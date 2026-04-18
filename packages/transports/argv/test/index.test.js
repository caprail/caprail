import test from 'node:test';
import assert from 'node:assert/strict';

import { runArgvTransport } from '../src/index.js';
import { createMockGuard } from './fixtures/mock-guard.js';

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

test('validate mode exits 0 and renders text for a valid config', async () => {
  const stdout = createCaptureStream();
  const stderr = createCaptureStream();
  const guard = createMockGuard();

  const result = await runArgvTransport({
    argv: ['--config', 'policy.yaml', '--validate'],
    guard,
    stdout: stdout.stream,
    stderr: stderr.stream,
    env: { CAPRAIL_CLI_CONFIG: '/ignored' },
    platform: 'linux',
    homeDirectory: '/home/tester',
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.mode, 'validate');
  assert.match(stdout.text(), /Config is valid\./);
  assert.equal(stderr.text(), '');
  assert.equal(guard.calls.loadAndValidateConfig.length, 1);
  assert.deepEqual(guard.calls.loadAndValidateConfig[0], {
    configPath: 'policy.yaml',
    env: { CAPRAIL_CLI_CONFIG: '/ignored' },
    platform: 'linux',
    homeDirectory: '/home/tester',
  });
});

test('validate mode exits 1 and emits guard report JSON for invalid config', async () => {
  const stdout = createCaptureStream();
  const stderr = createCaptureStream();
  const report = {
    valid: false,
    errors: [{ code: 'config_invalid', message: 'Config must include a tools mapping.' }],
    warnings: [],
  };
  const guard = createMockGuard({
    loadAndValidateConfig: () => ({
      ok: false,
      report,
      error: report.errors[0],
    }),
  });

  const result = await runArgvTransport({
    argv: ['--validate', '--json'],
    guard,
    stdout: stdout.stream,
    stderr: stderr.stream,
  });

  assert.equal(result.exitCode, 1);
  assert.deepEqual(JSON.parse(stdout.text()), report);
  assert.equal(stderr.text(), '');
});

test('list mode renders JSON payload for a single tool', async () => {
  const stdout = createCaptureStream();
  const stderr = createCaptureStream();
  const guard = createMockGuard();

  const result = await runArgvTransport({
    argv: ['--list', 'gh', '--json'],
    guard,
    stdout: stdout.stream,
    stderr: stderr.stream,
  });

  assert.equal(result.exitCode, 0);
  assert.deepEqual(JSON.parse(stdout.text()), {
    tools: {
      gh: {
        binary: 'gh',
        description: 'GitHub CLI',
        allow: ['pr list', 'pr view'],
        deny: ['pr create'],
        deny_flags: ['--web'],
      },
    },
  });
  assert.equal(stderr.text(), '');
  assert.equal(guard.calls.buildListPayload.length, 1);
  assert.deepEqual(guard.calls.buildListPayload[0].options, { toolName: 'gh' });
});

test('list mode returns non-zero and stderr when guard list payload fails', async () => {
  const stdout = createCaptureStream();
  const stderr = createCaptureStream();
  const guard = createMockGuard({
    buildListPayload: () => ({
      ok: false,
      error: {
        code: 'unknown_tool',
        message: "Tool 'az' is not configured.",
      },
    }),
  });

  const result = await runArgvTransport({
    argv: ['--list', 'az'],
    guard,
    stdout: stdout.stream,
    stderr: stderr.stream,
  });

  assert.equal(result.exitCode, 1);
  assert.equal(stdout.text(), '');
  assert.match(stderr.text(), /Tool 'az' is not configured\./);
});

test('explain mode renders text output in a stable field order', async () => {
  const stdout = createCaptureStream();
  const stderr = createCaptureStream();
  const guard = createMockGuard({
    buildExplainPayload: () => ({
      ok: true,
      payload: {
        tool: 'gh',
        normalized_args: ['pr', 'create', '--title', 'test'],
        matched_allow: null,
        matched_deny: null,
        matched_deny_flag: null,
        deny_flags: ['--web'],
        allowed: false,
        reason: 'no_allow_match',
        message: 'No allow entry matched.',
      },
    }),
  });

  const result = await runArgvTransport({
    argv: ['--explain', '--', 'gh', 'pr', 'create', '--title', 'test'],
    guard,
    stdout: stdout.stream,
    stderr: stderr.stream,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(stderr.text(), '');
  assert.equal(stdout.text(), [
    'Tool:          gh',
    'Normalized:    pr create --title test',
    'Matched allow: (none)',
    'Matched deny:  (none)',
    'Matched deny flag: (none)',
    'Deny flags:    --web',
    'Result:        DENIED — no allow entry matched',
    '',
  ].join('\n'));
});

test('explain mode renders guard payload as JSON', async () => {
  const stdout = createCaptureStream();
  const stderr = createCaptureStream();
  const payload = {
    tool: 'gh',
    normalized_args: ['pr', 'list'],
    matched_allow: 'pr list',
    matched_deny: null,
    matched_deny_flag: null,
    deny_flags: ['--web'],
    allowed: true,
    reason: 'matched_allow',
    message: "Matched allow entry 'pr list'.",
  };
  const guard = createMockGuard({
    buildExplainPayload: () => ({ ok: true, payload }),
  });

  const result = await runArgvTransport({
    argv: ['--explain', '--json', '--', 'gh', 'pr', 'list'],
    guard,
    stdout: stdout.stream,
    stderr: stderr.stream,
  });

  assert.equal(result.exitCode, 0);
  assert.deepEqual(JSON.parse(stdout.text()), payload);
  assert.equal(stderr.text(), '');
});

test('list mode exits non-zero when config fails to load', async () => {
  const stdout = createCaptureStream();
  const stderr = createCaptureStream();
  const guard = createMockGuard({
    loadAndValidateConfig: () => ({
      ok: false,
      error: {
        code: 'config_not_found',
        message: 'No config file was found.',
      },
      report: {
        valid: false,
        errors: [{ code: 'config_not_found', message: 'No config file was found.' }],
        warnings: [],
      },
    }),
  });

  const result = await runArgvTransport({
    argv: ['--list'],
    guard,
    stdout: stdout.stream,
    stderr: stderr.stream,
  });

  assert.equal(result.exitCode, 1);
  assert.equal(guard.calls.buildListPayload.length, 0);
  assert.equal(stdout.text(), '');
  assert.match(stderr.text(), /No config file was found\./);
});

test('execute mode streams output and forwards child exit code', async () => {
  const stdout = createCaptureStream();
  const stderr = createCaptureStream();
  const guard = createMockGuard({
    executeGuardedCommand: async (_config, _toolName, _args, options) => {
      options.onStdout(Buffer.from('child stdout\n'));
      options.onStderr(Buffer.from('child stderr\n'));

      return {
        status: 'executed',
        allowed: true,
        executed: true,
        exitCode: 7,
      };
    },
  });

  const result = await runArgvTransport({
    argv: ['--', 'gh', 'pr', 'list'],
    guard,
    stdout: stdout.stream,
    stderr: stderr.stream,
  });

  assert.equal(result.exitCode, 7);
  assert.equal(stdout.text(), 'child stdout\n');
  assert.equal(stderr.text(), 'child stderr\n');
  assert.equal(guard.calls.executeGuardedCommand.length, 1);
  assert.equal(guard.calls.executeGuardedCommand[0].toolName, 'gh');
  assert.deepEqual(guard.calls.executeGuardedCommand[0].args, ['pr', 'list']);
});

test('execute mode maps denials to exit 126 with a clear stderr message', async () => {
  const stdout = createCaptureStream();
  const stderr = createCaptureStream();
  const guard = createMockGuard({
    executeGuardedCommand: async () => ({
      status: 'denied',
      allowed: false,
      executed: false,
      message: "'pr create' is not in the allow list for 'gh'.",
    }),
  });

  const result = await runArgvTransport({
    argv: ['--', 'gh', 'pr', 'create', '--title', 'test'],
    guard,
    stdout: stdout.stream,
    stderr: stderr.stream,
  });

  assert.equal(result.exitCode, 126);
  assert.equal(stdout.text(), '');
  assert.match(stderr.text(), /caprail-cli: denied 'gh pr create --title test' — 'pr create' is not in the allow list for 'gh'\./);
});

test('execute mode maps audit and execution failures to exit 1', async () => {
  const stdout = createCaptureStream();
  const stderr = createCaptureStream();
  const guard = createMockGuard({
    executeGuardedCommand: async () => ({
      status: 'audit_error',
      allowed: false,
      executed: false,
      error: {
        code: 'audit_write_failed',
        message: 'EACCES: permission denied',
      },
    }),
  });

  const result = await runArgvTransport({
    argv: ['--', 'gh', 'pr', 'list'],
    guard,
    stdout: stdout.stream,
    stderr: stderr.stream,
  });

  assert.equal(result.exitCode, 1);
  assert.equal(stdout.text(), '');
  assert.match(stderr.text(), /permission denied/);
});

test('execute mode maps thrown guard errors to exit 1', async () => {
  const stdout = createCaptureStream();
  const stderr = createCaptureStream();
  const guard = createMockGuard({
    executeGuardedCommand: async () => {
      throw new Error('spawn failed');
    },
  });

  const result = await runArgvTransport({
    argv: ['--', 'gh', 'pr', 'list'],
    guard,
    stdout: stdout.stream,
    stderr: stderr.stream,
  });

  assert.equal(result.exitCode, 1);
  assert.equal(stdout.text(), '');
  assert.match(stderr.text(), /spawn failed/);
});
