# Spec: Caprail

## Objective

A command-argument whitelist enforcer for vendor CLIs, designed for use with AI coding agents. It sits between an agent and the real CLI binary, allowing only pre-configured subcommands to execute.

**Target user:** Someone running an AI coding agent who wants to give the agent access to authenticated vendor CLIs (`gh`, `az`, `gws`, etc.) with restricted permissions — even when the CLI vendor doesn't support scoped tokens.

See [docs/usecase-docker-sidecar.md](docs/usecase-docker-sidecar.md) and [docs/usecase-pi-container-host-wrapper.md](docs/usecase-pi-container-host-wrapper.md) for the two concrete deployment models driving this design.

## Design Principles

### Transport-agnostic

Caprail's CLI guard is a CLI tool. It takes process argv, checks policy, and either executes or rejects. It does not know or care how it was invoked — by a Pi custom tool, by an HTTP wrapper, by an MCP server, by `docker exec`, or by a human typing in a terminal.

The **guard design is the core product idea**. Transport is an adapter choice.

Exposing the guard over HTTP, MCP, gRPC, or any other transport is the job of a separate, thin wrapper. This repo includes `caprail-cli-http` as one such wrapper. MCP-facing wrappers can be added later without changing the core guard logic.

### Policy, not security boundary

The security boundary is the execution environment — Docker network isolation, agent framework tool restrictions, filesystem permissions. Caprail's role is **policy enforcement within** that boundary. It turns coarse "has access to `gh`" into finer-grained "can run these read-oriented subcommands but not others."

### Verbs, not scope

Caprail constrains **which command shapes and verbs** may run. It does **not** provide true resource scoping.

Examples of what v1 can express well:
- Allow `gh pr list`
- Deny `gh pr create`
- Allow `gws gmail drafts create`
- Deny `--web`

Examples of what v1 does **not** express:
- Only allow repo `org/repo`
- Only allow subscription `abc123`
- Only allow `--limit <= 100`
- Only allow mailboxes in a specific domain

### Fail closed

If config is missing, malformed, or ambiguous, Caprail denies. No silent fallthrough to allow.

## Family of host capability guards

This repo starts with the CLI guard, but the broader pattern is a **family of host capability guards**: small, narrow, transport-agnostic services that expose one host or sidecar capability to an agent through an authenticated, auditable interface.

The key idea to preserve is:

> **keep the guard design as the core product idea**
>
> Each guard defines the capability boundary, policy model, config, audit behavior, and failure semantics.
> HTTP, MCP, stdio, or other transports are adapters layered on top.

Current member:
- **`@caprail/guard-cli`** — token-based policy enforcement for host or sidecar CLIs

Exploration candidates:
- **`host-files-http`** — read-only access to allowlisted host files and log folders
- **`host-ui-http`** — declarative automation and screenshots for one known desktop app

Shared characteristics across the family:
- explicit config path
- startup validation
- discovery endpoint
- structured JSON request/response shapes
- non-interactive execution by default
- bounded output and timeout behavior
- audit logs kept separate from returned command/data output
- narrow, capability-specific policy rather than general host access

### Transport adapter strategy

HTTP wrappers are the initial adapter choice because they are simple to run across containers, hosts, and local networks.

That does **not** lock the design to HTTP.

For any guard in this family, the same core capability can later be exposed through:
- **HTTP** — practical default for sidecars and host wrappers
- **MCP** — for native tool discovery/invocation in MCP-aware clients
- **stdio** or other transports — where local process integration is simpler

The intended layering is:

```text
core guard -> transport adapter (HTTP, MCP, stdio, ...) -> agent/client
```

Examples:
- `@caprail/cli` + `@caprail/cli-http` now, `@caprail/cli-mcp` later
- `host-files` core later, with `host-files-http` first and `host-files-mcp` as an optional follow-on
- `host-ui` core later, with `host-ui-http` first and `host-ui-mcp` if MCP becomes the better integration surface

### Relationship to the Docker sidecar model

This still aligns with the Docker sidecar approach.

