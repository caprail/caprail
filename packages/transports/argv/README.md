# @caprail/transport-argv

`@caprail/transport-argv` is the process-argv transport for **command-token guard** packages in the Caprail family.

It owns:
- argv flag parsing (`--config`, `--validate`, `--list`, `--explain`, `--json`)
- mode dispatch (`validate`, `list`, `explain`, `execute`)
- text/JSON rendering for read-only modes
- process-style exit-code mapping for execution outcomes

It does **not** own guard policy logic (matching, config schema, audit implementation, command spawning rules). Those remain inside the injected guard package (for example `@caprail/guard-cli`).

## Scope note

This transport targets guards that expose a **command-token invocation model** (`<tool> [args...]`).

`@caprail/guard-cli` is the first consumer. Other guards should use this transport only if their capability also fits this model.

## Install

```bash
npm install @caprail/transport-argv
```

Node 18+ is required.

## API

```js
import { parseArgv, runArgvTransport } from '@caprail/transport-argv';
```

### `parseArgv(argv)`

Parses argv tokens into one of four modes:
- `execute` (default)
- `explain`
- `list`
- `validate`

Returns either:
- `{ ok: true, value: ParsedArgv }`
- `{ ok: false, error: { code, message, ... } }`

### `runArgvTransport(options)`

```js
await runArgvTransport({
  argv,
  guard,
  stdout,
  stderr,
  env,
  platform,
  homeDirectory,
});
```

`guard` must expose this public contract:
- `loadAndValidateConfig(options)`
- `buildListPayload(config, options)`
- `buildExplainPayload(config, toolName, args)`
- `executeGuardedCommand(config, toolName, args, options)`

The transport writes to the provided streams and returns structured results with `exitCode`. It does not call `process.exit()`.

## Product composition

This package is a **library transport**, not the runnable CLI product.

The executable boundary belongs in `@caprail/cli-argv`, which should stay thin:
1. import guard + transport
2. pass `process.argv.slice(2)` and stdio
3. set `process.exitCode` from the returned `exitCode`

## Contract details

See [`docs/contract.md`](./docs/contract.md) for parser grammar, output behavior, and exit-code rules.
