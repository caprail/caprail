# `@caprail/transport-http`

HTTP transport for command-token guards in the Caprail family.

This package is a **transport library** — it provides a reusable HTTP server runtime
that binds a Caprail guard to `/exec`, `/discover`, and `/health` endpoints. It does not
ship a binary or CLI entrypoint; that is the responsibility of a product package such as
`@caprail/cli-http`.

See [`docs/api.md`](./docs/api.md) for endpoint contracts and
[`docs/auth.md`](./docs/auth.md) for authentication modes.

---

## Usage

```js
import * as guardCli from '@caprail/guard-cli';
import { startHttpTransportServer } from '@caprail/transport-http';

const server = await startHttpTransportServer({
  guard: guardCli,
  configPath: '/etc/caprail-cli/config.yaml',
  auth: { token: process.env.CAPRAIL_TOKEN },
  host: '0.0.0.0',
  port: 8100,
});

console.log(`Listening on port ${server.address().port}`);
```

---

## API

### `createHttpTransportServer(options)` → `Promise<http.Server>`

Validates the guard contract, auth configuration, and policy config via
`guard.loadAndValidateConfig`, then returns a configured `http.Server` that is **not
yet listening**. Throws if any startup step fails (fail-closed).

After startup, `/discover` and `/exec` hot-reload the policy file when its on-disk
fingerprint changes. Reload failures are also fail-closed: protected routes return 500
until the config becomes valid again. `/health` stays public and does not depend on
successful reloads.

### `startHttpTransportServer(options)` → `Promise<http.Server>`

Same as `createHttpTransportServer`, but also starts listening on the configured
`host`/`port`. Resolves with the listening `http.Server`.

### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `guard` | object | **required** | Guard adapter — see [Guard contract](#guard-contract) |
| `configPath` | string | | Explicit config path passed to `guard.loadAndValidateConfig` |
| `auth` | object | **required** | `{ token: string }` or `{ noAuth: true }` — see [docs/auth.md](./docs/auth.md) |
| `timeoutMs` | number | `30000` | Child process timeout in ms. Returns 504 on breach. |
| `maxOutputBytes` | number | `1048576` | Max combined stdout+stderr bytes. Returns 413 on breach. |
| `host` | string | `'127.0.0.1'` | Bind host (`startHttpTransportServer` only) |
| `port` | number | `8100` | Bind port (`startHttpTransportServer` only). Use `0` for OS-assigned. |
| `env` | object | `process.env` | Environment passed to child processes |

---

## Guard contract

The injected `guard` object must implement these three methods. All other guard
internals are invisible to the transport.

```js
{
  // Load and validate the policy config from disk.
  // Returns { ok, configPath, config, report, error }.
  loadAndValidateConfig(options),

  // Return serialised tool definitions for /discover.
  // Returns { ok, payload: { tools } }.
  buildListPayload(config, options),

  // Evaluate policy and execute the command.
  // Returns Promise<{ status, ... }>.
  // Supports optional `signal` (AbortSignal) for transport-level timeout/cap.
  executeGuardedCommand(config, toolName, args, options),
}
```

The transport depends **only on this public contract**. It never imports guard
internals. This means the same `@caprail/transport-http` can be paired with any future
guard (e.g. `@caprail/guard-files`) without modification.

---

## Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | None | Container health check — always 200 |
| `GET` | `/discover` | Required | Tool manifest + execution metadata |
| `POST` | `/exec` | Required | Execute a command through the guard |

See [`docs/api.md`](./docs/api.md) for full request/response contracts.

---

## Execution controls

All commands run in **non-interactive mode**:

- `stdin` is never forwarded.
- `stdout` and `stderr` are captured separately and returned in the response body.
- Timeout enforcement: if the child exceeds `timeoutMs`, it is sent SIGTERM then SIGKILL
  (after 200 ms) and the transport returns **504 Gateway Timeout**.
- Output cap enforcement: once combined stdout+stderr reaches `maxOutputBytes`, the child
  is terminated and the transport returns **413 Payload Too Large**.

Output capture happens byte-by-byte during execution — large outputs are never fully
buffered before the cap is enforced.

---

## Composition boundary

```text
guard package:     policy model + config + evaluation + execution + audit
shared package:    config runtime + hot-reload state/fingerprinting
transport package: HTTP protocol + auth + timeout/output limits + process lifecycle
product package:   thin wiring + CLI flags + binary entry point
```

`@caprail/transport-http` is intentionally guard-agnostic. A future product like
`@caprail/files-http` can reuse this transport with a different guard without changing
any HTTP runtime code, while sharing the same config-runtime helpers.

---

## Reusable runtime core

The HTTP primitives in `src/server.js` are guard-agnostic and can be imported directly:

```js
import { parseJsonBody, writeJson, writeError, checkAuth } from '@caprail/transport-http/src/server.js';
```

These are used internally by the CLI route adapter (`/exec`, `/discover`) but are
available as building blocks for future guard adapters.
