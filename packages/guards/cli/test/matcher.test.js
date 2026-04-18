import test from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateCommand,
  evaluateToolPolicy,
  matchesTokenSequence,
  normalizeArgs,
  tokenizePolicyEntry,
} from '../src/matcher.js';

const ghTool = {
  name: 'gh',
  binary: 'gh',
  description: 'GitHub CLI',
  allow: ['pr list', 'pr view', 'pr'],
  deny: ['pr create'],
  denyFlags: ['--web'],
};

test('matcher normalizes --flag=value tokens', () => {
  assert.deepEqual(normalizeArgs(['pr', 'list', '--json=title,url']), [
    'pr',
    'list',
    '--json',
    'title,url',
  ]);
});

test('matcher keeps matching case-sensitive', () => {
  const result = evaluateToolPolicy(
    {
      ...ghTool,
      allow: ['PR list'],
      deny: [],
      denyFlags: [],
    },
    ['pr', 'list'],
  );

  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'no_allow_match');
});

test('matcher does not expand bundled short flags', () => {
  assert.deepEqual(normalizeArgs(['-abc', '--web=false']), ['-abc', '--web', 'false']);
});

test('matcher tokenizes policy entries on whitespace', () => {
  assert.deepEqual(tokenizePolicyEntry('  pr   list  '), ['pr', 'list']);
});

test('matcher finds contiguous token subsequences', () => {
  assert.equal(matchesTokenSequence(['--repo', 'org/repo', 'pr', 'list'], ['pr', 'list']), true);
  assert.equal(matchesTokenSequence(['pr', '--repo', 'org/repo', 'list'], ['pr', 'list']), false);
});

test('matcher allows a command when an allow entry matches later in argv', () => {
  const result = evaluateToolPolicy(ghTool, ['--repo', 'org/repo', 'pr', 'list', '--state', 'open']);

  assert.equal(result.allowed, true);
  assert.equal(result.matchedAllow, 'pr list');
  assert.equal(result.reason, 'matched_allow');
  assert.deepEqual(result.normalizedArgs, ['--repo', 'org/repo', 'pr', 'list', '--state', 'open']);
});

test('matcher denies when an explicit deny entry matches', () => {
  const result = evaluateToolPolicy(ghTool, ['pr', 'create', '--title', 'test']);

  assert.equal(result.allowed, false);
  assert.equal(result.matchedDeny, 'pr create');
  assert.equal(result.matchedAllow, 'pr');
  assert.equal(result.reason, 'matched_deny');
});

test('matcher denies when a deny flag appears before the terminator', () => {
  const result = evaluateToolPolicy(ghTool, ['pr', 'view', '123', '--web']);

  assert.equal(result.allowed, false);
  assert.equal(result.matchedDenyFlag, '--web');
  assert.equal(result.reason, 'matched_deny_flag');
});

test('matcher ignores deny flags after -- terminator', () => {
  const result = evaluateToolPolicy(ghTool, ['pr', 'view', '--', '--web']);

  assert.equal(result.allowed, true);
  assert.equal(result.matchedAllow, 'pr view');
  assert.equal(result.matchedDenyFlag, null);
});

test('matcher returns implicit deny when no allow entry matches', () => {
  const result = evaluateToolPolicy(
    {
      ...ghTool,
      allow: ['pr list'],
      deny: [],
      denyFlags: [],
    },
    ['repo', 'delete'],
  );

  assert.equal(result.allowed, false);
  assert.equal(result.matchedAllow, null);
  assert.equal(result.reason, 'no_allow_match');
});

test('matcher evaluates unknown tools as denied with a machine-readable reason', () => {
  const result = evaluateCommand(
    {
      tools: {
        gh: ghTool,
      },
    },
    'az',
    ['group', 'list'],
  );

  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'unknown_tool');
  assert.equal(result.matchedAllow, null);
  assert.deepEqual(result.normalizedArgs, ['group', 'list']);
});
