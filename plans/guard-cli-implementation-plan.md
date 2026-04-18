# Implementation Plan: `@caprail/guard-cli`

## Overview
Implement the first publishable core guard package described in `SPEC.md`: `@caprail/guard-cli`. This package should own config loading/validation, token-based policy evaluation, guarded execution, discovery payload generation, and audit logging, while staying transport-agnostic so it can later be composed into `transport-argv`, `transport-http`, and product packages.

Current repo state is still design-only. The repository contains the spec, one accepted ADR, and supporting use-case/exploration docs, but there is no `packages/` tree yet. The implementation therefore needs to start with workspace/package scaffolding before guard behavior can be added.

## Scope

### In scope
- Root/workspace changes required to host `@caprail/guard-cli`
- `packages/guards/cli/...`
- Guard-specific tests
- Guard package docs and example policy fixture
- Public guard contract for future transports/products

### Out of scope
- `@caprail/transport-argv`
- `@caprail/transport-http`
- Product packages such as `@caprail/cli` and `@caprail/cli-http`
- MCP transport work
- Future `files` / `ui` guards

## Current Repo Snapshot
- `SPEC.md` defines the target architecture, behavior, package layout, and success criteria.
- `docs/decisions/ADR-001-adopt-caprail-family-name.md` locks in the `caprail` family naming.
- `docs/usecase-docker-sidecar.md` and `docs/usecase-pi-container-host-wrapper.md` confirm why the guard must stay transport-agnostic and fail closed.
- Root `package.json` has no implementation packages yet.
- No implementation files, tests, examples, or package docs exist yet.

## Architecture Decisions
- **Use `caprail` naming from the start.** Place new code under `packages/guards/cli` as specified by ADR-001.
- **Keep the guard transport-agnostic.** The public API should accept plain tool/argv/config data and return structured results, not CLI flag parsing or HTTP request/response objects.
- **Isolate the security-critical matcher.** `src/matcher.js` should be the smallest possible unit containing normalization + allow/deny evaluation and should receive the strongest test coverage.
- **Fail closed everywhere.** Missing config, malformed config, unknown tool names, invalid policy entries, and audit sink setup failures must all block execution.
- **Stay dependency-light.** Use only Node built-ins plus `yaml`, matching the spec and keeping the package easy to audit.
- **Keep transport-specific status mapping out of the guard package.** The guard should return structured denial/allowance/execution results; product and transport layers can map those to exit code `126`, HTTP `403`, etc.

## Dependency Graph

```text
root workspace + package scaffold
                ↓
      config resolution + parsing
                ↓
 token normalization + policy matcher
                ↓
      validation diagnostics/reporting
           ↙                ↘
 discovery/list/explain   executor + audit logger
           ↘                ↙
            public package contract
                      ↓
         package docs + example policy
```

Implementation order should prove parsing and matching before any real process execution is added.

## Task List

### Phase 1: Foundation

## Task 1: Scaffold the workspace and guard package

**Description:**
Replace the legacy root workspace setup with a spec-aligned package boundary for `@caprail/guard-cli`, then create the minimal package skeleton needed to install, test, and pack the guard independently. This task establishes the long-term repo shape without yet implementing guard behavior.

**Acceptance criteria:**
- [ ] Root workspaces include `packages/guards/cli`.
- [ ] `packages/guards/cli/package.json` exists and uses the name `@caprail/guard-cli`.
- [ ] A minimal `src/index.js` and smoke test exist so the package can be resolved and tested.
- [ ] `yaml` is the only planned runtime dependency for the guard package.

**Verification:**
- [ ] Install succeeds: `npm install`
- [ ] Smoke test passes: `node --test packages/guards/cli/test/smoke.test.js`
- [ ] Package can be packed: `npm pack --workspace @caprail/guard-cli --dry-run`

**Dependencies:** None

**Files likely touched:**
- `package.json`
- `packages/guards/cli/package.json`
- `packages/guards/cli/src/index.js`
- `packages/guards/cli/test/smoke.test.js`
- `packages/guards/cli/README.md`

**Estimated scope:** Medium (5 files)

