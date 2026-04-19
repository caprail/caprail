import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { startCliHttpProduct } from '@caprail/cli-http';

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

test('integration starts product and serves /health, /discover, and /exec', async () => {
  const { configPath, scriptPath } = createHttpProductFixture();

  const started = await startCliHttpProduct({
    argv: ['--config', configPath, '--port', '0', '--no-auth'],
  });

  try {
    const health = await req(started.address.port, { path: '/health' });
    assert.equal(health.status, 200);
    assert.deepEqual(health.json, { status: 'ok' });

    const discover = await req(started.address.port, { path: '/discover' });
    assert.equal(discover.status, 200);
    assert.ok(discover.json.tools.node);

    const exec = await req(started.address.port, {
      method: 'POST',
      path: '/exec',
      body: { tool: 'node', args: [scriptPath, 'echo', 'ok'] },
    });
    assert.equal(exec.status, 200);
    assert.equal(exec.json.allowed, true);
    assert.match(exec.json.stdout, /echo:ok/);
  } finally {
    await new Promise((resolve) => started.server.close(resolve));
  }
});

test('integration startup failure: missing auth mode is rejected', async () => {
  const { configPath } = createHttpProductFixture();

  await assert.rejects(
    () => startCliHttpProduct({ argv: ['--config', configPath, '--port', '0'] }),
    (error) => {
      assert.equal(error.code, 'missing_auth_mode');
      return true;
    },
  );
});

test('integration startup failure: invalid config path surfaces startup error', async () => {
  await assert.rejects(
    () => startCliHttpProduct({
      argv: ['--config', '/no/such/config.yaml', '--port', '0', '--no-auth'],
    }),
    (error) => {
      assert.equal(error.code, 'startup_failed');
      assert.match(error.message, /failed to start http server/i);
      return true;
    },
  );
});
