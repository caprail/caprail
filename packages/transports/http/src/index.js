import { createServer } from 'node:http';

import { parseJsonBody, writeJson, writeError, checkAuth } from './server.js';
import { buildDiscoverPayload } from './discovery.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576; // 1 MiB

const REQUIRED_GUARD_METHODS = ['loadAndValidateConfig', 'buildListPayload', 'executeGuardedCommand'];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate the guard contract, auth config, and policy config, then return a
 * configured `http.Server` that is not yet listening. Throws if startup fails.
 *
 * @param {object} options
 * @param {object} options.guard             Guard adapter
 * @param {string} [options.configPath]      Explicit config path (optional)
 * @param {object} options.auth              `{ token }` or `{ noAuth: true }`
 * @param {number} [options.timeoutMs]       Child timeout in ms (default 30 000)
 * @param {number} [options.maxOutputBytes]  Max captured bytes (default 1 MiB)
 * @param {object} [options.env]             Environment for child processes
 * @returns {Promise<import('node:http').Server>}
 */
export async function createHttpTransportServer(options = {}) {
  const {
    guard,
    configPath,
    auth,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
    env = process.env,
  } = options;

  const guardValidation = validateGuardContract(guard);
  if (!guardValidation.ok) {
    throw new Error(guardValidation.error.message);
  }

  const authValidation = validateAuth(auth);
  if (!authValidation.ok) {
    throw new Error(authValidation.error.message);
  }

  // Fail-closed startup: load and validate config before binding.
  const configOptions = { env };
  if (configPath) configOptions.configPath = configPath;

  let loaded;
  try {
    loaded = guard.loadAndValidateConfig(configOptions);
  } catch (err) {
    throw new Error(`Config load failed: ${err?.message ?? String(err)}`);
  }

  if (!loaded || !loaded.ok) {
    const msg = loaded?.error?.message ?? 'Config validation failed.';
    throw new Error(`Startup validation failed: ${msg}`);
  }

  const config = loaded.config;
  const ctx = { guard, config, auth, timeoutMs, maxOutputBytes, env };

  const server = createServer((req, res) => {
    handleRequest(req, res, ctx).catch((err) => {
      if (!res.headersSent) {
        writeError(res, 500, 'internal_error', err?.message ?? 'Internal error.');
      }
    });
  });

  return server;
}

/**
 * Create an HTTP transport server and start it listening on `host`:`port`.
 * Resolves with the listening `http.Server`.
 *
 * @param {object} options
 * @param {string} [options.host]  Bind host (default '127.0.0.1')
 * @param {number} [options.port]  Bind port (default 8100). Use 0 for OS-assigned.
 * @param {*}      [options.*]     All other options forwarded to createHttpTransportServer
 * @returns {Promise<import('node:http').Server>}
 */
export async function startHttpTransportServer(options = {}) {
  const { host = '127.0.0.1', port = 8100, ...rest } = options;
  const server = await createHttpTransportServer(rest);

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  return server;
}

// ---------------------------------------------------------------------------
// Route dispatcher
// ---------------------------------------------------------------------------

async function handleRequest(req, res, ctx) {
  // Strip query string for routing
  const url = req.url?.split('?')[0] ?? '/';

  if (req.method === 'GET' && url === '/health') {
    return handleHealth(req, res);
  }

  if (req.method === 'GET' && url === '/discover') {
    return handleDiscover(req, res, ctx);
  }

  if (req.method === 'POST' && url === '/exec') {
    return handleExec(req, res, ctx);
  }

  writeError(res, 404, 'not_found', 'Not found.');
}

// ---------------------------------------------------------------------------
// /health
// ---------------------------------------------------------------------------

function handleHealth(_req, res) {
  writeJson(res, 200, { status: 'ok' });
}

// ---------------------------------------------------------------------------
// /discover
// ---------------------------------------------------------------------------

function handleDiscover(req, res, ctx) {
  const authCheck = checkAuth(req, ctx.auth);
  if (!authCheck.ok) {
    return writeError(res, 401, 'unauthorized', 'Missing or invalid bearer token.');
  }

  const discovery = buildDiscoverPayload(ctx.guard, ctx.config, {
    timeoutMs: ctx.timeoutMs,
    maxOutputBytes: ctx.maxOutputBytes,
  });

  if (!discovery.ok) {
    return writeError(res, 500, 'internal_error', discovery.error?.message ?? 'Discovery failed.');
  }

  writeJson(res, 200, discovery.payload);
}

// ---------------------------------------------------------------------------
// /exec
// ---------------------------------------------------------------------------