## Task 2: Implement config resolution and YAML parsing

**Description:**
Add `src/config.js` to resolve the policy path using the spec’s precedence rules, read YAML safely, and normalize the raw document into an internal config structure with fail-closed defaults. This task should stop short of advanced diagnostics, focusing first on predictable loading/parsing behavior.

**Acceptance criteria:**
- [ ] Config resolution follows `--config` -> `CAPRAIL_CLI_CONFIG` -> platform defaults, with no current-working-directory lookup.
- [ ] Missing optional lists (`allow`, `deny`, `deny_flags`) normalize to empty arrays.
- [ ] Missing/unreadable/malformed config produces structured errors with no partial allow behavior.
- [ ] Internal config objects preserve tool descriptions, binary paths, settings, and token-list inputs exactly enough for later matcher/validation work.

**Verification:**
- [ ] Parsing and resolution tests pass: `node --test packages/guards/cli/test/config.test.js --test-name-pattern "resolution|parse|schema"`
- [ ] Manual check: verify platform-default path logic on the current OS with temporary fixture paths

**Dependencies:** Task 1

**Files likely touched:**
- `packages/guards/cli/src/config.js`
- `packages/guards/cli/test/config.test.js`
- `packages/guards/cli/src/index.js`

**Estimated scope:** Small (3 files)

## Task 3: Implement token normalization and policy matching

**Description:**
Build `src/matcher.js` to normalize argv tokens and evaluate allow/deny rules exactly as described in the spec. The matcher should return a rich evaluation object that later supports explain mode, validation warnings, and execution gating.

**Acceptance criteria:**
- [ ] Normalization implements `--flag=value` splitting, case-sensitive matching, no short-flag expansion, and `deny_flags` stopping at `--`.
- [ ] Matching uses contiguous token subsequences and honors precedence `deny > deny_flags > allow > implicit deny`.
- [ ] Result objects include matched allow/deny entries, normalized args, allowed/denied outcome, and a machine-readable reason.
- [ ] The test matrix covers the security-critical branch cases called out in the spec.

**Verification:**
- [ ] Matcher tests pass: `node --test packages/guards/cli/test/matcher.test.js`
- [ ] Manual check: run evaluation fixtures for `gh pr list`, `gh pr create`, `gh --repo org/repo pr list`, and `--web` denial cases

**Dependencies:** Task 2

**Files likely touched:**
- `packages/guards/cli/src/matcher.js`
- `packages/guards/cli/test/matcher.test.js`
- `packages/guards/cli/src/index.js`

**Estimated scope:** Small (3 files)

### Checkpoint: Foundation
- [ ] `npm install` works with the new workspace/package layout
- [ ] Config parsing and matcher tests pass cleanly
- [ ] No new code is placed under incorrect workspace paths
- [ ] The repo is ready to add validation/execution without reworking the package boundary

### Phase 2: Core Guard Behavior

## Task 4: Add config diagnostics and validation reporting

**Description:**
Expand the config layer so it can produce the `valid/errors/warnings` report required by the spec’s validate mode and startup checks. This task should handle structural validation, binary existence warnings, audit sink writability, and suspicious policy warnings such as deny entries that appear unreachable.

**Acceptance criteria:**
- [ ] Validation results serialize to the spec-aligned `{ valid, errors, warnings }` shape.
- [ ] Startup-fatal errors are clearly separated from warnings.
- [ ] Binary-not-found is reported as a warning rather than a silent pass.
- [ ] Audit log configuration is checked without mixing audit output into command output.
- [ ] Likely-misconfigured deny entries are surfaced as warnings, not fatal errors.

**Verification:**
- [ ] Validation tests pass: `node --test packages/guards/cli/test/config.test.js --test-name-pattern "validate|warning|audit"`
- [ ] Manual check: run validation against one good fixture and one intentionally bad fixture

**Dependencies:** Tasks 2, 3

**Files likely touched:**
- `packages/guards/cli/src/config.js`
- `packages/guards/cli/test/config.test.js`
- `packages/guards/cli/src/index.js`

**Estimated scope:** Small (3 files)

