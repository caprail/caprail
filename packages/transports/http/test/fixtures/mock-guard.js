import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const DEFAULT_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'caprail-http-mock-guard-'));
const DEFAULT_CONFIG_PATH = join(DEFAULT_CONFIG_DIR, 'config.yaml');
writeFileSync(DEFAULT_CONFIG_PATH, 'mock-config-v1');

const DEFAULT_CONFIG = {
  source: { path: DEFAULT_CONFIG_PATH, source: 'cli' },
  settings: { auditLog: 'none', auditFormat: 'jsonl' },
  tools: {
    gh: {
      name: 'gh',
      binary: 'gh',
      description: 'GitHub CLI',
      allow: ['pr list', 'pr view'],
      deny: ['pr create'],
      denyFlags: ['--web'],
    },
  },
};

const DEFAULT_LIST_PAYLOAD = {
  tools: {
    gh: {
      binary: 'gh',
      description: 'GitHub CLI',
      allow: ['pr list', 'pr view'],
      deny: ['pr create'],
      deny_flags: ['--web'],
    },
  },
};

/**
 * Create a mock guard adapter for transport-http tests.
 *
 * @param {object} overrides  Per-method overrides (use functions or values)
 * @returns {object}
 */
export function createMockGuard(overrides = {}) {
  const calls = {
    loadAndValidateConfig: [],
    buildListPayload: [],
    executeGuardedCommand: [],
  };

  const config = overrides.config ?? clone(DEFAULT_CONFIG);

  return {
    calls,

    loadAndValidateConfig(options = {}) {
      calls.loadAndValidateConfig.push(clone(options));

      if (overrides.loadAndValidateConfig) {
        return overrides.loadAndValidateConfig(options);
      }

      return {
        ok: true,
        configPath: config.source?.path ?? DEFAULT_CONFIG_PATH,
        config: clone(config),
        report: { valid: true, errors: [], warnings: [] },
        error: null,
      };
    },

    buildListPayload(receivedConfig, options = {}) {
      calls.buildListPayload.push({ config: receivedConfig, options: clone(options) });

      if (overrides.buildListPayload) {
        return overrides.buildListPayload(receivedConfig, options);
      }

      return { ok: true, payload: clone(DEFAULT_LIST_PAYLOAD) };
    },

    async executeGuardedCommand(receivedConfig, toolName, args, options = {}) {
      calls.executeGuardedCommand.push({ config: receivedConfig, toolName, args: [...args] });

      if (overrides.executeGuardedCommand) {
        return overrides.executeGuardedCommand(receivedConfig, toolName, args, options);
      }

      // Default: simulate an allowed execution with small output
      options.onStdout?.(Buffer.from('mock-stdout\n'));
      options.onStderr?.(Buffer.from('mock-stderr\n'));

      return { status: 'executed', allowed: true, executed: true, exitCode: 0 };
    },
  };
}