- If a capability can live entirely inside a container, prefer the **sidecar model**.
  - Example: `caprail-cli-http` running next to authenticated vendor CLIs inside a sidecar.
- If a capability is inherently host-local, expose it through a **host wrapper** with explicit auth, fixed config, and host-level isolation.
  - Examples: host log folders, Windows desktop UI automation, browser-backed host auth contexts.

The architecture pattern stays the same in both cases:

```text
agent/container -> thin authenticated wrapper -> narrow guarded capability
```

Only the location of the guarded capability changes.

## Non-goals

- Authentication / credential management
- Output filtering or redaction
- Network-level controls
- Agent-framework-specific integration (Caprail is framework-agnostic)
- Resource/value scoping such as repo allowlists or numeric bounds
- Full vendor-specific CLI parsing

## Tech Stack

- **Language:** Node.js (uses only built-in modules + `yaml` for config parsing)
- **Reason:** Runs everywhere the agent frameworks run. `child_process.spawn` passes args as an array natively — shell injection is impossible by construction. No compile step. Publishable as npm packages.
- **Minimum Node version:** 18 LTS
- **Monorepo:** npm workspaces, grouped by `packages/guards/*`, `packages/transports/*`, `packages/products/*`, and optional `packages/shared/*`

## Naming and package identity

The repo needs a **single family name** that becomes the npm scope and binary prefix for every published package. That gives the project a discoverable product line even as individual guards and transports multiply.

### Adopted family name

Adopt **`caprail`** as the family name.

Why this fits:

- broad enough to cover **CLI, files, UI, and future host/sidecar capabilities**
- works cleanly with self-evident subpackage names like `guard-cli`, `guard-files`, `transport-http`, and `transport-mcp`
- brandable enough for a product family, but plain enough that package names stay obvious and searchable
- does not include `guard` or `transport` in the family name itself, so package names avoid awkward stutter

### Naming convention

- **npm scope:** `@caprail/...`
- **Guard libraries:** `@caprail/guard-<capability>`
- **Transport libraries:** `@caprail/transport-<transport>`
- **Composed runnable packages:** `@caprail/<capability>-<transport>`
- **Optional local/argv product binary:** `caprail-<capability>`
- **Other product binaries:** `caprail-<capability>-<transport>`

Concrete examples:

- `@caprail/guard-cli`
- `@caprail/guard-files`
- `@caprail/transport-argv`
- `@caprail/transport-http`
- `@caprail/transport-mcp`
- `@caprail/cli`
- `@caprail/cli-http`
- `@caprail/files-http`
- `@caprail/ui-mcp`

### Naming guidance

- prefer **self-evident names** over clever names for subpackages
- use capability nouns for guards (`cli`, `files`, `ui`)
- use protocol/runtime nouns for transports (`argv`, `http`, `mcp`)
- do not hard-code legacy names into the workspace layout or package boundaries
- before publishing, reserve the chosen npm scope and confirm there are no naming/trademark conflicts

## Repository Structure

