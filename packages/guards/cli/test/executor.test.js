import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { executeGuardedCommand } from '../src/executor.js';

const fixturePath = fileURLToPath(new URL('./fixtures/child-runner.mjs', import.meta.url));

function createTempDir() {
  return mkdtempSync(join(tmpdir(), 'caprail-guard-cli-exec-'));
}

function createConfig(settings = {}) {
  return {
    settings: {
      auditLog: settings.auditLog ?? 'none',
      auditFormat: settings.auditFormat ?? 'jsonl',
    },
    tools: {
      node: {
        name: 'node',
        binary: process.execPath,
        description: 'Node test runner',
        allow: ['capture-env', 'echo', 'fail', 'literal;arg'],
        deny: ['write-marker'],
        denyFlags: ['--blocked'],
      },
    },
  };
}

test('executor runs allowed commands non-interactively with pager suppression env vars', async () => {
  const stdoutChunks = [];
  const stderrChunks = [];
  const config = createConfig();

  const result = await executeGuardedCommand(config, 'node', [fixturePath, 'capture-env', 'literal;arg'], {
    env: {
      ...process.env,
      PAGER: 'less',
      GIT_PAGER: 'less',
      GH_PAGER: 'less',
      TERM: 'xterm-256color',
    },
    onStdout: (chunk) => stdoutChunks.push(chunk),
    onStderr: (chunk) => stderrChunks.push(chunk),
  });

  assert.equal(result.status, 'executed');
  assert.equal(result.allowed, true);
  assert.equal(result.executed, true);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderrBytes, 0);

  const payload = JSON.parse(Buffer.concat(stdoutChunks).toString('utf8').trim());

  assert.equal(payload.pager, 'cat');
  assert.equal(payload.gitPager, 'cat');
  assert.equal(payload.ghPager, 'cat');
  assert.equal(payload.term, 'dumb');
  assert.equal(payload.stdinLength, 0);
  assert.deepEqual(payload.args, ['literal;arg']);
  assert.equal(Buffer.concat(stderrChunks).toString('utf8'), '');
});

test('executor denies blocked commands without spawning and still writes jsonl audit events', async () => {
  const tempDir = createTempDir();
  const auditPath = join(tempDir, 'audit.jsonl');
  const markerPath = join(tempDir, 'marker.txt');
  const config = createConfig({
    auditLog: auditPath,
    auditFormat: 'jsonl',
  });
  const stdoutChunks = [];
  const stderrChunks = [];

  const result = await executeGuardedCommand(config, 'node', [fixturePath, 'write-marker', markerPath], {
    onStdout: (chunk) => stdoutChunks.push(chunk),
    onStderr: (chunk) => stderrChunks.push(chunk),
  });

  assert.equal(result.status, 'denied');
  assert.equal(result.allowed, false);
  assert.equal(result.executed, false);
  assert.equal(existsSync(markerPath), false);
  assert.equal(Buffer.concat(stdoutChunks).toString('utf8'), '');
  assert.equal(Buffer.concat(stderrChunks).toString('utf8'), '');

  const [auditEntry] = readFileSync(auditPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));

  assert.equal(auditEntry.result, 'denied');
  assert.equal(auditEntry.reason, 'matched_deny');
  assert.deepEqual(auditEntry.args, [fixturePath, 'write-marker', markerPath]);
});

test('executor keeps audit output separate from child stdout and stderr', async () => {
  const tempDir = createTempDir();
  const auditPath = join(tempDir, 'audit.jsonl');
  const config = createConfig({
    auditLog: auditPath,
    auditFormat: 'jsonl',
  });
  const stdoutChunks = [];
  const stderrChunks = [];

  const result = await executeGuardedCommand(config, 'node', [fixturePath, 'echo', 'hello'], {
    onStdout: (chunk) => stdoutChunks.push(chunk),
    onStderr: (chunk) => stderrChunks.push(chunk),
  });

  assert.equal(result.status, 'executed');
  assert.equal(result.exitCode, 0);

  const stdout = Buffer.concat(stdoutChunks).toString('utf8').trim();
  const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
  const auditEntry = JSON.parse(readFileSync(auditPath, 'utf8').trim());

  assert.equal(stdout, 'stdout:hello');
  assert.equal(stderr, 'stderr:hello');
  assert.equal(auditEntry.result, 'allowed');
  assert.match(readFileSync(auditPath, 'utf8'), /"tool":"node"/);
  assert.equal(stdout.includes('"tool":"node"'), false);
  assert.equal(stderr.includes('"tool":"node"'), false);
});

test('executor supports text audit logs and returns child failure metadata', async () => {
  const tempDir = createTempDir();
  const auditPath = join(tempDir, 'audit.log');
  const config = createConfig({
    auditLog: auditPath,
    auditFormat: 'text',
  });
  const stderrChunks = [];

  const result = await executeGuardedCommand(config, 'node', [fixturePath, 'fail'], {
    onStderr: (chunk) => stderrChunks.push(chunk),
  });

  assert.equal(result.status, 'executed');
  assert.equal(result.allowed, true);
  assert.equal(result.executed, true);
  assert.equal(result.exitCode, 7);
  assert.match(Buffer.concat(stderrChunks).toString('utf8'), /child failed/);
  assert.match(readFileSync(auditPath, 'utf8'), /ALLOWED node/);
});
