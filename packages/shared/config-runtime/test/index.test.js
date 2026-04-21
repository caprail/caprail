import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createConfigRuntime, createReloadableConfigRuntime } from '../src/index.js';

function createTempConfigFile(initialText = 'version-1') {
  const tempDir = mkdtempSync(join(tmpdir(), 'caprail-config-runtime-'));
  const configPath = join(tempDir, 'config.yaml');
  writeFileSync(configPath, initialText);
  return { tempDir, configPath };
}

test('createConfigRuntime returns the current config without reload behavior', () => {
  const config = { tools: { gh: { allow: ['pr list'] } } };
  const runtime = createConfigRuntime({ config, configPath: '/tmp/config.yaml' });

  assert.equal(runtime.config, config);
  assert.equal(runtime.configPath, '/tmp/config.yaml');
  assert.deepEqual(runtime.getActiveConfig(), { ok: true, config });
});

test('createReloadableConfigRuntime reloads after the config fingerprint changes', () => {
  const { configPath } = createTempConfigFile('version-1');
  let reloadCount = 0;

  const runtime = createReloadableConfigRuntime({
    config: { version: 'v1' },
    configPath,
    reloadConfig: () => {
      reloadCount += 1;
      return {
        ok: true,
        config: { version: 'v2' },
      };
    },
  });

  assert.deepEqual(runtime.getActiveConfig(), { ok: true, config: { version: 'v1' } });
  assert.equal(reloadCount, 0);

  writeFileSync(configPath, 'version-2 with different size');

  assert.deepEqual(runtime.getActiveConfig(), { ok: true, config: { version: 'v2' } });
  assert.equal(reloadCount, 1);
});

test('createReloadableConfigRuntime caches reload failures until the fingerprint changes', () => {
  const { configPath } = createTempConfigFile('valid-v1');
  let reloadCount = 0;

  const runtime = createReloadableConfigRuntime({
    config: { version: 'v1' },
    configPath,
    reloadConfig: () => {
      reloadCount += 1;
      const text = readFileSync(configPath, 'utf8');

      if (text.startsWith('invalid')) {
        return {
          ok: false,
          error: { code: 'config_invalid', message: 'Config syntax is invalid.' },
        };
      }

      return {
        ok: true,
        config: { version: text.includes('v2') ? 'v2' : 'v1' },
      };
    },
  });

  writeFileSync(configPath, 'invalid-v2');

  const failed = runtime.getActiveConfig();
  assert.equal(failed.ok, false);
  assert.equal(failed.error.code, 'config_reload_failed');
  assert.equal(reloadCount, 1);

  const cachedFailure = runtime.getActiveConfig();
  assert.equal(cachedFailure.ok, false);
  assert.equal(cachedFailure.error.code, 'config_reload_failed');
  assert.equal(reloadCount, 1);

  writeFileSync(configPath, 'valid-v2 with a new fingerprint');

  assert.deepEqual(runtime.getActiveConfig(), { ok: true, config: { version: 'v2' } });
  assert.equal(reloadCount, 2);
});

test('createReloadableConfigRuntime fails closed when config path is unavailable', () => {
  const runtime = createReloadableConfigRuntime({
    config: { version: 'v1' },
    configPath: '',
    reloadConfig: () => ({ ok: true, config: { version: 'v2' } }),
  });

  const active = runtime.getActiveConfig();
  assert.equal(active.ok, false);
  assert.equal(active.error.code, 'config_reload_failed');
  assert.match(active.error.message, /path is unavailable/i);
});
