# Authentication — `@caprail/transport-http`

## Two modes, explicit choice required

The transport supports exactly two authentication modes. **If neither mode is configured,
the server refuses to start.** This prevents accidentally exposing the HTTP API without
making a deliberate security decision.

---

## Bearer token mode

Pass a secret token to `createHttpTransportServer` or `startHttpTransportServer`:

```js
const server = await startHttpTransportServer({
  guard,
  auth: { token: process.env.CAPRAIL_TOKEN },
  // ...
});
```

Every request to `/discover` and `/exec` must include:

```http
Authorization: Bearer <token>
```

A missing, empty, or mismatched token returns:

```json
HTTP 401 Unauthorized
{ "error": { "code": "unauthorized", "message": "Missing or invalid bearer token." } }
```

`/health` is **always unauthenticated** — it is intended for container orchestration
probes that run before any application-level secrets are available.

### Generating a token

Use any cryptographically-random secret. For example:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Pass it as an environment variable and never hard-code it in source control.

---

## No-auth mode

Use `{ noAuth: true }` only in environments where the network itself is the security
boundary (e.g. a private Docker bridge network not reachable from the host):

```js
const server = await startHttpTransportServer({
  guard,
  auth: { noAuth: true },
  host: '127.0.0.1', // bind only to loopback
  // ...
});
```

**Warning:** anyone who can reach the bound host+port can call `/exec`. Make sure the
network is isolated before enabling no-auth mode.

---

## Startup enforcement

`createHttpTransportServer` validates the auth option before the server binds to a port:

| `auth` value | Startup result |
|---|---|
| `{ token: '<non-empty string>' }` | OK |
| `{ noAuth: true }` | OK |
| `{}` | Throws — no explicit choice |
| `null` / `undefined` / missing | Throws — no explicit choice |
| `{ token: '' }` | Throws — empty token is not allowed |

---

## Guard boundary

Authentication is a **transport concern**. The guard package does not know whether a
request was authenticated — the transport enforces auth before the guard is ever called.

This means a new guard type (e.g. `@caprail/guard-files`) can reuse the same
`@caprail/transport-http` auth primitives without implementing auth itself.
