# @caprail/cli usage

## Invocation shape

```bash
caprail-cli [transport flags] [-- <tool> [args...]]
```

Transport flags come before the `--` separator.

## Modes

### Validate

```bash
caprail-cli --config ./config.yaml --validate
caprail-cli --config ./config.yaml --validate --json
```

### List

```bash
caprail-cli --config ./config.yaml --list
caprail-cli --config ./config.yaml --list gh --json
```

### Explain

```bash
caprail-cli --config ./config.yaml --explain -- gh pr list
caprail-cli --config ./config.yaml --explain --json -- gh pr list
```

### Execute

```bash
caprail-cli --config ./config.yaml -- gh pr list
```

## Exit behavior

- `0`: success
- `1`: argument/config/runtime failure
- `126`: policy denial in execute mode
- child process exit code: forwarded for allowed execute mode

## Responsibility boundary

This package does not define policy semantics itself. It forwards to:

- `@caprail/guard-cli` for policy/matching/execution
- `@caprail/transport-argv` for parsing and mode behavior
