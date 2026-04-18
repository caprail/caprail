# Spec: cliguard

## Objective

A command-argument whitelist enforcer for vendor CLIs, designed for use with AI coding agents. It sits between an agent and the real CLI binary, allowing only pre-configured subcommands to execute.

**Target user:** Someone running an AI coding agent who wants to give the agent access to authenticated vendor CLIs (gh, az, gws, etc.) with restricted permissions — even when the CLI vendor doesn't support scoped tokens.

See [docs/usecase-docker-sidecar.md](docs/usecase-docker-sidecar.md) and [docs/usecase-pi-host.md](docs/usecase-pi-host.md) for the two concrete deployment models driving this design.

## Design Principles

### Transport-agnostic

Cliguard is a CLI tool. It takes process argv, checks policy, and either executes or rejects. It does not know or care how it was invoked — by a Pi custom tool, by an HTTP wrapper, by `docker exec`, or by a human typing in a terminal.

Exposing cliguard over HTTP, MCP, gRPC, or any other transport is the job of a separate, thin wrapper. This repo includes `cliguard-http` as one such wrapper for the Docker sidecar use case. Others can be built without modifying cliguard itself.

### Policy, not security boundary

The security boundary is the execution environment — Docker network isolation, agent framework tool restrictions, filesystem permissions. Cliguard's role is **policy enforcement within** that boundary. It turns coarse "has access to gh" into fine-grained "can read PRs but not create them."

### Fail closed

If config is missing, malformed, or ambiguous, cliguard denies. No silent fallthrough to allow.

## Non-goals

- Authentication / credential management
- Output filtering or redaction
- Network-level controls
- Agent-framework-specific integration (cliguard is framework-agnostic)
- Flag-value validation (e.g., "allow `--limit` only up to 100")

## Tech Stack

- **Language:** Node.js (uses only built-in modules + `yaml` for config parsing)
- **Reason:** Runs everywhere the agent frameworks run. `child_process.spawn` passes args as an array natively — shell injection is impossible by construction. No compile step. Publishable as npm packages.
- **Minimum Node version:** 18 LTS
- **Monorepo:** npm workspaces

## Repository Structure

```
cli-whitelist-wrapper/
├── packages/
│   ├── cliguard/                 # Core CLI policy enforcer
│   │   ├── bin/
│   │   │   └── cliguard.js      # Entry point (hashbang, arg routing)
│   │   ├── src/
│   │   │   ├── config.js        # Config loading, validation, resolution
│   │   │   ├── matcher.js       # Subcommand matching + flag deny logic
│   │   │   ├── executor.js      # Safe child process execution
│   │   │   └── logger.js        # Structured audit logging
│   │   ├── test/
│   │   │   ├── config.test.js
│   │   │   ├── matcher.test.js
│   │   │   ├── executor.test.js
│   │   │   └── integration.test.js
│   │   └── package.json
│   │
│   └── cliguard-http/            # Thin HTTP wrapper for container-to-container use
│       ├── src/
│       │   ├── server.js         # HTTP server, invokes cliguard as subprocess
│       │   └── discovery.js      # Auto-exposes whitelisted tools/commands
│       ├── test/
│       │   ├── server.test.js
│       │   └── discovery.test.js
│       └── package.json
│
├── docs/
│   ├── usecase-docker-sidecar.md # Use case 1: openclaw + sidecar
│   └── usecase-pi-host.md        # Use case 2: Pi on Win11 host
├── examples/
│   └── cliguard.yaml             # Annotated example config
├── package.json                   # Workspace root
├── SPEC.md
└── README.md
```

## Commands

```
# Root
Install:            npm install
Test all:           npm test --workspaces
Lint all:           npm run lint --workspaces

# cliguard (core)
Run:                cliguard <tool> [args...]
Explain mode:       cliguard --explain <tool> [args...]
Validate config:    cliguard --validate
List permissions:   cliguard --list [tool]

# cliguard-http (sidecar wrapper)
Start server:       cliguard-http --port 8100
Start (with auth):  cliguard-http --port 8100 --token <secret>
```

---

# Package: cliguard (core)

## Configuration

Single YAML file. Resolution order (first found wins):
1. `CLIGUARD_CONFIG` environment variable
2. `.cliguard.yaml` in current working directory
3. `~/.config/cliguard/config.yaml`

### Format

