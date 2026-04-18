# Config

## Resolution order

`@caprail/guard-cli` resolves policy config in this order:

1. explicit `configPath`
2. `CAPRAIL_CLI_CONFIG`
3. platform defaults

There is **no current-working-directory lookup**.

### Platform defaults

- Windows: `%ProgramData%\caprail-cli\config.yaml`, then `%AppData%\caprail-cli\config.yaml`
- Linux/macOS: `$XDG_CONFIG_HOME/caprail-cli/config.yaml`, then `~/.config/caprail-cli/config.yaml`

## Shape

```yaml
settings:
  audit_log: none
  audit_format: jsonl

tools:
  gh:
    binary: gh
    description: GitHub CLI
    allow:
      - pr list
    deny:
      - pr create
    deny_flags:
      - --web
```

## Normalization

- omitted `allow`, `deny`, and `deny_flags` become empty arrays
- omitted `settings.audit_log` becomes `none`
- omitted `settings.audit_format` becomes `text`
- tool configs are normalized into internal camelCase fields such as `denyFlags`

## Validation report

`validateConfig()` returns:

```json
{
  "valid": true,
  "errors": [],
  "warnings": []
}
```

### Errors

Errors are startup-fatal and include cases such as:

- unreadable or malformed config
- unsupported audit format
- unwritable audit sink
- empty policy entries

### Warnings

Warnings do not make the config invalid. Current warnings include:

- `binary_not_found`
- `unreachable_deny_entry`

Missing binaries are warnings by design so transports/products can decide how strict startup should be.
