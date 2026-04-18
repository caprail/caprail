import { constants, existsSync, readFileSync } from 'node:fs';
import { accessSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

import YAML from 'yaml';

const DEFAULT_AUDIT_LOG = 'none';
const DEFAULT_AUDIT_FORMAT = 'text';

export function getDefaultConfigPaths({
  platform = process.platform,
  env = process.env,
  homeDirectory = homedir(),
} = {}) {
  if (platform === 'win32') {
    return [env.ProgramData, env.AppData]
      .filter(Boolean)
      .map((basePath) => join(basePath, 'cliguard', 'config.yaml'));
  }

  const paths = [];

  if (env.XDG_CONFIG_HOME) {
    paths.push(join(env.XDG_CONFIG_HOME, 'cliguard', 'config.yaml'));
  }

  if (homeDirectory) {
    paths.push(join(homeDirectory, '.config', 'cliguard', 'config.yaml'));
  }

  return paths;
}

export function resolveConfigPath({
  configPath,
  env = process.env,
  platform = process.platform,
  homeDirectory = homedir(),
} = {}) {
  if (configPath) {
    return {
      ok: true,
      path: resolveConfigPathValue(configPath),
      source: 'cli',
    };
  }

  if (env.CLIGUARD_CONFIG) {
    return {
      ok: true,
      path: resolveConfigPathValue(env.CLIGUARD_CONFIG),
      source: 'env',
    };
  }

  const defaultPaths = getDefaultConfigPaths({ platform, env, homeDirectory });

  for (const candidatePath of defaultPaths) {
    if (existsSync(candidatePath)) {
      return {
        ok: true,
        path: candidatePath,
        source: 'default',
      };
    }
  }

  return {
    ok: false,
    error: {
      code: 'config_not_found',
      message: 'No cliguard config file was found in the configured resolution paths.',
      candidates: defaultPaths,
    },
  };
}

export function parseConfig(configText, { configPath = '<inline>' } = {}) {
  const document = YAML.parseDocument(configText, {
    uniqueKeys: true,
  });

  if (document.errors.length > 0) {
    return {
      ok: false,
      error: {
        code: 'config_parse_error',
        message: `YAML parse error in ${configPath}: ${document.errors[0].message}`,
      },
    };
  }

  const rawConfig = document.toJS();

  if (!isPlainObject(rawConfig)) {
    return invalidConfig(configPath, 'Config root must be a mapping.');
  }

  if (!isPlainObject(rawConfig.tools)) {
    return invalidConfig(configPath, 'Config must include a tools mapping.');
  }

  const settings = normalizeSettings(rawConfig.settings, configPath);

  if (!settings.ok) {
    return settings;
  }

  const tools = {};

  for (const [toolName, rawTool] of Object.entries(rawConfig.tools)) {
    const normalizedTool = normalizeToolConfig(toolName, rawTool, configPath);

    if (!normalizedTool.ok) {
      return normalizedTool;
    }

    tools[toolName] = normalizedTool.tool;
  }

  return {
    ok: true,
    config: {
      source: {
        path: resolveConfigPathValue(configPath),
      },
      settings: settings.settings,
      tools,
    },
  };
}

export function loadConfig(options = {}) {
  const resolved = resolveConfigPath(options);

  if (!resolved.ok) {
    return resolved;
  }

  try {
    accessSync(resolved.path, constants.R_OK);
  } catch {
    if (!existsSync(resolved.path)) {
      return {
        ok: false,
        error: {
          code: 'config_not_found',
          message: `Config file was not found: ${resolved.path}`,
          path: resolved.path,
          source: resolved.source,
        },
      };
    }

    return {
      ok: false,
      error: {
        code: 'config_unreadable',
        message: `Config file is not readable: ${resolved.path}`,
        path: resolved.path,
        source: resolved.source,
      },
    };
  }

  let configText;

  try {
    configText = readFileSync(resolved.path, 'utf8');
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'config_unreadable',
        message: `Failed to read config file: ${resolved.path}`,
        path: resolved.path,
        source: resolved.source,
        cause: error.message,
      },
    };
  }

  const parsed = parseConfig(configText, { configPath: resolved.path });

  if (!parsed.ok) {
    return parsed;
  }

  return {
    ok: true,
    config: {
      ...parsed.config,
      source: {
        path: resolved.path,
        source: resolved.source,
      },
    },
  };
}

function normalizeSettings(rawSettings, configPath) {
  if (rawSettings === undefined) {
    return {
      ok: true,
      settings: {
        auditLog: DEFAULT_AUDIT_LOG,
        auditFormat: DEFAULT_AUDIT_FORMAT,
      },
    };
  }

  if (!isPlainObject(rawSettings)) {
    return invalidConfig(configPath, 'settings must be a mapping when provided.');
  }

  if (
    rawSettings.audit_log !== undefined &&
    (typeof rawSettings.audit_log !== 'string' || rawSettings.audit_log.length === 0)
  ) {
    return invalidConfig(configPath, 'settings.audit_log must be a non-empty string when provided.');
  }

  if (
    rawSettings.audit_format !== undefined &&
    (typeof rawSettings.audit_format !== 'string' || rawSettings.audit_format.length === 0)
  ) {
    return invalidConfig(configPath, 'settings.audit_format must be a non-empty string when provided.');
  }

  return {
    ok: true,
    settings: {
      auditLog: rawSettings.audit_log ?? DEFAULT_AUDIT_LOG,
      auditFormat: rawSettings.audit_format ?? DEFAULT_AUDIT_FORMAT,
    },
  };
}

function normalizeToolConfig(toolName, rawTool, configPath) {
  if (!isPlainObject(rawTool)) {
    return invalidConfig(configPath, `tools.${toolName} must be a mapping.`);
  }

  if (typeof rawTool.binary !== 'string' || rawTool.binary.length === 0) {
    return invalidConfig(configPath, `tools.${toolName}.binary must be a non-empty string.`);
  }

  if (rawTool.description !== undefined && typeof rawTool.description !== 'string') {
    return invalidConfig(configPath, `tools.${toolName}.description must be a string when provided.`);
  }

  const allow = normalizeTokenList(rawTool.allow, `tools.${toolName}.allow`, configPath);

  if (!allow.ok) {
    return allow;
  }

  const deny = normalizeTokenList(rawTool.deny, `tools.${toolName}.deny`, configPath);

  if (!deny.ok) {
    return deny;
  }

  const denyFlags = normalizeTokenList(rawTool.deny_flags, `tools.${toolName}.deny_flags`, configPath);

  if (!denyFlags.ok) {
    return denyFlags;
  }

  return {
    ok: true,
    tool: {
      name: toolName,
      binary: rawTool.binary,
      description: rawTool.description ?? '',
      allow: allow.values,
      deny: deny.values,
      denyFlags: denyFlags.values,
    },
  };
}

function normalizeTokenList(value, fieldPath, configPath) {
  if (value === undefined) {
    return {
      ok: true,
      values: [],
    };
  }

  if (!Array.isArray(value)) {
    return invalidConfig(configPath, `${fieldPath} must be an array of strings when provided.`);
  }

  for (const entry of value) {
    if (typeof entry !== 'string') {
      return invalidConfig(configPath, `${fieldPath} must contain only strings.`);
    }
  }

  return {
    ok: true,
    values: [...value],
  };
}

function invalidConfig(configPath, message) {
  return {
    ok: false,
    error: {
      code: 'config_invalid',
      message: `${message} (${configPath})`,
    },
  };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function resolveConfigPathValue(configPath) {
  if (isAbsolute(configPath)) {
    return configPath;
  }

  return resolve(configPath);
}
