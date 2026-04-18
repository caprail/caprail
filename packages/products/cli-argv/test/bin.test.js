import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { fileURLToPath } from 'node:url';

import { runCliProductBin } from '../bin/caprail-cli.js';

const binPath = fileURLToPath(new URL('../bin/caprail-cli.js', import.meta.url));

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

function createTempConfig() {
  const tempDirectory = mkdtempSync(join(tmpdir(), 'caprail-cli-bin-'));
  const configPath = join(tempDirectory, 'config.yaml');

  writeFileSync(configPath, [
    'settings:',
    '  audit_log: none',
    '  audit_format: jsonl',
    'tools:',
    '  node:',
    `    binary: "${process.execPath.replace(/\\/g, '\\\\')}"`,
    '    allow:',
    '      - --version',
    '',
  ].join('\n'));

  return { configPath };
}

test('bin forwards argv/std streams/runtime options and sets process.exitCode from runner result', async () => {
  const stdout = createCaptureStream();
  const stderr = createCaptureStream();
  const argv = ['--validate'];
  const env = { PATH: process.env.PATH ?? '' };
  const platform = 'linux';
  const homeDirectory = '/tmp/fake-home';
  const originalExitCode = process.exitCode;
  let receivedOptions = null;

  try {
    const result = await runCliProductBin({
      argv,
      stdout: stdout.stream,
      stderr: stderr.stream,
      env,
      platform,
      homeDirectory,
      run: async (options) => {
        receivedOptions = options;
        return { ok: false, exitCode: 7 };
      },
    });

    assert.equal(result.exitCode, 7);
    assert.equal(process.exitCode, 7);
    assert.deepEqual(receivedOptions.argv, argv);
    assert.equal(receivedOptions.stdout, stdout.stream);
    assert.equal(receivedOptions.stderr, stderr.stream);
    assert.equal(receivedOptions.env, env);
    assert.equal(receivedOptions.platform, platform);
    assert.equal(receivedOptions.homeDirectory, homeDirectory);
  } finally {
    process.exitCode = originalExitCode;
  }
});

test('bin defaults to exit code 1 when runner returns malformed exitCode', async () => {
  const originalExitCode = process.exitCode;

  try {
    await runCliProductBin({
      run: async () => ({ ok: true, exitCode: 'invalid' }),
    });

    assert.equal(process.exitCode, 1);
  } finally {
    process.exitCode = originalExitCode;
  }
});

test('bin writes unexpected errors to stderr and returns fallback exit result', async () => {
  const stderr = createCaptureStream();
  const originalExitCode = process.exitCode;

  try {
    const result = await runCliProductBin({
      stderr: stderr.stream,
      run: async () => {
        throw new Error('boom');
      },
    });

    assert.equal(process.exitCode, 1);
    assert.equal(result.exitCode, 1);
    assert.equal(result.error.code, 'cli_product_unhandled_error');
    assert.match(stderr.text(), /caprail-cli: fatal error: boom/);
  } finally {
    process.exitCode = originalExitCode;
  }
});

test('bin script runs end-to-end via node invocation and maps transport exit code', () => {
  const { configPath } = createTempConfig();

  const completed = spawnSync(process.execPath, [
    binPath,
    '--config',
    configPath,
    '--validate',
    '--json',
  ], {
    encoding: 'utf8',
  });

  assert.equal(completed.status, 0);
  assert.equal(completed.stderr, '');
  assert.equal(JSON.parse(completed.stdout).valid, true);
});
