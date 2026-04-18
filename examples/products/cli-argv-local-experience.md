# Local experience: @caprail/cli-argv

Running `@caprail/cli-argv` end-to-end on a developer machine using `gh` and the `examples/guards/cli.policy.yaml` policy.

## Prerequisites

- Node 18+
- `gh` installed and authenticated (`gh auth status`)
- workspace dependencies installed (`npm install` from repo root)

## Running the binary

The workspace symlink at `node_modules/.bin/caprail-cli` is a shell wrapper, not a `.js` entrypoint, so invoking it with `node` directly will fail. Run the entrypoint file directly instead:

```bash
node packages/products/cli-argv/bin/caprail-cli.js [flags] [-- tool args...]
```

## Policy config

Using the example config at `examples/guards/cli.policy.yaml`. It configures three tools (`gh`, `gws`, `az`). Only `gh` is on PATH in this environment.

## Mode walkthrough

### 1. Validate

```bash
node packages/products/cli-argv/bin/caprail-cli.js \
  --config ./examples/guards/cli.policy.yaml \
  --validate
```

```
Config is valid.
WARNING: Binary 'gws' was not found on PATH.
WARNING: Binary 'az' was not found on PATH.
```

Config is valid. Missing-binary warnings are non-fatal by design — the transport decides whether to treat them as hard failures.

### 2. List

```bash
node packages/products/cli-argv/bin/caprail-cli.js \
  --config ./examples/guards/cli.policy.yaml \
  --list
```

```
Tool: az
  Binary: az
  Description: Azure CLI (read-only resource access)
  Allow: group list, group show, resource list, resource show, vm list, vm show
  Deny: (none)
  Deny flags: (none)

Tool: gh
  Binary: gh
  Description: GitHub CLI (read-only PR and issue access)
  Allow: pr list, pr view, pr diff, pr checks, issue list, issue view, repo view
  Deny: (none)
  Deny flags: --web

Tool: gws
  Binary: gws
  Description: Google Workspace CLI (read + draft only)
  Allow: gmail messages list, gmail messages get, gmail drafts create, gmail drafts list, gmail drafts get
  Deny: (none)
  Deny flags: (none)
```

Tools are sorted alphabetically. Each entry shows its full allow/deny surface at a glance.

### 3. Explain

Check whether a command would be allowed before running it:

```bash
node packages/products/cli-argv/bin/caprail-cli.js \
  --config ./examples/guards/cli.policy.yaml \
  --explain -- gh pr list --repo Denifia/nextup
```

```
Tool:          gh
Normalized:    pr list --repo Denifia/nextup
Matched allow: pr list
Matched deny:  (none)
Matched deny flag: (none)
Deny flags:    --web
Result:        ALLOWED — matched allow entry
```

The `--repo` flag is not in `deny_flags`, so the allow entry `pr list` matches. Explain exits 0 in both allow and deny cases — it is a dry-run inspection, not an enforcement point.

Checking a blocked flag:

```bash
node packages/products/cli-argv/bin/caprail-cli.js \
  --config ./examples/guards/cli.policy.yaml \
  --explain -- gh pr list --web
```

```
Tool:          gh
Normalized:    pr list --web
Matched allow: pr list
Matched deny:  (none)
Matched deny flag: --web
Deny flags:    --web
Result:        DENIED — matched deny flag '--web'
```

### 4. Execute — allowed command

```bash
node packages/products/cli-argv/bin/caprail-cli.js \
  --config ./examples/guards/cli.policy.yaml \
  -- gh pr list --repo Denifia/nextup
```

```
7	chore(deps-dev): bump @types/node from 25.5.2 to 25.6.0	dependabot/npm_and_yarn/types/node-25.6.0	OPEN	2026-04-11T15:33:06Z
6	chore(deps-dev): bump vitest from 4.1.2 to 4.1.4	dependabot/npm_and_yarn/vitest-4.1.4	OPEN	2026-04-11T15:32:59Z
```

`gh` runs through the guard, stdout is streamed, and the child process exit code is forwarded.

### 5. Execute — denied command

```bash
node packages/products/cli-argv/bin/caprail-cli.js \
  --config ./examples/guards/cli.policy.yaml \
  -- gh pr list --web
```

```
caprail-cli: denied 'gh pr list --web' — Deny flag '--web' is blocked for 'gh'.
```

Exit code is `126`. The child process is never spawned.

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Argument, config, or runtime failure |
| `126` | Policy denial in execute mode |
| other | Forwarded from the child process |

## What this confirms

- Config resolution and validation work via explicit `--config`
- List mode renders the full policy surface correctly
- Explain mode accurately predicts allow/deny before execution
- Execute mode runs allowed commands and streams their output
- Execute mode blocks denied commands at policy with exit 126, without spawning the child
