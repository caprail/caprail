# Spec: cliguard

## Objective

A generic, cross-agent command-argument whitelist enforcer for vendor CLIs. It sits between an AI agent's custom tool definition and the real CLI binary on the host, allowing only pre-configured subcommands to execute.

**Target user:** Someone running an AI coding agent (Pi, Cline, Cursor, etc.) on their host machine, with bash/shell forwarded to a Docker container, and authenticated vendor CLIs (gh, az, gws, etc.) available on the host. They want the agent to use those CLIs with restricted permissions, even when the CLI vendor doesn't support scoped tokens.

**Architecture context:**
```
Agent framework (host)
  ├── read/edit/write tools → host filesystem (direct)
  ├── bash tool → Docker container (no creds, no CLIs)
  └── cli tools → cliguard (host) → real CLI (host, with creds)
```

The security boundary is NOT cliguard itself. The security boundary is:
1. The agent framework only exposes defined tools (no raw host shell)
2. Docker sandboxes all shell execution (no access to host creds)

Cliguard's role is **policy enforcement** — turning one-tool-per-CLI into fine-grained subcommand permissions via a single config file.

## Non-goals

- Authentication / credential management
- Output filtering or redaction
- Network-level controls
- Agent-framework-specific integration (cliguard is framework-agnostic)
- Flag-value validation (e.g., "allow `--limit` only up to 100")

## Tech Stack

- **Language:** Node.js (zero dependencies, uses only built-in modules)
- **Reason:** Runs everywhere the agent frameworks run. `child_process.execFile` passes args as an array natively — shell injection is impossible by construction. No compile step. Publishable as an npm package for easy installation.
- **Minimum Node version:** 18 LTS

## Commands

```
Install (global):   npm install -g cliguard
Run:                cliguard <tool> [args...]
Explain mode:       cliguard --explain <tool> [args...]
Validate config:    cliguard --validate
List permissions:   cliguard --list [tool]
Test:               npm test
Lint:               npm run lint
```

## Project Structure

```
cliguard/
├── bin/
│   └── cliguard.js          # Entry point (hashbang, arg routing)
├── src/
│   ├── config.js            # Config loading, validation, resolution
│   ├── matcher.js           # Subcommand matching + flag deny logic
│   ├── executor.js          # Safe child process execution
│   └── logger.js            # Structured audit logging
├── test/
│   ├── config.test.js
│   ├── matcher.test.js
│   ├── executor.test.js
│   └── integration.test.js
├── examples/
│   └── cliguard.yaml        # Annotated example config
├── package.json
├── SPEC.md
└── README.md
```

## Configuration

Single YAML file. Resolution order (first found wins):
1. `CLIGUARD_CONFIG` environment variable
2. `.cliguard.yaml` in current working directory
3. `~/.config/cliguard/config.yaml`

### Format

