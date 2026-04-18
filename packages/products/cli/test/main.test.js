import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runCliProduct } from '../src/main.js';

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

function createHomeDirectoryConfig() {
  const homeDirectory = mkdtempSync(join(tmpdir(), 'caprail-cli-product-'));
  const configDirectory = join(homeDirectory, '.config', 'caprail-cli');
  const configPath = join(configDirectory, 'config.yaml');

  mkdirSync(configDirectory, { recursive: true });

  writeFileSync(configPath, [
    'settings:',
    '  audit_log: none',
    '  audit_format: jsonl',
    'tools:',
    '  node:',
    `    binary: "${process.execPath.replace(/\\/g, '\\\\')}"`,
    '    description: Node fixture',
    '    allow:',
    '      - --version',
    '',
  ].join('\n'));

  return {
    homeDirectory,
    configPath,
  };
}

test('composition: runCliProduct composes guard-cli + argv transport and validates via forwarded runtime options', async () => {
  const stdout = createCaptureStream();
  const stderr = createCaptureStream();
  const { homeDirectory } = createHomeDirectoryConfig();

  const result = await runCliProduct({
    argv: ['--validate', '--json'],
    stdout: stdout.stream,
    stderr: stderr.stream,
    env: {
      PATH: process.env.PATH ?? '',
    },
    platform: 'linux',
    homeDirectory,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.mode, 'validate');
  assert.equal(result.report.valid, true);
  assert.equal(JSON.parse(stdout.text()).valid, true);
  assert.equal(stderr.text(), '');
});

test('forwarding: runCliProduct passes argv tokens unchanged and returns transport error payloads', async () => {
  const stdout = createCaptureStream();
  const stderr = createCaptureStream();

  const result = await runCliProduct({
    argv: ['--does-not-exist'],
    stdout: stdout.stream,
    stderr: stderr.stream,
  });

  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 1);
  assert.equal(result.error.code, 'unknown_flag');
  assert.equal(stdout.text(), '');
  assert.match(stderr.text(), /argument error: Unknown transport flag '--does-not-exist'\./);
});
