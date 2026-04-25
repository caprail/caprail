# @caprail/cli-http

`@caprail/cli-http` is the runnable HTTP product in the Caprail package family.

It is intentionally thin and composes:
- `@caprail/guard-cli` (policy/config/matching/execution core)
- `@caprail/transport-http` (HTTP routes, auth checks, timeout/output-cap behavior)

This package owns only product concerns: startup CLI flags, executable boundary, and product composition.

## Install

```bash
npm install @caprail/cli-http
```

Node 18+ is required.

## Binary name

This package ships a single canonical executable:

- `caprail-cli-http`

## Minimal policy example

A Caprail policy lives in the config file you pass to `--config`. For a simple read-only GitHub setup using `gh`, the policy can look like this:

```yaml
tools:
  gh:
    binary: gh
    description: GitHub CLI (read-only PR and issue access)
    allow:
      - pr list
      - pr view
      - pr diff
      - issue list
      - issue view
    deny_flags:
      - --web
```

For the full policy schema, matching rules, and config-loading behavior, see the [`@caprail/guard-cli` README](../../guards/cli/README.md).

## Quickstart

Token mode:

```bash
caprail-cli-http \
  --config /etc/caprail-cli/config.yaml \
  --host 0.0.0.0 \
  --port 8100 \
  --token "$CAPRAIL_TOKEN"
```

No-auth mode (private network only):

```bash
caprail-cli-http \
  --config /etc/caprail-cli/config.yaml \
  --host 0.0.0.0 \
  --port 8100 \
  --no-auth
```

After startup, use:
- `GET /health`
- `GET /discover`
- `POST /exec`

The product hot-reloads the configured policy YAML for `/discover` and `/exec` when the
file changes on disk. Reload errors are fail-closed: protected routes return 500 until
the config is valid again.

For full route request/response contracts, see `@caprail/transport-http` docs:
- `packages/transports/http/docs/api.md`
- `packages/transports/http/docs/auth.md`

## Programmatic API

```js
import { startCliHttpProduct } from '@caprail/cli-http';

const started = await startCliHttpProduct({
  argv: [
    '--config', '/etc/caprail-cli/config.yaml',
    '--port', '8100',
    '--token', 'secret',
  ],
});

console.log(started.address.port);
```

Returns:

```js
{
  ok: true,
  server,
  address: { host, port },
  options: {
    configPath,
    host,
    port,
    timeoutMs,
    maxOutputBytes,
    auth,
  }
}
```

## Layering and boundaries

- Product (`@caprail/cli-http`): startup flags, bin wiring, startup UX
- Guard (`@caprail/guard-cli`): policy semantics, config loading/validation, matching, execution
- Shared (`@caprail/config-runtime`): config runtime state and hot-reload lifecycle
- Transport (`@caprail/transport-http`): HTTP protocol, `/exec`/`/discover`/`/health`, auth behavior, timeout/cap behavior

This package does **not** reimplement HTTP behavior from the transport package.

## Operational guidance

- `--config` is required. Use explicit config paths for sidecar/host-wrapper deployments.
- Auth mode must be explicit: choose exactly one of `--token <secret>` or `--no-auth`.
- Default bind host is `0.0.0.0` to support container-to-container use cases; keep deployments on private networks and protect with token + network controls.
- See product usage details in [`docs/usage.md`](./docs/usage.md), and repository use cases:
  - `docs/usecase-docker-sidecar.md`
  - `docs/usecase-pi-container-host-wrapper.md`
