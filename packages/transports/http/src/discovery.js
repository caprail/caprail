/**
 * Build the payload for GET /discover.
 *
 * Calls `guard.buildListPayload` to enumerate tools, then appends the
 * execution metadata block (mode, timeout_ms, max_output_bytes).
 *
 * @param {object} guard          - Guard adapter
 * @param {object} config         - Validated config object from loadAndValidateConfig
 * @param {{ timeoutMs: number, maxOutputBytes: number }} executionMeta
 * @returns {{ ok: true, payload: object } | { ok: false, error: object }}
 */
export function buildDiscoverPayload(guard, config, executionMeta) {
  let listed;

  try {
    listed = guard.buildListPayload(config, {});
  } catch (err) {
    return {
      ok: false,
      error: {
        code: 'internal_error',
        message: err?.message ?? 'Failed to build discovery payload.',
      },
    };
  }

  if (!listed.ok) {
    return {
      ok: false,
      error: {
        code: 'internal_error',
        message: listed.error?.message ?? 'Failed to list tools.',
      },
    };
  }

  return {
    ok: true,
    payload: {
      tools: listed.payload.tools,
      execution: {
        mode: 'non-interactive',
        timeout_ms: executionMeta.timeoutMs,
        max_output_bytes: executionMeta.maxOutputBytes,
      },
    },
  };
}
