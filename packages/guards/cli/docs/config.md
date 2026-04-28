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
  az:
    binary: "C:\\Program Files\\Microsoft SDKs\\Azure\\CLI2\\python.exe"
    argv_prefix:
      - -IBm
      - azure.cli
    allow:
      - account list
```

## Fields

| Field | Required | Description |
|---|---|---|
| `binary` | yes | Executable to launch (full path or name resolved via `PATH`) |
| `description` | no | Human-readable tool description |
| `allow` | no | Allowlist of command token sequences (empty = deny all) |
| `deny` | no | Denylist of command token sequences evaluated before allow |
| `deny_flags` | no | Individual flags that are always denied regardless of allow |
| `argv_prefix` | no | Fixed tokens prepended to spawn args before user args (see below) |

### `argv_prefix` — per-tool argument prefix

`argv_prefix` accepts an optional list of strings that are inserted between the binary and the
user-supplied args at spawn time. Policy evaluation still operates on the original user args only;
prefix tokens are never included in allowlist matching.

**Use case:** tools that are not directly executable on the host (e.g. Windows Azure CLI, which is
a Python-based wrapper rather than a native `.exe`):

```yaml
tools:
  az:
    binary: "C:\\Program Files\\Microsoft SDKs\\Azure\\CLI2\\python.exe"
    argv_prefix:
      - -IBm
      - azure.cli
    allow:
      - account list
      - group list
```

- Client sends args: `account list --output table`
- Policy evaluates: `account list --output table` (clean, no prefix)
- Actual spawn: `python.exe -IBm azure.cli account list --output table`

This preserves `shell: false` safety while accommodating interpreter-wrapped tools.

## Normalization

- omitted `allow`, `deny`, and `deny_flags` become empty arrays
- omitted `settings.audit_log` becomes `none`
- omitted `settings.audit_format` becomes `text`
- tool configs are normalized into internal camelCase fields such as `denyFlags`

## Load result shape

`loadConfig()` returns `{ ok, configPath, config }` on success.
`loadAndValidateConfig()` returns `{ ok, configPath, config, report, error }`.

`configPath` is the resolved canonical path used to load the policy file. Consumers should
prefer this explicit field over reaching into config metadata.

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
