# Use Case: Docker Sidecar for Openclaw

## Context

Openclaw (an AI coding agent) runs in a Docker container. It needs access to authenticated vendor CLIs (`gh`, `gws`) but must not have direct access to the credentials or the ability to run arbitrary commands against those CLIs.

## Architecture

```
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
| **cliguard policy** | Subcommand whitelist. Even if the agent can reach the sidecar, it can only run allowed commands. |
| **Credential isolation** | Credentials live in the sidecar container only. Openclaw container has no creds, no vendor CLI binaries, no way to make direct API calls. |

The security boundary is the Docker network isolation + credential isolation. Cliguard adds policy granularity within that boundary.

## Agent Workflow

1. **Discovery:** Agent calls `GET /discover` at session start. Receives a manifest of available tools and allowed commands.

2. **Execution:** Agent calls `POST /exec` with tool name and args. Sidecar runs `cliguard <tool> <args>`, returns stdout/stderr/exit code.

3. **Denial handling:** If the command is denied, agent receives a 403 with a clear message explaining what's not allowed and what is. Agent can self-correct.

## Example: Openclaw reading PRs and drafting emails

```yaml
# cliguard.yaml (mounted into sidecar)
settings:
  default_policy: deny
  log: stderr
  log_format: json

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
      # Credential mounts (or baked into image):
      - ~/.config/gh:/root/.config/gh:ro
      - ~/.config/gws:/root/.config/gws:ro
    environment:
      - CLIGUARD_CONFIG=/etc/cliguard/config.yaml
      - CLIGUARD_HTTP_TOKEN=<shared-secret>
    command: ["cliguard-http", "--port", "8100", "--token", "${CLIGUARD_HTTP_TOKEN}"]

networks:
  agent-net:
    internal: true  # No external access
```

## What the agent sees

The agent in the openclaw container doesn't know about cliguard. It knows there's an HTTP endpoint it can call. The orchestration layer (whatever connects openclaw to external tools) is configured to hit `http://cliguard-sidecar:8100`.

From the agent's perspective:
- Call `/discover` → "I can read PRs, view issues, list emails, create drafts"
- Call `/exec` with `{"tool": "gh", "args": ["pr", "list", "--repo", "org/repo"]}` → get PR list
- Call `/exec` with `{"tool": "gws", "args": ["gmail", "messages", "send", ...]}` → get 403 denial

## Bypass analysis

| Vector | Blocked by |
|--------|-----------|
| Agent runs `gh` directly | `gh` not installed in openclaw container |
| Agent reads credential files | Credentials not mounted in openclaw container |
| Agent curls GitHub API with stolen token | No token available in openclaw container |
| Agent calls sidecar with disallowed command | cliguard policy denies it |
| External attacker calls sidecar | Docker internal network — no external access |
| Agent modifies cliguard config | Config mounted read-only |

**This is the strongest deployment model.** All bypass vectors are closed by the combination of Docker isolation and cliguard policy.
