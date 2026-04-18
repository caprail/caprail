import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDiscoveryPayload,
  buildExplainPayload,
  buildListPayload,
} from '../src/discovery.js';

const config = {
  tools: {
    gh: {
      name: 'gh',
      binary: 'gh',
      description: 'GitHub CLI',
      allow: ['pr list', 'pr view'],
      deny: ['pr create'],
      denyFlags: ['--web'],
    },
    az: {
      name: 'az',
      binary: 'az',
      description: 'Azure CLI',
      allow: ['group list'],
      deny: [],
      denyFlags: [],
    },
  },
};

test('discovery returns all configured tools without leaking internals', () => {
  const result = buildDiscoveryPayload(config);

  assert.equal(result.ok, true);
  assert.deepEqual(result.payload, {
    tools: {
      gh: {
        binary: 'gh',
        description: 'GitHub CLI',
        allow: ['pr list', 'pr view'],
        deny: ['pr create'],
        deny_flags: ['--web'],
      },
      az: {
        binary: 'az',
        description: 'Azure CLI',
        allow: ['group list'],
        deny: [],
        deny_flags: [],
      },
    },
  });

  assert.equal('name' in result.payload.tools.gh, false);
  assert.equal('denyFlags' in result.payload.tools.gh, false);
});

test('discovery can list a single tool', () => {
  const result = buildListPayload(config, { toolName: 'gh' });

  assert.equal(result.ok, true);
  assert.deepEqual(result.payload.tools, {
    gh: {
      binary: 'gh',
      description: 'GitHub CLI',
      allow: ['pr list', 'pr view'],
      deny: ['pr create'],
      deny_flags: ['--web'],
    },
  });
});

test('discovery returns a stable unknown-tool error', () => {
  const result = buildListPayload(config, { toolName: 'gws' });

  assert.equal(result.ok, false);
  assert.deepEqual(result.error, {
    code: 'unknown_tool',
    tool: 'gws',
    message: "Tool 'gws' is not configured.",
  });
});

test('discovery returns a stable empty-config error', () => {
  const result = buildDiscoveryPayload({ tools: {} });

  assert.equal(result.ok, false);
  assert.deepEqual(result.error, {
    code: 'no_tools_configured',
    message: 'The guard config does not define any tools.',
  });
});

test('explain returns spec-aligned payload fields for allowed commands', () => {
  const result = buildExplainPayload(config, 'gh', ['--repo', 'org/repo', 'pr', 'list']);

  assert.equal(result.ok, true);
  assert.deepEqual(result.payload, {
    tool: 'gh',
    normalized_args: ['--repo', 'org/repo', 'pr', 'list'],
    matched_allow: 'pr list',
    matched_deny: null,
    matched_deny_flag: null,
    deny_flags: ['--web'],
    allowed: true,
    reason: 'matched_allow',
    message: "Matched allow entry 'pr list'.",
  });
});

test('explain returns deny-flag detail for blocked commands', () => {
  const result = buildExplainPayload(config, 'gh', ['pr', 'view', '123', '--web']);

  assert.equal(result.ok, true);
  assert.deepEqual(result.payload, {
    tool: 'gh',
    normalized_args: ['pr', 'view', '123', '--web'],
    matched_allow: 'pr view',
    matched_deny: null,
    matched_deny_flag: '--web',
    deny_flags: ['--web'],
    allowed: false,
    reason: 'matched_deny_flag',
    message: "Matched deny flag '--web'.",
  });
});

test('explain returns a stable unknown-tool error', () => {
  const result = buildExplainPayload(config, 'gws', ['gmail', 'messages', 'list']);

  assert.equal(result.ok, false);
  assert.deepEqual(result.error, {
    code: 'unknown_tool',
    tool: 'gws',
    message: "Tool 'gws' is not configured.",
  });
});