```text
cli-whitelist-wrapper/
├── packages/
│   ├── guards/
│   │   ├── cli/
│   │   │   ├── README.md                 # Package overview and quick start
│   │   │   ├── docs/
│   │   │   │   ├── config.md             # Config schema and resolution rules
│   │   │   │   ├── policy-model.md       # Allow/deny semantics and matching rules
│   │   │   │   └── audit.md              # Audit events and operational guidance
│   │   │   ├── src/
│   │   │   │   ├── index.js              # Public guard API
│   │   │   │   ├── config.js             # Config loading, validation, resolution
│   │   │   │   ├── matcher.js            # Token-based allow/deny matching
│   │   │   │   ├── executor.js           # Safe child process execution
│   │   │   │   ├── discovery.js          # Capability discovery payloads
│   │   │   │   └── logger.js             # Structured audit logging
│   │   │   ├── test/
│   │   │   │   ├── config.test.js
│   │   │   │   ├── matcher.test.js
│   │   │   │   ├── executor.test.js
│   │   │   │   └── discovery.test.js
│   │   │   └── package.json              # @caprail/guard-cli
│   │   │
│   │   ├── files/
│   │   │   ├── README.md
│   │   │   ├── docs/
│   │   │   ├── src/
│   │   │   ├── test/
│   │   │   └── package.json              # @caprail/guard-files
│   │   │
│   │   └── ui/
│   │       ├── README.md
│   │       ├── docs/
│   │       ├── src/
│   │       ├── test/
│   │       └── package.json              # @caprail/guard-ui
│   │
│   ├── transports/
│   │   ├── argv/
│   │   │   ├── README.md
│   │   │   ├── docs/
│   │   │   │   └── contract.md           # CLI/process-argv transport contract
│   │   │   ├── src/
│   │   │   │   ├── index.js              # Binds a guard to process argv
│   │   │   │   └── parser.js             # CLI flag parsing for the transport
│   │   │   ├── test/
│   │   │   └── package.json              # @caprail/transport-argv
│   │   │
│   │   ├── http/
│   │   │   ├── README.md
│   │   │   ├── docs/
│   │   │   │   ├── api.md                # /exec, /discover, /health contract
│   │   │   │   └── auth.md               # Token/no-auth modes and limits
│   │   │   ├── src/
│   │   │   │   ├── index.js              # Binds a guard to an HTTP server
│   │   │   │   ├── server.js
│   │   │   │   └── discovery.js
│   │   │   ├── test/
│   │   │   └── package.json              # @caprail/transport-http
│   │   │
│   │   └── mcp/
│   │       ├── README.md
│   │       ├── docs/
│   │       ├── src/
│   │       ├── test/
│   │       └── package.json              # @caprail/transport-mcp
│   │
│   ├── products/
│   │   ├── cli/
│   │   │   ├── README.md
│   │   │   ├── docs/
│   │   │   ├── bin/
│   │   │   │   └── caprail-cli.js
│   │   │   ├── src/
│   │   │   │   └── main.js               # Composes guard-cli + transport-argv
│   │   │   ├── test/
│   │   │   └── package.json              # @caprail/cli
│   │   │
│   │   ├── cli-http/
│   │   │   ├── README.md
│   │   │   ├── docs/
│   │   │   ├── bin/
│   │   │   │   └── caprail-cli-http.js
│   │   │   ├── src/
│   │   │   │   └── main.js               # Composes guard-cli + transport-http
│   │   │   ├── test/
│   │   │   └── package.json              # @caprail/cli-http
│   │   │
│   │   └── files-http/
│   │       ├── README.md
│   │       ├── docs/
│   │       ├── bin/
│   │       ├── src/
│   │       ├── test/
│   │       └── package.json              # @caprail/files-http
│   │
│   └── shared/
│       ├── testkit/
│       │   ├── README.md
│       │   ├── src/
│       │   ├── test/
│       │   └── package.json              # Shared mocks/fixtures only
│       └── package.json                  # Optional umbrella shared workspace
│
├── docs/
│   ├── decisions/                        # ADRs and cross-package architecture notes
│   ├── usecase-docker-sidecar.md         # Use case 1: agent + sidecar container
│   ├── usecase-pi-container-host-wrapper.md
│   ├── explore-host-files-http.md        # Future member: guarded host file/log access
│   └── explore-host-ui-http.md           # Future member: declarative host UI automation
├── examples/
│   ├── guards/
│   │   └── cli.policy.yaml               # Annotated example policy for the CLI guard
│   └── transports/
│       └── http.exec-request.json        # Example transport request payloads
├── package.json                          # Workspace root
├── SPEC.md
└── README.md
```

### Composition contract

To keep guards and transports genuinely composable, the architectural boundary should be:

```text
guard package:     policy model + config + evaluation + execution + discovery
transport package: request/response protocol + auth + timeout/output policy + process lifecycle
product package:   a thin composition layer that wires one guard to one transport and ships the executable
```

Rules that fall out of this structure:

