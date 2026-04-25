# Caprail

Policy-enforced access to host capabilities for AI coding agents.

Caprail sits between an agent and the real CLI binary, allowing only pre-configured subcommands to execute. The agent gets useful tool access — reading PRs, listing resources, drafting emails — without the ability to run arbitrary commands against authenticated vendor CLIs.

> **Looking for the npm package?** Most readers will want [`@caprail/cli-http`](packages/products/cli-http/README.md#install). Its [README](packages/products/cli-http/README.md) has the install command, binary name, and startup examples.

**This is not theoretical.** Caprail's `cli-http` product is running in production as a Docker sidecar, giving [Openclaw](https://github.com/nicholasgasior/openclaw) policy-based access to a personal GitHub (`gh`) and Google Workspace email (`gws`). The agent can read PRs, view issues, list emails, and create drafts — but cannot merge, delete, or send. It works exactly as designed.

## The problem

AI coding agents need access to vendor CLIs like `gh`, `az`, and `gws`. Those CLIs are authenticated with real credentials that often can't be scoped down — a `gh` token that can read PRs can also create them, merge them, or delete branches.

Giving an agent unrestricted access to these tools means trusting it with the full power of the underlying credentials. That's a poor trade-off when the agent only needs to read.

## How Caprail solves it

A YAML policy file declares exactly which command shapes are allowed:

```yaml
tools:
  gh:
    binary: gh
    description: GitHub CLI (read-only PR and issue access)
    allow:
      - pr list
      - pr view
      - pr diff
      - issue list
      - issue view
    deny_flags:
      - --web
```

Caprail checks every invocation against the policy. Allowed commands execute normally. Everything else is denied with exit code `126` and an audit log entry. No shell is ever involved — commands are spawned directly with `shell: false`.

```
$ caprail-cli --config policy.yaml -- gh pr list --state open
# ✓ runs normally, streams output

$ caprail-cli --config policy.yaml -- gh pr create --title "oops"
# ✗ caprail-cli: denied 'gh pr create --title oops' — not in allow list
# exit 126
```

## Modular architecture

Caprail separates **what to guard** from **how to expose it**:

```
guard (policy + matching + execution)
  + transport (argv, HTTP, MCP, ...)
  = product (thin wiring + executable)
```

This means the same policy engine can be used locally via the CLI, over HTTP from a container, or through MCP for native tool integration — without duplicating guard logic.

### What's built

| Layer | Package | What it does |
|-------|---------|-------------|
| Product | `@caprail/cli-http` | Wires guard + HTTP transport, ships the `caprail-cli-http` binary — the sidecar/host wrapper |
| Product | `@caprail/cli-argv` | Wires guard + argv transport, ships the `caprail-cli-argv` binary |
| Guard | `@caprail/guard-cli` | Config loading, token-based allow/deny matching, non-interactive execution, audit logging |
| Transport | `@caprail/transport-argv` | Parses `process.argv`, dispatches modes (validate/list/explain/execute), maps results to exit codes |
| Transport | `@caprail/transport-http` | HTTP server transport with bearer auth, timeouts, output caps — `/exec`, `/discover`, `/health` |

### What's next

| Package | Purpose |
|---------|---------|
| `@caprail/transport-mcp` | MCP transport for native tool discovery in MCP-aware agents |
| `@caprail/guard-files` | Read-only access to allowlisted host files and log folders |
| `@caprail/guard-ui` | Declarative desktop UI automation for specific apps |

## When to use this

### Docker sidecar

An AI agent runs in one container. Authenticated CLIs and credentials live in a separate sidecar. The agent has no vendor binaries and no credential mounts — it reaches the sidecar over HTTP, and Caprail enforces what commands can run.

This is the strongest model: the agent literally cannot run `gh` directly.

**I'm currently running in production** — My Openclaw uses it to access GitHub and Google Workspace email via `caprail-cli-http`.

→ [docs/usecase-docker-sidecar.md](docs/usecase-docker-sidecar.md)
→ [examples/products/cli-http-sidecar-experience.md](examples/products/cli-http-sidecar-experience.md)

### Host wrapper

An AI agent runs in a container on a Windows or Linux host. The host has the real CLIs and browser-backed auth sessions. Caprail runs on the host behind an HTTP wrapper, and the agent reaches it over the Docker network.

Weaker than the sidecar model, but much stronger than giving the agent direct host shell access.

→ [docs/usecase-pi-container-host-wrapper.md](docs/usecase-pi-container-host-wrapper.md)

## How is this different from an MCP server?

An MCP server gives an agent access to tools. Caprail gives an agent *restricted* access to tools that already exist on the host.

The difference is the policy layer. An MCP server for `gh` would typically expose `gh` commands as tools and execute whatever the agent asks for. Caprail sits in front of the real binary and enforces a token-based allow/deny policy before anything executes.

They compose well together: `@caprail/transport-mcp` would expose guarded CLI access as MCP tools, with Caprail's policy engine deciding what's allowed. The MCP server becomes the transport; the guard stays the same.

## Quick start

```bash
npm install
```

### Local CLI (cli-argv)

```bash
# Validate a policy config
node ./packages/products/cli-argv/bin/caprail-cli.js --config examples/guards/cli.policy.yaml --validate

# List what the agent can do
node ./packages/products/cli-argv/bin/caprail-cli.js --config examples/guards/cli.policy.yaml --list

# Explain whether a specific command would be allowed
node ./packages/products/cli-argv/bin/caprail-cli.js --config examples/guards/cli.policy.yaml --explain -- gh pr create --title test

# Run a guarded command
node ./packages/products/cli-argv/bin/caprail-cli.js --config examples/guards/cli.policy.yaml -- gh pr list --state open
```

### HTTP sidecar (cli-http)

```bash
# Start the HTTP server with token auth
node ./packages/products/cli-http/bin/caprail-cli-http.js \
  --config examples/guards/cli.policy.yaml \
  --port 8100 \
  --token mysecret

# In another terminal:
curl http://localhost:8100/health
curl -H "Authorization: Bearer mysecret" http://localhost:8100/discover
curl -X POST http://localhost:8100/exec \
  -H "Authorization: Bearer mysecret" \
  -H "Content-Type: application/json" \
  -d '{"tool": "gh", "args": ["pr", "list", "--state", "open"]}'
```

## Design principles

- **Fail closed.** Missing config, malformed policy, unknown tool — all denied.
- **Verbs, not scope.** Caprail controls *which commands* run, not *which resources* they target.
- **No shell, ever.** Commands are spawned with `child_process.spawn` and `shell: false`.
- **Transport-agnostic.** The guard doesn't know if it was called from a terminal, an HTTP server, or an MCP client.
- **Audit everything.** Every allowed and denied invocation can be logged, always separate from command output.

## Project structure

```
packages/
  guards/
    cli/               @caprail/guard-cli
  transports/
    argv/              @caprail/transport-argv
    http/              @caprail/transport-http
  products/
    cli-argv/          @caprail/cli-argv      (local CLI binary)
    cli-http/          @caprail/cli-http      (HTTP sidecar binary)
docs/
  usecase-*.md         Deployment models
examples/
  guards/cli.policy.yaml
  products/
    cli-argv-local-experience.md
    cli-http-sidecar-experience.md
```

Node 18+. No build step. Only runtime dependency is `yaml` (zero transitive deps).

## Links

- [Example policy](examples/guards/cli.policy.yaml)
- [cli-argv local experience](examples/products/cli-argv-local-experience.md)
- [cli-http sidecar experience](examples/products/cli-http-sidecar-experience.md)
- [Docker sidecar use case](docs/usecase-docker-sidecar.md)
- [Host wrapper use case](docs/usecase-pi-container-host-wrapper.md)
- [HTTP API contract](packages/transports/http/docs/api.md)
