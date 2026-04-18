import test from 'node:test';
import assert from 'node:assert/strict';

import { runCliProduct } from '@caprail/cli-argv';

import { createProductFixture } from './fixtures/create-product-fixture.js';

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

test('integration validate mode works through @caprail/cli-argv public entrypoint', async () => {
  const { configPath } = createProductFixture();
  const stdout = createCaptureStream();
  const stderr = createCaptureStream();

  const result = await runCliProduct({
    argv: ['--config', configPath, '--validate', '--json'],
    stdout: stdout.stream,
    stderr: stderr.stream,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.mode, 'validate');
  assert.equal(JSON.parse(stdout.text()).valid, true);
  assert.equal(stderr.text(), '');
});

test('integration list mode returns discovery payload through product composition', async () => {
  const { configPath } = createProductFixture();
  const stdout = createCaptureStream();
  const stderr = createCaptureStream();

  const result = await runCliProduct({
    argv: ['--config', configPath, '--list', 'node', '--json'],
    stdout: stdout.stream,
    stderr: stderr.stream,
  });

  assert.equal(result.exitCode, 0);
  const payload = JSON.parse(stdout.text());
  assert.equal(payload.tools.node.binary, process.execPath);
  assert.equal(payload.tools.node.allow.includes('echo'), true);
  assert.equal(stderr.text(), '');
});

test('integration explain mode reports allow match using fixture command tokens', async () => {
  const { configPath, scriptPath } = createProductFixture();
  const stdout = createCaptureStream();
  const stderr = createCaptureStream();

  const result = await runCliProduct({
    argv: ['--config', configPath, '--explain', '--json', '--', 'node', scriptPath, 'echo', 'hello'],
    stdout: stdout.stream,
    stderr: stderr.stream,
  });

  assert.equal(result.exitCode, 0);
  const payload = JSON.parse(stdout.text());
  assert.equal(payload.tool, 'node');
  assert.equal(payload.allowed, true);
  assert.equal(payload.matched_allow, 'echo');
  assert.equal(stderr.text(), '');
});

test('integration execute mode forwards child stdout/stderr and vendor exit code', async () => {
  const { configPath, scriptPath } = createProductFixture();
  const stdout = createCaptureStream();
  const stderr = createCaptureStream();

  const result = await runCliProduct({
    argv: ['--config', configPath, '--', 'node', scriptPath, 'code', '7'],
    stdout: stdout.stream,
    stderr: stderr.stream,
  });

  assert.equal(result.exitCode, 7);
  assert.match(stdout.text(), /code:7/);
  assert.match(stderr.text(), /warn:code/);
});

test('integration execute denied maps to exit 126 with a clear denial message', async () => {
  const { configPath, scriptPath } = createProductFixture();
  const stdout = createCaptureStream();
  const stderr = createCaptureStream();

  const result = await runCliProduct({
    argv: ['--config', configPath, '--', 'node', scriptPath, 'blocked'],
    stdout: stdout.stream,
    stderr: stderr.stream,
  });

  assert.equal(result.exitCode, 126);
  assert.equal(stdout.text(), '');
  assert.match(stderr.text(), /denied/);
});
