# Use Case: Pi in Docker on Windows 11, caprail-cli-http on the Host

## Context

Pi runs inside a Windows Docker container rather than directly on the host. The host has authenticated vendor CLIs (`gh`, `az`, etc.) and browser-backed sessions. Caprail runs on the host behind the thin HTTP wrapper, and Pi reaches it over a local host-to-container network path.

This model is meant to improve on the earlier "Pi directly on the host" approach:
- Pi shell execution stays in the container
- vendor CLIs and credentials stay on the host
- Caprail policy is enforced on the host, close to the real CLI binaries
- host access is exposed through narrow HTTP wrappers instead of direct host shell access

It is still weaker than the full Docker sidecar model, but materially stronger than giving Pi direct host shell and broad host filesystem access.

## Architecture

```text
┌───────────────────────────────────────────────────────────────┐
│ Windows 11 Host                                              │
│                                                               │
│  Vendor CLIs + credentials + browser sessions                │
│                                                               │
│  caprail-cli-http --config %ProgramData%\caprail-cli\config.yaml│
│     └── caprail-cli gh ... / az ...                          │
│                                                               │
│  Config + audit logs live outside any container mounts       │
└───────────────────────────────────────────────────────────────┘
                    ▲
                    │ HTTP + bearer token
                    │ (e.g. via host.docker.internal)
                    ▼
┌───────────────────────────────────────────────────────────────┐
│ Pi container                                                  │
│                                                               │
│  Pi runtime                                                   │
│   ├── read/edit/write tools → container-mounted workspace     │
│   ├── bash tool           → container shell only              │
│   └── gh/az tools         → POST /exec on host caprail-cli-http│
│                                                               │
│  No vendor CLI binaries                                       │
│  No host credential files                                     │
│  No Caprail config mount                                      │
└───────────────────────────────────────────────────────────────┘
```

## Why this is better than Pi directly on the host

Compared with a host-native Pi setup, this model reduces several bypass paths:

- **No host shell access:** Pi's shell stays in the container.
- **No direct host CLI access:** the agent cannot just run `gh` or `az` directly.
- **No direct credential file access:** host credentials are not mounted into the container.
- **Policy close to the executable:** Caprail runs on the host, where the real CLI and auth context already live.
- **Narrow host integration surface:** host capabilities are exposed through specific wrappers instead of broad host tool access.

## Security Model

| Layer | What it does |
|-------|-------------|
| **Container boundary** | Pi shell execution stays sandboxed in the container. |
| **Host caprail-cli-http** | Exposes only a small authenticated API for selected vendor CLIs. |
| **Caprail policy** | Enforces token-based allow/deny rules before launching the real host CLI. |
| **Host filesystem placement** | Config, audit logs, and credential files live outside mounted container paths. |
| **Bearer token + host firewall** | Reduces the chance that anything other than the Pi container can reach the host wrapper. |

### Important limitation

Caprail constrains **verbs, not scope**. It can allow `az vm show` and deny `az vm delete`, but it does not inherently limit which subscription, resource group, or VM the allowed command targets.

## Recommended host placement

For this model, the host wrapper should use an explicit config path outside any path visible to the container.

Recommended Windows locations:
- **Preferred:** `%ProgramData%\caprail-cli\config.yaml`
- **Per-user fallback:** `%AppData%\caprail-cli\config.yaml`
- **Audit log:** `%LocalAppData%\caprail-cli\audit.log`

Guidance:
- do **not** place config in the repo workspace
- do **not** share the config path as a Docker volume with the Pi container
- lock down the file with Windows ACLs so the Pi host user/container mapping cannot modify it
- always pass `--config <path>` explicitly to `caprail-cli-http`

## Host wrapper example

```text
caprail-cli-http --config "C:\ProgramData\caprail-cli\config.yaml" --port 8100 --token "<shared-secret>" --timeout-ms 30000 --max-output-bytes 1048576
```

