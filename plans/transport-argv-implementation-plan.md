# Implementation Plan: `@caprail/transport-argv`

## Overview

Implement `@caprail/transport-argv` as the process-argv transport for guards that expose a **command-token execution model**, with `@caprail/guard-cli` as the first consumer. Per `SPEC.md` and the guard README, this package should own CLI parsing, mode dispatch, text/JSON rendering, and process exit-code mapping, while leaving config loading rules, policy evaluation, guarded execution, and audit behavior inside `@caprail/guard-cli`.

This keeps the repo aligned with the family architecture established across the spec, the ADR, and the future `host-files-http` / `host-ui-http` explorations: **guards define capability policy; transports adapt invocation shape**. It also makes the transport scope explicit: this argv transport is not assumed to be the default local transport for every future guard. Guards such as `@caprail/guard-files` should only use it if they intentionally adopt the same command-token invocation model; otherwise they should use a more suitable transport or product shape.

## Current Repo Snapshot

- `@caprail/guard-cli` already exists and exports the public APIs the transport needs:
  - `loadAndValidateConfig`
  - `buildListPayload`
  - `buildExplainPayload`
  - `executeGuardedCommand`
- `packages/transports/argv/` does not exist yet.
- Root `package.json` currently only includes the guard workspace.
- `examples/guards/cli.policy.yaml` already provides a useful fixture for transport-level integration tests.
- The guard README explicitly says these concerns belong outside the guard:
  - CLI flag parsing for `process.argv`
  - process-to-exit-code mapping
- The broader repo docs do **not** imply that every future guard should expose an argv-local product. The current likely consumer is `@caprail/guard-cli`; future guards such as `guard-files` and `guard-ui` may remain HTTP-first unless they deliberately adopt a command-token CLI surface.

## Scope

### In scope

- `packages/transports/argv/...`
- root workspace update to include the new transport package
- argv parser for command-token guard products
- transport runner/dispatcher
- text and JSON rendering for `--validate`, `--list`, and `--explain`
- exit-code mapping for execution vs denial vs transport/config failure
- transport package tests
- transport package docs

### Out of scope

- `@caprail/cli-argv` product package and executable bin
- HTTP/MCP transports
- auth, timeout, or output-capture policy
- new guard behavior or matcher changes
- a universal cross-guard invocation abstraction for non-command-token guards such as `@caprail/guard-files`
- help/version UX unless explicitly approved later

## Architecture Decisions

- **Keep the transport thin.** Do not duplicate config validation, matcher logic, or audit behavior from the guard.
- **Scope the transport to command-token guards.** `@caprail/transport-argv` is intended for guards whose core operation is “select a tool/command and pass argv tokens through.” `@caprail/guard-cli` is the first consumer; other guards should only use this transport if that model genuinely fits.
- **Inject the guard contract.** The transport should consume a small public guard interface rather than importing guard internals. This preserves the guard/transport/product layering from the spec.
- **Return results; do not call `process.exit()` directly.** The transport library should return `{ exitCode }` and write to provided streams. The future product package can set `process.exitCode`.
- **Preserve token boundaries exactly.** Execution and explain modes require a `--` separator. Everything after that separator is passed through unchanged as command-token input. No shell parsing, no whitespace splitting, no re-joining.
- **Execution mode streams; read-only modes format.** `--validate`, `--list`, and `--explain` can render buffered text/JSON. Normal execution should stream child stdout/stderr via guard callbacks.
- **Fail closed on parser ambiguity.** Invalid flag combinations, missing required values, a missing required `--` separator in execution/explain modes, or malformed mode usage should produce structured transport errors and exit non-zero.
- **Keep compatibility surface where the spec requires it.** `--config` remains the transport-facing way to pass config, but the underlying resolution rules still live in `@caprail/guard-cli`.

## Proposed Transport Contract

The transport should target a minimal **command-token guard** adapter like:

