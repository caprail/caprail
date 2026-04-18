# `@caprail/transport-argv` Contract

## Purpose

Provide a deterministic argv transport for command-token guards.

This transport parses CLI flags, loads config through an injected guard contract, dispatches one mode, and maps outcomes to process-style exit codes.

## Supported flags

- `--config <path>`
- `--validate`
- `--list [tool]`
- `--explain`
- `--json`

Unknown flags are parser errors.

## Mode grammar

### Execution (default)

```text
--config <path> -- <tool> [args...]
```

- `--` separator is required
- first token after `--` is `toolName`
- remaining tokens are forwarded unchanged as args
- `--json` is not supported in execution mode

### Explain

```text
--config <path> --explain [--json] -- <tool> [args...]
```

- `--` separator is required
- command tokens after `--` are preserved exactly

### List

```text
--config <path> --list [tool] [--json]
```

- no `--` separator
- optional tool narrows payload to one tool

### Validate

```text
--config <path> --validate [--json]
```

- no `--` separator

## Flag-order rules

- transport flags must appear before command-token input
- for execution and explain, command-token input starts at the required `--` separator
- tokens after `--` are always treated as command tokens (never parsed as transport flags)

## Parser errors

Parser returns machine-readable `{ code, message }` errors, including:
- `flag_requires_value`
- `mode_conflict`
- `separator_required`
- `separator_not_allowed`
- `unknown_flag`
- `command_tokens_missing`
- `json_not_supported_in_execution`

## Guard contract (injected)

The transport depends only on this public interface:

```js
{
  loadAndValidateConfig(options),
  buildListPayload(config, options),
  buildExplainPayload(config, toolName, args),
  executeGuardedCommand(config, toolName, args, options),
}
```

No guard internals should be imported.

## Output behavior

### Validate mode

- text: human-readable summary and diagnostics
- json: writes guard validation report JSON
- exit code:
  - `0` when valid
  - `1` when invalid or unreadable

### List mode

- text: formatted tool permissions
- json: writes guard list payload JSON
- exit code:
  - `0` on success
  - `1` on config/transport/payload errors

### Explain mode

- text: stable field ordering (`Tool`, `Normalized`, `Matched allow`, `Matched deny`, `Matched deny flag`, `Deny flags`, `Result`)
- json: writes guard explain payload JSON
- exit code:
  - `0` on success
  - `1` on config/transport/payload errors

### Execution mode

- delegates to `executeGuardedCommand`
- streams child stdout/stderr via callbacks
- exit code mapping:
  - guard `status: "executed"` -> forward vendor `exitCode`
  - guard `status: "denied"` -> `126`
  - transport/config/audit/spawn failures -> `1`

## Product boundary

`@caprail/transport-argv` is not the CLI binary.

The executable (`bin`, `--help`, `--version`, `process.exitCode` wiring) belongs in `@caprail/cli-argv`.
