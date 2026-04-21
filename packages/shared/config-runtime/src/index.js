import { statSync } from 'node:fs';

export function createConfigRuntime({ config, configPath } = {}) {
  const runtime = {
    config,
    configPath,
    getActiveConfig() {
      return {
        ok: true,
        config: runtime.config,
      };
    },
  };

  return runtime;
}

export function createReloadableConfigRuntime({
  config,
  configPath,
  reloadConfig,
  observeFingerprint = observeFileFingerprint,
  createReloadError = defaultCreateReloadError,
} = {}) {
  if (typeof reloadConfig !== 'function') {
    throw new TypeError('reloadConfig must be a function.');
  }

  const runtime = createConfigRuntime({ config, configPath });
  const observed = observeFingerprint(runtime.configPath, { createReloadError });

  runtime.fingerprint = observed.fingerprint;
  runtime.lastFailure = observed.ok ? null : { fingerprint: observed.fingerprint, error: observed.error };
  runtime.getActiveConfig = () => getReloadableActiveConfig(runtime, {
    reloadConfig,
    observeFingerprint,
    createReloadError,
  });

  return runtime;
}

function getReloadableActiveConfig(runtime, { reloadConfig, observeFingerprint, createReloadError }) {
  const observed = observeFingerprint(runtime.configPath, { createReloadError });

  if (observed.fingerprint === runtime.fingerprint) {
    if (runtime.lastFailure?.fingerprint === observed.fingerprint) {
      return {
        ok: false,
        error: runtime.lastFailure.error,
      };
    }

    return {
      ok: true,
      config: runtime.config,
    };
  }

  if (!observed.ok) {
    return recordReloadFailure(runtime, observed.fingerprint, observed.error);
  }

  let reloaded;
  try {
    reloaded = reloadConfig({
      config: runtime.config,
      configPath: runtime.configPath,
    });
  } catch (err) {
    return recordReloadFailure(
      runtime,
      observed.fingerprint,
      createReloadError(`Config reload failed: ${err?.message ?? String(err)}`),
    );
  }

  if (!reloaded || !reloaded.ok) {
    return recordReloadFailure(
      runtime,
      observed.fingerprint,
      createReloadError(
        `Config reload failed: ${reloaded?.error?.message ?? 'Config validation failed.'}`,
      ),
    );
  }

  runtime.config = reloaded.config;
  runtime.configPath = reloaded.configPath ?? runtime.configPath;
  runtime.fingerprint = observed.fingerprint;
  runtime.lastFailure = null;

  return {
    ok: true,
    config: runtime.config,
  };
}

function observeFileFingerprint(configPath, { createReloadError }) {
  if (typeof configPath !== 'string' || configPath.length === 0) {
    return {
      ok: false,
      fingerprint: 'config:missing-path',
      error: createReloadError('Config reload failed: Config path is unavailable.'),
    };
  }

  try {
    const stats = statSync(configPath);

    return {
      ok: true,
      fingerprint: `ok:${stats.size}:${stats.mtimeMs}`,
    };
  } catch (err) {
    return {
      ok: false,
      fingerprint: `error:${err?.code ?? 'unknown'}:${configPath}`,
      error: createReloadError(
        `Config reload failed: Unable to access config file '${configPath}': ${err?.message ?? String(err)}`,
      ),
    };
  }
}

function recordReloadFailure(runtime, fingerprint, error) {
  runtime.fingerprint = fingerprint;
  runtime.lastFailure = { fingerprint, error };

  return {
    ok: false,
    error,
  };
}

function defaultCreateReloadError(message) {
  return {
    code: 'config_reload_failed',
    message,
  };
}