```yaml
# cliguard.yaml

# Optional: global settings
settings:
  log: stderr              # stderr | file path | none
  log_format: text         # text | json
  default_policy: deny     # deny | allow (deny recommended)

# Tool definitions
tools:
  gh:
    binary: gh                          # binary name (resolved via PATH) or absolute path
    description: "GitHub CLI (read-only PR and issue access)"
    allow:
      - "pr list"
      - "pr view"
      - "pr diff"
      - "pr checks"
      - "issue list"
      - "issue view"
      - "repo view"
      - "api"                           # allow a single subcommand
    deny:
      - "api -X POST"                   # deny takes precedence over allow
      - "api -X PUT"
      - "api -X PATCH"
      - "api -X DELETE"
    deny_flags:                         # flags denied on ALL subcommands for this tool
      - "--web"                         # don't open browser from agent

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

Given the invocation: `cliguard gh pr list --state open --json title,url`

1. **Extract tool name:** `gh`
2. **Extract subcommand path:** Walk the args left-to-right, collecting tokens that don't start with `-`, until you hit something that isn't a known positional continuation. For robustness, use a simple heuristic: collect leading non-flag tokens after the tool name. Result: `["pr", "list"]`
3. **Stringify:** `"pr list"`
4. **Match against allow list:** Does `"pr list"` match any entry in `allow`? An allow entry matches if the invocation's subcommand path starts with the entry. So `allow: "pr list"` matches `pr list --state open`. And `allow: "api"` matches `api /repos/{owner}/{repo}/pulls`.
5. **Check deny list:** Same extraction logic. If the subcommand + flags match a deny entry, reject. Deny entries are matched as subsequences of the full argv — `"api -X POST"` matches `api /repos/foo -X POST`.
6. **Check deny_flags:** If any flag token in the full argv matches a deny_flags entry, reject.

**Precedence:** deny > deny_flags > allow > default_policy.

**Matching is prefix-based on subcommand path.** This means:
- `allow: "pr list"` permits `pr list`, `pr list --state open`, `pr list --json url`
- `allow: "pr"` permits `pr list`, `pr view`, `pr create` — broad, use with care
- You narrow broad allows with deny entries

This avoids all the fragility of glob matching on full argument strings. Flag order doesn't matter. New flags added by CLI vendors don't break the config.

## Core Behaviour

### Invocation

```
cliguard <tool> [subcommand...] [flags...] [positional-args...]
```

Cliguard receives its own process argv. Everything after `<tool>` is passed to the real binary if allowed.

### Execution

When a command is allowed, cliguard uses `child_process.execFile` (not `exec`, not `spawn` with `shell: true`). This:
- Passes args as an array — no shell interpretation
- Inherits stdout/stderr from the parent for streaming output
- Exits with the child process's exit code

Specifically, use `child_process.spawn` with `{ stdio: 'inherit', shell: false }` to stream output and preserve interactivity for long-running commands.

### Rejection

When a command is denied, cliguard:
1. Prints to stderr: `cliguard: denied 'gh pr create --title test' — 'pr create' is not in the allow list for 'gh'`
2. Exits with code **126** (standard "command cannot execute" code)
3. Logs the denial (see Logging)

### Explain Mode

`cliguard --explain gh pr create --title test`

Prints the matching decision without executing:
```
Tool:       gh
Subcommand: pr create
Allow list: pr list, pr view, pr diff, pr checks, issue list, issue view, repo view, api
Deny list:  api -X POST, api -X PUT, api -X PATCH, api -X DELETE
Deny flags: --web
Result:     DENIED — 'pr create' does not match any allow entry
```

Useful for debugging config and for agents to self-correct.

### List Mode

`cliguard --list` — print all tools and their allow/deny entries.
`cliguard --list gh` — print just gh's config.

Output is human-readable by default, JSON with `--json` flag.

### Validate Mode

`cliguard --validate` — parse config, check for:
- Valid YAML
- All required fields present
- Binary exists and is executable (warning, not error, if not found)
- No deny entries that don't overlap with any allow entry (likely misconfiguration)

Exit 0 if valid, exit 1 if errors.

## Logging

All invocations (allowed and denied) are logged for audit.

**Default:** stderr (interleaved with command output — acceptable for agent use where stderr is typically captured).

**Structured log entry (JSON format):**
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

When logging to a file, append. No log rotation (out of scope — use system logrotate).

## Agent Integration

### Pi custom tool (example)

The Pi tool definition is minimal. Cliguard handles everything.

```javascript
// Pi extension tool definition
{
  name: "gh",
  description: "GitHub CLI — restricted to read-only PR/issue operations. Use 'cliguard --list gh' to see allowed commands.",
  parameters: {
    args: {
      type: "string",
      description: "Arguments to pass to gh (e.g., 'pr list --state open')"
    }
  },
  execute: async ({ args }) => {
    const { execFile } = require('child_process');
    return new Promise((resolve, reject) => {
      execFile('cliguard', ['gh', ...args.split(/\s+/)], (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve(stdout);
      });
    });
  }
}
```

**Important:** The tool description should tell the agent what's allowed so it doesn't waste turns on denied commands. Including `cliguard --list gh` in the description lets the agent discover permissions.

### Other agents (Cline, Cursor, etc.)

Any agent that supports custom tool/command definitions can use cliguard the same way. The integration is always: invoke `cliguard <tool> <args>` as a subprocess.

## Code Style

```javascript
// Terse, no classes, no abstractions without reason.
// Node built-ins only. No dependencies.

