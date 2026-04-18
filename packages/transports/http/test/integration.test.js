import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as guardCli from '@caprail/guard-cli';

import { startHttpTransportServer } from '../src/index.js';

const FIXTURE_CHILD = fileURLToPath(
  new URL('./fixtures/integration-child.mjs', import.meta.url),
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function req(port, { method = 'GET', path = '/', body, auth } = {}) {
  return new Promise((resolve, reject) => {
    const bodyStr = body != null ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (bodyStr) headers['Content-Length'] = String(Buffer.byteLength(bodyStr));
    if (auth) headers['Authorization'] = `Bearer ${auth}`;

    const request = http.request(
      { hostname: '127.0.0.1', port, method, path, headers },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json;
          try { json = JSON.parse(text); } catch {}
          resolve({ status: res.statusCode, json, text });
        });
      },
    );
    request.on('error', reject);
    if (bodyStr) request.write(bodyStr);
    request.end();
  });
}

/**
 * Create a temp config that allows `node` with specific arg patterns.
 * Uses the real Node.js binary so tests are self-contained.
 */
function createTempConfig() {
  const tempDir = mkdtempSync(join(tmpdir(), 'caprail-http-integ-'));
  const configPath = join(tempDir, 'config.yaml');
  const nodeBinary = process.execPath.replace(/\\/g, '\\\\');

  writeFileSync(configPath, [
    'settings:',
    '  audit_log: none',
    '  audit_format: jsonl',
    'tools:',
    '  node:',
    `    binary: "${nodeBinary}"`,
    '    description: Node integration fixture',
    '    allow:',
    `      - "${FIXTURE_CHILD.replace(/\\/g, '\\\\')} echo"`,
    `      - "${FIXTURE_CHILD.replace(/\\/g, '\\\\')} fail"`,
    `      - "${FIXTURE_CHILD.replace(/\\/g, '\\\\')} bigoutput"`,
    `      - "${FIXTURE_CHILD.replace(/\\/g, '\\\\')} sleep"`,
    '',
  ].join('\n'));

  return configPath;
}