```js
{
  loadAndValidateConfig(options),
  buildListPayload(config, options),
  buildExplainPayload(config, toolName, args),
  executeGuardedCommand(config, toolName, args, options),
}
```

Primary transport exports:

- `parseArgv(argv)`
- `runArgvTransport({ argv, guard, stdout, stderr, env, platform, homeDirectory })`

This contract is intentionally shaped around a command-token execution model. It is a strong fit for `@caprail/guard-cli`, but it is not presented here as a universal contract for all future guards.

## Dependency Graph

```text
workspace/package scaffold
            ↓
   transport/guard contract
            ↓
        argv parser
            ↓
   mode dispatch + renderers
      ↙               ↘
validate/list/explain   execution mapping
      ↘               ↙
   contract-level integration tests
            ↓
          docs
```

## Task List

### Phase 1: Foundation

## Task 1: Scaffold the transport package and freeze the public transport boundary

**Description:**  
Create `packages/transports/argv` with the spec-aligned package structure and define the minimal public API for the transport. This task should establish that the transport is a reusable library adapter for command-token guards, not the runnable product binary, with `@caprail/guard-cli` as the first consumer.

**Acceptance criteria:**
- [ ] Root workspaces include `packages/transports/argv`.
- [ ] `packages/transports/argv/package.json` exists with the name `@caprail/transport-argv`.
- [ ] The package exports `parseArgv` and `runArgvTransport`.
- [ ] The transport API accepts an injected command-token guard contract and returns structured results instead of terminating the process directly.
- [ ] The package does not depend on guard internals such as `packages/guards/cli/src/*`.
- [ ] Package docs and code comments do not claim that all future guards automatically fit this transport.

**Verification:**
- [ ] Install succeeds: `npm install`
- [ ] Smoke test passes: `node --test packages/transports/argv/test/smoke.test.js`
- [ ] Package can be packed: `npm pack --workspace @caprail/transport-argv --dry-run`

**Dependencies:** None

**Files likely touched:**
- `package.json`
- `packages/transports/argv/package.json`
- `packages/transports/argv/src/index.js`
- `packages/transports/argv/src/parser.js`
- `packages/transports/argv/test/smoke.test.js`

**Estimated scope:** Medium

## Task 2: Implement argv parsing and mode validation

**Description:**  
Build `src/parser.js` to parse transport flags and select one of the supported modes: execution, explain, list, or validate. The parser should enforce a deterministic grammar by requiring a `--` separator before command-token input in execution and explain modes, so tool arguments are never mistaken for transport flags.

**Acceptance criteria:**
- [ ] Parser supports `--config`, `--explain`, `--list`, `--validate`, and `--json`.
- [ ] Invalid combinations such as `--list --validate` or missing `--config` values return stable parser errors.
- [ ] Execution and explain modes require a `--` separator before command-token input.
- [ ] All transport flags must appear before the `--` separator, and all tokens after it are preserved exactly.
- [ ] List mode supports the spec shape `--list [tool]` and `--list [tool] --json`.
- [ ] Parser errors are machine-readable and suitable for transport-level stderr rendering.

**Verification:**
- [ ] Parser tests pass: `node --test packages/transports/argv/test/parser.test.js`
- [ ] Manual matrix check covers:
  - `--config path -- gh pr list`
  - `--config path --explain --json -- gh pr create`
  - `--config path --validate --json`
  - `--config path --list gh --json`

**Dependencies:** Task 1

**Files likely touched:**
- `packages/transports/argv/src/parser.js`
- `packages/transports/argv/test/parser.test.js`

**Estimated scope:** Small

### Checkpoint: Foundation
- [ ] Package exists and is packable
- [ ] Parser mode grammar is explicit and test-covered
- [ ] Tool args are preserved without shell-style parsing
- [ ] Guard/transport boundary is frozen before dispatch logic grows

---

### Phase 2: Core Transport Behavior

## Task 3: Implement validate, list, and explain dispatch with text/JSON renderers

