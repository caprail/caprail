# @caprail/cli

`@caprail/cli` is the runnable local argv product in the Caprail package family.

It is intentionally thin and composes:
- `@caprail/guard-cli` (policy/config/matching/execution core)
- `@caprail/transport-argv` (argv parsing, mode dispatch, rendering, exit semantics)

This package owns only the executable boundary (`bin`, `process.argv`, stdio, and `process.exitCode`).

## Install

```bash
npm install @caprail/cli
```

Node 18+ is required.

## Binary name

This package ships a single canonical executable:

- `caprail-cli`

## Quickstart

Validate config:

```bash
caprail-cli --config ./config.yaml --validate --json
```

List configured tools:

```bash
caprail-cli --config ./config.yaml --list --json
```

Explain whether a command would be allowed:

```bash
caprail-cli --config ./config.yaml --explain --json -- gh pr list
```

Execute through the guard:

```bash
caprail-cli --config ./config.yaml -- gh pr list
```

## Programmatic API

```js
import { runCliProduct } from '@caprail/cli';

const result = await runCliProduct({
  argv: ['--config', './config.yaml', '--validate', '--json'],
  stdout: process.stdout,
  stderr: process.stderr,
});

process.exitCode = result.exitCode;
```

`runCliProduct` returns the transport result object and does not call `process.exit()`.

## Layering and boundaries

- Product (`@caprail/cli`): executable boundary and wiring
- Guard (`@caprail/guard-cli`): policy semantics, config, matcher, execution, audit
- Transport (`@caprail/transport-argv`): argv contract and mode behavior

For deeper behavior details see:
- `@caprail/guard-cli` docs in `packages/guards/cli/docs/`
- `@caprail/transport-argv` docs in `packages/transports/argv/docs/`
- local usage details: [`docs/usage.md`](./docs/usage.md)
