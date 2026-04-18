import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

import { parseJsonBody, writeJson, writeError, checkAuth } from '../src/server.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReadable(body) {
  const req = new Readable({ read() {} });
  req.headers = {};
  if (body !== null) {
    req.push(typeof body === 'string' ? body : body);
    req.push(null);
  }
  return req;
}

function makeResponse() {
  const chunks = [];
  const res = {
    headersSent: false,
    statusCode: null,
    headers: {},
    writeHead(code, headers) {
      this.statusCode = code;
      this.headers = { ...this.headers, ...headers };
      this.headersSent = true;
    },
    end(data) {
      if (data) chunks.push(typeof data === 'string' ? Buffer.from(data) : data);
    },
    text() {
      return Buffer.concat(chunks).toString('utf8');
    },
    json() {
      return JSON.parse(this.text());
    },
  };
  return res;
}

// ---------------------------------------------------------------------------
// parseJsonBody
// ---------------------------------------------------------------------------

test('parseJsonBody resolves with parsed object for valid JSON', async () => {
  const req = makeReadable('{"tool":"gh","args":["pr","list"]}');
  const result = await parseJsonBody(req);
  assert.deepEqual(result, { tool: 'gh', args: ['pr', 'list'] });
});

test('parseJsonBody resolves with parsed array for valid JSON array', async () => {
  const req = makeReadable('[1,2,3]');
  const result = await parseJsonBody(req);
  assert.deepEqual(result, [1, 2, 3]);
});

test('parseJsonBody rejects with invalid_json for malformed JSON', async () => {
  const req = makeReadable('not json {');
  await assert.rejects(() => parseJsonBody(req), (err) => {
    assert.equal(err.code, 'invalid_json');
    return true;
  });
});

test('parseJsonBody rejects with request_too_large when body exceeds 64 KB', async () => {
  const bigBody = 'x'.repeat(65537);
  const req = makeReadable(bigBody);
  await assert.rejects(() => parseJsonBody(req), (err) => {
    assert.equal(err.code, 'request_too_large');
    return true;
  });
});

test('parseJsonBody rejects with request_error on stream error', async () => {
  const req = new Readable({ read() {} });
  req.headers = {};
  setImmediate(() => req.destroy(new Error('socket hang up')));
  await assert.rejects(() => parseJsonBody(req), (err) => {
    assert.equal(err.code, 'request_error');
    assert.match(err.message, /socket hang up/);
    return true;
  });
});

// ---------------------------------------------------------------------------
// writeJson
// ---------------------------------------------------------------------------

test('writeJson writes status code, Content-Type, and JSON body', () => {
  const res = makeResponse();
  writeJson(res, 200, { status: 'ok' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Content-Type'], 'application/json');
  assert.deepEqual(res.json(), { status: 'ok' });
});

test('writeJson sets Content-Length matching the body bytes', () => {
  const res = makeResponse();
  const payload = { message: 'hello' };
  writeJson(res, 201, payload);
  const expectedLength = Buffer.byteLength(JSON.stringify(payload));
  assert.equal(res.headers['Content-Length'], expectedLength);
});

test('writeJson handles non-200 status codes', () => {
  const res = makeResponse();
  writeJson(res, 404, { error: { code: 'not_found', message: 'Not found.' } });
  assert.equal(res.statusCode, 404);
});

// ---------------------------------------------------------------------------
// writeError
// ---------------------------------------------------------------------------

test('writeError produces stable { error: { code, message } } envelope', () => {
  const res = makeResponse();
  writeError(res, 401, 'unauthorized', 'Missing or invalid bearer token.');
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.json(), {
    error: { code: 'unauthorized', message: 'Missing or invalid bearer token.' },
  });
});

// ---------------------------------------------------------------------------
// checkAuth
// ---------------------------------------------------------------------------

test('checkAuth returns ok when noAuth is true regardless of header', () => {
  const req = makeReadable(null);
  req.headers = {};
  const result = checkAuth(req, { noAuth: true });
  assert.equal(result.ok, true);
});

test('checkAuth returns ok for a valid bearer token', () => {
  const req = makeReadable(null);
  req.headers = { authorization: 'Bearer secret-token' };
  const result = checkAuth(req, { token: 'secret-token' });
  assert.equal(result.ok, true);
});

test('checkAuth returns not-ok for a wrong bearer token', () => {
  const req = makeReadable(null);
  req.headers = { authorization: 'Bearer wrong-token' };
  const result = checkAuth(req, { token: 'secret-token' });
  assert.equal(result.ok, false);
});

test('checkAuth returns not-ok when Authorization header is missing', () => {
  const req = makeReadable(null);
  req.headers = {};
  const result = checkAuth(req, { token: 'secret-token' });
  assert.equal(result.ok, false);
});

test('checkAuth returns not-ok for Basic auth instead of Bearer', () => {
  const req = makeReadable(null);
  req.headers = { authorization: 'Basic dXNlcjpwYXNz' };
  const result = checkAuth(req, { token: 'dXNlcjpwYXNz' });
  assert.equal(result.ok, false);
});
