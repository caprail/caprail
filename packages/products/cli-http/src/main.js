import * as guardCli from '@caprail/guard-cli';
import { startHttpTransportServer } from '@caprail/transport-http';

import { parseCliHttpArgv } from './parser.js';

export async function startCliHttpProduct({
  argv = process.argv.slice(2),
  stdout: _stdout = process.stdout,
  stderr: _stderr = process.stderr,
  env = process.env,
  guard = guardCli,
  startServer = startHttpTransportServer,
} = {}) {
  const parsed = parseCliHttpArgv(argv);
  if (!parsed.ok) {
    throw createProductError(parsed.error);
  }

  const options = parsed.options;

  let server;
  try {
    server = await startServer({
      guard,
      configPath: options.configPath,
      host: options.host,
      port: options.port,
      timeoutMs: options.timeoutMs,
      maxOutputBytes: options.maxOutputBytes,
      auth: options.auth,
      env,
    });
  } catch (error) {
    throw createProductError({
      code: 'startup_failed',
      message: `Failed to start HTTP server: ${formatError(error)}`,
      cause: error,
    });
  }

  const address = normalizeAddress(server, options.host, options.port);

  return {
    ok: true,
    server,
    address,
    options,
  };
}

function normalizeAddress(server, fallbackHost, fallbackPort) {
  const rawAddress = server.address();

  if (!rawAddress || typeof rawAddress === 'string') {
    return {
      host: fallbackHost,
      port: fallbackPort,
    };
  }

  return {
    host: rawAddress.address,
    port: rawAddress.port,
  };
}

function createProductError(error) {
  const wrapped = new Error(error.message);
  wrapped.code = error.code;
  if (error.flag) wrapped.flag = error.flag;
  if (error.value !== undefined) wrapped.value = error.value;
  if (error.cause) wrapped.cause = error.cause;
  return wrapped;
}

function formatError(error) {
  if (error && typeof error.message === 'string' && error.message.length > 0) {
    return error.message;
  }

  return String(error ?? 'Unknown error');
}