Operational note: because the service must be reachable from the container, use a local firewall rule to restrict access to the Docker Desktop / Hyper-V network rather than exposing it broadly on the LAN.

## Example config

```yaml
# C:\ProgramData\caprail-cli\config.yaml
settings:
  audit_log: C:\Users\<user>\AppData\Local\caprail-cli\audit.log
  audit_format: jsonl

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

## Pi integration pattern

The Pi extension should not split a single string on whitespace. It should send an argument-token array to the host wrapper.

### Better tool shape

- One generated tool per configured CLI (`gh`, `az`, etc.), or
- One generic transport tool plus startup discovery that synthesizes descriptions from `/discover`

The important part is the parameter type:

```javascript
{
  name: "gh",
  description: "GitHub CLI (restricted; description generated from /discover)",
  parameters: {
    args: {
      type: "array",
      items: { type: "string" },
      description: "Argument tokens, e.g. ['pr', 'list', '--state', 'open']"
    }
  },
  execute: async ({ args }) => {
    const response = await fetch("http://host.docker.internal:8100/exec", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": "Bearer <shared-secret>"
      },
      body: JSON.stringify({ tool: "gh", args })
    });

    const payload = await response.json();
    return JSON.stringify(payload, null, 2);
  }
}
```

### Why this is better

- avoids brittle `args.split(/\s+/)` parsing
- preserves token boundaries and quoted values
- keeps stdout/stderr separate in the response
- lets the wrapper enforce timeout and output-size limits
- avoids mixing audit logs into tool output
- allows tool descriptions to be generated from `/discover` so they do not drift from policy

## Agent Workflow

1. Pi container starts.
2. Extension calls `GET /discover` on the host wrapper.
3. Extension exposes `gh`, `az`, etc. to the agent with descriptions synthesized from the live policy.
4. Agent invokes `gh` with `args: ["pr", "list", "--repo", "org/repo"]`.
5. Host wrapper runs `caprail-cli --config C:\ProgramData\caprail-cli\config.yaml -- gh pr list --repo org/repo`.
6. Caprail checks policy and launches the real host CLI only if allowed.
7. Wrapper returns structured JSON with `stdout`, `stderr`, and `exit_code`.

## API error behaviour in practice

| Situation | Response |
|-----------|----------|
| Missing/invalid auth | `401 unauthorized` |
| Malformed request | `400 invalid_request` |
| Tool not configured or command denied | `403 policy_denied` |
| Allowed command fails normally | `200` with non-zero `exit_code` |
| Output exceeds cap | `413 output_limit_exceeded` |
| Command times out | `504 execution_timeout` |
| Wrapper failure | `500 internal_error` |

## Bypass Analysis

| Vector | Status |
|--------|--------|
| Agent runs `gh` directly via shell | Blocked: shell is in container, no host `gh` available |
| Agent reads host credential files | Blocked if those host paths are not mounted into the container |
| Agent edits Caprail config | Blocked if config lives outside mounted container paths and wrapper uses fixed `--config` |
| Agent passes malicious args to Caprail | Blocked by `spawn` with `shell: false` and token-array transport |
| Agent hits host wrapper with disallowed command | Blocked by Caprail policy |
| External process hits host wrapper | Reduced by bearer token + host firewall scoping |

## Residual Risks

This is not as strong as the sidecar model.

Residual concerns include:
- host wrapper exposure is broader than an internal-only sidecar unless the host firewall is configured carefully
- the host still holds real credentials and real vendor CLIs
- if sensitive host paths are accidentally mounted into the container, the agent may still reach them
- container escape or host compromise bypasses Caprail entirely

Still, with:
- Pi in a container
- host CLIs behind `caprail-cli-http`
- explicit `--config`
- config outside agent-visible paths
- no sensitive host mounts into the container

...this becomes a much more credible model than running Pi directly on the host with unrestricted host access.
