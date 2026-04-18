import test from 'node:test';
import assert from 'node:assert/strict';

import * as transportArgv from '@caprail/transport-argv';

test('argv transport package resolves through the public entrypoint', async () => {
  assert.equal(typeof transportArgv.parseArgv, 'function');
  assert.equal(typeof transportArgv.runArgvTransport, 'function');

  const result = await transportArgv.runArgvTransport({
    argv: ['--', 'gh', 'pr', 'list'],
    guard: {
      loadAndValidateConfig: () => ({ ok: true, config: {} }),
      buildListPayload: () => ({ ok: true, payload: { tools: {} } }),
      buildExplainPayload: () => ({ ok: true, payload: {} }),
      executeGuardedCommand: async () => ({ status: 'executed', exitCode: 0 }),
    },
    stdout: { write() {} },
    stderr: { write() {} },
  });

  assert.equal(result.ok, true);
  assert.equal(result.exitCode, 0);
});
