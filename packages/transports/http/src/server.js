import { Readable } from 'node:stream';
import { ServerResponse } from 'node:http';

const MAX_REQUEST_BODY_BYTES = 65536; // 64 KB

/**
 * Parse the request body as JSON, enforcing a 64 KB size limit.
 * Rejects with a plain error object `{ code, message }` on failure.
 *
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<unknown>}
 */
export function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let settled = false;

    function fail(error) {
      if (settled) return;
      settled = true;
      reject(error);
    }

    req.on('data', (chunk) => {
      if (settled) return;
      totalBytes += chunk.length;
      if (totalBytes > MAX_REQUEST_BODY_BYTES) {
        fail({ code: 'request_too_large', message: 'Request body exceeds 64 KB limit.' });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (settled) return;
      settled = true;
      const text = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(JSON.parse(text));
      } catch {
        reject({ code: 'invalid_json', message: 'Request body is not valid JSON.' });
      }
    });

    req.on('error', (err) => {
      fail({ code: 'request_error', message: err.message });
    });
  });
}

/**
 * Write a JSON response with the given HTTP status code.
 *
 * @param {import('node:http').ServerResponse} res
 * @param {number} statusCode
 * @param {unknown} payload
 */
export function writeJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

/**
 * Write a standard `{ error: { code, message } }` envelope response.
 *
 * @param {import('node:http').ServerResponse} res
 * @param {number} statusCode
 * @param {string} code
 * @param {string} message
 */
export function writeError(res, statusCode, code, message) {
  writeJson(res, statusCode, { error: { code, message } });
}

/**
 * Check the Authorization header against the configured auth mode.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {{ noAuth?: boolean, token?: string }} auth
 * @returns {{ ok: boolean }}
 */
export function checkAuth(req, auth) {
  if (auth.noAuth === true) {
    return { ok: true };
  }

  const header = req.headers['authorization'] ?? '';
  const match = /^Bearer (.+)$/.exec(header);

  if (!match || match[1] !== auth.token) {
    return { ok: false };
  }

  return { ok: true };
}