```yaml
# cliguard.yaml

settings:
  log: stderr              # stderr | file path | none
  log_format: text         # text | json
  default_policy: deny     # deny | allow (deny recommended)

tools:
  gh:
    binary: gh                          # binary name (PATH) or absolute path
    description: "GitHub CLI (read-only PR and issue access)"
    allow:
      - "pr list"
      - "pr view"
      - "pr diff"
      - "pr checks"
      - "issue list"
      - "issue view"
      - "repo view"
      - "api"
    deny:
      - "api -X POST"
      - "api -X PUT"
      - "api -X PATCH"
      - "api -X DELETE"
    deny_flags:
      - "--web"

  gws:
    binary: gws
    description: "Google Workspace CLI (read + draft only)"
    allow:
      - "gmail messages list"
      - "gmail messages get"
      - "gmail drafts create"
      - "gmail drafts list"
      - "gmail drafts get"

  az:
    binary: az
    description: "Azure CLI (read-only resource access)"
    allow:
      - "group list"
      - "group show"
      - "resource list"
      - "resource show"
      - "vm list"
      - "vm show"
```

### Matching Rules

**Subcommand matching** — match on the subcommand path, not the full argument string.

Given: `cliguard gh pr list --state open --json title,url`

1. **Extract tool name:** `gh`
2. **Extract subcommand path:** Walk args left-to-right, collect leading non-flag tokens. Result: `["pr", "list"]`
3. **Stringify:** `"pr list"`
4. **Match against allow list:** Prefix match — `"pr list"` starts with allow entry `"pr list"` ✅. `allow: "api"` matches `api /repos/foo/pulls`.
5. **Check deny list:** Deny entries matched as subsequences of full argv — `"api -X POST"` matches `api /repos/foo -X POST`.
6. **Check deny_flags:** Any flag token matching a deny_flags entry → reject.

**Precedence:** deny > deny_flags > allow > default_policy.

**Prefix-based matching means:**
- `allow: "pr list"` permits `pr list`, `pr list --state open`, `pr list --json url`
- `allow: "pr"` permits `pr list`, `pr view`, `pr create` — broad, use with care
- Narrow broad allows with deny entries

Flag order doesn't matter. New flags added by CLI vendors don't break config.

## Core Behaviour

### Invocation

```
cliguard <tool> [subcommand...] [flags...] [positional-args...]
```

Everything after `<tool>` is passed to the real binary if allowed.

### Execution

Use `child_process.spawn` with `{ stdio: 'inherit', shell: false }`. This:
- Passes args as an array — no shell interpretation
- Streams stdout/stderr directly to parent
- Passes through stdin unconditionally
- Exits with the child process's exit code

### Rejection

1. Prints to stderr: `cliguard: denied 'gh pr create --title test' — 'pr create' is not in the allow list for 'gh'`
2. Exits with code **126** (standard "command cannot execute")
3. Logs the denial

### Explain Mode

`cliguard --explain gh pr create --title test`

```
Tool:       gh
Subcommand: pr create
Allow list: pr list, pr view, pr diff, pr checks, issue list, issue view, repo view, api
Deny list:  api -X POST, api -X PUT, api -X PATCH, api -X DELETE
Deny flags: --web
Result:     DENIED — 'pr create' does not match any allow entry
```

### List Mode

`cliguard --list` — all tools and their allow/deny entries.
`cliguard --list gh` — just gh's config.
`cliguard --list --json` — structured JSON output.

### Validate Mode

`cliguard --validate` — checks config for:
- Valid YAML
- Required fields present
- Binary exists and is executable (warning if not found)
- Deny entries that don't overlap any allow entry (likely misconfiguration)

Exit 0 if valid, exit 1 if errors.

## Logging

All invocations (allowed and denied) are logged.

**Default:** stderr.

**JSON format:**
```json
{
  "ts": "2026-04-18T10:30:00.000Z",
  "tool": "gh",
  "subcommand": "pr list",
  "args": ["pr", "list", "--state", "open"],
  "result": "allowed",
  "binary": "/usr/bin/gh",
  "duration_ms": 1523
}
```

**Text format:** `[2026-04-18T10:30:00Z] ALLOWED gh pr list --state open (1523ms)`

---

# Package: cliguard-http

A thin HTTP server that wraps cliguard for container-to-container communication. Designed for the Docker sidecar use case (see [docs/usecase-docker-sidecar.md](docs/usecase-docker-sidecar.md)).

## Responsibilities

1. Accept HTTP requests with tool name + args
2. Invoke `cliguard` as a subprocess
3. Return stdout/stderr/exit code as JSON
4. **Auto-discovery endpoint** — expose what tools and commands are available (reads from cliguard config)
5. **Request authentication** — bearer token or Docker network isolation

