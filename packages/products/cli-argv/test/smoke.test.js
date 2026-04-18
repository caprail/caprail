import test from 'node:test';
import assert from 'node:assert/strict';

import * as cliProduct from '@caprail/cli-argv';

test('cli product package resolves through the public entrypoint', () => {
  assert.equal(typeof cliProduct.runCliProduct, 'function');
});