import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { parse as parseYaml } from './yaml-lite.js'; // minimal inline YAML parser OR:
// Accept dependency on 'yaml' package if inline parser is out of scope.
```

**Decision needed:** YAML parsing. Options:
1. Zero dependencies — write/inline a minimal YAML parser (covers the subset we use)
2. Single dependency — `yaml` npm package (well-maintained, 0 transitive deps)

**Recommendation:** Option 2. The `yaml` package is 0 transitive dependencies and handles edge cases we'd get wrong. One dependency is acceptable for a security tool. Audit it once.

**Naming:** camelCase for variables/functions. kebab-case for files. No TypeScript (keep the tool simple and auditable — one layer of code, no build step).

## Testing Strategy

- **Framework:** Node built-in test runner (`node --test`)
- **Location:** `test/` directory, mirroring `src/` structure
- **Coverage:** 100% of matcher.js (this is the security-critical path)

**Test levels:**

| Level | What | How |
|-------|------|-----|
| Unit | Config parsing, subcommand extraction, matching logic | Pure function tests |
| Unit | Deny precedence over allow | Edge case matrix |
| Integration | Full cliguard invocation against a mock binary | Subprocess tests with a stub script |
| Integration | Rejection output format and exit code | Assert stderr + exit 126 |
| Integration | Explain mode output | Assert structured output |

**Critical test cases for matcher:**
- Exact subcommand match
- Prefix match (`allow: "api"` matches `api /repos/...`)
- Deny overrides allow
- deny_flags blocks regardless of subcommand
- Flags interspersed with subcommands (`gh --repo foo pr list`)
- Empty args (just `cliguard gh` with no subcommand)
- Unknown tool name
- No config file found

## Boundaries

**Always:**
- Use `execFile`/`spawn` with `shell: false` — never pass args through a shell
- Validate config on load — fail closed on invalid config
- Log every invocation (allowed and denied)
- Exit with child's exit code on success
- Exit 126 on denial

**Ask first:**
- Adding any dependency beyond `yaml`
- Changing the matching algorithm
- Adding new config resolution paths

**Never:**
- Use `child_process.exec` or `shell: true`
- Silently allow a command when config is ambiguous — fail closed
- Read or manipulate credentials
- Buffer large outputs in memory — stream through

## Success Criteria

1. `cliguard gh pr list --state open` executes `gh pr list --state open` and streams output
2. `cliguard gh pr create --title test` exits 126 with clear denial message
3. `cliguard --explain gh pr create` prints matching trace without executing
4. `cliguard --list` shows all configured permissions
5. `cliguard --validate` catches invalid config
6. All invocations are logged
7. Zero dependencies beyond `yaml`
8. Works on Windows (Git Bash / cmd / PowerShell), Linux, macOS
9. Publishable as `npx cliguard` / global npm install
10. A Pi tool definition for a wrapped CLI is <15 lines

## Open Questions

1. **YAML dependency vs inline parser** — Recommendation is to use `yaml` package. Confirm?
2. **Should cliguard support piping stdin to the child process?** Some CLI commands accept stdin (e.g., `gh api --input -`). Recommendation: yes, pass through stdin unconditionally. It doesn't affect security since the whitelist already controls which command runs.
3. **Should `--list` output be designed for agent consumption?** If the tool description says "run `cliguard --list gh` to see allowed commands," the output should be LLM-friendly. Recommendation: yes, default text output is clean enough, and `--json` is available for structured use.
4. **Config hot-reload or read-on-every-invocation?** Since cliguard is invoked as a subprocess per command (not a daemon), it reads config on every invocation. No hot-reload needed. Confirm this is fine?
5. **Windows path handling** — `binary: gh` needs to resolve correctly on Windows where the actual binary might be `gh.exe` or `gh.cmd`. Node's `spawn` handles this if we use `{ shell: false }` with a bare command name that's on PATH. Need to verify and test on Windows specifically.
