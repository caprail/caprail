import test from 'node:test';
import assert from 'node:assert/strict';

import { getPackageInfo, packageName } from '../src/index.js';

test('guard package resolves', () => {
  assert.equal(packageName, '@caprail/guard-cli');
  assert.deepEqual(getPackageInfo(), {
    name: '@caprail/guard-cli',
  });
});
