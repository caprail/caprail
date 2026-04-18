# Implementation Plan: `@caprail/transport-http`

## Overview

Implement `@caprail/transport-http` as a reusable HTTP transport library that composes with `@caprail/guard-cli` now and can support future guards (such as `@caprail/guard-files`) without reworking HTTP runtime fundamentals.

Per `SPEC.md`, this package should own transport concerns only: request/response protocol, auth policy, startup lifecycle, timeout/output controls, and status-code mapping. Guard concerns (policy model, matching, config schema, execution/audit semantics) remain in the injected guard package.

## Current Repo Snapshot

- Implemented packages:
  - `@caprail/guard-cli`
  - `@caprail/transport-argv`
  - `@caprail/cli-argv`
- Missing packages:
  - `@caprail/transport-http`
  - `@caprail/cli-http`
- `SPEC.md` already defines expected HTTP behavior for the CLI pairing:
  - `POST /exec`
  - `GET /discover`
  - `GET /health`
  - bearer-token or explicit `--no-auth` mode
  - timeout and output caps with explicit 504/413 behavior
- Existing plan quality/structure can be mirrored from:
  - `plans/transport-argv-implementation-plan.md`

## Scope

### In scope

- `packages/transports/http/...`
- root workspace update for the new transport package
- HTTP server runtime (Node built-ins)
- request auth enforcement
- startup validation behavior via injected guard contract
- route handling for CLI pairing (`/exec`, `/discover`, `/health`)
- timeout/output-cap transport controls
- transport package tests
- transport package docs

### Out of scope

- product package `@caprail/cli-http` (bin and CLI flags)
- guard matcher/config semantics changes unless required for timeout cancellation support
- TLS, rate limiting, request queuing, streaming output (explicit v1 non-goals in spec)
- implementation of `@caprail/guard-files`

## Architecture Decisions

- **Keep transport/guard separation strict.**
  - Transport depends on guard public contract only.
  - No imports from guard internals (`packages/guards/cli/src/*`).
- **Build a reusable HTTP runtime core.**
  - Separate generic HTTP concerns (auth, parse, write, lifecycle) from CLI-specific route handlers.
  - This preserves a migration path for `guard-files`/`guard-ui` route adapters later.
- **Fail closed at startup.**
  - If config is unreadable/invalid or guard startup validation fails, server refuses to start.
- **Use explicit auth mode selection.**
  - Token mode or no-auth mode must be explicit.
  - If neither is configured, startup fails.
- **Enforce bounded execution responses in transport.**
  - Buffer stdout/stderr separately with a total max-output cap.
  - Enforce timeout and map to HTTP 504.
- **Return structured errors with stable codes.**
  - `invalid_request`, `unauthorized`, `policy_denied`, `output_limit_exceeded`, `execution_timeout`, `internal_error`.

## Proposed Transport Contract

The transport should accept an injected command-token guard adapter compatible with:

```js
{
  loadAndValidateConfig(options),
  buildListPayload(config, options),
  executeGuardedCommand(config, toolName, args, options),
}
```

Public transport exports should be shaped around server composition, for example:

- `createHttpTransportServer(options)`
- `startHttpTransportServer(options)`

Where options include:

- `guard`
- `configPath`
- `auth` config (`token` or `noAuth`)
- execution limits (`timeoutMs`, `maxOutputBytes`)
- server binding (`host`, `port`)

## Dependency Graph

```text
workspace + package scaffold
            ↓
HTTP runtime core (server/auth/json/error helpers)
            ↓
CLI adapter routes (/health, /discover, /exec)
            ↓
execution controls (timeout/output cap/status mapping)
            ↓
integration tests with real @caprail/guard-cli
            ↓
docs + packability
```

## Task List

### Phase 1: Foundation

## Task 1: Scaffold `@caprail/transport-http` package and workspace wiring

**Description:**
Create `packages/transports/http` with Caprail-standard package structure and register it at the root workspace. Establish a minimal public entrypoint and smoke test so the package is independently testable and packable.

**Acceptance criteria:**
- [ ] Root workspaces include `packages/transports/http`.
- [ ] `packages/transports/http/package.json` exists with name `@caprail/transport-http`.
- [ ] Package exports a minimal public entrypoint from `src/index.js`.
- [ ] `README.md`, `docs/`, `src/`, and `test/` exist.
- [ ] Package is packable independently.

**Verification:**
- [ ] `npm install`
- [ ] `node --test packages/transports/http/test/smoke.test.js`
- [ ] `npm pack --workspace @caprail/transport-http --dry-run`

**Dependencies:** None

