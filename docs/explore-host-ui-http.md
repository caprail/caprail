# Exploration: host-ui-http

## Purpose

`host-ui-http` is a possible future member of the host capability guard family. It would expose **declarative automation for one known desktop app** running on the host, along with bounded screenshot capture.

This is for cases where the useful capability is inherently host-local, such as:
- a legacy WPF thick client
- a desktop tool with no useful CLI or API
- a host app that must run in an interactive Windows session

It is **not** meant to be generic desktop control.

## Core idea

Use a **declarative API for one known app**, not arbitrary automation scripts and not open-ended mouse/keyboard control.

Good:
```json
{
  "app": "legacy-wpf-client",
  "action": "click",
  "target": {
    "automation_id": "SearchButton"
  }
}
```

Also good:
```json
{
  "app": "legacy-wpf-client",
  "action": "screenshot",
  "scope": "main_window"
}
```

Not good:
- "run this automation script"
- "click at screen x/y anywhere"
- "control whichever window currently has focus"
- unrestricted keyboard/mouse macros

## Why this should be separate from the CLI guard

The CLI guard (`@caprail/guard-cli`) is for tokenized CLI execution. Desktop UI automation needs a different model:
- attach to one known process/window
- target controls by automation identity
- verify window ownership/focus
- capture bounded screenshots
- defend against accidental control of the wrong app

That makes `host-ui-http` a separate member, not a CLI guard mode.

## Design shape

```text
agent/container -> host-ui-http -> one known host desktop app
```

The backing implementation would likely use Windows UI Automation directly or a wrapper such as FlaUI / WinAppDriver-class tooling.

## Proposed scope

### In scope
- attach to or launch one allowlisted app
- verify the app/window identity
- capture screenshots of the allowlisted window
- perform a small allowlisted set of actions against known controls
- wait for known windows/controls/states
- discover available actions and targets

### Out of scope
- generic desktop control
- arbitrary scripts
- multi-app workflows in v1
- unrestricted coordinate-based clicking
- unrestricted key injection
- background-service-only execution without an interactive session

## Config sketch

```yaml
apps:
  legacy_wpf_client:
    description: "Legacy WPF client"
    executable: C:\Program Files\Vendor\LegacyApp\LegacyApp.exe
    process_name: LegacyApp
    main_window:
      title_regex: "^Legacy App"
    allow_actions:
      - screenshot
      - click
      - type
      - wait_for
    controls:
      SearchTextBox:
        automation_id: SearchTextBox
      SearchButton:
        automation_id: SearchButton
      ResultsGrid:
        automation_id: ResultsGrid

settings:
  audit_log: C:\ProgramData\host-ui-http\audit.log
  audit_format: jsonl
  screenshot_max_bytes: 1048576
  action_timeout_ms: 15000
```

## API sketch

### `GET /discover`
Return the allowlisted app, controls, and actions.

```json
{
  "apps": {
    "legacy_wpf_client": {
      "description": "Legacy WPF client",
      "allow_actions": ["screenshot", "click", "type", "wait_for"],
      "controls": ["SearchTextBox", "SearchButton", "ResultsGrid"]
    }
  },
  "limits": {
    "screenshot_max_bytes": 1048576,
    "action_timeout_ms": 15000
  }
}
```

### `POST /session/attach`
Attach to the configured app if it is already running.

```json
{
  "app": "legacy_wpf_client"
}
```

### `POST /session/launch`
Launch the configured app if allowed.

```json
{
  "app": "legacy_wpf_client"
}
```

### `POST /action`
Perform one declared action.

Click example:
```json
{
  "app": "legacy_wpf_client",
  "action": "click",
  "target": {
    "control": "SearchButton"
  }
}
```

Type example:
```json
{
  "app": "legacy_wpf_client",
  "action": "type",
  "target": {
    "control": "SearchTextBox"
  },
  "value": "invoice 1234"
}
```

Wait example:
```json
{
  "app": "legacy_wpf_client",
  "action": "wait_for",
  "target": {
    "control": "ResultsGrid"
  },
  "timeout_ms": 5000
}
```

### `POST /screenshot`
Capture the main window or another declared scope.

```json
{
  "app": "legacy_wpf_client",
  "scope": "main_window"
}
```

### `GET /health`
Basic health check.

## Security model

- one allowlisted app at a time
- process/window identity must match config before any action
- controls are addressed by configured names or automation IDs, not arbitrary coordinates
- screenshot scope is bounded to the app window or another declared scope
- action set is explicitly allowlisted per app
- audit logs are separate from returned screenshot/action data
- wrapper should run only in an interactive user session where UI automation is expected to work

## Deployment fit

This is generally a **host-wrapper** capability, not a sidecar one, because desktop UI automation usually depends on:
- the real host desktop session
- the host-installed app
- host graphics/session state

The outer architecture still matches the same pattern:

```text
agent/container -> thin authenticated wrapper -> narrow guarded capability
```

## Open questions

- which Windows automation stack is the best base: UIA directly, FlaUI, or WinAppDriver-style tooling?
- should screenshots be PNG only, or allow JPEG for smaller payloads?
- should `launch` be in scope for v1, or only `attach`?
- how should modal dialogs and transient popups be modeled declaratively?
- what is the minimum useful control metadata to expose in `/discover`?
