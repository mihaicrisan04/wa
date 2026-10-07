# Security

## Threat model

wa holds a WhatsApp account's credentials and its message history, and hands parts of it to other programs. What it protects against, and what it doesn't:

- **Over-sharing with cooperative clients.** An AI agent working in a project should see only that project's chats. Profiles and collections give each client exactly the chats and capabilities it needs, and the engine enforces that for every read.
- **Other machines and web pages.** The API listens on loopback only and refuses requests that look like they come from a browser.
- **Not a sandbox against your own user.** Any program running as your macOS user can read `WA_HOME` (the database, the credentials, the token files) directly. Scope is a guardrail for clients that use the API, not a boundary against local code you run.

## Access control

- Clients authenticate with **tokens** bound to a **profile**: a set of capabilities plus a chat scope (all chats, or named collections).
- Tokens are `wa_` + 32 random bytes (base64url). The engine stores only their sha256, looks them up by hash and shows a new token once. Tokens are accepted only in the `Authorization` header, never in a query string. Revocation and profile changes take effect on the next request; nothing is cached.
- **Scope is enforced in SQL** by every read path: chat lists, messages, search, message context, media, recipients and every MCP tool. A chat outside the scope behaves exactly like one that doesn't exist (404 or empty, never 403), including in error messages and in the candidates listed for an ambiguous chat name.
- Quoted replies are resolved through the same filter. If the quoted message is in a chat outside the scope, only the quoted text the reader's chat already showed is returned, without the other chat's jid.
- Contacts and group participants are visible only through chats in scope.
- `send` targets must be in scope. `send:self` allows only the account's own chat.
- MCP is **read-only by default**: the send tool exists only for profiles with `send` or `send:self`.
- **Admin** (managing collections, profiles and tokens, backfill, relink) is only reachable over the unix socket `WA_HOME/engine.sock` (mode 0600). There is no admin token to leak.

## Network

- The engine binds `127.0.0.1` only.
- Requests must carry `Host: 127.0.0.1:<port>` or `localhost:<port>`, which defeats DNS rebinding.
- Any request with an `Origin` header is rejected, so web pages can't call the API even on the same machine.

## Files

- The engine runs with umask 077 (and so does the launchd agent): every file it creates is 0600, every directory 0700. Tests check this.
- The Raycast token is only in `WA_HOME/tokens/raycast.token` (0600); MCP tokens live next to it, one file per profile and project.
- `wa mcp install` registers Claude Code with a headers helper (`wa mcp headers --token-file …`), so the token stays in its 0600 file instead of Claude Code's config. It also adds a `Read(<WA_HOME>/**)` deny rule to the project's `.claude/settings.local.json`.
- Clients upload file bytes to send. The engine never reads a filesystem path supplied by a client.
- MCP `download_media` never returns paths inside `WA_HOME`; files are exported to `$TMPDIR/wa-export/<profile>/`.
- `wa service install` excludes `WA_HOME/auth` (the WhatsApp keys) from Time Machine backups. Relinks and logouts keep that directory and move the old keys into `auth/previous/`, so the exclusion covers them too.

## Untrusted content

Message text, names, captions and file names are written by other people. MCP output renders every such string JSON-quoted inside a fixed fence, one message per line, and the server instructions tell the agent that fenced content is data, never instructions. A message containing newlines, a fake message header or the fence itself can't break out. The CLI folds newlines and replaces control characters before printing. See [mcp.md](mcp.md#untrusted-content).

## Honoring intent

- Delete-for-me and chat clears delete the rows, their search entries and cached media.
- Revokes ("delete for everyone") clear the content and keep a tombstone.
- Edits and revokes are applied only when they come from the original sender (or a group admin, for revokes).
- Disappearing messages are purged once they expire.
- View-once media is never downloaded and its raw payload is not kept.
- Stories (`status@broadcast`) are not stored.

## Logging and audit

- At the default `info` level the engine never logs message text or file names. Baileys' own logger is capped at `warn` because it logs content below that.
- The raw WhatsApp payload stored with each message never appears in any API or MCP response.
- The audit log records every send, every MCP tool call (tool, profile, chat, result count) and every admin change, without message text. `wa audit` shows it.

## WhatsApp

wa links as a separate companion device through [Baileys](https://github.com/WhiskeySockets/Baileys), an unofficial client; the account owner can see and remove it under Linked devices on the phone. Using it is against WhatsApp's terms of service and carries a small risk of a ban. Baileys is pinned to an exact release (`7.0.0-rc14`) that has no known advisories.
