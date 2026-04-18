# Compatibility notes

## Command naming

`@caprail/cli` publishes `caprail-cli` as the only binary name.

## Config resolution

Config is resolved via `CAPRAIL_CLI_CONFIG` environment variable and platform-standard `caprail-cli/config.yaml` default paths. See `@caprail/guard-cli` docs for full resolution order.
