# @caprail/guard-cli

`@caprail/guard-cli` is the transport-agnostic core for Caprail's CLI guard.
It loads and validates policy config, evaluates token-based allow/deny rules, builds discovery/explain payloads, and executes allowed commands without going through a shell.

## What this package owns

- config resolution and YAML parsing
- validation reports with errors and warnings
- token normalization and policy matching
- discovery, list, and explain payload builders
- guarded execution and audit logging

## What this package does not own

Transport concerns stay outside the guard:

- CLI flag parsing for `process.argv`
- HTTP request/response handling
- auth, timeout, and output-capture policies
- process-to-exit-code or HTTP-status mapping

Those belong in transport or product packages such as `@caprail/transport-argv`, `@caprail/transport-http`, `@caprail/cli`, and `@caprail/cli-http`.

## Install

```bash
npm install @caprail/guard-cli
```

Node 18+ is required.

## Config compatibility note

The package name uses the Caprail family naming, but the current config lookup remains aligned with the spec's existing `cliguard` compatibility surface:

- `CLIGUARD_CONFIG`
- `%ProgramData%\cliguard\config.yaml`
- `%AppData%\cliguard\config.yaml`
- `$XDG_CONFIG_HOME/cliguard/config.yaml`
- `~/.config/cliguard/config.yaml`

## Example

```js
import {
  loadAndValidateConfig,
  buildDiscoveryPayload,
  buildExplainPayload,
  executeGuardedCommand,
} from '@caprail/guard-cli';

const loaded = loadAndValidateConfig({ configPath: '/secure/cliguard/config.yaml' });

if (!loaded.ok) {
  console.error(loaded.report);
  process.exit(1);
}

const discovery = buildDiscoveryPayload(loaded.config);
const explanation = buildExplainPayload(loaded.config, 'gh', ['pr', 'list']);
const result = await executeGuardedCommand(loaded.config, 'gh', ['pr', 'list'], {
  onStdout: (chunk) => process.stdout.write(chunk),
  onStderr: (chunk) => process.stderr.write(chunk),
});
```

## Docs

- `docs/config.md`
- `docs/policy-model.md`
- `docs/audit.md`
- repo example policy: `examples/guards/cli.policy.yaml`
