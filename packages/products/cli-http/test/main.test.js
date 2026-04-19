import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { startCliHttpProduct } from '../src/main.js';
import { createHttpProductFixture } from './fixtures/create-http-product-fixture.js';

function req(port, { method = 'GET', path = '/', body, auth } = {}) {
  return new Promise((resolve, reject) => {
    const bodyStr = body != null ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (bodyStr) headers['Content-Length'] = String(Buffer.byteLength(bodyStr));
    if (auth) headers.Authorization = `Bearer ${auth}`;

    const request = http.request({ hostname: '127.0.0.1', port, method, path, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json;
        try { json = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, json, text });
      });
    });

    request.on('error', reject);
    if (bodyStr) request.write(bodyStr);
    request.end();
  });
}

test('composition: startCliHttpProduct maps parsed args to transport start options', async () => {
  const fakeGuard = { name: 'guard' };
  let capturedOptions;

  const started = await startCliHttpProduct({
    argv: [
      '--config', 'cfg.yaml',
      '--host', '127.0.0.1',
      '--port', '8101',
      '--token', 'secret',
      '--timeout-ms', '7000',
      '--max-output-bytes', '5000',
    ],
    env: { PATH: process.env.PATH ?? '' },
    guard: fakeGuard,
    startServer: async (options) => {
      capturedOptions = options;
      return {
        address() {
          return { address: '127.0.0.1', port: 8101 };
        },
      };
    },
  });

  assert.equal(started.ok, true);
  assert.equal(capturedOptions.guard, fakeGuard);
  assert.equal(capturedOptions.configPath, 'cfg.yaml');
  assert.equal(capturedOptions.host, '127.0.0.1');
  assert.equal(capturedOptions.port, 8101);
  assert.equal(capturedOptions.timeoutMs, 7000);
  assert.equal(capturedOptions.maxOutputBytes, 5000);
  assert.deepEqual(capturedOptions.auth, { token: 'secret' });
  assert.deepEqual(started.address, { host: '127.0.0.1', port: 8101 });
});

test('forwarding: startCliHttpProduct throws parser errors with stable code/message', async () => {
  await assert.rejects(
    () => startCliHttpProduct({ argv: ['--config', 'cfg.yaml'] }),
    (error) => {
      assert.equal(error.code, 'missing_auth_mode');
      assert.match(error.message, /auth mode/i);
      return true;
    },
  );
});

test('startup: startCliHttpProduct starts a real HTTP server and returns usable address', async () => {
  const { configPath, scriptPath } = createHttpProductFixture();
  const started = await startCliHttpProduct({
    argv: ['--config', configPath, '--port', '0', '--no-auth'],
  });

  try {
    assert.equal(started.ok, true);
    assert.equal(typeof started.address.port, 'number');

    const health = await req(started.address.port, { path: '/health' });
    assert.equal(health.status, 200);
    assert.deepEqual(health.json, { status: 'ok' });

    const exec = await req(started.address.port, {
      method: 'POST',
      path: '/exec',
      body: { tool: 'node', args: [scriptPath, 'echo', 'hello'] },
    });

    assert.equal(exec.status, 200);
    assert.equal(exec.json.allowed, true);
    assert.match(exec.json.stdout, /echo:hello/);
  } finally {
    await new Promise((resolve) => started.server.close(resolve));
  }
});
