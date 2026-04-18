# Implementation Plan: `@caprail/cli` Product Package

## Overview

Implement `@caprail/cli` as the thin, publishable argv product that composes `@caprail/guard-cli` with `@caprail/transport-argv` and exposes the executable boundary (`bin`, `process.argv`, stdio, exit code). The package should contain almost no policy logic of its own: guard behavior stays in `guard-cli`, and argv parsing/dispatch stays in `transport-argv`.

This plan focuses only on the `@caprail/cli` product package (the local/argv product in the family model). HTTP/MCP transports and other products remain out of scope.

## Current Repo Snapshot

- `@caprail/guard-cli` exists and exports config, matcher, discovery, execution, and audit APIs.
- `@caprail/transport-argv` exists and exports:
  - `parseArgv(argv)`
  - `runArgvTransport({ argv, guard, ... })`
- `packages/products/` does not exist yet.
- Root `package.json` workspaces currently include only:
  - `packages/guards/cli`
  - `packages/transports/argv`
- Existing plans for guard/transport are already in `plans/`.

## Scope

### In scope

- Workspace + package scaffolding for `packages/products/cli`
- `@caprail/cli` package metadata and dependency wiring
- Product composition code that runs `runArgvTransport` with `@caprail/guard-cli`
- Bin entrypoint(s) that map transport result to `process.exitCode`
- Product-level tests (smoke + composition integration)
- Product docs (`README.md`, package-local docs)

### Out of scope

- Changes to guard matching/config semantics
- Changes to transport flag grammar or mode behavior
- `@caprail/cli-http` or HTTP server behavior
- New auth/timeout/output-limiting logic (not part of argv product)
- Publishing/release automation beyond package packability checks

## Architecture Decisions

- **Keep product code thin.** `@caprail/cli` should wire guard + transport, not reimplement parser/matcher/validation/execution behavior.
- **Treat the bin as the runtime boundary.** `bin/caprail-cli.js` handles `process.argv`, stdio, env, platform, and `process.exitCode`; core logic remains in `src/main.js` for testability.
- **Return results from `main`, set exits in bin.** Product internals should return `{ exitCode, ... }`; only bin sets process exit state.
- **Ship `caprail-cli` only.** No compatibility aliases are needed — there is no prior product to migrate from.
- **No direct imports of guard internals.** Product should import from public package entrypoints only (`@caprail/guard-cli`, `@caprail/transport-argv`).

## Dependency Graph

```text
workspace + product package scaffold
                 ↓
        src/main composition API
                 ↓
            bin entrypoint(s)
                 ↓
   composition + subprocess integration tests
                 ↓
          package docs and examples
```

## Task List

### Phase 1: Product Foundation

## Task 1: Scaffold `packages/products/cli` and wire workspaces

**Description:**  
Create the product package structure and register it in root workspaces. Establish independent package metadata and scripts so `@caprail/cli` can be installed, tested, and packed on its own.

**Acceptance criteria:**
- [ ] Root workspaces include `packages/products/cli`.
- [ ] `packages/products/cli/package.json` exists with `name: "@caprail/cli"`.
- [ ] Package declares runtime dependencies on `@caprail/guard-cli` and `@caprail/transport-argv`.
- [ ] Product package has `README.md`, `docs/`, `src/`, `bin/`, and `test/` directories.
- [ ] A smoke test verifies public entrypoint resolution.

**Verification:**
- [ ] `npm install`
- [ ] `node --test packages/products/cli/test/smoke.test.js`
- [ ] `npm pack --workspace @caprail/cli --dry-run`

**Dependencies:** None

**Files likely touched:**
- `package.json`
- `packages/products/cli/package.json`
- `packages/products/cli/src/index.js`
- `packages/products/cli/test/smoke.test.js`
- `packages/products/cli/README.md`

**Estimated scope:** Medium

## Task 2: Implement product composition in `src/main.js`

**Description:**  
Add the product runtime function that calls `runArgvTransport` with the real guard package and injected runtime dependencies. Keep the function test-friendly by accepting optional `argv`, streams, and platform/env overrides.

**Acceptance criteria:**
- [ ] `src/main.js` exports an async runner (for example `runCliProduct(options)`).
- [ ] Runner passes `argv` tokens to `runArgvTransport` unchanged.
- [ ] Runner injects `guard: guardCli` from `@caprail/guard-cli`.
- [ ] Runner forwards streams/env/platform/homeDirectory without side effects.
- [ ] Runner returns the transport result object without mutating transport semantics.

**Verification:**
- [ ] `node --test packages/products/cli/test/main.test.js --test-name-pattern "composition|forwarding"`
- [ ] Manual dry run with mocked streams confirms no direct process termination in `src/main.js`

**Dependencies:** Task 1

**Files likely touched:**
- `packages/products/cli/src/main.js`
- `packages/products/cli/src/index.js`
- `packages/products/cli/test/main.test.js`

**Estimated scope:** Small

### Checkpoint: Foundation
- [ ] Product workspace resolves and packs
- [ ] Composition runner exists and is independently testable
- [ ] Product remains thin (no duplicated parser/matcher logic)

---

### Phase 2: Executable and Behavior Verification

## Task 3: Add executable entrypoint(s) in `bin/`

**Description:**  
Implement the runnable bin script(s) with shebang, call into `src/main.js`, write fatal errors to stderr, and set `process.exitCode` from returned transport exit codes.