## API

### `POST /exec`

Execute a command through cliguard.

```
POST /exec
Authorization: Bearer <token>
Content-Type: application/json

{
  "tool": "gh",
  "args": ["pr", "list", "--state", "open"]
}
```

Response (200 for allowed, 403 for denied):
```json
{
  "exit_code": 0,
  "stdout": "...",
  "stderr": "...",
  "allowed": true
}
```

### `GET /discover`

Returns all available tools and their allowed commands. Designed for agent consumption — an agent can call this once at the start of a session to understand what it can do.

```
GET /discover
Authorization: Bearer <token>
```

Response:
```json
{
  "tools": {
    "gh": {
      "description": "GitHub CLI (read-only PR and issue access)",
      "allow": ["pr list", "pr view", "pr diff", "pr checks", "issue list", "issue view", "repo view", "api"],
      "deny": ["api -X POST", "api -X PUT", "api -X PATCH", "api -X DELETE"],
      "deny_flags": ["--web"]
    },
    "gws": {
      "description": "Google Workspace CLI (read + draft only)",
      "allow": ["gmail messages list", "gmail messages get", "gmail drafts create", "gmail drafts list", "gmail drafts get"],
      "deny": [],
      "deny_flags": []
    }
  }
}
```

### `GET /health`

Returns 200. No auth required. For container orchestration health checks.

## Authentication

Two modes, configured via CLI flags:

1. **Bearer token** (`--token <secret>`) — all requests must include `Authorization: Bearer <secret>`. Token is passed via environment variable or flag. Simple, sufficient for Docker network where the only consumer is a known container.

2. **No auth** (`--no-auth`) — for environments where Docker network isolation is the security boundary (only the agent container can reach the sidecar). Requires explicit opt-in flag to make the security trade-off visible.

Default: if neither flag is provided, server refuses to start. Forces an explicit choice.

## Non-goals for cliguard-http

- TLS (use Docker network isolation or a reverse proxy)
- User management / multi-tenancy
- Rate limiting
- Request queuing

---

# Shared Concerns

## Code Style

```javascript
// Terse, no classes, no abstractions without reason.
// Node built-ins only + yaml package.

import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
```

**Naming:** camelCase for variables/functions. kebab-case for files. No TypeScript — keep auditable, no build step.

**Dependency:** `yaml` npm package (0 transitive deps) for config parsing. Shared via workspace dependency.

## Testing Strategy

- **Framework:** Node built-in test runner (`node --test`)
- **Coverage:** 100% of matcher.js (security-critical path)

| Level | What | Where |
|-------|------|-------|
| Unit | Config parsing, matching logic, deny precedence | `packages/cliguard/test/` |
| Integration | Full cliguard invocation against mock binary | `packages/cliguard/test/` |
| Unit | HTTP server routing, auth checking, discovery | `packages/cliguard-http/test/` |
| Integration | HTTP request → cliguard subprocess → response | `packages/cliguard-http/test/` |

## Boundaries

**Always:**
- `spawn` with `shell: false` — never pass args through a shell
- Fail closed on invalid/missing config
- Log every invocation
- Exit 126 on denial (cliguard), 403 on denial (cliguard-http)

**Ask first:**
- Adding any dependency beyond `yaml`
- Changing the matching algorithm
- Adding new config resolution paths

**Never:**
- `child_process.exec` or `shell: true`
- Silent allow on ambiguous config
- Read or manipulate credentials
- Buffer large outputs in memory

## Success Criteria

1. `cliguard gh pr list --state open` executes and streams output
2. `cliguard gh pr create --title test` exits 126 with clear denial
3. `cliguard --explain gh pr create` prints matching trace
4. `cliguard --list` / `cliguard --list --json` shows permissions
5. `cliguard --validate` catches bad config
6. `cliguard-http` serves `/exec`, `/discover`, `/health`
7. `/discover` returns full tool/permission manifest from config
8. Auth is enforced when configured; explicit opt-in for no-auth
9. Zero dependencies beyond `yaml` (both packages)
10. Works on Windows + Linux + macOS
11. Both packages publishable to npm

## Resolved Questions

1. **YAML dependency vs inline parser** — Using `yaml` package. Zero transitive deps, audit once.
2. **Windows `spawn` behaviour** — Tested, works with PATH-resolved commands including `.cmd`/`.exe`.
3. **Should `cliguard-http` stream responses or buffer?** Buffer with configurable max size for v1. Streaming can be added later if needed.
4. **Should `/discover` include example invocations?** Not in v1 — the allow list is sufficient.
