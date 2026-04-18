# `@caprail/transport-http`

HTTP transport for command-token guards in the Caprail family.

This package is a **transport library** — it provides an HTTP server runtime that binds
a Caprail guard to `/exec`, `/discover`, and `/health` endpoints. It does not ship a
binary or CLI entrypoint; that is the responsibility of a product package such as
`@caprail/cli-http`.

See [`docs/api.md`](./docs/api.md) for endpoint contracts and
[`docs/auth.md`](./docs/auth.md) for authentication modes.

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

## API

### `createHttpTransportServer(options)`

Validates the guard contract, auth configuration, and loaded config, then returns a
configured `http.Server` that is **not yet listening**. Throws if startup validation fails.

### `startHttpTransportServer(options)`

Same as `createHttpTransportServer` but also starts listening on the configured
`host`/`port`. Resolves with the listening `http.Server`.

### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `guard` | object | required | Guard adapter (`loadAndValidateConfig`, `buildListPayload`, `executeGuardedCommand`) |
| `configPath` | string | | Explicit config file path (falls back to guard resolution) |
| `auth` | object | required | `{ token: string }` or `{ noAuth: true }` |
| `timeoutMs` | number | `30000` | Child process timeout in milliseconds |
| `maxOutputBytes` | number | `1048576` | Max combined stdout+stderr bytes before 413 |
| `host` | string | `'127.0.0.1'` | Bind host (`startHttpTransportServer` only) |
| `port` | number | `8100` | Bind port (`startHttpTransportServer` only) |
| `env` | object | `process.env` | Environment passed to spawned processes |

## Guard contract

The injected `guard` object must implement:

```js
{
  loadAndValidateConfig(options),          // → { ok, config, report, error }
  buildListPayload(config, options),       // → { ok, payload }
  executeGuardedCommand(config, tool, args, options),  // → Promise<result>
}
```

Transport concerns (auth, timeouts, output caps, HTTP status mapping) stay in this
package. Guard concerns (policy evaluation, config parsing, audit logging) stay in the
guard package.
