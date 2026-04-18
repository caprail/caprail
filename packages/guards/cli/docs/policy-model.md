# Policy model

## Matching model

Policies are matched on tokens, not string prefixes.

- config entries are whitespace-delimited token sequences
- argv matching is case-sensitive
- `--flag=value` is normalized to `--flag`, `value`
- bundled short flags are not expanded
- `deny_flags` only applies before a `--` terminator

## Allow rules

An allow entry matches when its token sequence appears as a contiguous subsequence anywhere in the normalized argv.

Examples:

- `pr list` matches `pr list --state open`
- `pr list` matches `--repo org/repo pr list`
- `pr list` does **not** match `pr --repo org/repo list`

## Deny rules

A command is denied when either of these matches:

1. a `deny` token sequence
2. a `deny_flags` token before `--`

Precedence is:

```text
deny > deny_flags > allow > implicit deny
```

## Evaluation output

`evaluateCommand()` and `buildExplainPayload()` expose:

- normalized args
- matched allow entry
- matched deny entry
- matched deny flag
- final allowed/denied result
- machine-readable reason codes such as `matched_allow`, `matched_deny`, `matched_deny_flag`, `no_allow_match`, and `unknown_tool`

## Scope limits

This model intentionally does **not** do resource scoping or numeric validation. It constrains command shapes and dangerous flags, not repo IDs, subscription IDs, or value ranges.
