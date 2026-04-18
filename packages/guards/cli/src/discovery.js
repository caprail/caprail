import { evaluateCommand } from './matcher.js';

export function buildDiscoveryPayload(config, options = {}) {
  return buildListPayload(config, options);
}

export function buildListPayload(config, { toolName } = {}) {
  if (isEmptyConfig(config)) {
    return {
      ok: false,
      error: {
        code: 'no_tools_configured',
        message: 'The guard config does not define any tools.',
      },
    };
  }

  if (toolName) {
    const tool = config.tools[toolName];

    if (!tool) {
      return {
        ok: false,
        error: {
          code: 'unknown_tool',
          tool: toolName,
          message: `Tool '${toolName}' is not configured.`,
        },
      };
    }

    return {
      ok: true,
      payload: {
        tools: {
          [toolName]: serializeTool(tool),
        },
      },
    };
  }

  return {
    ok: true,
    payload: {
      tools: Object.fromEntries(
        Object.entries(config.tools).map(([name, tool]) => [name, serializeTool(tool)]),
      ),
    },
  };
}

export function buildExplainPayload(config, toolName, args) {
  if (isEmptyConfig(config)) {
    return {
      ok: false,
      error: {
        code: 'no_tools_configured',
        message: 'The guard config does not define any tools.',
      },
    };
  }

  if (!config.tools[toolName]) {
    return {
      ok: false,
      error: {
        code: 'unknown_tool',
        tool: toolName,
        message: `Tool '${toolName}' is not configured.`,
      },
    };
  }

  const evaluation = evaluateCommand(config, toolName, args);

  return {
    ok: true,
    payload: {
      tool: evaluation.tool,
      normalized_args: evaluation.normalizedArgs,
      matched_allow: evaluation.matchedAllow,
      matched_deny: evaluation.matchedDeny,
      matched_deny_flag: evaluation.matchedDenyFlag,
      deny_flags: evaluation.denyFlags,
      allowed: evaluation.allowed,
      reason: evaluation.reason,
      message: evaluation.message,
    },
  };
}

function isEmptyConfig(config) {
  return Object.keys(config.tools).length === 0;
}

function serializeTool(tool) {
  return {
    binary: tool.binary,
    description: tool.description,
    allow: [...tool.allow],
    deny: [...tool.deny],
    deny_flags: [...tool.denyFlags],
  };
}
