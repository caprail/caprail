import test from 'node:test';
import assert from 'node:assert/strict';

import * as transportHttp from '@caprail/transport-http';

test('http transport package resolves through the public entrypoint', () => {
  assert.equal(typeof transportHttp.createHttpTransportServer, 'function');
  assert.equal(typeof transportHttp.startHttpTransportServer, 'function');
});