- Every published package gets its own `README.md`, `docs/`, `test/`, and `package.json`.
- A transport should depend only on the **guard contract**, not on guard-specific internals.
- A new capability should usually add **one guard package** first, then as many product pairings as needed (`files-http`, `files-mcp`, etc.).
- A new transport should usually add **one transport package** first, then compose it with existing guards without copying guard logic.
- Product packages are intentionally thin and mostly contain wiring, CLI entrypoints, and composition tests.

## Commands

```text
# Root
Install:                  npm install
Test all:                 npm test --workspaces
Lint all:                 npm run lint --workspaces

# Product: caprail-cli (`guard-cli` + `transport-argv`)
Run:                      caprail-cli --config <path> -- <tool> [args...]
Explain mode:             caprail-cli --config <path> --explain -- <tool> [args...]
Explain mode (JSON):      caprail-cli --config <path> --explain --json -- <tool> [args...]
Validate config:          caprail-cli --config <path> --validate
Validate config (JSON):   caprail-cli --config <path> --validate --json
List permissions:         caprail-cli --config <path> --list [tool]
List permissions (JSON):  caprail-cli --config <path> --list [tool] --json

# Product: caprail-cli-http (`guard-cli` + `transport-http`)
Start server:             caprail-cli-http --config <path> --port 8100 --token <secret>
Start (no auth):          caprail-cli-http --config <path> --port 8100 --no-auth
Optional limits:          caprail-cli-http --config <path> --timeout-ms 30000 --max-output-bytes 1048576
```

`--config` is the recommended production mode for every agent integration. Environment or default-path lookup exists for local/manual use, but wrappers should pin policy explicitly.

For the argv transport, execution and explain modes require a `--` separator. All transport flags must appear before `--`, and all tokens after it are passed through unchanged as command-token input.

---

# Product: caprail-cli (`guard-cli` over argv)

## Configuration

Single YAML file.

### Resolution order

1. `--config <path>` CLI flag
2. `CAPRAIL_CLI_CONFIG` environment variable
3. Platform default path:
   - **Windows:** `%ProgramData%\caprail-cli\config.yaml`, then `%AppData%\caprail-cli\config.yaml`
   - **Linux/macOS:** `$XDG_CONFIG_HOME/caprail-cli/config.yaml`, then `~/.config/caprail-cli/config.yaml`

**No current-working-directory lookup.** Agent-accessible workspace config files are too easy to shadow or tamper with.

### Placement guidance

> **Important:** the config file should live in a location the agent cannot read or write.
>
> Good examples:
> - A read-only mount inside a sidecar container, not mounted into the agent container
> - `%ProgramData%\caprail-cli\config.yaml` on Windows with restrictive ACLs
> - `/etc/caprail-cli/config.yaml` or an XDG config path owned by a separate service account
>
> Bad examples:
> - The repo workspace
> - Any path exposed through agent `read` / `edit` / `write` tools
> - A bind mount shared with the agent container

### Format

