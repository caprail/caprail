#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

import { startCliHttpProduct } from '../src/main.js';

const FALLBACK_EXIT_CODE = 1;

export async function runCliHttpProductBin({
  argv = process.argv.slice(2),
  stdout = process.stdout,
  stderr = process.stderr,
  env = process.env,
  run = startCliHttpProduct,
} = {}) {
  try {
    const result = await run({ argv, stdout, stderr, env });

    stdout.write(`caprail-cli-http: listening on ${formatAddress(result.address)}\n`);

    return result;
  } catch (error) {
    stderr.write(`caprail-cli-http: fatal error: ${formatError(error)}\n`);
    process.exitCode = FALLBACK_EXIT_CODE;

    return {
      ok: false,
      exitCode: FALLBACK_EXIT_CODE,
      error: {
        code: error?.code ?? 'cli_http_product_unhandled_error',
        message: formatError(error),
      },
    };
  }
}

function formatAddress(address) {
  if (!address) return 'unknown-address';

  const host = address.host ?? '127.0.0.1';
  const port = address.port ?? 'unknown-port';
  return `http://${host}:${port}`;
}

function formatError(error) {
  if (error && typeof error.message === 'string' && error.message.length > 0) {
    return error.message;
  }

  return String(error ?? 'Unknown error');
}

function isDirectExecution() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isDirectExecution()) {
  await runCliHttpProductBin();
}