async function handleExec(req, res, ctx) {
  const authCheck = checkAuth(req, ctx.auth);
  if (!authCheck.ok) {
    return writeError(res, 401, 'unauthorized', 'Missing or invalid bearer token.');
  }

  let body;
  try {
    body = await parseJsonBody(req);
  } catch (err) {
    return writeError(res, 400, err?.code ?? 'invalid_request', err?.message ?? 'Invalid request body.');
  }

  const shapeError = validateExecBody(body);
  if (shapeError) {
    return writeError(res, 400, 'invalid_request', shapeError);
  }

  const { tool, args } = body;

  const execResult = await executeWithLimits(ctx.guard, ctx.config, tool, args, {
    timeoutMs: ctx.timeoutMs,
    maxOutputBytes: ctx.maxOutputBytes,
    env: ctx.env,
  });

  if (execResult.abortReason === 'timeout') {
    return writeJson(res, 504, {
      allowed: true,
      timed_out: true,
      truncated: false,
      error: {
        code: 'execution_timeout',
        message: `Command exceeded ${ctx.timeoutMs}ms.`,
      },
    });
  }

  if (execResult.abortReason === 'output_cap') {
    return writeJson(res, 413, {
      allowed: true,
      timed_out: false,
      truncated: true,
      error: {
        code: 'output_limit_exceeded',
        message: `Captured output exceeded ${ctx.maxOutputBytes} bytes.`,
      },
    });
  }

  const { result } = execResult;

  if (result.status === 'denied') {
    return writeJson(res, 403, {
      allowed: false,
      error: {
        code: 'policy_denied',
        message: result.message ?? 'Command denied by policy.',
      },
    });
  }

  if (result.status === 'executed') {
    return writeJson(res, 200, {
      allowed: true,
      exit_code: result.exitCode ?? null,
      stdout: execResult.stdout,
      stderr: execResult.stderr,
      timed_out: false,
      truncated: false,
    });
  }

  // execution_error, audit_error, or unknown status
  return writeError(
    res, 500, 'internal_error',
    result?.error?.message ?? 'Command execution failed.',
  );
}

// ---------------------------------------------------------------------------
// Execution with timeout and output cap
// ---------------------------------------------------------------------------

async function executeWithLimits(guard, config, toolName, args, options) {
  const { timeoutMs, maxOutputBytes, env } = options;
  const controller = new AbortController();

  const stdoutChunks = [];
  const stderrChunks = [];
  let totalBytes = 0;
  let abortReason = null;

  function onStdout(chunk) {
    if (abortReason) return;
    const budget = maxOutputBytes - totalBytes;
    if (chunk.length >= budget) {
      if (budget > 0) stdoutChunks.push(chunk.slice(0, budget));
      totalBytes = maxOutputBytes;
      abortReason = 'output_cap';
      controller.abort();
    } else {
      stdoutChunks.push(chunk);
      totalBytes += chunk.length;
    }
  }

  function onStderr(chunk) {
    if (abortReason) return;
    const budget = maxOutputBytes - totalBytes;
    if (chunk.length >= budget) {
      if (budget > 0) stderrChunks.push(chunk.slice(0, budget));
      totalBytes = maxOutputBytes;
      abortReason = 'output_cap';
      controller.abort();
    } else {
      stderrChunks.push(chunk);
      totalBytes += chunk.length;
    }
  }

  const timeoutId = setTimeout(() => {
    if (!abortReason) {
      abortReason = 'timeout';
      controller.abort();
    }
  }, timeoutMs);

  let result;
  try {
    result = await guard.executeGuardedCommand(config, toolName, args, {
      env,
      signal: controller.signal,
      onStdout,
      onStderr,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  return {
    result,
    stdout: Buffer.concat(stdoutChunks).toString('utf8'),
    stderr: Buffer.concat(stderrChunks).toString('utf8'),
    abortReason,
  };
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function validateExecBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return 'Request body must be a JSON object.';
  }
  if (typeof body.tool !== 'string' || body.tool.length === 0) {
    return "'tool' must be a non-empty string.";
  }
  if (!Array.isArray(body.args)) {
    return "'args' must be an array of strings.";
  }
  if (!body.args.every((a) => typeof a === 'string')) {
    return "'args' must be an array of strings.";
  }
  return null;
}

function validateGuardContract(guard) {
  if (!guard || typeof guard !== 'object') {
    return {
      ok: false,
      error: { code: 'guard_contract_invalid', message: 'A guard adapter object is required.' },
    };
  }

  const missing = REQUIRED_GUARD_METHODS.filter((m) => typeof guard[m] !== 'function');
  if (missing.length > 0) {
    return {
      ok: false,
      error: {
        code: 'guard_contract_invalid',
        message: `Guard adapter is missing required methods: ${missing.join(', ')}`,
      },
    };
  }

  return { ok: true };
}

function validateAuth(auth) {
  if (!auth || typeof auth !== 'object') {
    return {
      ok: false,
      error: {
        code: 'auth_config_required',
        message: 'Auth config is required. Provide { token } or { noAuth: true }.',
      },
    };
  }

  if (auth.noAuth === true) {
    return { ok: true };
  }

  if (typeof auth.token === 'string' && auth.token.length > 0) {
    return { ok: true };
  }

  return {
    ok: false,
    error: {
      code: 'auth_config_required',
      message: 'Auth config requires a non-empty token or explicit { noAuth: true }.',
    },
  };
}