**Files likely touched:**
- `package.json`
- `packages/transports/http/package.json`
- `packages/transports/http/src/index.js`
- `packages/transports/http/test/smoke.test.js`
- `packages/transports/http/README.md`

**Estimated scope:** Medium

## Task 2: Implement HTTP runtime core (lifecycle, auth, JSON/error helpers)

**Description:**
Implement transport-level HTTP primitives with Node built-ins: request parsing, JSON decoding, response encoding, auth checks, and server lifecycle helpers. Keep this layer guard-agnostic so future guard adapters can reuse it.

**Acceptance criteria:**
- [ ] Runtime uses Node built-ins only (`node:http` + core modules).
- [ ] Supports token auth mode and no-auth mode via explicit config.
- [ ] `/health` can be served without auth.
- [ ] Invalid JSON and invalid request shape can be represented with stable 400 responses.
- [ ] Common error writer produces consistent `{ error: { code, message } }` envelopes.

**Verification:**
- [ ] `node --test packages/transports/http/test/server.test.js --test-name-pattern "auth|health|invalid"`
- [ ] Manual check: unauthorized request receives 401; malformed JSON receives 400.

**Dependencies:** Task 1

**Files likely touched:**
- `packages/transports/http/src/server.js`
- `packages/transports/http/src/index.js`
- `packages/transports/http/test/server.test.js`

**Estimated scope:** Medium

### Checkpoint: Foundation
- [ ] Package is wired and packable
- [ ] HTTP runtime works without CLI-specific assumptions
- [ ] Auth/no-auth mode behavior is deterministic

---

### Phase 2: CLI Pairing Behavior (`guard-cli`)

## Task 3: Add startup validation flow and `/discover` route

**Description:**
Wire guard startup validation into server boot and implement `/discover` using guard payload builders. Include execution metadata block from transport limits as required by the spec.

**Acceptance criteria:**
- [ ] Startup calls `guard.loadAndValidateConfig(...)` and refuses to start when invalid.
- [ ] `/discover` returns tools payload plus execution metadata (`mode`, `timeout_ms`, `max_output_bytes`).
- [ ] `/discover` requires auth when auth is enabled.
- [ ] Guard/transport errors map to 500 with `internal_error`.

**Verification:**
- [ ] `node --test packages/transports/http/test/index.test.js --test-name-pattern "startup|discover"`
- [ ] Manual check: discovery output reflects current policy and configured limits.

**Dependencies:** Task 2

**Files likely touched:**
- `packages/transports/http/src/index.js`
- `packages/transports/http/src/discovery.js`
- `packages/transports/http/test/index.test.js`

**Estimated scope:** Medium

## Task 4: Implement `/exec` route for CLI command-token requests

**Description:**
Implement `POST /exec` for request shape `{ tool: string, args: string[] }`, execute through the guard contract, and map guard outcomes to HTTP responses per `SPEC.md`.

**Acceptance criteria:**
- [ ] `/exec` validates request JSON shape and returns 400 for invalid payloads.
- [ ] Calls `guard.executeGuardedCommand(config, tool, args, options)`.
- [ ] Policy denials (including unknown tool) map to 403 with `policy_denied`.
- [ ] Allowed execution maps to HTTP 200 with `allowed`, `exit_code`, `stdout`, `stderr`, `timed_out`, `truncated` fields.
- [ ] Internal transport failures map to 500.

**Verification:**
- [ ] `node --test packages/transports/http/test/index.test.js --test-name-pattern "exec|denied|request"`
- [ ] Manual check for allowed non-zero child exit code still returning HTTP 200.

**Dependencies:** Task 3

**Files likely touched:**
- `packages/transports/http/src/index.js`
- `packages/transports/http/src/server.js`
- `packages/transports/http/test/index.test.js`

**Estimated scope:** Medium

## Task 5: Enforce timeout and output limits with status mapping

**Description:**
Add transport-level timeout and output-capture controls for `/exec`, including process termination behavior and explicit 413/504 responses.

**Acceptance criteria:**
- [ ] Default timeout is `30000ms`, configurable.
- [ ] Default output cap is `1048576` bytes total across stdout+stderr, configurable.
- [ ] Timeout produces HTTP 504 with `execution_timeout`.
- [ ] Output-cap breach produces HTTP 413 with `output_limit_exceeded`.
- [ ] Capture flags (`timed_out`, `truncated`) are set correctly.

**Verification:**
- [ ] `node --test packages/transports/http/test/index.test.js --test-name-pattern "timeout|output"`
- [ ] Manual check with fixture command that sleeps and one that writes large output.

**Dependencies:** Task 4