```yaml
# config.yaml

settings:
  audit_log: /var/log/caprail-cli/audit.log   # file path | none
  audit_format: jsonl                          # text | jsonl

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

`allow`, `deny`, and `deny_flags` are optional per tool. Omitted lists default to empty. Effective policy is always **default deny**.

### Matching Rules

Matching is **token-based**, not string-prefix-based.

#### Config tokenization

Each `allow` / `deny` entry is a whitespace-delimited token sequence.

Examples:
- `"pr list"` → `["pr", "list"]`
- `"vm delete"` → `["vm", "delete"]`

Quotes inside config entries are treated as literal characters, not shell syntax. The config is not a shell parser.

#### Arg normalization

Given invocation:

```text
caprail-cli --config config.yaml -- gh --repo org/repo pr list --state open --json title,url
```

1. **Extract tool name:** `gh`
2. **Read remaining argv tokens exactly as provided by the parent process**
3. **Normalize long flags with equals:** `--flag=value` becomes `--flag`, `value`
4. **Treat matching as case-sensitive**
5. **Do not expand bundled short flags:** `-abc` stays `-abc`

#### Allow matching

A command is allowed when the remaining argv contains an `allow` token sequence as a **contiguous token subsequence**.

Examples:
- `allow: "pr list"` permits:
  - `gh pr list`
  - `gh pr list --state open`
  - `gh --repo org/repo pr list --state open`
- `allow: "pr"` permits:
  - `gh pr list`
  - `gh pr view`
  - `gh pr create`
  - This is broad; prefer narrower entries.

#### Deny matching

A command is denied if:

1. Any `deny` entry matches as a contiguous token subsequence of the full normalized argv, or
2. Any token exactly matches a `deny_flags` entry before a `--` terminator

Examples:
- `deny: "vm delete"` blocks `az vm delete --name test-vm`
- `deny_flags: ["--web"]` blocks `gh pr view 123 --web`

#### Precedence

```text
deny > deny_flags > allow > implicit deny
```

#### Why token-based matching

This avoids brittle string-prefix logic and makes matching rules explicit:
- Exact token order matters inside an entry
- Extra flags and positional args around a matched entry are tolerated
- New vendor flags do not break existing allow entries unless they change the token sequence being matched

## Core Behaviour

### Invocation

```text
caprail-cli --config <path> -- <tool> [subcommand...] [flags...] [positional-args...]
```

For execution mode, the `--` separator is required. Everything after `--` is interpreted as command-token input, with the first token taken as `<tool>` and the remaining tokens passed to the real binary if allowed.

### Execution

Use `child_process.spawn` with `shell: false`.

Default execution mode is **non-interactive**:
- `stdin` is **not** forwarded to the child process
- `stdout` and `stderr` stream directly from the child process
- Environment is adjusted to discourage interactive output:
  - `PAGER=cat`
  - `GIT_PAGER=cat`
  - `GH_PAGER=cat`
  - `TERM=dumb`
- If the vendor CLI prompts for input anyway, it will see EOF / non-interactive execution and fail; that failure is returned as normal command stderr/exit code

`caprail-cli` itself does not buffer large outputs in execution mode. Buffering, truncation, and timeouts are wrapper concerns.

### Rejection

1. Prints to stderr: `caprail-cli: denied 'gh pr create --title test' — 'pr create' is not in the allow list for 'gh'`
2. Exits with code **126** (standard "command cannot execute")
3. Writes an audit event to the configured audit sink

### Explain Mode

```text
caprail-cli --config config.yaml --explain -- gh pr create --title test
```

Plain-text output:

```text
Tool:         gh
Normalized:   pr create --title test
Matched allow: (none)
Matched deny:  (none)
Deny flags:    --web
Result:        DENIED — no allow entry matched
```

JSON output:

```json
{
  "tool": "gh",
  "normalized_args": ["pr", "create", "--title", "test"],
  "matched_allow": null,
  "matched_deny": null,
  "deny_flags": ["--web"],
  "allowed": false,
  "reason": "no allow entry matched"
}
```

### List Mode

```text
caprail-cli --config config.yaml --list
caprail-cli --config config.yaml --list gh
caprail-cli --config config.yaml --list --json
```

JSON output:

```json
{
  "tools": {
    "gh": {
      "binary": "gh",
      "description": "GitHub CLI (read-only PR and issue access)",
      "allow": ["pr list", "pr view", "pr diff", "pr checks", "issue list", "issue view", "repo view"],
      "deny": [],
      "deny_flags": ["--web"]
    }
  }
}
```

### Validate Mode

```text
caprail-cli --config config.yaml --validate
caprail-cli --config config.yaml --validate --json
```

Checks:
- Valid YAML
- Config path readable
- Required fields present
- Tool names unique
- Binary exists and is executable (warning if not found)
- `allow` / `deny` entries tokenize cleanly
- `deny` entries that can never match any `allow` path are warned as likely misconfiguration
- Audit log path is writable when configured

Exit 0 if valid, exit 1 if errors.

JSON output:

```json
{
  "valid": true,
  "errors": [],
  "warnings": [
    {
      "code": "binary_not_found",
      "tool": "az",
      "message": "Binary 'az' was not found on PATH"
    }
  ]
}
```

## Audit Logging

All invocations (allowed and denied) can be written to an audit sink.

**Important:** audit logs are **separate from command stdout/stderr**. The guard never mixes audit entries into the wrapped command's output streams.

### Sinks

- `audit_log: <file path>` — append audit events to a file
- `audit_log: none` — disable audit logging

### Formats

**JSONL format:**
```json
{"ts":"2026-04-18T10:30:00.000Z","tool":"gh","args":["pr","list","--state","open"],"result":"allowed","binary":"/usr/bin/gh","duration_ms":1523}
```

**Text format:**
```text
[2026-04-18T10:30:00Z] ALLOWED gh pr list --state open (1523ms)
```

---

# Product: caprail-cli-http (`guard-cli` over HTTP)

A thin HTTP server that wraps the CLI guard for agent/container communication. On startup it validates the configured policy and refuses to start if the config is unreadable, invalid, or the audit sink cannot be opened.

## Responsibilities

1. Accept HTTP requests with tool name + argument token array
2. Invoke the guard with a fixed `--config` path
3. Return stdout/stderr/exit code as JSON
4. Expose a discovery endpoint for agent/tool generation
5. Enforce request authentication (unless explicitly disabled)
6. Enforce non-interactive defaults, timeouts, and output limits

## API

### `POST /exec`

Execute a command through the guard.

```http
POST /exec
Authorization: Bearer <token>
Content-Type: application/json

