import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getDefaultConfigPaths,
  loadAndValidateConfig,
  loadConfig,
  parseConfig,
  resolveConfigPath,
  validateConfig,
} from '../src/config.js';

function createTempDir() {
  return mkdtempSync(join(tmpdir(), 'caprail-guard-cli-'));
}

function writeConfigFile(filePath, content) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
}

const examplePolicyPath = fileURLToPath(new URL('../../../../examples/guards/cli.policy.yaml', import.meta.url));

test('resolution prefers explicit config path over env and defaults', () => {
  const tempDir = createTempDir();
  const explicitPath = join(tempDir, 'explicit.yaml');
  const envPath = join(tempDir, 'env.yaml');

  writeConfigFile(explicitPath, 'tools: {}\n');
  writeConfigFile(envPath, 'tools: {}\n');

  const result = resolveConfigPath({
    configPath: explicitPath,
    env: {
      CAPRAIL_CLI_CONFIG: envPath,
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
  const defaultPath = join(tempDir, 'xdg', 'caprail-cli', 'config.yaml');

  writeConfigFile(envPath, 'tools: {}\n');
  writeConfigFile(defaultPath, 'tools: {}\n');

  const result = resolveConfigPath({
    env: {
      CAPRAIL_CLI_CONFIG: envPath,
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
  const defaultPath = join(xdgHome, 'caprail-cli', 'config.yaml');

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
    join(tempDir, 'program-data', 'caprail-cli', 'config.yaml'),
    join(tempDir, 'app-data', 'caprail-cli', 'config.yaml'),
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
    argvPrefix: [],
  });
});

test('schema rejects malformed yaml with a structured error', () => {
  const result = parseConfig('tools:\n  gh: [\n', { configPath: '/tmp/policy.yaml' });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'config_parse_error');
  assert.match(result.error.message, /yaml/i);
});

test('parse normalizes argv_prefix into an array of strings', () => {
  const result = parseConfig(`
tools:
  az:
    binary: /usr/bin/python3
    argv_prefix:
      - -IBm
      - azure.cli
    allow:
      - account list
`, { configPath: '/tmp/policy.yaml' });

  assert.equal(result.ok, true);
  assert.deepEqual(result.config.tools.az.argvPrefix, ['-IBm', 'azure.cli']);
});

test('parse rejects non-array argv_prefix with a structured error', () => {
  const result = parseConfig(`
tools:
  az:
    binary: az
    argv_prefix: "-IBm azure.cli"
    allow:
      - account list
`, { configPath: '/tmp/policy.yaml' });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'config_invalid');
  assert.match(result.error.message, /argv_prefix/);
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
  audit_log: /var/log/caprail-cli/audit.log
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
  assert.equal(result.config.settings.auditLog, '/var/log/caprail-cli/audit.log');
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
  assert.equal(result.configPath, resolve(configPath));
  assert.equal(result.config.source.path, resolve(configPath));
  assert.deepEqual(result.config.tools.az.allow, ['group list']);
});


test('loadAndValidateConfig returns explicit configPath on success', () => {
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

  const result = loadAndValidateConfig({ configPath });

  assert.equal(result.ok, true);
  assert.equal(result.configPath, resolve(configPath));
  assert.deepEqual(result.config.tools.az.allow, ['group list']);
});


test('loadAndValidateConfig returns explicit configPath on parse failure', () => {
  const tempDir = createTempDir();
  const configPath = join(tempDir, 'policy.yaml');

  writeConfigFile(configPath, 'tools:\n  gh: [\n');

  const result = loadAndValidateConfig({ configPath });

  assert.equal(result.ok, false);
  assert.equal(result.configPath, resolve(configPath));
  assert.equal(result.error.code, 'config_parse_error');
});

test('validate returns a clean report for a good config', () => {
  const parsed = parseConfig(`
settings:
  audit_log: none
  audit_format: jsonl
tools:
  node:
    binary: ${JSON.stringify(process.execPath)}
    allow:
      - fixtures
    deny:
      - fixtures blocked
`, { configPath: '/tmp/policy.yaml' });

  assert.equal(parsed.ok, true);

  const report = validateConfig(parsed.config);

  assert.deepEqual(report, {
    valid: true,
    errors: [],
    warnings: [],
  });
});

test('warning reports missing binaries without failing validation', () => {
  const parsed = parseConfig(`
tools:
  az:
    binary: definitely-missing-binary-for-caprail-tests
    allow:
      - group list
`, { configPath: '/tmp/policy.yaml' });

  assert.equal(parsed.ok, true);

  const report = validateConfig(parsed.config, {
    env: {
      PATH: '',
    },
    platform: 'linux',
  });

  assert.equal(report.valid, true);
  assert.equal(report.errors.length, 0);
  assert.equal(report.warnings[0].code, 'binary_not_found');
});

test('validate reports unsupported audit formats as errors', () => {
  const parsed = parseConfig(`
settings:
  audit_log: none
  audit_format: xml
tools:
  gh:
    binary: ${JSON.stringify(process.execPath)}
    allow:
      - pr list
`, { configPath: '/tmp/policy.yaml' });

  assert.equal(parsed.ok, true);

  const report = validateConfig(parsed.config);

  assert.equal(report.valid, false);
  assert.equal(report.errors[0].code, 'audit_format_invalid');
});

test('audit validation fails when the audit log parent directory is missing', () => {
  const tempDir = createTempDir();
  const auditPath = join(tempDir, 'missing-dir', 'audit.log');
  const parsed = parseConfig(`
settings:
  audit_log: ${JSON.stringify(auditPath)}
  audit_format: text
tools:
  gh:
    binary: ${JSON.stringify(process.execPath)}
    allow:
      - pr list
`, { configPath: '/tmp/policy.yaml' });

  assert.equal(parsed.ok, true);

  const report = validateConfig(parsed.config);

  assert.equal(report.valid, false);
  assert.equal(report.errors[0].code, 'audit_log_unwritable');
});

test('warning reports likely unreachable deny entries', () => {
  const parsed = parseConfig(`
tools:
  gh:
    binary: ${JSON.stringify(process.execPath)}
    allow:
      - pr list
    deny:
      - pr create
`, { configPath: '/tmp/policy.yaml' });

  assert.equal(parsed.ok, true);

  const report = validateConfig(parsed.config);

  assert.equal(report.valid, true);
  assert.equal(report.warnings[0].code, 'unreachable_deny_entry');
});

test('validate rejects empty policy entries as startup-fatal errors', () => {
  const parsed = parseConfig(`
tools:
  gh:
    binary: ${JSON.stringify(process.execPath)}
    allow:
      - "   "
`, { configPath: '/tmp/policy.yaml' });

  assert.equal(parsed.ok, true);

  const report = validateConfig(parsed.config);

  assert.equal(report.valid, false);
  assert.equal(report.errors[0].code, 'policy_entry_empty');
});

test('example policy loads and validates with predictable binary warnings', () => {
  const loaded = loadConfig({ configPath: examplePolicyPath });

  assert.equal(loaded.ok, true);
  assert.deepEqual(Object.keys(loaded.config.tools), ['gh', 'gws', 'az']);

  const report = validateConfig(loaded.config, {
    env: {
      PATH: '',
    },
    platform: 'linux',
  });

  assert.equal(report.valid, true);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings.map((warning) => warning.code), [
    'binary_not_found',
    'binary_not_found',
    'binary_not_found',
  ]);
});