**Files likely touched:**
- `packages/transports/http/src/index.js`
- `packages/transports/http/test/index.test.js`
- `packages/transports/http/test/fixtures/*`

**Estimated scope:** Medium

### Checkpoint: Core Behavior
- [ ] `/health`, `/discover`, `/exec` implemented
- [ ] Startup fail-closed behavior confirmed
- [ ] Auth and status code mapping match spec
- [ ] Timeout/output cap behavior verified

---

### Phase 3: Confidence, Reuse Readiness, and Handoff

## Task 6: Add integration tests against real `@caprail/guard-cli`

**Description:**
Validate the transport with real guard public APIs and deterministic fixture binaries/scripts. Confirm no guard internals are required.

**Acceptance criteria:**
- [ ] Integration tests import `@caprail/guard-cli` only through public entrypoint.
- [ ] Coverage includes: auth checks, `/discover`, allowed `/exec`, denied `/exec`, timeout, output cap.
- [ ] Tests avoid external CLI dependencies by using local Node fixtures.

**Verification:**
- [ ] `node --test packages/transports/http/test/integration.test.js`
- [ ] `node --test packages/transports/http/test/*.test.js`

**Dependencies:** Tasks 3–5

**Files likely touched:**
- `packages/transports/http/test/integration.test.js`
- `packages/transports/http/test/fixtures/*`

**Estimated scope:** Small/Medium

## Task 7: Document HTTP contract and guard boundary

**Description:**
Write transport docs aligned to spec and package boundaries, including endpoint behavior, auth modes, limits, and product handoff to future `@caprail/cli-http`.

**Acceptance criteria:**
- [ ] `README.md` explains package purpose and composition boundary.
- [ ] `docs/api.md` documents `/exec`, `/discover`, `/health` request/response contracts.
- [ ] `docs/auth.md` documents token/no-auth modes and explicit-choice startup rule.
- [ ] Docs state this is a transport library; executable/bin lives in `@caprail/cli-http`.
- [ ] Docs mention reusable runtime core for future guard pairings.

**Verification:**
- [ ] `npm pack --workspace @caprail/transport-http --dry-run`
- [ ] Manual review against `SPEC.md` HTTP section.

**Dependencies:** Task 6

**Files likely touched:**
- `packages/transports/http/README.md`
- `packages/transports/http/docs/api.md`
- `packages/transports/http/docs/auth.md`

**Estimated scope:** Small

### Checkpoint: Complete
- [ ] `@caprail/transport-http` is independently testable and packable
- [ ] HTTP contract implemented and documented
- [ ] Real guard integration proven
- [ ] Reusable runtime foundation exists for future `guard-files`/`guard-ui` adapters
- [ ] Ready for thin product composition in `@caprail/cli-http`

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Timeout enforcement may require guard-level cancellation support | High | Decide early whether to extend `executeGuardedCommand` options with cancellation/abort support |
| HTTP runtime becomes too CLI-specific | High | Keep generic server/auth/error helpers separate from CLI endpoint adapter |
| Output capture can overrun memory under heavy command output | High | Enforce byte caps during capture, not after full buffer accumulation |
| Auth defaults become insecure by omission | Medium | Refuse startup unless token mode or explicit no-auth mode is set |
| Status/error mapping drifts from `SPEC.md` | Medium | Add exact-code tests for 400/401/403/413/504/500 |
| Cross-platform process termination behavior differs | Medium | Include fixture tests for Windows/POSIX-compatible timeout handling |

## Parallelization Opportunities

- After **Task 2**, docs drafting (`api.md`/`auth.md`) can start in parallel with route implementation.
- After **Task 4**, timeout/output-limit work and integration test scaffolding can run in parallel.
- Packaging/README cleanup can run in parallel with final integration test stabilization.

## Open Questions

- Should timeout/output-cap termination semantics require a guard contract enhancement (e.g., abort signal), or can transport enforce this externally in v1? transport does it
- On output-cap breach, should child execution be terminated immediately or only capture stopped while process continues? (Spec intent suggests immediate bounded behavior.) immediate bounded behavior
- Should transport-http include an inbound request body size limit in v1 (separate from child output cap)? yes, make it sensible
- Should `/health` remain permanently unauthenticated for all future guard pairings, or be configurable per product? unauthenticated

## Recommendation

Approve this plan and implement `@caprail/transport-http` before `@caprail/cli-http`. Keep the package focused on reusable HTTP transport responsibilities while delivering the full `guard-cli` pairing contract from `SPEC.md`. Once this transport is stable, the `cli-http` product should be a thin wiring layer (analogous to `@caprail/cli-argv`).
