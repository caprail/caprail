# ADR-001: Adopt Caprail as the product family name

## Status
Accepted

## Date
2026-04-18

## Context
This repo started with `cliguard` as a working name for the first CLI-focused guard product. That name was too narrow for the broader architecture now described in `SPEC.md`:

- multiple **guard** packages (`guard-cli`, `guard-files`, `guard-ui`, ...)
- multiple **transport** packages (`transport-argv`, `transport-http`, `transport-mcp`, ...)
- thin composed **product** packages (`cli`, `cli-http`, `files-http`, ...)
- all packages published independently to npm as part of one discoverable family

The family name needs to work as:

- an npm scope
- a binary prefix
- a product-family brand
- a neutral umbrella for both host-local and sidecar-local capabilities

It also needs to compose cleanly with plain, self-evident package names. The project explicitly prefers obvious names like `guard-cli` and `transport-http` over more clever subpackage names.

## Decision
Adopt **`caprail`** as the family name.

Use the following naming convention:

- npm scope: `@caprail/...`
- guard packages: `@caprail/guard-<capability>`
- transport packages: `@caprail/transport-<transport>`
- composed product packages: `@caprail/<capability>-<transport>`
- local/argv binaries: `caprail-<capability>`
- other binaries: `caprail-<capability>-<transport>`

Examples:

- `@caprail/guard-cli`
- `@caprail/guard-files`
- `@caprail/transport-http`
- `@caprail/transport-mcp`
- `@caprail/cli-argv`
- `@caprail/cli-http`
- `@caprail/files-http`

The working name `cliguard` has been fully retired. All code, config paths, and documentation now use Caprail naming exclusively.

## Availability checks at decision time
Initial naming checks performed on 2026-04-18 found no conflicting public presence in the places most important to this project:

- no published npm packages were found for `@caprail/cli-argv` or `@caprail/guard-cli` via registry lookups
- no `caprail` GitHub user or organization was found (`https://github.com/caprail` and `https://github.com/orgs/caprail` both returned `404`)

Operational note: npm scope ownership still must be claimed before first publish, and final trademark/domain checks should still be completed before public launch.

## Alternatives considered

### Keep `cliguard`
- Pros: already present in the repo and easy to understand for the initial CLI use case
- Cons: too tied to one product; awkward once the family expands to files, UI, and other capabilities
- Rejected: does not scale to the intended guard/transport/product architecture

### Use a more host-specific family name
Examples considered in discussion included names closer to host access control.

- Pros: emphasizes the host-wrapper use case
- Cons: too narrow for sidecar-only deployments and less suitable for non-host-centered packaging
- Rejected: overfits one deployment model

### Use a more security-heavy family name
Examples considered in discussion included names emphasizing gates, security, or enforcement.

- Pros: sounds strong and direct
- Cons: risks overstating the security boundary when the project is intentionally a policy layer within a broader isolation model
- Rejected: the product should not imply stronger guarantees than it provides

## Consequences
- The workspace structure can cleanly separate `guards/`, `transports/`, and `products/` while keeping package names obvious.
- Future additions such as `@caprail/transport-mcp` and `@caprail/guard-files` feel like natural extensions of the same family.
- Documentation, examples, and publication use `caprail` naming exclusively.
