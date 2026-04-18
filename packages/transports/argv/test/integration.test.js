import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as guardCli from '@caprail/guard-cli';

import { runArgvTransport } from '../src/index.js';

const examplePolicyPath = fileURLToPath(new URL('../../../../examples/guards/cli.policy.yaml', import.meta.url));

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

function createTempIntegrationConfig() {
  const tempDir = mkdtempSync(join(tmpdir(), 'caprail-transport-argv-'));
  const scriptPath = join(tempDir, 'child.mjs');
  const configPath = join(tempDir, 'config.yaml');

  writeFileSync(scriptPath, [
    "const [mode, value] = process.argv.slice(2);",
    "if (mode === 'echo') {",
    "  process.stdout.write(`ok:${value || ''}\\n`);",
    "  process.stderr.write('warn:echo\\n');",
    '  process.exit(0);',
    '}',
    "process.stderr.write('unexpected mode\\n');",
    'process.exit(3);',
    '',
  ].join('\n'));

  writeFileSync(configPath, [
    'settings:',
    '  audit_log: none',
    '  audit_format: jsonl',
    'tools:',
    '  node:',
    `    binary: "${process.execPath.replace(/\\/g, '\\\\')}"`,
    '    description: Node integration fixture',
    '    allow:',
    '      - echo',
    '    deny:',
    '      - blocked',
    '',
  ].join('\n'));

  return {
    configPath,
    scriptPath,
  };
}

test('integration validate uses real @caprail/guard-cli and example policy', async () => {
  const stdout = createCaptureStream();
  const stderr = createCaptureStream();

  const result = await runArgvTransport({
    argv: ['--config', examplePolicyPath, '--validate', '--json'],
    guard: guardCli,
    stdout: stdout.stream,
    stderr: stderr.stream,
  });

  assert.equal(result.exitCode, 0);
  const report = JSON.parse(stdout.text());
  assert.equal(report.valid, true);
  assert.equal(Array.isArray(report.warnings), true);
  assert.equal(stderr.text(), '');
});

test('integration list uses real guard discovery payload', async () => {
  const stdout = createCaptureStream();
  const stderr = createCaptureStream();

  const result = await runArgvTransport({
    argv: ['--config', examplePolicyPath, '--list', 'gh', '--json'],
    guard: guardCli,
    stdout: stdout.stream,
    stderr: stderr.stream,
  });

  assert.equal(result.exitCode, 0);
  const payload = JSON.parse(stdout.text());
  assert.equal(payload.tools.gh.binary, 'gh');
  assert.equal(Array.isArray(payload.tools.gh.allow), true);
  assert.equal(stderr.text(), '');
});

test('integration explain uses real guard matcher payload', async () => {
  const stdout = createCaptureStream();
  const stderr = createCaptureStream();

  const result = await runArgvTransport({
    argv: ['--config', examplePolicyPath, '--explain', '--json', '--', 'gh', 'pr', 'create'],
    guard: guardCli,
    stdout: stdout.stream,
    stderr: stderr.stream,
  });

  assert.equal(result.exitCode, 0);
  const payload = JSON.parse(stdout.text());
  assert.equal(payload.tool, 'gh');
  assert.equal(payload.allowed, false);
  assert.equal(payload.reason, 'no_allow_match');
  assert.equal(stderr.text(), '');
});

test('integration execute allows and forwards child exit code/output', async () => {
  const { configPath, scriptPath } = createTempIntegrationConfig();
  const stdout = createCaptureStream();
  const stderr = createCaptureStream();

  const result = await runArgvTransport({
    argv: ['--config', configPath, '--', 'node', scriptPath, 'echo', 'hello'],
    guard: guardCli,
    stdout: stdout.stream,
    stderr: stderr.stream,
  });

  assert.equal(result.exitCode, 0);
  assert.match(stdout.text(), /ok:hello/);
  assert.match(stderr.text(), /warn:echo/);
});

test('integration execute denied command maps to exit 126', async () => {
  const { configPath, scriptPath } = createTempIntegrationConfig();
  const stdout = createCaptureStream();
  const stderr = createCaptureStream();

  const result = await runArgvTransport({
    argv: ['--config', configPath, '--', 'node', scriptPath, 'blocked'],
    guard: guardCli,
    stdout: stdout.stream,
    stderr: stderr.stream,
  });

  assert.equal(result.exitCode, 126);
  assert.equal(stdout.text(), '');
  assert.match(stderr.text(), /cliguard: denied/);
});
