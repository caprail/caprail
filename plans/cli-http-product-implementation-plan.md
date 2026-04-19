# Implementation Plan: `@caprail/cli-http` Product Package

## Overview

Implement `@caprail/cli-http` as the thin, publishable HTTP product that composes `@caprail/guard-cli` with `@caprail/transport-http` and exposes the executable boundary for the long-running `caprail-cli-http` server.

Per `SPEC.md`, this package should own only product concerns: CLI flag parsing, startup UX, bin wiring, and composition tests. Guard policy/config semantics stay in `@caprail/guard-cli`, and HTTP protocol/auth/timeout/output-cap behavior stays in `@caprail/transport-http`.

## Read Source Summary

Planning was based on:

- `SPEC.md`
- `README.md`
- `packages/products/cli-argv/README.md`
- `packages/products/cli-argv/docs/usage.md`
- `packages/transports/http/README.md`
- `packages/transports/http/docs/api.md`
- `packages/transports/http/docs/auth.md`
- `docs/usecase-docker-sidecar.md`
- `docs/usecase-pi-container-host-wrapper.md`
- existing plans in `plans/` for `transport-http` and `cli-argv`

## Current Repo Snapshot

- Implemented and documented:
  - `@caprail/guard-cli`
  - `@caprail/transport-argv`
  - `@caprail/transport-http`
  - `@caprail/cli-argv`
- `packages/products/cli-http/` exists only as empty `bin/`, `src/`, and `test/` directories.
- Root workspaces currently include `packages/products/cli-argv` but not `packages/products/cli-http`.
- `@caprail/transport-http` already provides the core runtime the product should reuse:
  - `createHttpTransportServer(options)`
  - `startHttpTransportServer(options)`
- `SPEC.md` and the use-case docs position `caprail-cli-http` as the deployable sidecar/host-wrapper product with:
  - explicit config path
  - explicit auth choice (`--token` or `--no-auth`)
  - `/exec`, `/discover`, `/health`
  - transport-enforced timeout and output caps

## Scope

### In scope

- workspace + package scaffolding for `packages/products/cli-http`
- package metadata and dependency wiring
- product-level CLI flag parser for server startup
- composition code that binds `@caprail/guard-cli` to `@caprail/transport-http`
- executable boundary in `bin/caprail-cli-http.js`
- product-level tests (parser, startup, bin, end-to-end smoke)
- product docs (`README.md`, package-local docs)

### Out of scope

- changes to guard policy/config/matching semantics
- changes to HTTP route contracts, auth behavior, timeout behavior, or output-cap behavior already owned by `@caprail/transport-http`
- TLS, rate limiting, request queueing, streaming output, or multi-tenant concerns
- MCP product work
- release automation beyond packability checks

## Architecture Decisions

- **Keep the product thin.**
  - Product code should parse startup flags, call the transport, and surface startup errors.
  - It must not reimplement auth checks, `/exec` mapping, or output/timeout logic already covered by `@caprail/transport-http`.

- **Expose a server-oriented product API.**
  - Prefer a programmatic API like `startCliHttpProduct(...)` over a one-shot `run...` name, because this package starts a long-lived server.
  - The API should resolve once the server is listening and return the server instance plus normalized startup metadata.

- **Treat auth choice as a required startup decision.**
  - The product parser should enforce `--token <secret>` xor `--no-auth` before calling the transport.
  - This keeps operator mistakes visible at the product boundary instead of relying only on transport-level validation.

- **Prefer explicit config for the HTTP product.**
  - Although the guard supports environment/default-path lookup, the HTTP wrapper is meant to run with a fixed config path.
  - The product should require `--config <path>` so sidecar/host-wrapper deployments do not accidentally drift into implicit lookup behavior.

- **Make bind-host behavior explicit early.**
  - The transport library defaults to `127.0.0.1`, but the documented sidecar/host-wrapper use cases require network reachability from another container or host context.
  - Recommended product behavior: support `--host` and default it to `0.0.0.0`, while keeping docs focused on private-network deployment plus token/firewall controls.

- **Do not duplicate transport coverage in product tests.**
  - Product tests should prove wiring, parser behavior, startup UX, and one or two real end-to-end flows.
  - Route/status/auth edge-case exhaustiveness should stay concentrated in `packages/transports/http/test/`.

