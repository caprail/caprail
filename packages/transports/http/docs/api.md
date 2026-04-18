# HTTP API Contract — `@caprail/transport-http`

All endpoints return `application/json`. Requests to `/exec` and `/discover` require a
`Content-Type: application/json` header when sending a body.

---

## `POST /exec`

Execute a command through the guard.

### Request

```http
POST /exec
Authorization: Bearer <token>
Content-Type: application/json

{
  "tool": "gh",
  "args": ["pr", "list", "--state", "open"]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `tool` | string | yes | Tool name as defined in the guard config |
| `args` | string[] | yes | Argument token array passed to the real binary |

The request body must be valid JSON and must not exceed **64 KB**.

### Success — HTTP 200

The command was allowed by policy and executed. A non-zero `exit_code` still returns
HTTP 200 because policy permitted the command and execution occurred.

```json
{
  "allowed": true,
  "exit_code": 0,
  "stdout": "...",
  "stderr": "...",
  "timed_out": false,
  "truncated": false
}
```

### Error responses

#### 400 Bad Request — invalid JSON or invalid request shape

```json
{
  "error": {
    "code": "invalid_request",
    "message": "'args' must be an array of strings."
  }
}
```

Error codes: `invalid_json`, `request_too_large`, `invalid_request`.

#### 401 Unauthorized — missing or invalid bearer token

```json
{
  "error": {
    "code": "unauthorized",
    "message": "Missing or invalid bearer token."
  }
}
```

#### 403 Forbidden — policy denial

```json
{
  "allowed": false,
  "error": {
    "code": "policy_denied",
    "message": "'pr create' is not in the allow list for 'gh'."
  }
}
```

Unknown tools and denied flags are also 403 `policy_denied`.

#### 413 Payload Too Large — captured output exceeded `maxOutputBytes`

```json
{
  "allowed": true,
  "timed_out": false,
  "truncated": true,
  "error": {
    "code": "output_limit_exceeded",
    "message": "Captured output exceeded 1048576 bytes."
  }
}
```

When the cap is reached, the child process is terminated immediately.

#### 504 Gateway Timeout — child process exceeded `timeoutMs`

```json
{
  "allowed": true,
  "timed_out": true,
  "truncated": false,
  "error": {
    "code": "execution_timeout",
    "message": "Command exceeded 30000ms."
  }
}
```

When the timeout fires, the child process is sent SIGTERM (then SIGKILL after 200 ms).

#### 500 Internal Server Error — transport or guard failure

```json
{
  "error": {
    "code": "internal_error",
    "message": "Command execution failed."
  }
}
```

---

## `GET /discover`

Returns all configured tools and their allowed commands, plus the execution metadata
block. Designed for agent-side tool generation — an agent can call this once at startup
and synthesise tool descriptions from the response.

### Request

```http
GET /discover
Authorization: Bearer <token>
```

### Response — HTTP 200

```json
{
  "tools": {
    "gh": {
      "binary": "gh",
      "description": "GitHub CLI (read-only PR and issue access)",
      "allow": ["pr list", "pr view", "pr diff"],
      "deny": [],
      "deny_flags": ["--web"]
    }
  },
  "execution": {
    "mode": "non-interactive",
    "timeout_ms": 30000,
    "max_output_bytes": 1048576
  }
}
```

Returns 401 if auth is required and no valid token is provided.

---

## `GET /health`

Returns 200 with no authentication required. Intended for container orchestration health
checks. A healthy response means the server has already completed startup validation of
the policy config and audit-sink setup.

### Request

```http
GET /health
```

### Response — HTTP 200

```json
{
  "status": "ok"
}
```

---

## Non-interactive execution

All commands run in non-interactive mode:

- `stdin` is never forwarded to the child process.
- `stdout` and `stderr` are captured separately, then returned in the response body.
- Child processes inherit the non-interactive environment variables (`PAGER=cat`,
  `GIT_PAGER=cat`, `GH_PAGER=cat`, `TERM=dumb`).
- If a vendor CLI prompts for input, it receives EOF and fails — that failure is returned
  as a normal exit code in an HTTP 200 response.

## Status code summary

| Status | Meaning |
|---|---|
| `200` | Command allowed and executed (check `exit_code` for process result) |
| `400` | Invalid request body shape or JSON parse error |
| `401` | Missing or invalid bearer token |
| `403` | Command denied by policy |
| `404` | Unknown route |
| `413` | Combined stdout+stderr exceeded `maxOutputBytes` |
| `500` | Transport or guard internal error |
| `504` | Child process exceeded `timeoutMs` |
