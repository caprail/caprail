import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function createAuditLogger(settings) {
  if (settings.auditLog === 'none') {
    return {
      ok: true,
      logger: {
        enabled: false,
        log() {},
      },
    };
  }

  if (!['text', 'jsonl'].includes(settings.auditFormat)) {
    return {
      ok: false,
      error: {
        code: 'audit_format_invalid',
        message: `Audit format '${settings.auditFormat}' is not supported.`,
      },
    };
  }

  const auditLogPath = resolve(settings.auditLog);

  return {
    ok: true,
    logger: {
      enabled: true,
      log(event) {
        appendFileSync(auditLogPath, `${formatAuditEvent(event, settings.auditFormat)}\n`, 'utf8');
      },
    },
  };
}

export function formatAuditEvent(event, format) {
  if (format === 'jsonl') {
    return JSON.stringify({
      ts: event.ts,
      tool: event.tool,
      args: event.args,
      result: event.result,
      binary: event.binary,
      reason: event.reason,
      exit_code: event.exitCode,
      signal: event.signal,
      duration_ms: event.durationMs,
    });
  }

  const outcome = String(event.result).toUpperCase();
  const reasonSuffix = event.reason ? ` ${event.reason}` : '';
  const durationSuffix = Number.isFinite(event.durationMs) ? ` (${event.durationMs}ms)` : '';

  return `[${event.ts}] ${outcome} ${event.tool} ${event.args.join(' ')}${reasonSuffix}${durationSuffix}`.trim();
}