## Proposed Product Contract

Suggested public API:

```js
import { startCliHttpProduct } from '@caprail/cli-http';

const started = await startCliHttpProduct({
  argv: [
    '--config', '/etc/caprail-cli/config.yaml',
    '--port', '8100',
    '--token', 'secret',
  ],
  stdout: process.stdout,
  stderr: process.stderr,
  env: process.env,
});

console.log(started.address.port);
```

Suggested result shape:

```js
{
  ok: true,
  server,
  address: { host, port },
  options: {
    configPath,
    host,
    port,
    timeoutMs,
    maxOutputBytes,
    auth,
  }
}
```

Suggested product-owned CLI flags:

- `--config <path>`
- `--port <number>`
- `--host <host>`
- `--token <secret>`
- `--no-auth`
- `--timeout-ms <number>`
- `--max-output-bytes <number>`

Validation expectations:

- reject unknown flags
- reject missing flag values
- reject `--token` combined with `--no-auth`
- reject invalid numeric values
- allow `--port 0` for tests/ephemeral local runs

## Dependency Graph

```text
workspace + package scaffold
                ↓
        product CLI parser
                ↓
      main/start composition API
                ↓
          bin entrypoint
                ↓
 product-level end-to-end startup tests
                ↓
          docs + packability
```

## Task List

### Phase 1: Product Foundation

## Task 1: Scaffold `packages/products/cli-http` and wire workspaces

**Description:**
Create the product package structure and register it at the repo root so `@caprail/cli-http` is independently installable, testable, and packable.

**Acceptance criteria:**
- [ ] Root workspaces include `packages/products/cli-http`.
- [ ] `packages/products/cli-http/package.json` exists with name `@caprail/cli-http`.
- [ ] Package declares runtime dependencies on `@caprail/guard-cli` and `@caprail/transport-http`.
- [ ] Package includes `README.md`, `docs/`, `src/`, `bin/`, and `test/`.
- [ ] Public entrypoint resolves through `src/index.js`.

**Verification:**
- [ ] `npm install`
- [ ] `node --test packages/products/cli-http/test/smoke.test.js`
- [ ] `npm pack --workspace @caprail/cli-http --dry-run`

**Dependencies:** None

**Files likely touched:**
- `package.json`
- `packages/products/cli-http/package.json`
- `packages/products/cli-http/src/index.js`
- `packages/products/cli-http/test/smoke.test.js`
- `packages/products/cli-http/README.md`

**Estimated scope:** Small/Medium

## Task 2: Implement product CLI parsing and startup-option validation

**Description:**
Add a product-owned parser that translates process argv into normalized transport startup options. This is the main new responsibility that does not already exist in guard or transport packages.

**Acceptance criteria:**
- [ ] Parser supports `--config`, `--port`, `--host`, `--token`, `--no-auth`, `--timeout-ms`, and `--max-output-bytes`.
- [ ] `--config` is required.
- [ ] Exactly one auth mode is accepted: `--token <secret>` or `--no-auth`.
- [ ] `--port`, `--timeout-ms`, and `--max-output-bytes` validate as non-negative integers.
- [ ] `--port 0` is accepted.
- [ ] Parser returns machine-readable errors suitable for stderr rendering and tests.

**Verification:**
- [ ] `node --test packages/products/cli-http/test/parser.test.js`
- [ ] Manual matrix check covers:
  - `--config cfg --port 8100 --token secret`
  - `--config cfg --port 8100 --no-auth`
  - missing `--config`
  - conflicting `--token` + `--no-auth`
  - invalid numeric values

**Dependencies:** Task 1

**Files likely touched:**
- `packages/products/cli-http/src/parser.js`
- `packages/products/cli-http/src/index.js`
- `packages/products/cli-http/test/parser.test.js`

**Estimated scope:** Small

### Checkpoint: Foundation
- [ ] Product package resolves and packs
- [ ] CLI grammar is explicit and test-covered
- [ ] Config/auth/bind/startup choices are validated before transport startup

---

### Phase 2: Product Composition and Runtime

## Task 3: Implement `src/main.js` composition around `guard-cli` + `transport-http`

