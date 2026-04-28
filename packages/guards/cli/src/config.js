import { accessSync, constants, existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, extname, isAbsolute, join, resolve } from 'node:path';

import YAML from 'yaml';

import { tokenizePolicyEntry } from './matcher.js';

const DEFAULT_AUDIT_LOG = 'none';
const DEFAULT_AUDIT_FORMAT = 'text';
const VALID_AUDIT_FORMATS = new Set(['text', 'jsonl']);
const WINDOWS_EXECUTABLE_EXTENSIONS = ['.exe', '.cmd', '.bat', '.com'];

export function getDefaultConfigPaths({
  platform = process.platform,
  env = process.env,
  homeDirectory = homedir(),
} = {}) {
  if (platform === 'win32') {
    return [env.ProgramData, env.AppData]
      .filter(Boolean)
      .map((basePath) => join(basePath, 'caprail-cli', 'config.yaml'));
  }

  const paths = [];

  if (env.XDG_CONFIG_HOME) {
    paths.push(join(env.XDG_CONFIG_HOME, 'caprail-cli', 'config.yaml'));
  }

  if (homeDirectory) {
    paths.push(join(homeDirectory, '.config', 'caprail-cli', 'config.yaml'));
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

  if (env.CAPRAIL_CLI_CONFIG) {
    return {
      ok: true,
      path: resolveConfigPathValue(env.CAPRAIL_CLI_CONFIG),
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
      message: 'No config file was found in the configured resolution paths.',
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
    return {
      ...parsed,
      configPath: resolved.path,
    };
  }

  return {
    ok: true,
    configPath: resolved.path,
    config: {
      ...parsed.config,
      source: {
        path: resolved.path,
        source: resolved.source,
      },
    },
  };
}

export function validateConfig(config, options = {}) {
  const errors = [];
  const warnings = [];

  validateSettings(config, errors);

  for (const tool of Object.values(config.tools)) {
    validateToolPolicyEntries(tool, errors, warnings);
    validateBinaryAvailability(tool, warnings, options);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export function loadAndValidateConfig(options = {}) {
  const loaded = loadConfig(options);

  if (!loaded.ok) {
    return {
      ok: false,
      configPath: loaded.configPath ?? loaded.error?.path,
      report: {
        valid: false,
        errors: [loaded.error],
        warnings: [],
      },
      error: loaded.error,
    };
  }

  const report = validateConfig(loaded.config, options);

  return {
    ok: report.valid,
    configPath: loaded.configPath,
    config: loaded.config,
    report,
    error: report.valid ? null : report.errors[0],
  };
}

export function findExecutable(binary, {
  env = process.env,
  platform = process.platform,
} = {}) {
  const pathEntries = (env.PATH ?? '')
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);

  const pathext = platform === 'win32'
    ? (env.PATHEXT ?? WINDOWS_EXECUTABLE_EXTENSIONS.join(';'))
      .split(';')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean)
    : [''];

  const hasPathSeparator = binary.includes('/') || binary.includes('\\');
  const binaryCandidates = [];

  if (hasPathSeparator || isAbsolute(binary)) {
    binaryCandidates.push(binary);
  } else {
    for (const pathEntry of pathEntries) {
      binaryCandidates.push(join(pathEntry, binary));
    }
  }

  for (const candidate of binaryCandidates) {
    for (const executablePath of expandExecutableCandidates(candidate, pathext, platform)) {
      if (isExecutableFile(executablePath, platform)) {
        return executablePath;
      }
    }
  }

  return null;
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

  const argvPrefix = normalizeTokenList(rawTool.argv_prefix, `tools.${toolName}.argv_prefix`, configPath);

  if (!argvPrefix.ok) {
    return argvPrefix;
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
      argvPrefix: argvPrefix.values,
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

function validateSettings(config, errors) {
  if (!VALID_AUDIT_FORMATS.has(config.settings.auditFormat)) {
    errors.push({
      code: 'audit_format_invalid',
      message: `Audit format '${config.settings.auditFormat}' is not supported. Use 'text' or 'jsonl'.`,
      path: config.source.path,
    });
  }

  if (config.settings.auditLog === DEFAULT_AUDIT_LOG) {
    return;
  }

  const auditLogValidation = validateAuditLogPath(config.settings.auditLog);

  if (!auditLogValidation.ok) {
    errors.push(auditLogValidation.error);
  }
}

function validateToolPolicyEntries(tool, errors, warnings) {
  validatePolicyEntries(tool.allow, 'allow', tool.name, errors);
  validatePolicyEntries(tool.deny, 'deny', tool.name, errors);
  validatePolicyEntries(tool.denyFlags, 'deny_flags', tool.name, errors);

  for (const denyEntry of tool.deny) {
    if (tool.allow.length === 0) {
      warnings.push({
        code: 'unreachable_deny_entry',
        tool: tool.name,
        entry: denyEntry,
        message: `Deny entry '${denyEntry}' is likely unreachable because '${tool.name}' has no allow entries.`,
      });
      continue;
    }

    if (isLikelyReachableDenyEntry(denyEntry, tool.allow)) {
      continue;
    }

    warnings.push({
      code: 'unreachable_deny_entry',
      tool: tool.name,
      entry: denyEntry,
      message: `Deny entry '${denyEntry}' is likely unreachable because it does not share a command prefix with any allow entry.`,
    });
  }
}

function validateBinaryAvailability(tool, warnings, options) {
  const executablePath = findExecutable(tool.binary, options);

  if (executablePath) {
    return;
  }

  warnings.push({
    code: 'binary_not_found',
    tool: tool.name,
    binary: tool.binary,
    message: `Binary '${tool.binary}' was not found on PATH.`,
  });
}

function validatePolicyEntries(entries, fieldName, toolName, errors) {
  for (const entry of entries) {
    const tokens = tokenizePolicyEntry(entry);

    if (tokens.length > 0) {
      continue;
    }

    errors.push({
      code: 'policy_entry_empty',
      tool: toolName,
      field: fieldName,
      entry,
      message: `Tool '${toolName}' has an empty ${fieldName} policy entry.`,
    });
  }
}

function validateAuditLogPath(auditLogPath) {
  const resolvedAuditLogPath = resolve(auditLogPath);
  const parentDirectory = dirname(resolvedAuditLogPath);

  if (!existsSync(parentDirectory)) {
    return {
      ok: false,
      error: {
        code: 'audit_log_unwritable',
        message: `Audit log directory does not exist: ${parentDirectory}`,
        path: resolvedAuditLogPath,
      },
    };
  }

  try {
    if (existsSync(resolvedAuditLogPath)) {
      const stats = statSync(resolvedAuditLogPath);

      if (!stats.isFile()) {
        return {
          ok: false,
          error: {
            code: 'audit_log_unwritable',
            message: `Audit log path is not a file: ${resolvedAuditLogPath}`,
            path: resolvedAuditLogPath,
          },
        };
      }

      accessSync(resolvedAuditLogPath, constants.W_OK);
    } else {
      accessSync(parentDirectory, constants.W_OK);
    }
  } catch {
    return {
      ok: false,
      error: {
        code: 'audit_log_unwritable',
        message: `Audit log path is not writable: ${resolvedAuditLogPath}`,
        path: resolvedAuditLogPath,
      },
    };
  }

  return {
    ok: true,
  };
}

function expandExecutableCandidates(candidate, extensions, platform) {
  if (platform !== 'win32') {
    return [candidate];
  }

  if (extname(candidate)) {
    return [candidate];
  }

  return [candidate, ...extensions.map((extension) => `${candidate}${extension}`)];
}

function isExecutableFile(filePath, platform) {
  try {
    const stats = statSync(filePath);

    if (!stats.isFile()) {
      return false;
    }

    accessSync(filePath, platform === 'win32' ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function isLikelyReachableDenyEntry(denyEntry, allowEntries) {
  const denyTokens = tokenizePolicyEntry(denyEntry);

  return allowEntries.some((allowEntry) => {
    const allowTokens = tokenizePolicyEntry(allowEntry);
    const sharedPrefixLength = Math.min(allowTokens.length, denyTokens.length);

    if (sharedPrefixLength === 0) {
      return false;
    }

    for (let index = 0; index < sharedPrefixLength; index += 1) {
      if (allowTokens[index] !== denyTokens[index]) {
        return false;
      }
    }

    return true;
  });
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
