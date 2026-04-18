# Audit logging

Audit logging is separate from wrapped command stdout and stderr.

## Supported sinks

- `audit_log: none`
- `audit_log: <file path>` with `audit_format: text`
- `audit_log: <file path>` with `audit_format: jsonl`

## Event contents

Current audit events include:

- timestamp
- tool name
- original argument array
- result (`allowed`, `denied`, `error`)
- binary path/name
- reason code
- exit code / signal when execution occurred
- duration in milliseconds

## Format examples

### JSONL

```json
{"ts":"2026-04-18T10:30:00.000Z","tool":"gh","args":["pr","list"],"result":"allowed","binary":"gh","reason":"matched_allow","exit_code":0,"signal":null,"duration_ms":123}
```

### Text

```text
[2026-04-18T10:30:00.000Z] ALLOWED gh pr list matched_allow (123ms)
```

## Operational notes

- denied commands do not spawn a child process, but can still emit an audit entry
- allowed commands run with `shell: false`
- audit writes are intentionally kept out of command stdout/stderr callbacks
- startup validation should check audit path writability before exposing the guard through a transport