**Description:**  
Add the read-only transport flows that load config through the injected guard, render spec-aligned outputs, and map failures to process-style exit codes. This establishes all non-execution behavior before child-process streaming is added.

**Acceptance criteria:**
- [ ] `--validate` calls `loadAndValidateConfig` and returns exit `0` for valid configs, `1` for invalid configs.
- [ ] `--validate --json` emits the structured validation report from the guard.
- [ ] `--list` and `--list --json` render tool permissions without re-deriving policy from raw config.
- [ ] `--explain` and `--explain --json` render the guard’s explain payload in transport-owned text/JSON formats.
- [ ] Unknown tools, missing config, and invalid config produce clear stderr output and non-zero exits without attempting execution.

**Verification:**
- [ ] Dispatch tests pass: `node --test packages/transports/argv/test/index.test.js --test-name-pattern "validate|list|explain"`
- [ ] Manual check confirms explain text matches the spec’s field ordering and wording closely enough for docs/examples

**Dependencies:** Tasks 1, 2

**Files likely touched:**
- `packages/transports/argv/src/index.js`
- `packages/transports/argv/test/index.test.js`
- `packages/transports/argv/test/fixtures/mock-guard.js`

**Estimated scope:** Medium

## Task 4: Implement execution-mode dispatch and exit-code mapping

**Description:**  
Add the normal execution path for argv transport. This path should delegate allowed execution to the guard, stream stdout/stderr through the provided callbacks, and translate guard outcomes into product-friendly exit codes.

**Acceptance criteria:**
- [ ] Execution mode calls `executeGuardedCommand(config, toolName, args, ...)` with the raw tokens after the required `--` separator, split as `<tool>` plus remaining args without further parsing.
- [ ] Allowed commands stream stdout/stderr and return the vendor CLI exit code.
- [ ] Policy denials print a clear stderr message and return exit code `126`.
- [ ] Transport/config/audit/spawn failures return exit code `1`.
- [ ] The transport adds no shelling, buffering, timeout, or auth logic.

**Verification:**
- [ ] Execution tests pass: `node --test packages/transports/argv/test/index.test.js --test-name-pattern "execute|deny|exit"`
- [ ] Manual check covers:
  - allowed command exits `0`
  - allowed command exits non-zero and transport forwards that code
  - denied command exits `126`
  - unknown tool exits non-zero without child execution

**Dependencies:** Tasks 1, 2

**Files likely touched:**
- `packages/transports/argv/src/index.js`
- `packages/transports/argv/test/index.test.js`
- `packages/transports/argv/test/fixtures/mock-guard.js`

**Estimated scope:** Medium

### Checkpoint: Core Transport Behavior
- [ ] All four modes work through one runner
- [ ] Read-only modes render correctly in text and JSON
- [ ] Execution mode streams rather than buffers
- [ ] Denial and operational failures are mapped to distinct exits
- [ ] Transport still contains no duplicated policy logic

---

### Phase 3: Confidence and Handoff

## Task 5: Add contract-level integration tests against the real guard package

**Description:**  
Prove that the transport’s injected command-token guard contract is sufficient by running the transport against the real `@caprail/guard-cli` public entrypoint and the committed example policy. This gives confidence before the future `@caprail/cli-argv` product package is added and confirms `guard-cli` as the first concrete consumer of the transport.

**Acceptance criteria:**
- [ ] At least one integration test uses the real `@caprail/guard-cli` import, not a mock.
- [ ] Integration coverage includes `--validate`, `--list`, `--explain`, one allowed execution path, and one denied execution path.
- [ ] Tests use only the guard public API, not source-internal imports.
- [ ] The transport remains usable as a library without embedding product/bin concerns.

**Verification:**
- [ ] Full transport test suite passes: `node --test packages/transports/argv/test/*.test.js`
- [ ] Manual review confirms imports come from `@caprail/guard-cli` only

**Dependencies:** Tasks 3, 4

