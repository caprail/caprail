const MODE_FLAGS = new Set(['--validate', '--list', '--explain']);

export function parseArgv(argv = []) {
  const argvValidationError = validateArgv(argv);

  if (argvValidationError) {
    return {
      ok: false,
      error: argvValidationError,
    };
  }

  const separatorIndex = argv.indexOf('--');
  const hasSeparator = separatorIndex !== -1;
  const headTokens = hasSeparator ? argv.slice(0, separatorIndex) : argv;
  const tailTokens = hasSeparator ? argv.slice(separatorIndex + 1) : [];

  const parsedHead = parseHeadTokens(headTokens);

  if (!parsedHead.ok) {
    return parsedHead;
  }

  const parsed = parsedHead.value;

  if (hasSeparator && (parsed.mode === 'validate' || parsed.mode === 'list')) {
    return fail('separator_not_allowed', "'--' separator is only valid for execution and explain modes.");
  }

  if (!hasSeparator && (parsed.mode === 'execute' || parsed.mode === 'explain')) {
    return fail(
      'separator_required',
      "Execution and explain modes require a '--' separator before command tokens.",
    );
  }

  if (parsed.mode === 'execute') {
    if (parsed.json) {
      return fail('json_not_supported_in_execution', "'--json' is only supported in validate, list, or explain modes.");
    }

    return parseCommandModePayload({ mode: 'execute', parsed, commandTokens: tailTokens });
  }

  if (parsed.mode === 'explain') {
    return parseCommandModePayload({ mode: 'explain', parsed, commandTokens: tailTokens });
  }

  return {
    ok: true,
    value: {
      mode: parsed.mode,
      configPath: parsed.configPath,
      json: parsed.json,
      toolName: parsed.toolName,
      separatorIndex,
      commandTokens: [],
    },
  };
}

function parseHeadTokens(tokens) {
  const state = {
    mode: 'execute',
    configPath: null,
    json: false,
    toolName: null,
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (token === '--config') {
      const configPath = tokens[index + 1];

      if (!configPath || configPath.startsWith('--')) {
        return fail('flag_requires_value', "'--config' requires a path value.", {
          flag: '--config',
        });
      }

      state.configPath = configPath;
      index += 1;
      continue;
    }

    if (token === '--json') {
      state.json = true;
      continue;
    }

    if (token === '--list') {
      const modeConflict = setMode(state, 'list', token);

      if (modeConflict) {
        return fail('mode_conflict', modeConflict.message, {
          activeMode: state.mode,
          conflictingFlag: token,
        });
      }

      const candidateToolToken = tokens[index + 1];

      if (candidateToolToken && !candidateToolToken.startsWith('--')) {
        state.toolName = candidateToolToken;
        index += 1;
      }

      continue;
    }

    if (token === '--validate' || token === '--explain') {
      const nextMode = token === '--validate' ? 'validate' : 'explain';
      const modeConflict = setMode(state, nextMode, token);

      if (modeConflict) {
        return fail('mode_conflict', modeConflict.message, {
          activeMode: state.mode,
          conflictingFlag: token,
        });
      }

      continue;
    }

    if (MODE_FLAGS.has(token)) {
      return fail('mode_conflict', `Conflicting mode flags are not allowed: '${token}'.`, {
        activeMode: state.mode,
        conflictingFlag: token,
      });
    }

    if (token.startsWith('--')) {
      return fail('unknown_flag', `Unknown transport flag '${token}'.`, {
        flag: token,
      });
    }

    if (state.mode === 'list' && state.toolName === null) {
      state.toolName = token;
      continue;
    }

    if (state.mode === 'execute' || state.mode === 'explain') {
      return fail(
        'separator_required',
        "Execution and explain modes require a '--' separator before command tokens.",
        { token },
      );
    }

    return fail(
      'unexpected_token',
      `Unexpected token '${token}' before '--'. Transport flags must come before command tokens.`,
      { token },
    );
  }

  if (state.mode === 'validate' && state.toolName) {
    return fail('unexpected_token', 'Validate mode does not accept a tool name.', {
      token: state.toolName,
    });
  }

  return {
    ok: true,
    value: state,
  };
}

function parseCommandModePayload({ mode, parsed, commandTokens }) {
  if (commandTokens.length === 0) {
    return fail('command_tokens_missing', `Mode '${mode}' requires command tokens after '--'.`);
  }

  const [toolName, ...args] = commandTokens;

  if (!toolName || toolName.length === 0) {
    return fail('command_tokens_missing', `Mode '${mode}' requires a tool token after '--'.`);
  }

  return {
    ok: true,
    value: {
      mode,
      configPath: parsed.configPath,
      json: parsed.json,
      toolName,
      args,
      commandTokens: [...commandTokens],
    },
  };
}

function setMode(state, nextMode, modeFlag) {
  if (state.mode !== 'execute' && state.mode !== nextMode) {
    return {
      message: `Mode flag '${modeFlag}' cannot be combined with mode '${state.mode}'.`,
    };
  }

  state.mode = nextMode;
  return null;
}

function validateArgv(argv) {
  if (!Array.isArray(argv)) {
    return {
      code: 'argv_invalid_type',
      message: 'argv must be an array of string tokens.',
    };
  }

  for (const token of argv) {
    if (typeof token !== 'string') {
      return {
        code: 'argv_invalid_token',
        message: 'argv must contain only string tokens.',
      };
    }
  }

  return null;
}

function fail(code, message, details = {}) {
  return {
    ok: false,
    error: {
      code,
      message,
      ...details,
    },
  };
}
