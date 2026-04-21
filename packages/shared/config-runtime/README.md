# `@caprail/config-runtime`

Shared helpers for config lifecycle in long-lived Caprail runtimes.

## What it owns

- stable in-memory config runtime objects
- optional file-fingerprint-based reload behavior
- fail-closed caching for reload failures until the source changes again

## What it does not own

- parsing or validating any specific config format
- resolving default config paths
- transport-specific error-to-protocol mapping

Those remain in guard or transport packages.

## API

### `createConfigRuntime({ config, configPath })`

Create a simple runtime that always returns the same active config.

### `createReloadableConfigRuntime({ config, configPath, reloadConfig })`

Create a runtime that reloads when the file fingerprint changes.
`reloadConfig({ config, configPath })` must return either:

- `{ ok: true, config, configPath? }`
- `{ ok: false, error }`

On reload failure, the runtime returns a fail-closed error until the fingerprint changes again.
