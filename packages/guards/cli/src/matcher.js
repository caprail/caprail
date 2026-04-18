export function normalizeArgs(args) {
  const normalizedArgs = [];

  for (const token of args) {
    if (isLongFlagWithValue(token)) {
      const [flag, ...valueParts] = token.split('=');
      normalizedArgs.push(flag, valueParts.join('='));
      continue;
    }

    normalizedArgs.push(token);
  }

  return normalizedArgs;
}

export function tokenizePolicyEntry(entry) {
  return entry.trim().split(/\s+/).filter(Boolean);
}

export function matchesTokenSequence(args, sequence) {
  if (sequence.length === 0 || sequence.length > args.length) {
    return false;
  }

  for (let startIndex = 0; startIndex <= args.length - sequence.length; startIndex += 1) {
    let matched = true;

    for (let sequenceIndex = 0; sequenceIndex < sequence.length; sequenceIndex += 1) {
      if (args[startIndex + sequenceIndex] !== sequence[sequenceIndex]) {
        matched = false;
        break;
      }
    }

    if (matched) {
      return true;
    }
  }

  return false;
}

export function findMatchedEntry(args, entries) {
  for (const entry of entries) {
    const tokens = tokenizePolicyEntry(entry);

    if (matchesTokenSequence(args, tokens)) {
      return entry;
    }
  }

  return null;
}

export function findMatchedDenyFlag(args, denyFlags) {
  for (const token of args) {
    if (token === '--') {
      return null;
    }

    if (denyFlags.includes(token)) {
      return token;
    }
  }

  return null;
}

export function evaluateToolPolicy(toolConfig, args) {
  const normalizedArgs = normalizeArgs(args);
  const matchedDeny = findMatchedEntry(normalizedArgs, toolConfig.deny);
  const matchedDenyFlag = findMatchedDenyFlag(normalizedArgs, toolConfig.denyFlags);
  const matchedAllow = findMatchedEntry(normalizedArgs, toolConfig.allow);

  if (matchedDeny) {
    return createEvaluationResult(toolConfig, normalizedArgs, {
      allowed: false,
      matchedAllow,
      matchedDeny,
      matchedDenyFlag: null,
      reason: 'matched_deny',
      message: `Matched deny entry '${matchedDeny}'.`,
    });
  }

  if (matchedDenyFlag) {
    return createEvaluationResult(toolConfig, normalizedArgs, {
      allowed: false,
      matchedAllow,
      matchedDeny: null,
      matchedDenyFlag,
      reason: 'matched_deny_flag',
      message: `Matched deny flag '${matchedDenyFlag}'.`,
    });
  }

  if (matchedAllow) {
    return createEvaluationResult(toolConfig, normalizedArgs, {
      allowed: true,
      matchedAllow,
      matchedDeny: null,
      matchedDenyFlag: null,
      reason: 'matched_allow',
      message: `Matched allow entry '${matchedAllow}'.`,
    });
  }

  return createEvaluationResult(toolConfig, normalizedArgs, {
    allowed: false,
    matchedAllow: null,
    matchedDeny: null,
    matchedDenyFlag: null,
    reason: 'no_allow_match',
    message: 'No allow entry matched.',
  });
}

export function evaluateCommand(config, toolName, args) {
  const toolConfig = config.tools[toolName];

  if (!toolConfig) {
    return {
      tool: toolName,
      normalizedArgs: normalizeArgs(args),
      matchedAllow: null,
      matchedDeny: null,
      matchedDenyFlag: null,
      denyFlags: [],
      allowed: false,
      reason: 'unknown_tool',
      message: `Tool '${toolName}' is not configured.`,
    };
  }

  return evaluateToolPolicy(toolConfig, args);
}

function createEvaluationResult(toolConfig, normalizedArgs, result) {
  return {
    tool: toolConfig.name,
    normalizedArgs,
    matchedAllow: result.matchedAllow,
    matchedDeny: result.matchedDeny,
    matchedDenyFlag: result.matchedDenyFlag,
    denyFlags: [...toolConfig.denyFlags],
    allowed: result.allowed,
    reason: result.reason,
    message: result.message,
  };
}

function isLongFlagWithValue(token) {
  return token.startsWith('--') && token.includes('=') && token.length > 2;
}
