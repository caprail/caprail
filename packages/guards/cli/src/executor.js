import { spawn } from 'node:child_process';

import { evaluateCommand } from './matcher.js';
import { createAuditLogger } from './logger.js';

const NON_INTERACTIVE_ENV = {
  PAGER: 'cat',
  GIT_PAGER: 'cat',
  GH_PAGER: 'cat',
  TERM: 'dumb',
};

export async function executeGuardedCommand(config, toolName, args, options = {}) {
  const toolConfig = config.tools[toolName] ?? null;
  const evaluation = evaluateCommand(config, toolName, args);
  const command = {
    tool: toolName,
    binary: toolConfig?.binary ?? null,
    args: [...args],
  };
  const auditLoggerResult = options.auditLogger
    ? { ok: true, logger: options.auditLogger }
    : createAuditLogger(config.settings);

  if (!auditLoggerResult.ok) {
    return {
      status: 'audit_error',
      allowed: false,
      executed: false,
      command,
      evaluation,
      error: auditLoggerResult.error,
    };
  }

  const auditLogger = auditLoggerResult.logger;

  if (!evaluation.allowed) {
    const deniedResult = {
      status: 'denied',
      allowed: false,
      executed: false,
      command,
      evaluation,
      message: formatDenialMessage(toolName, args, evaluation),
    };
    const auditError = writeAuditEvent(auditLogger, deniedResult, evaluation, 0);

    if (auditError) {
      return {
        ...deniedResult,
        status: 'audit_error',
        error: auditError,
      };
    }

    return deniedResult;
  }

  const startTime = Date.now();
  let stdoutBytes = 0;
  let stderrBytes = 0;

  try {
    const completed = await new Promise((resolvePromise, rejectPromise) => {
      const child = spawn(toolConfig.binary, args, {
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...(options.env ?? process.env),
          ...NON_INTERACTIVE_ENV,
        },
      });

      child.stdout.on('data', (chunk) => {
        stdoutBytes += chunk.length;
        options.onStdout?.(chunk);
      });

      child.stderr.on('data', (chunk) => {
        stderrBytes += chunk.length;
        options.onStderr?.(chunk);
      });

      child.on('error', (error) => {
        rejectPromise(error);
      });

      child.on('close', (exitCode, signal) => {
        resolvePromise({
          exitCode,
          signal,
        });
      });
    });

    const result = {
      status: 'executed',
      allowed: true,
      executed: true,
      command,
      evaluation,
      exitCode: completed.exitCode,
      signal: completed.signal,
      durationMs: Date.now() - startTime,
      stdoutBytes,
      stderrBytes,
    };
    const auditError = writeAuditEvent(auditLogger, result, evaluation, result.durationMs);

    if (auditError) {
      return {
        ...result,
        status: 'audit_error',
        error: auditError,
      };
    }

    return result;
  } catch (error) {
    const result = {
      status: 'execution_error',
      allowed: true,
      executed: false,
      command,
      evaluation,
      durationMs: Date.now() - startTime,
      stdoutBytes,
      stderrBytes,
      error: {
        code: 'spawn_failed',
        message: error.message,
      },
    };
    const auditError = writeAuditEvent(auditLogger, result, evaluation, result.durationMs);

    if (auditError) {
      return {
        ...result,
        status: 'audit_error',
        error: auditError,
      };
    }

    return result;
  }
}

export function createExecutionEnvironment(baseEnv = process.env) {
  return {
    ...baseEnv,
    ...NON_INTERACTIVE_ENV,
  };
}

function writeAuditEvent(auditLogger, result, evaluation, durationMs) {
  try {
    auditLogger.log({
      ts: new Date().toISOString(),
      tool: result.command.tool,
      args: result.command.args,
      result: mapAuditResult(result),
      binary: result.command.binary,
      reason: evaluation.reason,
      exitCode: result.exitCode ?? null,
      signal: result.signal ?? null,
      durationMs,
    });
    return null;
  } catch (error) {
    return {
      code: 'audit_write_failed',
      message: error.message,
    };
  }
}

function mapAuditResult(result) {
  if (result.status === 'denied') {
    return 'denied';
  }

  if (result.status === 'execution_error') {
    return 'error';
  }

  if (result.allowed) {
    return 'allowed';
  }

  return 'denied';
}

function formatDenialMessage(toolName, args, evaluation) {
  if (evaluation.reason === 'unknown_tool') {
    return `Tool '${toolName}' is not configured.`;
  }

  if (evaluation.matchedDeny) {
    return `'${evaluation.matchedDeny}' is denied for '${toolName}'.`;
  }

  if (evaluation.matchedDenyFlag) {
    return `Deny flag '${evaluation.matchedDenyFlag}' is blocked for '${toolName}'.`;
  }

  return `'${args.join(' ')}' is not in the allow list for '${toolName}'.`;
}
