import test from 'node:test';
import assert from 'node:assert/strict';

import { parseArgv } from '../src/parser.js';

test('parses execution mode with required separator and preserves command tokens', () => {
  const parsed = parseArgv(['--config', 'policy.yaml', '--', 'gh', 'pr', 'list', '--json']);

  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.mode, 'execute');
  assert.equal(parsed.value.configPath, 'policy.yaml');
  assert.equal(parsed.value.toolName, 'gh');
  assert.deepEqual(parsed.value.args, ['pr', 'list', '--json']);
  assert.deepEqual(parsed.value.commandTokens, ['gh', 'pr', 'list', '--json']);
});

test('parses explain mode with json rendering and separator', () => {
  const parsed = parseArgv(['--config', 'policy.yaml', '--explain', '--json', '--', 'gh', 'pr', 'create']);

  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.mode, 'explain');
  assert.equal(parsed.value.json, true);
  assert.equal(parsed.value.toolName, 'gh');
  assert.deepEqual(parsed.value.args, ['pr', 'create']);
});

test('parses validate mode with json rendering', () => {
  const parsed = parseArgv(['--config', 'policy.yaml', '--validate', '--json']);

  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.value, {
    mode: 'validate',
    configPath: 'policy.yaml',
    json: true,
    toolName: null,
    separatorIndex: -1,
    commandTokens: [],
  });
});

test('parses list mode with optional tool and json rendering', () => {
  const parsed = parseArgv(['--config', 'policy.yaml', '--list', 'gh', '--json']);

  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.value, {
    mode: 'list',
    configPath: 'policy.yaml',
    json: true,
    toolName: 'gh',
    separatorIndex: -1,
    commandTokens: [],
  });
});

test('parses list mode with no tool token', () => {
  const parsed = parseArgv(['--list']);

  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.mode, 'list');
  assert.equal(parsed.value.toolName, null);
});

test('returns parser error when config flag is missing a value', () => {
  const parsed = parseArgv(['--config']);

  assert.equal(parsed.ok, false);
  assert.equal(parsed.error.code, 'flag_requires_value');
  assert.equal(parsed.error.flag, '--config');
});

test('returns parser error for conflicting mode flags', () => {
  const parsed = parseArgv(['--list', '--validate']);

  assert.equal(parsed.ok, false);
  assert.equal(parsed.error.code, 'mode_conflict');
});

test('requires separator for explain mode', () => {
  const parsed = parseArgv(['--explain', 'gh', 'pr', 'list']);

  assert.equal(parsed.ok, false);
  assert.equal(parsed.error.code, 'separator_required');
});

test('requires separator for default execution mode', () => {
  const parsed = parseArgv(['gh', 'pr', 'list']);

  assert.equal(parsed.ok, false);
  assert.equal(parsed.error.code, 'separator_required');
});

test('disallows separator for list mode', () => {
  const parsed = parseArgv(['--list', '--', 'gh']);

  assert.equal(parsed.ok, false);
  assert.equal(parsed.error.code, 'separator_not_allowed');
});

test('returns parser error for unknown flags', () => {
  const parsed = parseArgv(['--config', 'policy.yaml', '--unknown']);

  assert.equal(parsed.ok, false);
  assert.equal(parsed.error.code, 'unknown_flag');
});

test('returns parser error when explain mode has no command tokens', () => {
  const parsed = parseArgv(['--explain', '--']);

  assert.equal(parsed.ok, false);
  assert.equal(parsed.error.code, 'command_tokens_missing');
});

test('returns parser error when execution mode attempts json output', () => {
  const parsed = parseArgv(['--json', '--', 'gh', 'pr', 'list']);

  assert.equal(parsed.ok, false);
  assert.equal(parsed.error.code, 'json_not_supported_in_execution');
});