{
  "tool": "gh",
  "args": ["pr", "list", "--state", "open"]
}
```

#### Success response

HTTP 200 means the command was allowed and executed. The wrapped CLI's own exit code is returned in the body.

```json
{
  "allowed": true,
  "exit_code": 0,
  "stdout": "...",
  "stderr": "...",
  "timed_out": false,
  "truncated": false
}
```

A non-zero `exit_code` from the vendor CLI still returns HTTP 200 because policy allowed the command and execution occurred.

#### Error responses

**400 Bad Request** — invalid JSON or invalid request shape
```json
{
  "error": {
    "code": "invalid_request",
    "message": "'args' must be an array of strings"
  }
}
```

**401 Unauthorized** — missing or invalid bearer token
```json
{
  "error": {
    "code": "unauthorized",
    "message": "Missing or invalid bearer token"
  }
}
```

**403 Forbidden** — policy denial, unknown tool, or denied flag
```json
{
  "allowed": false,
  "error": {
    "code": "policy_denied",
    "message": "'pr create' is not allowed for 'gh'"
  }
}
```

**413 Payload Too Large** — captured stdout/stderr exceeded `--max-output-bytes`
```json
{
  "allowed": true,
  "error": {
    "code": "output_limit_exceeded",
    "message": "Captured output exceeded 1048576 bytes"
  }
}
```

**504 Gateway Timeout** — child process exceeded `--timeout-ms`
```json
{
  "allowed": true,
  "error": {
    "code": "execution_timeout",
    "message": "Command exceeded 30000ms"
  }
}
```

**500 Internal Server Error** — wrapper failure (spawn failure, unexpected exception)
```json
{
  "error": {
    "code": "internal_error",
    "message": "Failed to execute wrapped command"
  }
}
```

### `GET /discover`

Returns all available tools and their allowed commands. Designed for agent consumption — the agent or agent extension can call this once at startup and synthesize tool descriptions from it.

```http
GET /discover
Authorization: Bearer <token>
```

Response:

```json
{
  "tools": {
    "gh": {
      "description": "GitHub CLI (read-only PR and issue access)",
      "allow": ["pr list", "pr view", "pr diff", "pr checks", "issue list", "issue view", "repo view"],
      "deny": [],
      "deny_flags": ["--web"]
    },
    "gws": {
      "description": "Google Workspace CLI (read + draft only)",
      "allow": ["gmail messages list", "gmail messages get", "gmail drafts create", "gmail drafts list", "gmail drafts get"],
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

### `GET /health`

Returns 200. No auth required. For container orchestration health checks. A healthy server has already completed startup validation of config and audit-sink setup.

## Authentication

Two modes, configured via CLI flags:

1. **Bearer token** (`--token <secret>`) — all requests must include `Authorization: Bearer <secret>`
2. **No auth** (`--no-auth`) — only for environments where network isolation is the security boundary

Default: if neither flag is provided, server refuses to start. Forces an explicit choice.

## Non-interactive behaviour

`caprail-cli-http` always runs commands in non-interactive mode:
- `stdin` is never forwarded
- child stdout/stderr are captured separately
- default timeout is **30000ms** (configurable via `--timeout-ms`)
- default captured-output cap is **1048576 bytes** total across stdout/stderr (configurable via `--max-output-bytes`)
- if the child times out, it is terminated and a 504 response is returned
- if output exceeds the cap, capture stops and a 413 response is returned

## Non-goals for caprail-cli-http

- TLS (use Docker network isolation, host firewall rules, or a reverse proxy)
- User management / multi-tenancy
- Rate limiting
- Request queuing
- Streaming command output in v1

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
- **Coverage:** 100% of `matcher.js` (security-critical path)

| Level | What | Where |
|-------|------|-------|
| Unit | Guard config parsing, token normalization, deny precedence, execution rules | `packages/guards/cli/test/` |
| Unit | Transport routing, auth checking, discovery, protocol mapping | `packages/transports/argv/test/`, `packages/transports/http/test/` |
| Composition | Full local CLI product wiring (`guard-cli` + `transport-argv`) | `packages/products/cli/test/` |
| Composition | HTTP request → composed product → guard execution → response | `packages/products/cli-http/test/` |

## Boundaries

**Always:**
- `spawn` with `shell: false` — never pass args through a shell
- Fail closed on invalid/missing config
- Treat config entries as token sequences, not shell snippets
- Keep audit logs separate from command stdout/stderr
- Default to non-interactive execution
- Exit 126 on denial (`caprail-cli`), 403 on denial (`caprail-cli-http`)

**Ask first:**
- Adding any dependency beyond `yaml`
- Changing the matching algorithm
- Adding new config resolution paths
- Adding vendor-specific parsing logic beyond minimal normalization

**Never:**
- `child_process.exec` or `shell: true`
- Silent allow on ambiguous config
- Read or manipulate credentials
- Buffer large outputs in memory without an explicit cap
- Look for config in the current working directory

## Success Criteria

1. `caprail-cli --config <path> -- gh pr list --state open` executes and streams output
2. `caprail-cli --config <path> -- gh pr create --title test` exits 126 with clear denial
3. `caprail-cli --config <path> --explain --json -- gh pr create` prints structured matching output
4. `caprail-cli --config <path> --list --json` shows permissions
5. `caprail-cli --config <path> --validate --json` catches bad config
6. `caprail-cli-http` serves `/exec`, `/discover`, `/health`
7. `/discover` returns the full tool/permission manifest from config plus execution limits
8. Auth is enforced when configured; explicit opt-in for no-auth
9. `guard-cli` adds no runtime dependencies beyond `yaml`; transports/products prefer built-ins unless there is a strong justification
10. Works on Windows + Linux + macOS
11. Audit logs never contaminate command stdout/stderr
12. Guard, transport, and composed product packages are all publishable independently to npm

## Resolved Questions

1. **YAML dependency vs inline parser** — Using `yaml` package. Zero transitive deps, audit once.
2. **Windows config path** — Prefer `%ProgramData%\caprail-cli\config.yaml` for host/service deployments; fall back to `%AppData%\caprail-cli\config.yaml` for per-user installs.
3. **Should `caprail-cli-http` stream responses or buffer?** Buffer with explicit size cap in v1. Streaming can be added later if needed.
4. **Should `/discover` include example invocations?** Not in v1 — the allow list plus execution metadata is sufficient.
5. **Should config be discovered from the working directory?** No. That is too easy for an agent to shadow or modify.
