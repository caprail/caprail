#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

import { runCliProduct } from '../src/main.js';

const FALLBACK_EXIT_CODE = 1;

export async function runCliProductBin({
  argv = process.argv.slice(2),
  stdout = process.stdout,
  stderr = process.stderr,
  env = process.env,
  platform = process.platform,
  homeDirectory,
  run = runCliProduct,
} = {}) {
  try {
    const result = await run({
      argv,
      stdout,
      stderr,
      env,
      platform,
      homeDirectory,
    });

    process.exitCode = normalizeExitCode(result?.exitCode);

    return result;
  } catch (error) {
    stderr.write(`caprail-cli: fatal error: ${formatFatalError(error)}\n`);
    process.exitCode = FALLBACK_EXIT_CODE;

    return {
      ok: false,
      exitCode: FALLBACK_EXIT_CODE,
      error: {
        code: 'cli_product_unhandled_error',
        message: formatFatalError(error),
      },
    };
  }
}

function normalizeExitCode(exitCode) {
  if (Number.isInteger(exitCode)) {
    return exitCode;
  }

  return FALLBACK_EXIT_CODE;
}

function formatFatalError(error) {
  if (error && typeof error.message === 'string' && error.message.length > 0) {
    return error.message;
  }

  return String(error ?? 'Unknown error');
}

function isDirectExecution() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isDirectExecution()) {
  await runCliProductBin();
}
