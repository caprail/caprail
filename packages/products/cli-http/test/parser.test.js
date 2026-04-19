import test from 'node:test';
import assert from 'node:assert/strict';

import { parseCliHttpArgv } from '../src/parser.js';

test('parser accepts token auth and numeric options', () => {
  const parsed = parseCliHttpArgv([
    '--config', 'cfg.yaml',
    '--host', '127.0.0.1',
    '--port', '8100',
    '--token', 'secret',
    '--timeout-ms', '5000',
    '--max-output-bytes', '2048',
  ]);

  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.options, {
    configPath: 'cfg.yaml',
    host: '127.0.0.1',
    port: 8100,
    timeoutMs: 5000,
    maxOutputBytes: 2048,
    auth: { token: 'secret' },
  });
});

test('parser accepts --no-auth and --port 0', () => {
  const parsed = parseCliHttpArgv([
    '--config', 'cfg.yaml',
    '--port', '0',
    '--no-auth',
  ]);

  assert.equal(parsed.ok, true);
  assert.equal(parsed.options.port, 0);
  assert.deepEqual(parsed.options.auth, { noAuth: true });
});

test('parser rejects missing --config', () => {
  const parsed = parseCliHttpArgv(['--port', '8100', '--no-auth']);

  assert.equal(parsed.ok, false);
  assert.equal(parsed.error.code, 'missing_required_flag');
  assert.match(parsed.error.message, /--config/);
});

test('parser rejects conflicting --token and --no-auth', () => {
  const parsed = parseCliHttpArgv(['--config', 'cfg.yaml', '--token', 'secret', '--no-auth']);

  assert.equal(parsed.ok, false);
  assert.equal(parsed.error.code, 'conflicting_auth_flags');
});

test('parser rejects unknown flags', () => {
  const parsed = parseCliHttpArgv(['--config', 'cfg.yaml', '--no-auth', '--wat']);

  assert.equal(parsed.ok, false);
  assert.equal(parsed.error.code, 'unknown_flag');
});

test('parser rejects missing value for value flags', () => {
  const parsed = parseCliHttpArgv(['--config', 'cfg.yaml', '--token']);

  assert.equal(parsed.ok, false);
  assert.equal(parsed.error.code, 'missing_flag_value');
  assert.equal(parsed.error.flag, '--token');
});

test('parser rejects invalid numeric values', () => {
  const parsed = parseCliHttpArgv(['--config', 'cfg.yaml', '--no-auth', '--port', '-1']);

  assert.equal(parsed.ok, false);
  assert.equal(parsed.error.code, 'invalid_number');
  assert.equal(parsed.error.flag, '--port');
});
