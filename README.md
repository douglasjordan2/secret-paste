# secret-paste

An MCP server that lets an agent request an API key or other secret from you
without the value ever entering the conversation, a tool argument, or the
transcript. "pbcopy for agents."

The agent calls `request_secret`. You get a local browser page with a single
password field. The value goes straight from the page to `.env`, your OS
keychain, or 1Password. The agent only ever sees `{ name, target, stored }`.

## Install

```sh
cd /path/to/secret-paste
npm install && npm run build
claude mcp add --scope user secret-paste -- node /path/to/secret-paste/dist/server.js
```

Restart Claude Code (or run `/mcp`) and confirm `secret-paste` is connected.

## Tool

`request_secret({ name, target?, description? })`

| field | notes |
|---|---|
| `name` | required, must match `^[A-Z_][A-Z0-9_]*$` |
| `target` | `env` (default), `keychain`, or `op` |
| `description` | optional, shown on the page |

Result on success: `{ "name": "...", "target": "...", "stored": true, "path"?: "...", "readHint": "...", "opened": "elicitation" | "browser" }`.
Result otherwise: `{ "stored": false, "reason": "cancelled" | "declined" | "timeout" | "aborted" | "<error>" }`.

The value, its length, a prefix, or a hash is never returned, logged, or echoed.

### Targets

- `env`: upserts `NAME=value` into `.env` in the server's working directory
  (the directory Claude Code was started in). Other lines are preserved, an
  existing line for that name is replaced, the file is created with mode 0600
  if missing, and `.env` is appended to `.gitignore` when the directory is a
  git repo.
- `keychain`: macOS `security add-generic-password` (fed over stdin via
  `security -i`, so the value never appears in `ps`), or Linux `secret-tool
  store` (requires `libsecret-tools`).
- `op`: `op item create` with a JSON item template on stdin (1Password CLI).

## How it works

1. A one-shot HTTP server starts on `127.0.0.1` on a random port with a random
   nonce in the path. Requests with the wrong nonce, Host, or Origin are rejected.
2. The URL is handed to Claude Code via MCP URL-mode elicitation, which shows a
   native "open this link?" prompt. If the client doesn't support that, the
   server falls back to `xdg-open` / `open`.
3. The page is static HTML with no JavaScript and `Cache-Control: no-store`.
4. On submit, the value is parsed at the byte level into a `Buffer`, written to
   the target, then zeroed. It is never held as a JavaScript string.
5. The server shuts down after one submit or cancel, or after 5 minutes.

The tool is tagged `_meta["anthropic/requiresUserInteraction"] = true`, so
Claude Code prompts for permission on every call, even in auto-accept modes.

## How to use it (for Claude)

When you need a credential, call `request_secret({ name: "SERVICE_API_KEY" })`
and then reference it as `process.env.SERVICE_API_KEY` (or the `readHint` in
the result). Never ask the user to paste a secret into chat.

## Development

```sh
npm test        # unit tests for .env upsert and form decoding (node --test)
npm run build   # tsc -> dist/
```
