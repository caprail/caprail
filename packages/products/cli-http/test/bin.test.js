import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { runCliHttpProductBin } from '../bin/caprail-cli-http.js';

const binPath = fileURLToPath(new URL('../bin/caprail-cli-http.js', import.meta.url));

function createCaptureStream() {
  const chunks = [];

  return {
    stream: {
      write(chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      },
    },
    text() {
      return Buffer.concat(chunks).toString('utf8');
    },
  };
}

test('bin forwards argv/std streams/env to runner and prints startup message', async () => {
  const stdout = createCaptureStream();
  const stderr = createCaptureStream();
  const argv = ['--config', 'cfg.yaml', '--no-auth'];
  const env = { PATH: process.env.PATH ?? '' };
  let capturedOptions;

  const result = await runCliHttpProductBin({
    argv,
    stdout: stdout.stream,
    stderr: stderr.stream,
    env,
    run: async (options) => {
      capturedOptions = options;
      return {
        ok: true,
        address: { host: '127.0.0.1', port: 8100 },
      };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(capturedOptions.argv, argv);
  assert.equal(capturedOptions.stdout, stdout.stream);
  assert.equal(capturedOptions.stderr, stderr.stream);
  assert.equal(capturedOptions.env, env);
  assert.match(stdout.text(), /caprail-cli-http: listening on http:\/\/127.0.0.1:8100/);
  assert.equal(stderr.text(), '');
});

test('bin writes fatal errors to stderr and returns fallback exit result', async () => {
  const stderr = createCaptureStream();
  const originalExitCode = process.exitCode;

  try {
    const result = await runCliHttpProductBin({
      stderr: stderr.stream,
      run: async () => {
        throw Object.assign(new Error('bad startup'), { code: 'startup_failed' });
      },
    });

    assert.equal(process.exitCode, 1);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'startup_failed');
    assert.match(stderr.text(), /fatal error: bad startup/);
  } finally {
    process.exitCode = originalExitCode;
  }
});

test('bin script exits non-zero on startup failure when invoked via node', () => {
  const completed = spawnSync(process.execPath, [
    binPath,
    '--config',
    '/definitely/missing-config.yaml',
    '--no-auth',
  ], {
    encoding: 'utf8',
  });

  assert.equal(completed.status, 1);
  assert.match(completed.stderr, /caprail-cli-http: fatal error:/);
});
