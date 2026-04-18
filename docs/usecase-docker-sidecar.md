# Use Case: Docker Sidecar for Openclaw

## Context

Openclaw (an AI coding agent) runs in a Docker container. It needs access to authenticated vendor CLIs (`gh`, `gws`) but must not have direct access to the credentials or the ability to run arbitrary commands against those CLIs.

This is the strongest deployment model for cliguard:
- the agent container has no vendor CLI binaries
- the agent container has no credential mounts
- policy config is mounted read-only into the sidecar only
- cliguard-http exposes a small, authenticated API for allowed commands

## Architecture

```text
┌─────────────────────────┐         ┌───────────────────────────────┐
│ openclaw container      │         │ sidecar container             │
│                         │         │                               │
│  Agent runtime          │  HTTP   │  cliguard-http (:8100)        │
│  (has shell, no creds,  │────────▶│    ├── POST /exec             │
│   no vendor CLIs)       │         │    ├── GET  /discover         │
│                         │         │    └── GET  /health           │
│                         │         │                               │
│                         │         │  cliguard (CLI)               │
│                         │         │    └── policy from config.yaml│
│                         │         │                               │
│                         │         │  gh  (authenticated)          │
│                         │         │  gws (authenticated)          │
└─────────────────────────┘         └───────────────────────────────┘
         │                                        │
         └──── Docker network (isolated) ─────────┘
```

## Security Model

| Layer | What it does |
|-------|-------------|
| **Docker network** | Only the openclaw container can reach the sidecar. No external access. |
| **cliguard-http auth** | Bearer token or Docker-network-only (`--no-auth`). Prevents anything other than the expected caller from invoking CLIs. |
| **cliguard policy** | Token-based command allow/deny matching. Even if the agent can reach the sidecar, it can only run allowed command shapes. |
| **Credential isolation** | Credentials live in the sidecar container only. Openclaw container has no creds, no vendor CLI binaries, no way to make direct API calls. |
| **Config isolation** | Config file is mounted read-only into the sidecar and is not mounted into the agent container. |

The security boundary is the Docker network isolation + credential isolation. Cliguard adds policy granularity within that boundary.

### Important limitation

Cliguard constrains **verbs, not scope**. It can allow `gh pr view` and deny `gh pr create`, but it does not inherently limit which repos, orgs, or resource IDs those commands target.

## Agent Workflow

1. **Discovery:** Agent calls `GET /discover` at session start. Receives a manifest of available tools and allowed commands.
2. **Execution:** Agent calls `POST /exec` with tool name and `args` token array.
3. **Non-interactive execution:** Sidecar runs `cliguard --config /etc/cliguard/config.yaml -- <tool> ...` with stdin disabled, pager suppression, timeout, and output cap.
4. **Denial handling:** If the command is denied, agent receives a 403 with a clear structured message.
5. **Normal command failures:** If the command is allowed but the vendor CLI exits non-zero, the wrapper still returns HTTP 200 with the vendor exit code in the body.

## Example: Openclaw reading PRs and drafting emails

```yaml
# /etc/cliguard/config.yaml (mounted read-only into sidecar)
settings:
  audit_log: /var/log/cliguard/audit.log
  audit_format: jsonl

tools:
  gh:
    binary: gh
    description: "GitHub CLI — read-only access to PRs and issues"
    allow:
      - "pr list"
      - "pr view"
      - "pr diff"
      - "pr checks"
      - "issue list"
      - "issue view"
    deny_flags:
      - "--web"

  gws:
    binary: gws
    description: "Google Workspace CLI — read emails and create drafts only"
    allow:
      - "gmail messages list"
      - "gmail messages get"
      - "gmail drafts create"
      - "gmail drafts list"
      - "gmail drafts get"
    # Implicitly denied: gmail messages send, gmail messages delete, etc.
```

## Docker Compose Sketch

```yaml
services:
  openclaw:
    image: openclaw:latest
    networks:
      - agent-net
    # No credential mounts. No vendor CLI binaries.

  cliguard-sidecar:
    image: cliguard-sidecar:latest  # Custom image with gh, gws, cliguard, cliguard-http
    networks:
      - agent-net
    ports: []                        # No host-exposed ports
    volumes:
      - ./cliguard.yaml:/etc/cliguard/config.yaml:ro
      - ./audit:/var/log/cliguard
      # Credential mounts (or baked into image):
      - ~/.config/gh:/root/.config/gh:ro
      - ~/.config/gws:/root/.config/gws:ro
    environment:
      - CLIGUARD_HTTP_TOKEN=<shared-secret>
    command:
      [
        "cliguard-http",
        "--config", "/etc/cliguard/config.yaml",
        "--port", "8100",
        "--token", "${CLIGUARD_HTTP_TOKEN}",
        "--timeout-ms", "30000",
        "--max-output-bytes", "1048576"
      ]

networks:
  agent-net:
    internal: true  # No external access
```

## What the agent sees

The agent in the openclaw container does not need to know about local credential files or CLI installation details.

From the agent's perspective:
- Call `/discover` → "I can read PRs, view issues, list emails, create drafts"
- Call `/exec` with `{"tool": "gh", "args": ["pr", "list", "--repo", "org/repo"]}` → get PR list
- Call `/exec` with `{"tool": "gws", "args": ["gmail", "messages", "send"]}` → get 403 denial
- Call `/exec` with an allowed command that fails operationally → get HTTP 200 with a non-zero `exit_code`

Because `args` is an array, the wrapper avoids brittle string splitting and preserves token boundaries.

## API error behaviour in practice

| Situation | Response |
|-----------|----------|
| Missing/invalid auth | `401 unauthorized` |
| Malformed JSON / wrong `args` type | `400 invalid_request` |
| Tool not configured or command denied | `403 policy_denied` |
| Command allowed but vendor CLI exits 1 | `200` with `exit_code: 1` |
| Output exceeds cap | `413 output_limit_exceeded` |
| Command exceeds timeout | `504 execution_timeout` |
| Wrapper internal failure | `500 internal_error` |

## Bypass analysis

| Vector | Blocked by |
|--------|-----------|
| Agent runs `gh` directly | `gh` not installed in openclaw container |
| Agent reads credential files | Credentials not mounted in openclaw container |
| Agent changes policy config | Config mounted read-only and not exposed to agent container |
| Agent curls vendor API with stolen token | No token available in openclaw container |
| Agent calls sidecar with disallowed command | cliguard policy denies it |
| Sidecar audit logs leak into command stderr | Audit log sink is separate from command IO |
| External attacker calls sidecar | Docker internal network and optional bearer token |

**This is the strongest deployment model.** The main remaining risks are outside cliguard itself: container escape, overly broad allowed verbs, or credentials already having too much power.
