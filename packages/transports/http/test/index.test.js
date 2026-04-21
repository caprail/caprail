import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createHttpTransportServer, startHttpTransportServer } from '../src/index.js';
import { createMockGuard } from './fixtures/mock-guard.js';

// ---------------------------------------------------------------------------
// HTTP request helper
// ---------------------------------------------------------------------------

function req(port, { method = 'GET', path = '/', body, auth } = {}) {
  return new Promise((resolve, reject) => {
    const bodyStr = body != null ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (bodyStr) headers['Content-Length'] = String(Buffer.byteLength(bodyStr));
    if (auth) headers['Authorization'] = `Bearer ${auth}`;

    const request = http.request(
      { hostname: '127.0.0.1', port, method, path, headers },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json;
          try { json = JSON.parse(text); } catch {}
          resolve({ status: res.statusCode, json, text });
        });
      },
    );
    request.on('error', reject);
    if (bodyStr) request.write(bodyStr);
    request.end();
  });
}

async function withServer(guardOverrides, authOptions, fn) {
  const guard = createMockGuard(guardOverrides);
  const server = await startHttpTransportServer({
    guard,
    auth: authOptions,
    host: '127.0.0.1',
    port: 0,
  });
  const port = server.address().port;
  try {
    await fn(port, guard);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function createTempPolicyFile(initialText = 'version-1') {
  const tempDir = mkdtempSync(join(tmpdir(), 'caprail-http-hot-reload-'));
  const configPath = join(tempDir, 'config.yaml');
  writeFileSync(configPath, initialText);
  return { tempDir, configPath };
}

function makeConfig(configPath, toolName) {
  return {
    source: { path: configPath, source: 'cli' },
    settings: { auditLog: 'none', auditFormat: 'jsonl' },
    tools: {
      [toolName]: {
        name: toolName,
        binary: toolName,
        description: `${toolName} tool`,
        allow: ['run'],
        deny: [],
        denyFlags: [],
      },
    },
  };
}

function makeListPayload(config) {
  return {
    ok: true,
    payload: {
      tools: Object.fromEntries(
        Object.entries(config.tools).map(([toolName, tool]) => [toolName, {
          binary: tool.binary,
          description: tool.description,
          allow: [...tool.allow],
          deny: [...tool.deny],
          deny_flags: [...tool.denyFlags],
        }]),
      ),
    },
  };
}

// ---------------------------------------------------------------------------
// Startup validation
// ---------------------------------------------------------------------------

test('createHttpTransportServer throws when guard is missing', async () => {
  await assert.rejects(
    () => createHttpTransportServer({ auth: { noAuth: true } }),
    /guard adapter/i,
  );
});

test('createHttpTransportServer throws when guard is missing required methods', async () => {
  await assert.rejects(
    () => createHttpTransportServer({
      guard: { loadAndValidateConfig: () => {} },
      auth: { noAuth: true },
    }),
    /missing required methods/i,
  );
});

test('createHttpTransportServer throws when auth config is missing', async () => {
  await assert.rejects(
    () => createHttpTransportServer({ guard: createMockGuard() }),
    /auth config/i,
  );
});

test('createHttpTransportServer throws when auth has neither token nor noAuth', async () => {
  await assert.rejects(
    () => createHttpTransportServer({ guard: createMockGuard(), auth: {} }),
    /auth config/i,
  );
});

test('createHttpTransportServer throws when config fails to load', async () => {
  const guard = createMockGuard({
    loadAndValidateConfig: () => ({
      ok: false,
      error: { code: 'config_not_found', message: 'Config file was not found.' },
    }),
  });

  await assert.rejects(
    () => createHttpTransportServer({ guard, auth: { noAuth: true } }),
    /config file was not found/i,
  );
});

test('createHttpTransportServer throws when loadAndValidateConfig throws', async () => {
  const guard = createMockGuard({
    loadAndValidateConfig: () => { throw new Error('disk read error'); },
  });

  await assert.rejects(
    () => createHttpTransportServer({ guard, auth: { noAuth: true } }),
    /disk read error/i,
  );
});

test('createHttpTransportServer returns a server when startup succeeds', async () => {
  const server = await createHttpTransportServer({
    guard: createMockGuard(),
    auth: { noAuth: true },
  });
  assert.ok(server);
  assert.equal(typeof server.listen, 'function');
});

// ---------------------------------------------------------------------------
// GET /health  (no auth required)
// ---------------------------------------------------------------------------

test('GET /health returns 200 { status: ok } without auth', async () => {
  await withServer({}, { noAuth: true }, async (port) => {
    const res = await req(port, { path: '/health' });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { status: 'ok' });
  });
});

test('GET /health returns 200 even when token mode is active and no token is sent', async () => {
  await withServer({}, { token: 'my-secret' }, async (port) => {
    const res = await req(port, { path: '/health' });
    assert.equal(res.status, 200);
  });
});

// ---------------------------------------------------------------------------
// GET /discover
// ---------------------------------------------------------------------------

test('GET /discover returns tools payload with execution metadata', async () => {
  await withServer({}, { noAuth: true }, async (port) => {
    const res = await req(port, { path: '/discover' });
    assert.equal(res.status, 200);
    assert.ok(res.json.tools);
    assert.ok(res.json.tools.gh);
    assert.equal(res.json.execution.mode, 'non-interactive');
    assert.equal(typeof res.json.execution.timeout_ms, 'number');
    assert.equal(typeof res.json.execution.max_output_bytes, 'number');
  });
});

test('GET /discover returns 401 when auth is required and no token is sent', async () => {
  await withServer({}, { token: 'secret' }, async (port) => {
    const res = await req(port, { path: '/discover' });
    assert.equal(res.status, 401);
    assert.equal(res.json.error.code, 'unauthorized');
  });
});

test('GET /discover returns 200 with correct bearer token', async () => {
  await withServer({}, { token: 'secret' }, async (port) => {
    const res = await req(port, { path: '/discover', auth: 'secret' });
    assert.equal(res.status, 200);
    assert.ok(res.json.tools);
  });
});

test('GET /discover returns 401 with wrong bearer token', async () => {
  await withServer({}, { token: 'secret' }, async (port) => {
    const res = await req(port, { path: '/discover', auth: 'wrong' });
    assert.equal(res.status, 401);
  });
});

test('GET /discover reflects configured timeout and output cap', async () => {
  const guard = createMockGuard();
  const server = await startHttpTransportServer({
    guard,
    auth: { noAuth: true },
    host: '127.0.0.1',
    port: 0,
    timeoutMs: 15000,
    maxOutputBytes: 524288,
  });
  const port = server.address().port;
  try {
    const res = await req(port, { path: '/discover' });
    assert.equal(res.json.execution.timeout_ms, 15000);
    assert.equal(res.json.execution.max_output_bytes, 524288);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('GET /discover hot reloads config after the policy file changes', async () => {
  const { configPath } = createTempPolicyFile('version-1');
  const configs = [makeConfig(configPath, 'gh'), makeConfig(configPath, 'git')];
  let loadCount = 0;

  const guard = createMockGuard({
    config: configs[0],
    loadAndValidateConfig: () => {
      const config = configs[Math.min(loadCount, configs.length - 1)];
      loadCount += 1;
      return {
        ok: true,
        configPath,
        config,
        report: { valid: true, errors: [], warnings: [] },
        error: null,
      };
    },
    buildListPayload: (config) => makeListPayload(config),
  });

  const server = await startHttpTransportServer({
    guard,
    auth: { noAuth: true },
    host: '127.0.0.1',
    port: 0,
    configPath,
  });
  const port = server.address().port;

  try {
    const before = await req(port, { path: '/discover' });
    assert.equal(before.status, 200);
    assert.ok(before.json.tools.gh);
    assert.equal(guard.calls.loadAndValidateConfig.length, 1, 'startup load only before file change');

    writeFileSync(configPath, 'version-2 with different size');

    const after = await req(port, { path: '/discover' });
    assert.equal(after.status, 200);
    assert.ok(after.json.tools.git);
    assert.equal(guard.calls.loadAndValidateConfig.length, 2, 'reload triggered after file change');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('protected routes fail closed on invalid hot reload and recover after config is fixed', async () => {
  const { configPath } = createTempPolicyFile('valid-v1');

  const guard = createMockGuard({
    config: makeConfig(configPath, 'gh'),
    loadAndValidateConfig: () => {
      const text = readFileSync(configPath, 'utf8');

      if (text.startsWith('invalid')) {
        return {
          ok: false,
          error: { code: 'config_invalid', message: 'Config syntax is invalid.' },
          report: { valid: false, errors: [{ code: 'config_invalid', message: 'Config syntax is invalid.' }], warnings: [] },
        };
      }

      const toolName = text.includes('v2') ? 'git' : 'gh';
      return {
        ok: true,
        configPath,
        config: makeConfig(configPath, toolName),
        report: { valid: true, errors: [], warnings: [] },
        error: null,
      };
    },
    buildListPayload: (config) => makeListPayload(config),
    executeGuardedCommand: async (config) => ({
      status: 'executed',
      allowed: true,
      executed: true,
      exitCode: Object.keys(config.tools)[0] === 'git' ? 7 : 0,
    }),
  });

  const server = await startHttpTransportServer({
    guard,
    auth: { noAuth: true },
    host: '127.0.0.1',
    port: 0,
    configPath,
  });
  const port = server.address().port;

  try {
    const initial = await req(port, { method: 'POST', path: '/exec', body: { tool: 'gh', args: [] } });
    assert.equal(initial.status, 200);
    assert.equal(initial.json.exit_code, 0);

    writeFileSync(configPath, 'invalid-v2');

    const invalidDiscover = await req(port, { path: '/discover' });
    assert.equal(invalidDiscover.status, 500);
    assert.equal(invalidDiscover.json.error.code, 'config_reload_failed');

    const invalidExec = await req(port, { method: 'POST', path: '/exec', body: { tool: 'gh', args: [] } });
    assert.equal(invalidExec.status, 500);
    assert.equal(invalidExec.json.error.code, 'config_reload_failed');
    assert.equal(guard.calls.loadAndValidateConfig.length, 2, 'invalid fingerprint is cached until file changes again');

    writeFileSync(configPath, 'valid-v2 with a new fingerprint');

    const recoveredDiscover = await req(port, { path: '/discover' });
    assert.equal(recoveredDiscover.status, 200);
    assert.ok(recoveredDiscover.json.tools.git);

    const recoveredExec = await req(port, { method: 'POST', path: '/exec', body: { tool: 'git', args: [] } });
    assert.equal(recoveredExec.status, 200);
    assert.equal(recoveredExec.json.exit_code, 7);
    assert.equal(guard.calls.loadAndValidateConfig.length, 3);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// ---------------------------------------------------------------------------
// Unknown routes
// ---------------------------------------------------------------------------

test('unknown route returns 404 not_found', async () => {
  await withServer({}, { noAuth: true }, async (port) => {
    const res = await req(port, { path: '/unknown' });
    assert.equal(res.status, 404);
    assert.equal(res.json.error.code, 'not_found');
  });
});

// ---------------------------------------------------------------------------
// POST /exec — request validation
// ---------------------------------------------------------------------------

test('POST /exec returns 401 when auth required and token missing', async () => {
  await withServer({}, { token: 'secret' }, async (port) => {
    const res = await req(port, { method: 'POST', path: '/exec', body: { tool: 'gh', args: [] } });
    assert.equal(res.status, 401);
    assert.equal(res.json.error.code, 'unauthorized');
  });
});

test('POST /exec returns 400 for non-JSON body', async () => {
  await withServer({}, { noAuth: true }, async (port) => {
    const r = await new Promise((resolve, reject) => {
      const raw = 'not json';
      const request = http.request(
        {
          hostname: '127.0.0.1', port, method: 'POST', path: '/exec',
          headers: { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(raw)) },
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            resolve({ status: res.statusCode, json: JSON.parse(text) });
          });
        },
      );
      request.on('error', reject);
      request.write(raw);
      request.end();
    });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, 'invalid_json');
  });
});

test('POST /exec returns 400 when tool is missing', async () => {
  await withServer({}, { noAuth: true }, async (port) => {
    const res = await req(port, { method: 'POST', path: '/exec', body: { args: [] } });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, 'invalid_request');
    assert.match(res.json.error.message, /tool/);
  });
});

test('POST /exec returns 400 when args is not an array', async () => {
  await withServer({}, { noAuth: true }, async (port) => {
    const res = await req(port, { method: 'POST', path: '/exec', body: { tool: 'gh', args: 'pr list' } });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, 'invalid_request');
    assert.match(res.json.error.message, /args/);
  });
});

test('POST /exec returns 400 when args contains non-strings', async () => {
  await withServer({}, { noAuth: true }, async (port) => {
    const res = await req(port, { method: 'POST', path: '/exec', body: { tool: 'gh', args: ['pr', 42] } });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, 'invalid_request');
  });
});

// ---------------------------------------------------------------------------
// POST /exec — execution outcomes
// ---------------------------------------------------------------------------

test('POST /exec returns 200 with full output for an allowed command', async () => {
  await withServer({}, { noAuth: true }, async (port) => {
    const res = await req(port, { method: 'POST', path: '/exec', body: { tool: 'gh', args: ['pr', 'list'] } });
    assert.equal(res.status, 200);
    assert.equal(res.json.allowed, true);
    assert.equal(res.json.exit_code, 0);
    assert.equal(typeof res.json.stdout, 'string');
    assert.equal(typeof res.json.stderr, 'string');
    assert.equal(res.json.timed_out, false);
    assert.equal(res.json.truncated, false);
  });
});

test('POST /exec returns 200 for a non-zero exit code (policy allowed, process failed)', async () => {
  await withServer({
    executeGuardedCommand: async () => ({ status: 'executed', allowed: true, executed: true, exitCode: 1 }),
  }, { noAuth: true }, async (port) => {
    const res = await req(port, { method: 'POST', path: '/exec', body: { tool: 'gh', args: ['pr', 'list'] } });
    assert.equal(res.status, 200);
    assert.equal(res.json.exit_code, 1);
  });
});

test('POST /exec returns 403 policy_denied for a denied command', async () => {
  await withServer({
    executeGuardedCommand: async () => ({
      status: 'denied',
      allowed: false,
      executed: false,
      message: "'pr create' is not in the allow list for 'gh'.",
    }),
  }, { noAuth: true }, async (port) => {
    const res = await req(port, { method: 'POST', path: '/exec', body: { tool: 'gh', args: ['pr', 'create'] } });
    assert.equal(res.status, 403);
    assert.equal(res.json.allowed, false);
    assert.equal(res.json.error.code, 'policy_denied');
    assert.match(res.json.error.message, /pr create/);
  });
});

test('POST /exec returns 500 for guard execution_error', async () => {
  await withServer({
    executeGuardedCommand: async () => ({
      status: 'execution_error',
      error: { code: 'spawn_failed', message: 'Binary not found.' },
    }),
  }, { noAuth: true }, async (port) => {
    const res = await req(port, { method: 'POST', path: '/exec', body: { tool: 'gh', args: [] } });
    assert.equal(res.status, 500);
    assert.equal(res.json.error.code, 'internal_error');
  });
});

// ---------------------------------------------------------------------------
// POST /exec — timeout and output cap
// ---------------------------------------------------------------------------

test('POST /exec returns 504 execution_timeout when command exceeds timeoutMs', async () => {
  const guard = createMockGuard({
    executeGuardedCommand: async (_config, _tool, _args, options) => {
      // Respect abort signal so the test doesn't hang
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 10_000);
        options.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          resolve();
        }, { once: true });
      });
      return { status: 'executed', allowed: true, executed: true, exitCode: 0 };
    },
  });

  const server = await startHttpTransportServer({
    guard,
    auth: { noAuth: true },
    host: '127.0.0.1',
    port: 0,
    timeoutMs: 50, // 50 ms — fires almost immediately
  });
  const port = server.address().port;
  try {
    const res = await req(port, { method: 'POST', path: '/exec', body: { tool: 'gh', args: [] } });
    assert.equal(res.status, 504);
    assert.equal(res.json.error.code, 'execution_timeout');
    assert.equal(res.json.timed_out, true);
    assert.equal(res.json.allowed, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('POST /exec returns 413 output_limit_exceeded when output cap is breached', async () => {
  const bigChunk = Buffer.alloc(512, 'x');

  const guard = createMockGuard({
    executeGuardedCommand: async (_config, _tool, _args, options) => {
      // Write chunks until aborted
      for (let i = 0; i < 10 && !options.signal?.aborted; i++) {
        options.onStdout?.(bigChunk);
      }
      return { status: 'executed', allowed: true, executed: true, exitCode: 0 };
    },
  });

  const server = await startHttpTransportServer({
    guard,
    auth: { noAuth: true },
    host: '127.0.0.1',
    port: 0,
    maxOutputBytes: 1024, // 1 KB — exceeded after 3rd 512-byte chunk
  });
  const port = server.address().port;
  try {
    const res = await req(port, { method: 'POST', path: '/exec', body: { tool: 'gh', args: [] } });
    assert.equal(res.status, 413);
    assert.equal(res.json.error.code, 'output_limit_exceeded');
    assert.equal(res.json.truncated, true);
    assert.equal(res.json.allowed, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('POST /exec stdout and stderr are captured separately', async () => {
  await withServer({
    executeGuardedCommand: async (_config, _tool, _args, options) => {
      options.onStdout?.(Buffer.from('out1'));
      options.onStdout?.(Buffer.from('out2'));
      options.onStderr?.(Buffer.from('err1'));
      return { status: 'executed', allowed: true, executed: true, exitCode: 0 };
    },
  }, { noAuth: true }, async (port) => {
    const res = await req(port, { method: 'POST', path: '/exec', body: { tool: 'gh', args: [] } });
    assert.equal(res.status, 200);
    assert.equal(res.json.stdout, 'out1out2');
    assert.equal(res.json.stderr, 'err1');
  });
});