## Task 5: Implement discovery, list, and explain payload builders

**Description:**
Create `src/discovery.js` and the supporting helpers that turn validated config + matcher results into transport-independent payloads for discovery/list/explain operations. These are the data contracts future argv and HTTP wrappers should consume rather than re-deriving behavior themselves.

**Acceptance criteria:**
- [ ] Discovery/list output includes tool descriptions, allow lists, deny lists, and deny flags without leaking internal-only details.
- [ ] Explain output matches the JSON fields in the spec and can also support later plain-text rendering.
- [ ] Unknown-tool and empty-config cases return stable, machine-readable errors.
- [ ] Discovery behavior does not depend on any transport concerns such as auth, ports, or HTTP status codes.

**Verification:**
- [ ] Discovery tests pass: `node --test packages/guards/cli/test/discovery.test.js`
- [ ] Manual check: serialize discovery output from a multi-tool fixture config

**Dependencies:** Tasks 2, 3

**Files likely touched:**
- `packages/guards/cli/src/discovery.js`
- `packages/guards/cli/test/discovery.test.js`
- `packages/guards/cli/src/index.js`

**Estimated scope:** Small (3 files)

## Task 6: Implement audit logging and guarded execution

**Description:**
Add `src/logger.js` and `src/executor.js` so the guard can safely execute allowed commands and record audit events for both allowed and denied attempts. Execution should remain non-interactive and shell-free, with guard results staying structured so later transports/products can map them to their own process/HTTP semantics.

**Acceptance criteria:**
- [ ] Execution uses `spawn` with `shell: false` and never shells out.
- [ ] Child processes run with stdin disabled and pager-suppression env vars set as described in the spec.
- [ ] Denied commands never spawn a child process and still emit an audit event when logging is enabled.
- [ ] Audit sinks support `none`, `text`, and `jsonl` modes, separate from command stdout/stderr.
- [ ] Execution results include enough metadata for callers to map policy denial vs allowed execution vs operational child failure.

**Verification:**
- [ ] Executor tests pass: `node --test packages/guards/cli/test/executor.test.js`
- [ ] Manual check: run a harmless fixture command and confirm audit output is separate from child stdout/stderr

**Dependencies:** Tasks 2, 3, 4

**Files likely touched:**
- `packages/guards/cli/src/executor.js`
- `packages/guards/cli/src/logger.js`
- `packages/guards/cli/test/executor.test.js`

**Estimated scope:** Medium (3 files, higher logic density)

### Checkpoint: Core Guard Behavior
- [ ] Validation returns structured errors/warnings for good and bad configs
- [ ] Discovery/list/explain payloads are stable and transport-agnostic
- [ ] Allowed commands execute non-interactively
- [ ] Denied commands do not spawn child processes
- [ ] Audit data never contaminates wrapped command stdout/stderr

### Phase 3: Package Contract and Handoff

## Task 7: Finalize the public package contract and publishability

**Description:**
Stabilize `src/index.js` so transports/products can consume the guard through one supported contract instead of reaching into internal modules. Tighten package metadata so the workspace is packable and clearly bounded for later npm publication.

**Acceptance criteria:**
- [ ] `src/index.js` exports the supported transport-agnostic API surface.
- [ ] Package metadata points consumers to the supported entrypoint and excludes accidental/internal-only packaging drift.
- [ ] Guard consumers can access config loading, validation, matching/evaluation, discovery helpers, and execution through the public contract.
- [ ] Package pack output is sane and contains only expected files.

**Verification:**
- [ ] Full guard test suite passes: `node --test packages/guards/cli/test/*.test.js`
- [ ] Package dry-run succeeds: `npm pack --workspace @caprail/guard-cli --dry-run`

**Dependencies:** Tasks 4, 5, 6

**Files likely touched:**
- `packages/guards/cli/src/index.js`
- `packages/guards/cli/package.json`
- `packages/guards/cli/test/smoke.test.js`

**Estimated scope:** Small (3 files)

## Task 8: Write package docs and example policy fixtures

**Description:**
Create the package-level documentation and example policy file described in the spec so future transport/product work has an explicit reference for config rules, policy semantics, and audit behavior. The example policy should also be usable by tests and manual verification.

