import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import {
  getDefaultConfigPaths,
  loadConfig,
  parseConfig,
  resolveConfigPath,
} from '../src/config.js';

function createTempDir() {
  return mkdtempSync(join(tmpdir(), 'caprail-guard-cli-'));
}

function writeConfigFile(filePath, content) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
}

test('resolution prefers explicit config path over env and defaults', () => {
  const tempDir = createTempDir();
  const explicitPath = join(tempDir, 'explicit.yaml');
  const envPath = join(tempDir, 'env.yaml');

  writeConfigFile(explicitPath, 'tools: {}\n');
  writeConfigFile(envPath, 'tools: {}\n');

  const result = resolveConfigPath({
    configPath: explicitPath,
    env: {
      CLIGUARD_CONFIG: envPath,
      XDG_CONFIG_HOME: join(tempDir, 'xdg'),
    },
    platform: 'linux',
    homeDirectory: join(tempDir, 'home'),
  });

  assert.equal(result.ok, true);
  assert.equal(result.source, 'cli');
  assert.equal(result.path, resolve(explicitPath));
});

test('resolution falls back to env config path before platform defaults', () => {
  const tempDir = createTempDir();
  const envPath = join(tempDir, 'env.yaml');
  const defaultPath = join(tempDir, 'xdg', 'cliguard', 'config.yaml');

  writeConfigFile(envPath, 'tools: {}\n');
  writeConfigFile(defaultPath, 'tools: {}\n');

  const result = resolveConfigPath({
    env: {
      CLIGUARD_CONFIG: envPath,
      XDG_CONFIG_HOME: join(tempDir, 'xdg'),
    },
    platform: 'linux',
    homeDirectory: join(tempDir, 'home'),
  });

  assert.equal(result.ok, true);
  assert.equal(result.source, 'env');
  assert.equal(result.path, resolve(envPath));
});

test('resolution uses linux default config paths without cwd lookup', () => {
  const tempDir = createTempDir();
  const xdgHome = join(tempDir, 'xdg');
  const defaultPath = join(xdgHome, 'cliguard', 'config.yaml');

  writeConfigFile(defaultPath, 'tools: {}\n');

  const result = resolveConfigPath({
    env: {
      XDG_CONFIG_HOME: xdgHome,
    },
    platform: 'linux',
    homeDirectory: join(tempDir, 'home'),
  });

  assert.equal(result.ok, true);
  assert.equal(result.source, 'default');
  assert.equal(result.path, resolve(defaultPath));
});

test('resolution returns win32 default path candidates in order', () => {
  const tempDir = createTempDir();
  const paths = getDefaultConfigPaths({
    platform: 'win32',
    env: {
      ProgramData: join(tempDir, 'program-data'),
      AppData: join(tempDir, 'app-data'),
    },
  });

  assert.deepEqual(paths, [
    join(tempDir, 'program-data', 'cliguard', 'config.yaml'),
    join(tempDir, 'app-data', 'cliguard', 'config.yaml'),
  ]);
});

test('parse normalizes optional lists and settings', () => {
  const result = parseConfig(`
settings:
  audit_format: jsonl
tools:
  gh:
    binary: gh
    description: GitHub CLI
`, { configPath: '/tmp/policy.yaml' });

  assert.equal(result.ok, true);
  assert.deepEqual(result.config.settings, {
    auditLog: 'none',
    auditFormat: 'jsonl',
  });
  assert.deepEqual(result.config.tools.gh, {
    name: 'gh',
    binary: 'gh',
    description: 'GitHub CLI',
    allow: [],
    deny: [],
    denyFlags: [],
  });
});

test('schema rejects malformed yaml with a structured error', () => {
  const result = parseConfig('tools:\n  gh: [\n', { configPath: '/tmp/policy.yaml' });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'config_parse_error');
  assert.match(result.error.message, /yaml/i);
});

test('schema rejects invalid tool definitions with a structured error', () => {
  const result = parseConfig(`
tools:
  gh:
    binary: 42
`, { configPath: '/tmp/policy.yaml' });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'config_invalid');
  assert.match(result.error.message, /binary/i);
});

test('parse preserves raw policy token lists for later matcher work', () => {
  const result = parseConfig(`
settings:
  audit_log: /var/log/cliguard/audit.log
tools:
  gh:
    binary: /usr/bin/gh
    description: GitHub CLI
    allow:
      - pr list
      - repo view
    deny:
      - pr create
    deny_flags:
      - --web
`, { configPath: '/tmp/policy.yaml' });

  assert.equal(result.ok, true);
  assert.deepEqual(result.config.tools.gh.allow, ['pr list', 'repo view']);
  assert.deepEqual(result.config.tools.gh.deny, ['pr create']);
  assert.deepEqual(result.config.tools.gh.denyFlags, ['--web']);
  assert.equal(result.config.settings.auditLog, '/var/log/cliguard/audit.log');
});

test('load returns a structured error for a missing config file', () => {
  const result = loadConfig({
    configPath: join(createTempDir(), 'missing.yaml'),
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'config_not_found');
});

test('load returns a structured error for an unreadable config path', () => {
  const tempDir = createTempDir();

  const result = loadConfig({
    configPath: tempDir,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'config_unreadable');
});

test('load resolves and parses config files end to end', () => {
  const tempDir = createTempDir();
  const configPath = join(tempDir, 'policy.yaml');

  writeConfigFile(configPath, `
settings:
  audit_log: none
tools:
  az:
    binary: az
    allow:
      - group list
`);

  const result = loadConfig({ configPath });

  assert.equal(result.ok, true);
  assert.equal(result.config.source.path, resolve(configPath));
  assert.deepEqual(result.config.tools.az.allow, ['group list']);
});
