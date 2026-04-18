import { parseArgv } from './parser.js';

const REQUIRED_GUARD_METHODS = [
  'loadAndValidateConfig',
  'buildListPayload',
  'buildExplainPayload',
  'executeGuardedCommand',
];

export { parseArgv } from './parser.js';

export async function runArgvTransport({
  argv = [],
  guard,
  stdout = process.stdout,
  stderr = process.stderr,
  env = process.env,
  platform = process.platform,
  homeDirectory,
} = {}) {
  const guardValidation = validateGuardContract(guard);

  if (!guardValidation.ok) {
    return failTransport(stderr, guardValidation.error);
  }

  const parsed = parseArgv(argv);

  if (!parsed.ok) {
    return failTransport(stderr, parsed.error, {
      prefix: 'argument error',
    });
  }

  const configLoadOptions = {
    env,
    platform,
  };

  if (parsed.value.configPath) {
    configLoadOptions.configPath = parsed.value.configPath;
  }

  if (homeDirectory !== undefined) {
    configLoadOptions.homeDirectory = homeDirectory;
  }

  const loaded = callGuard(guard.loadAndValidateConfig, [configLoadOptions]);

  if (!loaded.ok) {
    return failTransport(stderr, loaded.error, {
      mode: parsed.value.mode,
      action: 'loadAndValidateConfig',
    });
  }

  if (parsed.value.mode === 'validate') {
    return handleValidateMode({
      parsed: parsed.value,
      loaded: loaded.value,
      stdout,
      stderr,
    });
  }

  if (!loaded.value.ok) {
    return failTransport(stderr, loaded.value.error ?? {
      code: 'config_invalid',
      message: 'Config validation failed.',
    }, {
      mode: parsed.value.mode,
    });
  }

  if (parsed.value.mode === 'list') {
    return handleListMode({
      parsed: parsed.value,
      loaded: loaded.value,
      guard,
      stdout,
      stderr,
    });
  }

  if (parsed.value.mode === 'explain') {
    return handleExplainMode({
      parsed: parsed.value,
      loaded: loaded.value,
      guard,
      stdout,
      stderr,
    });
  }

  return handleExecuteMode({
    parsed: parsed.value,
    loaded: loaded.value,
    guard,
    stdout,
    stderr,
    env,
  });
}

function handleValidateMode({ parsed, loaded, stdout, stderr }) {
  if (parsed.json) {
    writeJson(stdout, loaded.report ?? {
      valid: Boolean(loaded.ok),
      errors: loaded.ok ? [] : [loaded.error],
      warnings: [],
    });
  } else {
    renderValidateText(loaded.report, loaded.ok ? stdout : stderr);
  }

  const exitCode = loaded.ok ? 0 : 1;

  return {
    ok: exitCode === 0,
    exitCode,
    mode: 'validate',
    report: loaded.report,
    error: loaded.error ?? null,
  };
}

function handleListMode({ parsed, loaded, guard, stdout, stderr }) {
  const listed = callGuard(guard.buildListPayload, [loaded.config, {
    toolName: parsed.toolName ?? undefined,
  }]);

  if (!listed.ok) {
    return failTransport(stderr, listed.error, {
      mode: 'list',
      action: 'buildListPayload',
    });
  }

  if (!listed.value.ok) {
    return failTransport(stderr, listed.value.error, {
      mode: 'list',
      action: 'buildListPayload',
    });
  }

  if (parsed.json) {
    writeJson(stdout, listed.value.payload);
  } else {
    renderListText(listed.value.payload, stdout);
  }

  return {
    ok: true,
    exitCode: 0,
    mode: 'list',
    payload: listed.value.payload,
  };
}

function handleExplainMode({ parsed, loaded, guard, stdout, stderr }) {
  const explained = callGuard(guard.buildExplainPayload, [loaded.config, parsed.toolName, parsed.args]);

  if (!explained.ok) {
    return failTransport(stderr, explained.error, {
      mode: 'explain',
      action: 'buildExplainPayload',
    });
  }

  if (!explained.value.ok) {
    return failTransport(stderr, explained.value.error, {
      mode: 'explain',
      action: 'buildExplainPayload',
    });
  }

  if (parsed.json) {
    writeJson(stdout, explained.value.payload);
  } else {
    renderExplainText(explained.value.payload, stdout);
  }

  return {
    ok: true,
    exitCode: 0,
    mode: 'explain',
    payload: explained.value.payload,
  };
}

async function handleExecuteMode({ parsed, loaded, guard, stdout, stderr, env }) {
  const executed = await callGuardAsync(guard.executeGuardedCommand, [
    loaded.config,
    parsed.toolName,
    parsed.args,
    {
      env,
      onStdout: (chunk) => stdout.write(chunk),
      onStderr: (chunk) => stderr.write(chunk),
    },
  ]);

  if (!executed.ok) {
    return failTransport(stderr, executed.error, {
      mode: 'execute',
      action: 'executeGuardedCommand',
    });
  }

  const result = executed.value;

  if (result.status === 'executed') {
    const exitCode = Number.isInteger(result.exitCode) ? result.exitCode : 1;

    return {
      ok: exitCode === 0,
      exitCode,
      mode: 'execute',
      result,
    };
  }

  if (result.status === 'denied') {
    writeLine(stderr, formatDeniedMessage(parsed.commandTokens, result.message));

    return {
      ok: false,
      exitCode: 126,
      mode: 'execute',
      result,
      error: {
        code: 'policy_denied',
        message: result.message ?? 'Command denied by policy.',
      },
    };
  }

  if (result.status === 'execution_error' || result.status === 'audit_error') {
    return failTransport(stderr, result.error ?? {
      code: result.status,
      message: 'Guard execution failed.',
    }, {
      mode: 'execute',
      result,
    });
  }

  return failTransport(stderr, {
    code: 'execution_result_unknown',
    message: `Unsupported execution status '${result.status}'.`,
  }, {
    mode: 'execute',
    result,
  });
}

