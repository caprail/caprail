const DEFAULT_HOST = '0.0.0.0';
const DEFAULT_PORT = 8100;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576;

const VALUE_FLAGS = new Set([
  '--config',
  '--port',
  '--host',
  '--token',
  '--timeout-ms',
  '--max-output-bytes',
]);

export function parseCliHttpArgv(argv = []) {
  const state = {
    configPath: undefined,
    host: DEFAULT_HOST,
    port: DEFAULT_PORT,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
    token: undefined,
    noAuth: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === '--no-auth') {
      state.noAuth = true;
      continue;
    }

    if (!VALUE_FLAGS.has(token)) {
      return invalid('unknown_flag', `Unknown flag '${token}'.`);
    }

    const value = argv[i + 1];
    if (value == null || value.startsWith('--')) {
      return invalid('missing_flag_value', `Flag '${token}' requires a value.`, { flag: token });
    }

    i += 1;

    if (token === '--config') {
      state.configPath = value;
      continue;
    }

    if (token === '--host') {
      state.host = value;
      continue;
    }

    if (token === '--token') {
      state.token = value;
      continue;
    }

    if (token === '--port') {
      const parsed = parseNonNegativeInteger(value, token);
      if (!parsed.ok) return parsed;
      state.port = parsed.value;
      continue;
    }

    if (token === '--timeout-ms') {
      const parsed = parseNonNegativeInteger(value, token);
      if (!parsed.ok) return parsed;
      state.timeoutMs = parsed.value;
      continue;
    }

    if (token === '--max-output-bytes') {
      const parsed = parseNonNegativeInteger(value, token);
      if (!parsed.ok) return parsed;
      state.maxOutputBytes = parsed.value;
    }
  }

  if (!state.configPath) {
    return invalid('missing_required_flag', "Missing required flag '--config <path>'.", { flag: '--config' });
  }

  if (state.noAuth && state.token) {
    return invalid(
      'conflicting_auth_flags',
      "Choose exactly one auth mode: '--token <secret>' or '--no-auth', not both.",
    );
  }

  if (!state.noAuth && !state.token) {
    return invalid(
      'missing_auth_mode',
      "Choose an auth mode: '--token <secret>' or '--no-auth'.",
    );
  }

  const auth = state.noAuth ? { noAuth: true } : { token: state.token };

  return {
    ok: true,
    options: {
      configPath: state.configPath,
      host: state.host,
      port: state.port,
      timeoutMs: state.timeoutMs,
      maxOutputBytes: state.maxOutputBytes,
      auth,
    },
  };
}

function parseNonNegativeInteger(value, flag) {
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    return invalid('invalid_number', `Flag '${flag}' must be a non-negative integer.`, { flag, value });
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed)) {
    return invalid('invalid_number', `Flag '${flag}' must be a safe integer.`, { flag, value });
  }

  return { ok: true, value: parsed };
}

function invalid(code, message, details = {}) {
  return {
    ok: false,
    error: {
      code,
      message,
      ...details,
    },
  };
}