async function withIntegServer(extraOptions, fn) {
  const configPath = createTempConfig();
  const server = await startHttpTransportServer({
    guard: guardCli,
    configPath,
    auth: { noAuth: true },
    host: '127.0.0.1',
    port: 0,
    ...extraOptions,
  });
  const port = server.address().port;
  try {
    await fn(port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// ---------------------------------------------------------------------------
// Tests: auth
// ---------------------------------------------------------------------------

test('integration: token auth rejects requests without a bearer token', async () => {
  const configPath = createTempConfig();
  const server = await startHttpTransportServer({
    guard: guardCli,
    configPath,
    auth: { token: 'integ-secret' },
    host: '127.0.0.1',
    port: 0,
  });
  const port = server.address().port;
  try {
    const healthRes = await req(port, { path: '/health' });
    assert.equal(healthRes.status, 200, '/health is always public');

    const discoverRes = await req(port, { path: '/discover' });
    assert.equal(discoverRes.status, 401, '/discover requires auth');

    const execRes = await req(port, {
      method: 'POST', path: '/exec', body: { tool: 'node', args: [] },
    });
    assert.equal(execRes.status, 401, '/exec requires auth');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('integration: token auth accepts requests with correct bearer token', async () => {
  const configPath = createTempConfig();
  const server = await startHttpTransportServer({
    guard: guardCli,
    configPath,
    auth: { token: 'integ-secret' },
    host: '127.0.0.1',
    port: 0,
  });
  const port = server.address().port;
  try {
    const discoverRes = await req(port, { path: '/discover', auth: 'integ-secret' });
    assert.equal(discoverRes.status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// ---------------------------------------------------------------------------
// Tests: /health
// ---------------------------------------------------------------------------

test('integration: GET /health returns 200 for a running server', async () => {
  await withIntegServer({}, async (port) => {
    const res = await req(port, { path: '/health' });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { status: 'ok' });
  });
});

// ---------------------------------------------------------------------------
// Tests: /discover
// ---------------------------------------------------------------------------

test('integration: GET /discover returns the configured tool and execution metadata', async () => {
  await withIntegServer({}, async (port) => {
    const res = await req(port, { path: '/discover' });
    assert.equal(res.status, 200);
    assert.ok(res.json.tools.node, 'node tool is present');
    assert.ok(Array.isArray(res.json.tools.node.allow), 'allow list is an array');
    assert.equal(res.json.execution.mode, 'non-interactive');
    assert.equal(res.json.execution.timeout_ms, 30_000);
    assert.equal(res.json.execution.max_output_bytes, 1_048_576);
  });
});

test('integration: startup fails if config path is invalid', async () => {
  await assert.rejects(
    () => startHttpTransportServer({
      guard: guardCli,
      configPath: '/no/such/config.yaml',
      auth: { noAuth: true },
      host: '127.0.0.1',
      port: 0,
    }),
    /startup validation failed/i,
  );
});

// ---------------------------------------------------------------------------
// Tests: /exec — allowed execution
// ---------------------------------------------------------------------------

test('integration: /exec allowed command returns stdout, stderr, exit_code', async () => {
  await withIntegServer({}, async (port) => {
    const res = await req(port, {
      method: 'POST', path: '/exec',
      body: { tool: 'node', args: [FIXTURE_CHILD, 'echo', 'hello'] },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.allowed, true);
    assert.equal(res.json.exit_code, 0);
    assert.match(res.json.stdout, /echo:hello/);
    assert.equal(res.json.timed_out, false);
    assert.equal(res.json.truncated, false);
  });
});

test('integration: /exec allowed command with non-zero exit still returns HTTP 200', async () => {
  await withIntegServer({}, async (port) => {
    const res = await req(port, {
      method: 'POST', path: '/exec',
      body: { tool: 'node', args: [FIXTURE_CHILD, 'fail'] },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.exit_code, 2);
    assert.match(res.json.stderr, /child-failed/);
  });
});

// ---------------------------------------------------------------------------
// Tests: /exec — denial
// ---------------------------------------------------------------------------

test('integration: /exec denied command returns 403 policy_denied', async () => {
  await withIntegServer({}, async (port) => {
    // 'unknown' mode has no allow entry
    const res = await req(port, {
      method: 'POST', path: '/exec',
      body: { tool: 'node', args: [FIXTURE_CHILD, 'unknown_mode'] },
    });
    assert.equal(res.status, 403);
    assert.equal(res.json.allowed, false);
    assert.equal(res.json.error.code, 'policy_denied');
  });
});

test('integration: /exec with unknown tool returns 403 policy_denied', async () => {
  await withIntegServer({}, async (port) => {
    const res = await req(port, {
      method: 'POST', path: '/exec',
      body: { tool: 'nonexistent', args: [] },
    });
    assert.equal(res.status, 403);
    assert.equal(res.json.error.code, 'policy_denied');
  });
});

// ---------------------------------------------------------------------------
// Tests: /exec — timeout
// ---------------------------------------------------------------------------

test('integration: /exec returns 504 when command exceeds timeoutMs', async () => {
  await withIntegServer({ timeoutMs: 300 }, async (port) => {
    const res = await req(port, {
      method: 'POST', path: '/exec',
      body: { tool: 'node', args: [FIXTURE_CHILD, 'sleep'] },
    });
    assert.equal(res.status, 504);
    assert.equal(res.json.error.code, 'execution_timeout');
    assert.equal(res.json.timed_out, true);
    assert.equal(res.json.allowed, true);
  });
}, { timeout: 5000 });

// ---------------------------------------------------------------------------
// Tests: /exec — output cap
// ---------------------------------------------------------------------------

test('integration: /exec returns 413 when output exceeds maxOutputBytes', async () => {
  // Cap at 64 KB; fixture writes 3.2 MB
  await withIntegServer({ maxOutputBytes: 65536 }, async (port) => {
    const res = await req(port, {
      method: 'POST', path: '/exec',
      body: { tool: 'node', args: [FIXTURE_CHILD, 'bigoutput'] },
    });
    assert.equal(res.status, 413);
    assert.equal(res.json.error.code, 'output_limit_exceeded');
    assert.equal(res.json.truncated, true);
    assert.equal(res.json.allowed, true);
  });
}, { timeout: 5000 });
