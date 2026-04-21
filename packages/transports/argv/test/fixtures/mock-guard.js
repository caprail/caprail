function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function createMockGuard(overrides = {}) {
  const calls = {
    loadAndValidateConfig: [],
    buildListPayload: [],
    buildExplainPayload: [],
    executeGuardedCommand: [],
  };

  const config = overrides.config ?? {
    source: { path: '/secure/caprail-cli/config.yaml', source: 'cli' },
    settings: {
      auditLog: 'none',
      auditFormat: 'jsonl',
    },
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

  const defaultValidationReport = {
    valid: true,
    errors: [],
    warnings: [],
  };

  return {
    calls,

    loadAndValidateConfig(options = {}) {
      calls.loadAndValidateConfig.push(options);

      if (overrides.loadAndValidateConfig) {
        return overrides.loadAndValidateConfig(options);
      }

      return {
        ok: true,
        configPath: config.source?.path,
        config,
        report: clone(defaultValidationReport),
        error: null,
      };
    },

    buildListPayload(receivedConfig, options = {}) {
      calls.buildListPayload.push({ config: receivedConfig, options });

      if (overrides.buildListPayload) {
        return overrides.buildListPayload(receivedConfig, options);
      }

      const ghPayload = {
        binary: 'gh',
        description: 'GitHub CLI',
        allow: ['pr list', 'pr view'],
        deny: ['pr create'],
        deny_flags: ['--web'],
      };

      if (options.toolName) {
        if (options.toolName !== 'gh') {
          return {
            ok: false,
            error: {
              code: 'unknown_tool',
              message: `Tool '${options.toolName}' is not configured.`,
              tool: options.toolName,
            },
          };
        }

        return {
          ok: true,
          payload: {
            tools: {
              gh: ghPayload,
            },
          },
        };
      }

      return {
        ok: true,
        payload: {
          tools: {
            gh: ghPayload,
          },
        },
      };
    },

    buildExplainPayload(receivedConfig, toolName, args) {
      calls.buildExplainPayload.push({ config: receivedConfig, toolName, args: [...args] });

      if (overrides.buildExplainPayload) {
        return overrides.buildExplainPayload(receivedConfig, toolName, args);
      }

      return {
        ok: true,
        payload: {
          tool: toolName,
          normalized_args: [...args],
          matched_allow: args.join(' ') === 'pr list' ? 'pr list' : null,
          matched_deny: args.join(' ') === 'pr create' ? 'pr create' : null,
          matched_deny_flag: null,
          deny_flags: ['--web'],
          allowed: args.join(' ') === 'pr list',
          reason: args.join(' ') === 'pr list' ? 'matched_allow' : 'no_allow_match',
          message: args.join(' ') === 'pr list' ? "Matched allow entry 'pr list'." : 'No allow entry matched.',
        },
      };
    },

    async executeGuardedCommand(receivedConfig, toolName, args, options = {}) {
      calls.executeGuardedCommand.push({ config: receivedConfig, toolName, args: [...args], options });

      if (overrides.executeGuardedCommand) {
        return overrides.executeGuardedCommand(receivedConfig, toolName, args, options);
      }

      options.onStdout?.(Buffer.from('mock-stdout'));
      options.onStderr?.(Buffer.from('mock-stderr'));

      return {
        status: 'executed',
        allowed: true,
        executed: true,
        exitCode: 0,
      };
    },
  };
}
