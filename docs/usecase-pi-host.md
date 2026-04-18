# Use Case: Pi on Windows 11 Host with Docker

## Context

Pi (the coding agent from pi.dev) runs directly on a Windows 11 host. The host has authenticated vendor CLIs (`gh`, `az`, etc.) and the user is logged into various services via their browser. The user wants a split-horizon security model:

- **Safe tools** (read, edit, write) run directly on the host
- **Shell execution** (bash) is forwarded to a Windows Docker container (Hyper-V)
- **Vendor CLI access** is exposed via Pi custom tools that invoke cliguard on the host

## Architecture

```
┌──────────────────────────────────────────────────┐
│  Windows 11 Host                                 │
│                                                  │
│  ┌───────────────┐                               │
│  │     Pi        │                               │
│  │  ┌───────────┤                                │
│  │  │ read      │──── host filesystem            │
│  │  │ edit      │──── host filesystem            │
│  │  │ write     │──── host filesystem            │
│  │  ├───────────┤                                │
│  │  │ gh tool   │──── cliguard gh ... ────▶ gh   │
│  │  │ az tool   │──── cliguard az ... ────▶ az   │
│  │  ├───────────┤                                │
│  │  │ bash      │──┐                             │
│  │  └───────────┤  │                             │
│  └───────────────┘  │                            │
│                     ▼                            │
│         ┌─────────────────────┐                  │
│         │ Docker container    │                  │
│         │ (Hyper-V, Windows)  │                  │
│         │                     │                  │
│         │ No credentials      │                  │
│         │ No vendor CLIs      │                  │
│         │ No host filesystem  │                  │
│         │ access (or limited) │                  │
│         └─────────────────────┘                  │
└──────────────────────────────────────────────────┘
```

## Security Model

| Layer | What it does |
|-------|-------------|
| **Pi tool system** | Agent can only invoke defined tools. No raw host shell access. |
| **Docker container** | All bash/shell execution is sandboxed. No credentials, no vendor CLIs. |
| **cliguard policy** | Custom tools invoke cliguard, which enforces subcommand whitelist before running the real CLI. |

The security boundary is Pi's tool restriction (agent can't run arbitrary host commands) combined with Docker (shell execution is sandboxed). Cliguard adds subcommand-level granularity to the custom tools.

**Compared to the Docker sidecar use case, this is slightly weaker:** if Pi's tool system has a bug that allows arbitrary host command execution, cliguard can be bypassed. In practice this is a reasonable trade-off — Pi's tool system is the trust boundary you're already relying on for file access.

## Pi Custom Tool Definitions

Each vendor CLI gets one Pi custom tool that delegates to cliguard.

```javascript
// Pi extension: gh tool
{
  name: "gh",
  description: `GitHub CLI (restricted). Allowed commands:
    pr list, pr view, pr diff, pr checks,
    issue list, issue view, repo view.
    Run with --help after a subcommand for usage.`,
  parameters: {
    args: {
      type: "string",
      description: "Arguments to pass to gh (e.g., 'pr list --state open --repo org/repo')"
    }
  },
  execute: async ({ args }) => {
    const { execFile } = require('child_process');
    return new Promise((resolve, reject) => {
      execFile('cliguard', ['gh', ...args.split(/\s+/)], {
        timeout: 30000
      }, (err, stdout, stderr) => {
        if (err && err.code === 126) {
          // Policy denial — return the message, don't throw
          resolve(`DENIED: ${stderr}`);
        } else if (err) {
          reject(new Error(stderr || err.message));
        } else {
          resolve(stdout);
        }
      });
    });
  }
}
```

The tool description lists allowed commands so the agent doesn't waste turns on denied actions. On denial, the error message tells the agent what went wrong.

## Example Config

```yaml
# ~/.config/cliguard/config.yaml
settings:
  default_policy: deny
  log: stderr
  log_format: text

tools:
  gh:
    binary: gh
    description: "GitHub CLI — read-only PR and issue access"
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

  az:
    binary: az
    description: "Azure CLI — read-only resource and VM access"
    allow:
      - "group list"
      - "group show"
      - "resource list"
      - "resource show"
      - "vm list"
      - "vm show"
```

## Agent Workflow

1. Agent sees `gh` and `az` in its available tools (Pi extension).
2. Agent calls `gh` tool with args `pr list --state open --repo org/repo`.
3. Pi invokes `cliguard gh pr list --state open --repo org/repo` on the host.
4. Cliguard checks config → `pr list` is allowed → spawns `gh pr list --state open --repo org/repo`.
5. Output streams back to agent.

If the agent tries `gh pr create --title "fix bug"`:
1. Cliguard checks config → `pr create` is not in the allow list → exits 126.
2. Pi tool returns `DENIED: 'pr create' is not in the allow list for 'gh'`.
3. Agent adjusts its approach.

## Bypass Analysis

| Vector | Status |
|--------|--------|
| Agent runs `gh` directly via shell | Shell goes to Docker container — no `gh` installed there |
| Agent reads `~/.config/gh/hosts.yml` | Agent has `read` tool on host — **this is a risk** |
| Agent curls API with stolen token | Shell (curl) goes to Docker — can't reach host's credential files |
| Agent passes malicious args to cliguard | Cliguard uses `spawn` with `shell: false` — no injection |
| Agent modifies cliguard config | Agent has `edit` tool — **this is a risk** |

### Residual Risks

**The agent has file read/edit access on the host.** This means it could theoretically:
- Read credential files (`~/.config/gh/hosts.yml`, `~/.azure/`)
- Edit the cliguard config to allow more commands

**Mitigations:**
1. **Pi's file access boundaries** — configure Pi to restrict which directories the agent can read/edit. Exclude credential directories and cliguard config from the agent's allowed paths.
2. **File permissions** — make cliguard config read-only for the user running Pi (if running as a different user, which is unlikely on a personal machine).
3. **Accept the risk** — on a personal dev machine, the agent already has broad file access. The cliguard layer is defense-in-depth, not the sole boundary. It prevents accidental misuse; a determined adversarial agent is out of scope for this deployment model.

**Recommendation:** Option 3 is pragmatic for a personal machine. Document the risk, accept it, and rely on the combination of Pi tool restrictions + Docker shell sandboxing + cliguard policy as layered defense.