**Files likely touched:**
- `packages/transports/argv/test/integration.test.js`
- `packages/transports/argv/test/fixtures/*` (if needed)

**Estimated scope:** Small

## Task 6: Write package docs and the argv transport contract

**Description:**  
Document the package’s role, API, flag grammar, output semantics, and handoff to the future `@caprail/cli-argv` product. This is where the transport’s ambiguous areas get made explicit so the eventual product stays thin.

**Acceptance criteria:**
- [ ] `README.md` explains the transport boundary, supported modes, and how it composes with `@caprail/guard-cli`.
- [ ] `docs/contract.md` documents parser grammar, flag ordering rules, output shapes, and exit-code mapping.
- [ ] Docs clearly state that the executable belongs in `@caprail/cli-argv`, not in the transport package itself.
- [ ] Documentation uses Caprail naming consistently.

**Verification:**
- [ ] Package dry-run succeeds: `npm pack --workspace @caprail/transport-argv --dry-run`
- [ ] Manual review against `SPEC.md` and `packages/guards/cli/README.md`

**Dependencies:** Tasks 2, 3, 4, 5

**Files likely touched:**
- `packages/transports/argv/README.md`
- `packages/transports/argv/docs/contract.md`
- `packages/transports/argv/package.json`

**Estimated scope:** Small

### Checkpoint: Complete
- [ ] Transport package is independently testable and packable
- [ ] Parser and runner behavior are documented
- [ ] The real guard package can drive the transport through its public contract
- [ ] The repo is ready for the thin `@caprail/cli-argv` product package
- [ ] Human review approves the transport contract before product work begins

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Parser grammar around transport flags vs command tokens is underspecified | High | Require `--` as the execution/explain separator, document that all transport flags must appear before it, and test the boundary explicitly |
| Transport grows guard-like logic | High | Use injected guard contract only; add integration tests against the public guard entrypoint |
| Transport is treated as universal across all future guards | Medium | State explicitly that it targets command-token guards, keep `guard-cli` as the first consumer, and avoid forcing `guard-files`/`guard-ui` into this contract |
| Library code becomes hard to test because it touches `process` directly | High | Return structured results and inject stdout/stderr/env instead of calling `process.exit()` |
| Text output drifts from spec examples | Medium | Add renderer tests with expected output snapshots/fixtures |
| Product responsibilities leak into transport | Medium | Keep bin/help/version work out of scope and hand off to `@caprail/cli-argv` |
| Workspace/package wiring churns again during product work | Low | Align package structure with spec now: `packages/transports/argv/...` |

## Parallelization Opportunities

- After **Task 2**, docs drafting for `docs/contract.md` can begin in parallel with implementation of the dispatcher.
- After **Task 4**, **Task 5** integration tests and **Task 6** docs can proceed in parallel.
- Parser work should stay sequential before dispatch/execution work; it defines the mode grammar for everything else.

## Open Questions

- Should `--help` and `--version` live in `@caprail/transport-argv`, or only in the future `@caprail/cli-argv` product package? in the future cli
- For explain mode, do we explicitly require transport flags like `--json` to appear before the tool boundary, or do we want broader flag-order flexibility? require them before the mandatory `--` separator
- When adding the transport package, should root workspaces move to grouped globs (`packages/guards/*`, `packages/transports/*`) or just add the direct path for now? direct path for now
- Do we want to eventually define a broader cross-guard transport contract such as `invoke(operation, params)`, or should non-command-token guards continue to adopt transport shapes independently? we should work on a cross-guard contract

## Recommendation

Approve this plan, then implement `@caprail/transport-argv` before `@caprail/cli-argv`. Treat it as the argv transport for command-token guards, with `@caprail/guard-cli` as the first consumer, rather than as a universal local transport for every future Caprail guard. Use a mandatory `--` separator for execution and explain modes so parser behavior stays deterministic. Once the transport contract is stable, the product package should be very thin: import guard + transport, pass `process.argv.slice(2)`, wire stdio, and add composition tests.