**Description:**
Add the testable product runtime that parses argv, calls `startHttpTransportServer`, and returns the started server plus normalized startup metadata. This file should stay wiring-only.

**Acceptance criteria:**
- [ ] Product imports only public package entrypoints from `@caprail/guard-cli` and `@caprail/transport-http`.
- [ ] Parsed product options map cleanly to transport options.
- [ ] Successful startup returns `{ ok: true, server, address, options }` or equivalent structured data.
- [ ] Startup failures return/throw clear product-level errors without partially swallowing transport diagnostics.
- [ ] No HTTP route logic, auth logic, or policy logic is duplicated here.

**Verification:**
- [ ] `node --test packages/products/cli-http/test/main.test.js --test-name-pattern "composition|forwarding|startup"`
- [ ] Manual check: starting with `--config <fixture> --port 0 --no-auth` returns a live server and a real bound port

**Dependencies:** Task 2

**Files likely touched:**
- `packages/products/cli-http/src/main.js`
- `packages/products/cli-http/src/index.js`
- `packages/products/cli-http/test/main.test.js`

**Estimated scope:** Small/Medium

## Task 4: Add executable boundary in `bin/caprail-cli-http.js`

**Description:**
Implement the runnable bin script with shebang, startup logging, fatal-error handling, and clean delegation to `src/main.js`. On successful startup, the process should remain alive because the server handle is open.

**Acceptance criteria:**
- [ ] `bin/caprail-cli-http.js` exists and is wired in `package.json` as `caprail-cli-http`.
- [ ] Bin passes `process.argv.slice(2)`, stdio, and env into the product runner.
- [ ] Successful startup prints a concise listening message with host/port.
- [ ] Startup failure writes a clear fatal error to stderr and exits non-zero.
- [ ] Bin does not reimplement option parsing or transport startup logic.

**Verification:**
- [ ] `node ./packages/products/cli-http/bin/caprail-cli-http.js --config <fixture> --port 0 --no-auth`
- [ ] `node --test packages/products/cli-http/test/bin.test.js`
- [ ] `npm pack --workspace @caprail/cli-http --dry-run`

**Dependencies:** Task 3

**Files likely touched:**
- `packages/products/cli-http/bin/caprail-cli-http.js`
- `packages/products/cli-http/package.json`
- `packages/products/cli-http/test/bin.test.js`

**Estimated scope:** Small

## Task 5: Add product-level end-to-end tests using the real transport and guard

**Description:**
Prove that the product package starts a real server and exposes the expected HTTP behavior when driven through its own public API or bin entrypoint. Keep this suite focused on product wiring rather than re-testing every transport branch.

**Acceptance criteria:**
- [ ] Integration tests start `@caprail/cli-http` through its public entrypoint and exercise `/health`, `/discover`, and one `/exec` request.
- [ ] Tests cover at least one startup failure path (for example missing auth choice or invalid config path).
- [ ] Tests use deterministic Node-based fixtures instead of external vendor CLIs.
- [ ] Tests confirm the product uses the real transport package rather than mocking away the core composition.
- [ ] Tests verify the listening address/port returned by the product API is usable.

**Verification:**
- [ ] `node --test packages/products/cli-http/test/integration.test.js`
- [ ] `node --test packages/products/cli-http/test/*.test.js`

**Dependencies:** Tasks 3, 4

**Files likely touched:**
- `packages/products/cli-http/test/integration.test.js`
- `packages/products/cli-http/test/fixtures/*`
- `packages/products/cli-http/test/main.test.js`
- `packages/products/cli-http/test/bin.test.js`

**Estimated scope:** Medium

### Checkpoint: Runtime Ready
- [ ] Product starts a real HTTP server through public APIs
- [ ] Bin startup UX works end-to-end
- [ ] CLI parsing and transport option mapping are proven
- [ ] Product remains thin and transport behavior is not duplicated

---

### Phase 3: Documentation and Packaging Readiness

## Task 6: Document `@caprail/cli-http` usage and operational boundary

**Description:**
Write package docs that explain what the product owns, how it composes guard + transport, how to start it in token/no-auth modes, and how it fits the documented sidecar and host-wrapper use cases.

