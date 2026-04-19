# Sidecar experience: @caprail/cli-http

Running `@caprail/cli-http` as a Docker sidecar to give an AI coding agent (Openclaw) policy-based access to `gh` and `gws` over HTTP.

## What was deployed

- **Agent container:** Openclaw (AI coding agent). No vendor CLIs, no credentials.
- **Sidecar container:** `caprail-cli-http` with `gh` (GitHub CLI) and `gws` (Google Workspace CLI) installed and authenticated. Policy config mounted read-only.
- **Network:** Docker internal network. Sidecar has no host-exposed ports.

This is the strongest deployment model described in [docs/usecase-docker-sidecar.md](../../docs/usecase-docker-sidecar.md). The agent literally cannot run `gh` or `gws` directly — it can only reach them through Caprail's HTTP API.

## Prerequisites

- Docker and Docker Compose
- `gh` authenticated in the sidecar image (or credentials mounted)
- `gws` authenticated in the sidecar image (or credentials mounted)
- A shared bearer token for sidecar auth
- Policy config file (see below)

## Policy config

```yaml
settings:
  audit_log: /var/log/caprail-cli/audit.log
  audit_format: jsonl

tools:
  gh:
    binary: gh
    description: "GitHub CLI — read-only access to PRs and issues"
    allow:
      - pr list
      - pr view
      - pr diff
      - pr checks
      - issue list
      - issue view
      - repo view
    deny_flags:
      - --web

  gws:
    binary: gws
    description: "Google Workspace CLI — read emails and create drafts only"
    allow:
      - gmail users messages list
      - gmail users messages get
      - gmail users drafts create
      - gmail users drafts list
      - gmail users drafts get
```

## Starting the sidecar

```bash
caprail-cli-http \
  --config /etc/caprail-cli/config.yaml \
  --host 0.0.0.0 \
  --port 8100 \
  --token "$CAPRAIL_TOKEN"
```

Startup log:

```text
caprail-cli-http: listening on http://0.0.0.0:8100
```

## Agent workflow

### 1. Discover available tools

The agent calls `/discover` once at session start to learn what it can do.

```http
GET /discover
Authorization: Bearer <token>
```

```json
{
  "tools": {
    "gh": {
      "binary": "gh",
      "description": "GitHub CLI — read-only access to PRs and issues",
      "allow": ["pr list", "pr view", "pr diff", "pr checks", "issue list", "issue view", "repo view"],
      "deny": [],
      "deny_flags": ["--web"]
    },
    "gws": {
      "binary": "gws",
      "description": "Google Workspace CLI — read emails and create drafts only",
      "allow": ["gmail users messages list", "gmail users messages get", "gmail users drafts create", "gmail users drafts list", "gmail users drafts get"],
      "deny": [],
      "deny_flags": []
    }
  },
  "execution": {
    "mode": "non-interactive",
    "timeout_ms": 30000,
    "max_output_bytes": 1048576
  }
}
```

The agent now knows: "I can read PRs, view issues, list emails, and create drafts."

### 2. Execute — read GitHub PRs

```http
POST /exec
Authorization: Bearer <token>
Content-Type: application/json

{
  "tool": "gh",
  "args": ["pr", "list", "--repo", "org/repo", "--state", "open"]
}
```

```json
{
  "allowed": true,
  "exit_code": 0,
  "stdout": "7\tchore(deps): bump @types/node\tdependabot/npm_and_yarn/types/node-25.6.0\tOPEN\t2026-04-11T15:33:06Z\n",
  "stderr": "",
  "timed_out": false,
  "truncated": false
}
```

### 3. Execute — read email

```http
POST /exec
Authorization: Bearer <token>
Content-Type: application/json

{
  "tool": "gws",
  "args": ["gmail", "messages", "list", "--max-results", "5"]
}
```

```json
{
  "allowed": true,
  "exit_code": 0,
  "stdout": "...",
  "stderr": "",
  "timed_out": false,
  "truncated": false
}
```

### 4. Execute — create a draft email

```http
POST /exec
Authorization: Bearer <token>
Content-Type: application/json

{
  "tool": "gws",
  "args": ["gmail", "drafts", "create", "--to", "someone@example.com", "--subject", "PR summary", "--body", "Here are the open PRs..."]
}
```

```json
{
  "allowed": true,
  "exit_code": 0,
  "stdout": "Draft created: id=abc123\n",
  "stderr": "",
  "timed_out": false,
  "truncated": false
}
```

### 5. Execute — denied command

The agent attempts to send an email directly (not in the allow list):

```http
POST /exec
Authorization: Bearer <token>
Content-Type: application/json

{
  "tool": "gws",
  "args": ["gmail", "messages", "send", "--to", "someone@example.com"]
}
```

```json
{
  "allowed": false,
  "error": {
    "code": "policy_denied",
    "message": "'gmail messages send' is not in the allow list for 'gws'."
  }
}
```

HTTP 403. The child process is never spawned. The agent sees the denial and can explain why to the user.

### 6. Execute — denied flag

```http
POST /exec
Authorization: Bearer <token>
Content-Type: application/json

{
  "tool": "gh",
  "args": ["pr", "view", "42", "--web"]
}
```

```json
{
  "allowed": false,
  "error": {
    "code": "policy_denied",
    "message": "Deny flag '--web' is blocked for 'gh'."
  }
}
```

HTTP 403. `--web` would open a browser in the sidecar container — blocked by policy.

### 7. Missing auth

```http
POST /exec
Content-Type: application/json

{
  "tool": "gh",
  "args": ["pr", "list"]
}
```

```json
{
  "error": {
    "code": "unauthorized",
    "message": "Missing or invalid bearer token."
  }
}
```

HTTP 401.

## HTTP status codes in practice

| Situation | Status | Code |
|-----------|--------|------|
| Allowed command succeeds | `200` | — |
| Allowed command, vendor CLI exits non-zero | `200` | `exit_code > 0` |
| Missing or invalid bearer token | `401` | `unauthorized` |
| Tool not configured or command denied | `403` | `policy_denied` |
| Denied flag used | `403` | `policy_denied` |
| Output exceeds cap | `413` | `output_limit_exceeded` |
| Command exceeds timeout | `504` | `execution_timeout` |

## What this confirms

- The Docker sidecar model works end-to-end: agent container → HTTP → sidecar → guarded CLI → vendor API
- `/discover` gives the agent a complete manifest of what it can do at session start
- `/exec` runs allowed commands and streams stdout/stderr back as structured JSON
- Policy denials return 403 with clear messages — the agent never touches the real binary
- Credential isolation is total: the agent container has no CLIs, no tokens, no credential files
- Bearer token auth prevents anything other than the expected agent from calling the sidecar
- Non-interactive execution means vendor CLIs that prompt for input receive EOF and fail gracefully
- Audit logging captures every allowed and denied invocation in the sidecar