**Acceptance criteria:**
- [ ] `bin/caprail-cli.js` exists with Node shebang and executable package wiring.
- [ ] Bin passes `process.argv.slice(2)`, stdio, env, and platform to product runner.
- [ ] Bin sets `process.exitCode` from returned `exitCode` (defaulting safely on malformed return).
- [ ] Unexpected uncaught errors are rendered to stderr and mapped to exit code `1`.

**Verification:**
- [ ] `node ./packages/products/cli/bin/caprail-cli.js --config <fixture> --validate --json`
- [ ] `npm pack --workspace @caprail/cli --dry-run` includes bin files as expected

**Dependencies:** Task 2

**Files likely touched:**
- `packages/products/cli/bin/caprail-cli.js`
- `packages/products/cli/package.json`
- `packages/products/cli/test/bin.test.js`

**Estimated scope:** Small

## Task 4: Add product-level integration tests using real guard+transport

**Description:**  
Create composition tests that execute product entrypoints against fixture config to verify real end-to-end behavior for `validate`, `list`, `explain`, allowed execution, and denied execution.

**Acceptance criteria:**
- [ ] Tests cover all four modes (`validate`, `list`, `explain`, `execute`) through product runner and/or bin subprocess.
- [ ] Allowed execution forwards stdout/stderr and vendor exit code.
- [ ] Denied execution returns exit code `126` and clear denial message.
- [ ] Tests use public package imports only, no source-internal coupling.
- [ ] Fixture commands are cross-platform and deterministic (prefer Node-based fixture binaries/scripts).

**Verification:**
- [ ] `node --test packages/products/cli/test/*.test.js`
- [ ] Manual check of denial output wording and exit behavior

**Dependencies:** Tasks 2, 3

**Files likely touched:**
- `packages/products/cli/test/main.test.js`
- `packages/products/cli/test/bin.test.js`
- `packages/products/cli/test/fixtures/*`

**Estimated scope:** Medium

### Checkpoint: Executable Ready
- [ ] Bin entrypoint works end-to-end
- [ ] Exit code mapping matches transport outcomes
- [ ] Product behavior proven with real guard + transport integration

---

### Phase 3: Documentation and Packaging Readiness

## Task 5: Document `@caprail/cli` usage and package boundary

**Description:**  
Write package docs that explain what the product owns, how it composes guard+transport, supported invocation forms, and compatibility naming guidance.

**Acceptance criteria:**
- [ ] `README.md` includes install, quickstart, and mode examples.
- [ ] Docs clearly describe layering: product wiring vs guard/transport responsibilities.
- [ ] Binary naming policy is explicit (`caprail-cli` only).
- [ ] Documentation points to guard and transport docs for deeper behavior details.

**Verification:**
- [ ] Manual review against `SPEC.md` command section and naming guidance
- [ ] `npm pack --workspace @caprail/cli --dry-run` includes docs

**Dependencies:** Tasks 3, 4

**Files likely touched:**
- `packages/products/cli/README.md`
- `packages/products/cli/docs/usage.md`
- `packages/products/cli/docs/compatibility.md` (optional)

**Estimated scope:** Small

## Task 6: Final product checklist and repo-level consistency pass

**Description:**  
Confirm the product is publishable and consistent with family naming/structure conventions. Capture any follow-up work needed for `@caprail/cli-http` or alias deprecation.

**Acceptance criteria:**
- [ ] Product package passes full test suite.
- [ ] Product package packs cleanly with expected files.
- [ ] Workspace references and package metadata are consistent.
- [ ] Any temporary compatibility choices are documented with next-step follow-up.

**Verification:**
- [ ] `npm test --workspaces`
- [ ] `npm pack --workspace @caprail/cli --dry-run`

**Dependencies:** Tasks 1–5

**Files likely touched:**
- `packages/products/cli/package.json`
- `package.json`
- `plans/` (follow-up tracking if needed)

**Estimated scope:** Small

### Checkpoint: Complete
- [ ] `@caprail/cli` is independently testable and packable
- [ ] Bin/runtime behavior is stable and documented
- [ ] Product remains a thin composition layer
- [ ] Ready for human review and implementation approval

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Product duplicates guard/transport logic and drifts over time | High | Keep `src/main.js` as wiring-only; enforce behavior through integration tests using real dependencies |
| Exit code handling diverges between runner and bin | Medium | Centralize exit mapping in transport; bin only assigns returned `exitCode` |
| Cross-platform bin behavior (Windows + shebang) is inconsistent | Medium | Validate through Node invocation in tests and npm pack checks; keep script simple |
| Naming confusion between product and package names | Low | Document canonical binary name explicitly |
| Fixture commands rely on external CLIs not available in CI | Medium | Use Node-based local fixture script/binary for deterministic tests |

## Parallelization Opportunities

- After **Task 2**, one stream can build bin wiring while another drafts README/docs.
- After **Task 3**, integration test authoring and docs polishing can proceed in parallel.
- Workspace scaffolding should remain sequential before parallel work starts.

## Open Questions

- Do we want root-level convenience scripts (e.g., `npm run test:cli-product`) or keep tests package-local only? package-local only

## Recommendation

Approve this plan and implement `@caprail/cli` as a thin composition package now that guard and argv transport foundations are in place. Keep business logic in existing packages, keep the bin small and robust, and verify behavior with real end-to-end product tests built on deterministic fixtures.