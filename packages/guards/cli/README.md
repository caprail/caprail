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

Those belong in transport or product packages such as `@caprail/transport-argv`, `@caprail/transport-http`, `@caprail/cli-argv`, and `@caprail/cli-http`.

## Install

```bash
npm install @caprail/guard-cli
```

Node 18+ is required.

## Config resolution

Config resolution follows this order:

- `CAPRAIL_CLI_CONFIG`
- `%ProgramData%\caprail-cli\config.yaml`
- `%AppData%\caprail-cli\config.yaml`
- `$XDG_CONFIG_HOME/caprail-cli/config.yaml`
- `~/.config/caprail-cli/config.yaml`

## Example

```js
import {
  loadAndValidateConfig,
  buildDiscoveryPayload,
  buildExplainPayload,
  executeGuardedCommand,
} from '@caprail/guard-cli';

const loaded = loadAndValidateConfig({ configPath: '/etc/caprail-cli/config.yaml' });

if (!loaded.ok) {
  console.error(loaded.report);
  process.exit(1);
}

console.log(`Loaded config from ${loaded.configPath}`);

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
