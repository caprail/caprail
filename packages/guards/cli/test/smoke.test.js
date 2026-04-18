import test from 'node:test';
import assert from 'node:assert/strict';

import * as guardCli from '@caprail/guard-cli';

test('guard package resolves through the public entrypoint', () => {
  assert.equal(typeof guardCli.loadConfig, 'function');
  assert.equal(typeof guardCli.validateConfig, 'function');
  assert.equal(typeof guardCli.evaluateCommand, 'function');
  assert.equal(typeof guardCli.buildDiscoveryPayload, 'function');
  assert.equal(typeof guardCli.buildExplainPayload, 'function');
  assert.equal(typeof guardCli.executeGuardedCommand, 'function');
});
