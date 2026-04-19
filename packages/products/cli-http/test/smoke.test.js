import test from 'node:test';
import assert from 'node:assert/strict';

import * as cliHttpProduct from '@caprail/cli-http';

test('cli-http product package resolves through public entrypoint', () => {
  assert.equal(typeof cliHttpProduct.startCliHttpProduct, 'function');
  assert.equal(typeof cliHttpProduct.parseCliHttpArgv, 'function');
});