**Acceptance criteria:**
- [ ] `README.md` includes install, quickstart, and startup examples.
- [ ] Docs clearly separate product responsibilities from `@caprail/transport-http` and `@caprail/guard-cli` responsibilities.
- [ ] Documentation explains explicit config placement guidance and references the sidecar/host-wrapper use cases.
- [ ] Docs mention `/discover`, `/exec`, and `/health` at a product level and link to transport docs for full contracts.
- [ ] Bind-host behavior is documented explicitly.

**Verification:**
- [ ] Manual review against `SPEC.md`, `docs/usecase-docker-sidecar.md`, and `docs/usecase-pi-container-host-wrapper.md`
- [ ] `npm pack --workspace @caprail/cli-http --dry-run`

**Dependencies:** Task 5

**Files likely touched:**
- `packages/products/cli-http/README.md`
- `packages/products/cli-http/docs/usage.md`
- `packages/products/cli-http/package.json`

**Estimated scope:** Small

## Task 7: Final consistency pass for publishability and repo alignment

**Description:**
Confirm the product is publishable, workspace metadata is correct, and naming/structure remain consistent with the rest of the Caprail package family.

**Acceptance criteria:**
- [ ] Full workspace tests still pass.
- [ ] `@caprail/cli-http` packs with the expected files.
- [ ] Binary naming and package metadata align with `SPEC.md` naming guidance.
- [ ] Any follow-up work beyond v1 product scope is captured separately rather than folded into this package.

**Verification:**
- [ ] `npm test --workspaces`
- [ ] `npm pack --workspace @caprail/cli-http --dry-run`

**Dependencies:** Tasks 1–6

**Files likely touched:**
- `package.json`
- `packages/products/cli-http/package.json`
- `plans/` (only if follow-up tracking is needed)

**Estimated scope:** Small

### Checkpoint: Complete
- [ ] `@caprail/cli-http` is independently testable and packable
- [ ] Product CLI grammar is documented and stable
- [ ] Sidecar/host-wrapper startup path works through the real composition
- [ ] Product package stays thin and aligned with Caprail family boundaries
- [ ] Ready for human review and implementation approval

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Product accidentally duplicates HTTP transport logic | High | Keep product tests focused on wiring/startup; import only transport public APIs |
| Bind host defaults conflict with real deployment needs | High | Decide host behavior up front, document it clearly, and test it explicitly |
| CLI parser grows ad hoc and becomes inconsistent with other products | Medium | Keep parser small, deterministic, and machine-testable; mirror `cli-argv` plan discipline |
| Product relies on implicit config discovery and becomes unsafe in wrapper deployments | High | Require `--config` in the product parser |
| Integration tests become flaky due to real network ports | Medium | Allow `--port 0`, capture actual bound port, and use localhost requests in tests |
| Product re-tests every transport branch, creating maintenance churn | Medium | Leave exhaustive protocol/auth edge cases in `transport-http` tests and keep product suite narrow |
| Success path logging becomes part of machine-oriented output unexpectedly | Low | Keep startup log concise and operational; reserve HTTP response JSON for the server endpoints themselves |

## Parallelization Opportunities

- After **Task 2**, docs drafting can begin in parallel with `src/main.js` implementation.
- After **Task 3**, bin work and end-to-end test fixture setup can proceed in parallel.
- Final README/docs polish can run in parallel with the repo consistency pass.

## Open Questions

- Should `--host` be part of the public CLI now, or should the product only change the default bind host internally? **Recommendation:** expose `--host` and document the default.
- Should the product API be named `startCliHttpProduct` or `runCliHttpProduct` for family consistency? **Recommendation:** `startCliHttpProduct` is clearer for a long-lived server.
- Should startup success be logged to stdout or stderr? **Recommendation:** stdout for normal operational output, stderr only for failures.
- Do we want graceful signal-handling (`SIGINT`/`SIGTERM`) in v1, or leave shutdown behavior to Node/process defaults? **Recommendation:** optional follow-up unless implementation is trivial.

## Recommendation

Approve this plan and implement `@caprail/cli-http` as a thin product layer on top of the already-built `@caprail/guard-cli` and `@caprail/transport-http`. The highest-value work is product-specific CLI parsing, startup ergonomics, and real composition tests — not more HTTP route logic.
