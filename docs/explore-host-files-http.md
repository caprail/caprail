# Exploration: host-files-http

## Purpose

`host-files-http` is a possible future member of the host capability guard family. It would expose **read-only** access to specific host files and log folders to an agent running elsewhere, such as inside Docker.

This is meant for cases where the useful data lives on the host:
- application log folders
- IIS logs
- desktop-app log output
- diagnostic dumps or exported reports

It is **not** a general filesystem server.

## Why this should be separate from cliguard

`cliguard` is for argv-shaped CLI policy. File access has different security and API needs:
- rooted path allowlists
- canonical path checks
- chunked reads and tailing
- symlink/junction handling
- file-size and traversal limits

That makes `host-files-http` a sibling, not a sub-mode of `cliguard`.

## Design shape

A small HTTP wrapper with a declarative config.

```text
agent/container -> host-files-http -> allowlisted host folders/files
```

## Proposed scope

### In scope
- list directories under allowlisted roots
- read text files
- tail log files
- read file metadata
- discover available roots and limits

### Out of scope
- write, edit, delete, rename, move
- arbitrary absolute-path reads
- recursive indexing of the whole disk
- unrestricted globbing over the host filesystem
- shelling out to `type`, `cat`, `powershell`, etc.

## Config sketch

```yaml
roots:
  iis_logs:
    path: C:\inetpub\logs\LogFiles
    description: "IIS logs"
    read_only: true

  myapp_logs:
    path: C:\ProgramData\MyApp\Logs
    description: "MyApp service logs"
    read_only: true

settings:
  audit_log: C:\ProgramData\host-files-http\audit.log
  audit_format: jsonl
  max_read_bytes: 262144
  max_tail_bytes: 262144
  max_entries_per_list: 500
```

## API sketch

### `GET /discover`
Return available roots and limits.

```json
{
  "roots": {
    "iis_logs": {
      "description": "IIS logs",
      "read_only": true
    },
    "myapp_logs": {
      "description": "MyApp service logs",
      "read_only": true
    }
  },
  "limits": {
    "max_read_bytes": 262144,
    "max_tail_bytes": 262144,
    "max_entries_per_list": 500
  }
}
```

### `POST /list`
List a directory relative to a configured root.

```json
{
  "root": "myapp_logs",
  "path": "."
}
```

### `POST /read`
Read a bounded slice of a text file.

```json
{
  "root": "myapp_logs",
  "path": "app.log",
  "offset": 0,
  "max_bytes": 65536
}
```

### `POST /tail`
Read the last bytes or lines of a log file.

```json
{
  "root": "myapp_logs",
  "path": "app.log",
  "max_bytes": 65536
}
```

### `GET /health`
Basic health check.

## Security model

- paths are always interpreted **relative to a configured root**
- server canonicalizes the resolved path and confirms it stays under that root
- deny access through symlink/junction escape unless explicitly allowed
- enforce read-size and listing-size limits
- keep audit logs separate from returned file content
- optional bearer token and/or loopback/firewall restriction

## Deployment fit

This still aligns with the sidecar/host-wrapper model:
- if the logs live in a sidecar container, run the server there
- if the logs live only on the host, run it on the host

The interface shape stays the same.

## Open questions

- should `/tail` be byte-based, line-based, or both?
- should compressed log formats be supported?
- should server-side grep/filter exist, or stay out of scope for v1?
- how strict should symlink/junction handling be on Windows?