function validateGuardContract(guard) {
  if (!guard || typeof guard !== 'object') {
    return {
      ok: false,
      error: {
        code: 'guard_contract_invalid',
        message: 'A guard adapter object is required.',
      },
    };
  }

  const missingMethods = REQUIRED_GUARD_METHODS.filter((methodName) => typeof guard[methodName] !== 'function');

  if (missingMethods.length > 0) {
    return {
      ok: false,
      error: {
        code: 'guard_contract_invalid',
        message: `Guard adapter is missing required methods: ${missingMethods.join(', ')}`,
        missingMethods,
      },
    };
  }

  return { ok: true };
}

function callGuard(method, args) {
  try {
    return {
      ok: true,
      value: method(...args),
    };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'guard_call_failed',
        message: error.message,
      },
    };
  }
}

async function callGuardAsync(method, args) {
  try {
    return {
      ok: true,
      value: await method(...args),
    };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'guard_call_failed',
        message: error.message,
      },
    };
  }
}

function renderValidateText(report, stream) {
  const validationReport = report ?? {
    valid: false,
    errors: [{ message: 'Validation failed with no report.' }],
    warnings: [],
  };

  if (validationReport.valid) {
    writeLine(stream, 'Config is valid.');
  } else {
    writeLine(stream, 'Config is invalid.');
  }

  for (const error of validationReport.errors ?? []) {
    writeLine(stream, `ERROR: ${error.message}`);
  }

  for (const warning of validationReport.warnings ?? []) {
    writeLine(stream, `WARNING: ${warning.message}`);
  }
}

function renderListText(payload, stream) {
  const entries = Object.entries(payload.tools ?? {}).sort(([a], [b]) => a.localeCompare(b));

  if (entries.length === 0) {
    writeLine(stream, 'No tools are configured.');
    return;
  }

  entries.forEach(([toolName, tool], index) => {
    if (index > 0) {
      writeLine(stream, '');
    }

    writeLine(stream, `Tool: ${toolName}`);
    writeLine(stream, `  Binary: ${tool.binary}`);
    writeLine(stream, `  Description: ${tool.description || '(none)'}`);
    writeLine(stream, `  Allow: ${formatPolicyList(tool.allow)}`);
    writeLine(stream, `  Deny: ${formatPolicyList(tool.deny)}`);
    writeLine(stream, `  Deny flags: ${formatPolicyList(tool.deny_flags)}`);
  });
}

function renderExplainText(payload, stream) {
  writeLine(stream, `Tool:          ${payload.tool}`);
  writeLine(stream, `Normalized:    ${formatNormalizedArgs(payload.normalized_args)}`);
  writeLine(stream, `Matched allow: ${payload.matched_allow ?? '(none)'}`);
  writeLine(stream, `Matched deny:  ${payload.matched_deny ?? '(none)'}`);
  writeLine(stream, `Matched deny flag: ${payload.matched_deny_flag ?? '(none)'}`);
  writeLine(stream, `Deny flags:    ${formatPolicyList(payload.deny_flags)}`);
  writeLine(stream, `Result:        ${payload.allowed ? 'ALLOWED' : 'DENIED'} — ${formatExplainReason(payload)}`);
}

function formatExplainReason(payload) {
  if (payload.allowed) {
    return 'matched allow entry';
  }

  if (payload.reason === 'no_allow_match') {
    return 'no allow entry matched';
  }

  if (payload.reason === 'matched_deny' && payload.matched_deny) {
    return `matched deny entry '${payload.matched_deny}'`;
  }

  if (payload.reason === 'matched_deny_flag' && payload.matched_deny_flag) {
    return `matched deny flag '${payload.matched_deny_flag}'`;
  }

  return (payload.message ?? payload.reason ?? 'denied').replace(/[.]$/, '').toLowerCase();
}

function formatDeniedMessage(commandTokens, message) {
  const renderedTokens = commandTokens.join(' ');
  const detail = message ?? 'Command denied by policy.';
  return `caprail-cli: denied '${renderedTokens}' — ${detail}`;
}

function formatPolicyList(entries = []) {
  if (!entries || entries.length === 0) {
    return '(none)';
  }

  return entries.join(', ');
}

function formatNormalizedArgs(tokens = []) {
  if (!tokens || tokens.length === 0) {
    return '(none)';
  }

  return tokens.join(' ');
}

function writeJson(stream, payload) {
  stream.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function writeLine(stream, line) {
  stream.write(`${line}\n`);
}

function failTransport(stderr, error, context = {}) {
  const prefix = context.prefix ?? 'transport error';
  writeLine(stderr, `${prefix}: ${formatErrorMessage(error)}`);

  return {
    ok: false,
    exitCode: 1,
    error,
    ...context,
  };
}

function formatErrorMessage(error) {
  if (!error) {
    return 'Unknown error.';
  }

  if (typeof error.message === 'string' && error.message.length > 0) {
    return error.message;
  }

  return JSON.stringify(error);
}