**Acceptance criteria:**
- [ ] `README.md` explains package purpose, install/use expectations, and the transport boundary.
- [ ] `docs/config.md`, `docs/policy-model.md`, and `docs/audit.md` match implemented behavior and spec language.
- [ ] `examples/guards/cli.policy.yaml` is valid and aligned with the canonical examples in `SPEC.md`.
- [ ] Documentation uses `caprail` naming consistently.

**Verification:**
- [ ] Example-backed config tests pass against the committed example policy
- [ ] Manual review confirms docs/examples match `SPEC.md` and ADR-001 terminology

**Dependencies:** Tasks 4, 5, 6, 7

**Files likely touched:**
- `packages/guards/cli/README.md`
- `packages/guards/cli/docs/config.md`
- `packages/guards/cli/docs/policy-model.md`
- `packages/guards/cli/docs/audit.md`
- `examples/guards/cli.policy.yaml`

**Estimated scope:** Medium (5 files)

### Checkpoint: Complete
- [ ] All guard package tests pass
- [ ] `@caprail/guard-cli` packs successfully as an independent workspace package
- [ ] Docs and example config reflect implemented behavior
- [ ] The guard is ready for follow-on work in `transport-argv` and `transport-http`
- [ ] Human review approves the public guard contract before transport work starts

## Parallelization Opportunities
- After **Task 3**, **Task 5** (discovery/explain/list) and **Task 6** (executor/logger) can proceed in parallel because both depend on the matcher contract but are otherwise separate.
- After **Task 7**, **Task 8** can run in parallel with planning for `transport-argv`, because the public guard contract should already be frozen.
- Validation warning heuristics in **Task 4** should stay sequential with matcher work; they are too coupled to safely parallelize earlier.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Public API is too transport-specific too early | High | Freeze a transport-agnostic contract in Task 7 and keep CLI/HTTP parsing out of the guard package |
| Matcher semantics drift from the spec | High | Implement matcher in isolation, use an explicit fixture matrix, and review precedence/normalization rules before adding executor code |
| Cross-platform config-path and binary checks behave differently on Windows vs POSIX | Medium | Keep resolution/path logic centralized in `config.js` and add OS-specific test cases/fixtures |
| Audit logging accidentally pollutes wrapped command output | High | Test logger and executor together with fixture commands that write to stdout/stderr and assert complete separation |
| Validation warnings for unreachable deny entries become brittle | Medium | Keep them best-effort and non-fatal; document the heuristic rather than overstating certainty |
| Workspace layout mismatches naming convention | Medium | Make Task 1 establish correct workspace references first, before any package implementation spreads them further |
| Coverage enforcement for `matcher.js` is awkward with no extra dependencies | Medium | Decide early whether built-in Node coverage is sufficient or whether a later explicit approval is needed for a coverage helper |

## Recommendations for Follow-on Work
- Plan `@caprail/transport-argv` immediately after this package contract is approved; it is the thinnest path to an end-to-end runnable product.
- Keep `@caprail/transport-http` separate so timeout/output/auth concerns do not leak into the core guard package.
- Do not begin product binary work until the guard’s public API and example policy are reviewed; otherwise wrapper behavior will churn.

## Open Questions
- Should the root `package.json` declare the full future workspace glob set (`packages/guards/*`, `packages/transports/*`, `packages/products/*`, `packages/shared/*`) immediately, or only the guard path until more packages exist? It should only have what exists in the repo
- What is the preferred no-extra-dependency strategy for enforcing the spec’s “100% of matcher.js” coverage requirement on Node 18? there can be a dev dependency for that
- Should `validateConfig()` always treat missing binaries as warnings only, with products/transports deciding whether startup should fail on those warnings? yes

## Pre-Implementation Verification Checklist
- [ ] Every task has acceptance criteria
- [ ] Every task has an explicit verification step
- [ ] Dependencies are ordered correctly
- [ ] No task is larger than Medium
- [ ] Checkpoints exist between phases
- [ ] The human has reviewed and approved the plan
