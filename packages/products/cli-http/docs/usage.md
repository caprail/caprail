# @caprail/cli-http usage

## Invocation shape

```bash
caprail-cli-http \
  --config <path> \
  [--host <host>] \
  [--port <number>] \
  [--timeout-ms <number>] \
  [--max-output-bytes <number>] \
  (--token <secret> | --no-auth)
```

## Flags

| Flag | Required | Description |
|---|---|---|
| `--config <path>` | yes | Explicit guard config path |
| `--host <host>` | no | Bind host (default `0.0.0.0`) |
| `--port <number>` | no | Bind port (default `8100`, `0` allowed for ephemeral ports) |
| `--token <secret>` | auth required | Enables bearer-token auth on `/discover` and `/exec` |
| `--no-auth` | auth required | Disables auth checks (only for trusted/private networks) |
| `--timeout-ms <number>` | no | Child timeout forwarded to transport (default `30000`) |
| `--max-output-bytes <number>` | no | Output cap forwarded to transport (default `1048576`) |

Validation behavior:
- unknown flags are rejected
- missing flag values are rejected
- `--token` and `--no-auth` cannot be combined
- one auth mode must be chosen
- numeric flags must be non-negative integers

---

## What a real test drive looked like

The product was exercised end-to-end via the real binary (`bin/caprail-cli-http.js`) with a temporary fixture config and real HTTP requests.

Observed behavior:
- Startup in no-auth mode succeeds and logs a listening line.
- `GET /health` returns `200`.
- `GET /discover` returns `200` in no-auth mode.
- `POST /exec` with an allowed command returns `200` and separate `stdout`/`stderr`.
- `POST /exec` against a command exceeding `--timeout-ms 200` returns `504 execution_timeout`.
- In token mode, `/discover` returns `401` without token and `200` with correct bearer token.
- Startup with a missing config exits non-zero and prints a fatal error to `stderr`.

This confirms product wiring is doing the right thing: parser → guard + transport composition → runtime UX.

Operationally, the server hot-reloads the configured policy YAML for `/discover` and
`/exec` when the file changes on disk. If a reload fails, those protected routes return
HTTP 500 until the config is fixed; `/health` remains available.

---

## Typical startup patterns

### Token mode (recommended)

```bash
caprail-cli-http \
  --config /etc/caprail-cli/config.yaml \
  --host 0.0.0.0 \
  --port 8100 \
  --token "$CAPRAIL_TOKEN"
```

### No-auth mode (isolated network only)

```bash
caprail-cli-http \
  --config /etc/caprail-cli/config.yaml \
  --host 0.0.0.0 \
  --port 8100 \
  --no-auth
```

### Ephemeral local port for testing

```bash
caprail-cli-http --config ./config.yaml --port 0 --no-auth
```

Startup log example:

```text
caprail-cli-http: listening on http://0.0.0.0:54321
```

---

## Calling the API

### Health

```http
GET /health
```

Expected:

```json
{ "status": "ok" }
```

### Discover (token mode)

```http
GET /discover
Authorization: Bearer <token>
```

Without token (in token mode) you should get `401 unauthorized`.

### Exec

```http
POST /exec
Content-Type: application/json
Authorization: Bearer <token>   # if token mode

{
  "tool": "node",
  "args": ["./child.mjs", "echo", "hello"]
}
```

Allowed command result:
- HTTP `200`
- `allowed: true`
- `stdout` and `stderr` returned separately

---

## Common failure modes

### Missing auth choice

If neither `--token` nor `--no-auth` is passed, startup fails immediately.

### Conflicting auth flags

Passing both `--token` and `--no-auth` fails immediately.

### Missing/invalid config

Example stderr:

```text
caprail-cli-http: fatal error: Failed to start HTTP server: Startup validation failed: Config file was not found: /no/such/config.yaml
```

Process exits non-zero.

### Policy-denied `/exec`

`/exec` returns `403 policy_denied` when request tokens do not match an allow entry.

Important: matching is token-exact. If your allow rule uses one path form and your request uses another, it can be denied.

---

## Responsibility boundary

`@caprail/cli-http` is a product wrapper.

- Product owns: startup flags, bin wiring, startup UX.
- `@caprail/config-runtime` owns: config runtime state and hot-reload lifecycle.
- `@caprail/transport-http` owns: route contracts/auth/timeout/output-cap behavior.
- `@caprail/guard-cli` owns: config/policy/matching/execution semantics.

For full HTTP contract details see:
- `packages/transports/http/docs/api.md`
- `packages/transports/http/docs/auth.md`
