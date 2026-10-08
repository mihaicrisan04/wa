# Architecture

wa is one long-running engine and a few thin clients. The engine owns the WhatsApp connection and every piece of state; clients only ever talk to it.

```
                 ┌──────────────── wa engine (`wa serve`, launchd) ─────────────────┐
WhatsApp ◄─────► │ connection (Baileys) → ingest (ev.process, 1 tx/batch) → store   │
                 │        ▲ outbox                      (SQLite + FTS5, media cache)│
                 │        │                 policy (principal → caps + chat scope)  │
                 │        └──── Hono on Bun.serve: TCP 127.0.0.1:7373 (/v1, /mcp)   │
                 │                         unix WA_HOME/engine.sock (admin)          │
                 └──────────────────────────────────────────────────────────────────┘
        Raycast (raycast token)     `wa` CLI (unix socket = admin)     Claude/Codex (MCP, profile token)
```

## Repository

A Bun workspace (Bun 1.4, isolated linker). Every package declares what it imports.

| path              | what                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------ |
| `packages/engine` | `@wa/engine`: connection, ingest, store, policy, outbox, HTTP API and MCP                              |
| `packages/sdk`    | `@wa/sdk`: the API's types and a typed fetch client; plain TypeScript, no build step, no Bun-only APIs |
| `apps/cli`        | the `wa` binary (`bun build --compile` → `dist/wa`), one file per command group in `src/commands`      |
| `apps/raycast`    | the Raycast extension, a client of `@wa/sdk`                                                           |
| `docs`            | this file, [mcp.md](mcp.md), [security.md](security.md)                                                |

## Engine

`startEngine(config, { client? })` in `engine.ts` wires everything and returns `{ stop() }`. Tests pass a fake client instead of a Baileys socket.

| module                   | responsibility                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `config.ts`              | `WA_HOME` and every path in it, `WA_PORT` (7373), `WA_LOG_LEVEL`; sets `umask 077` before anything is created            |
| `whatsapp/client.ts`     | the `WhatsAppClient` seam, a `Pick` of Baileys' `WASocket`, so a Baileys API change breaks `tsc` rather than production  |
| `whatsapp/connection.ts` | socket lifecycle, link/relink, reconnects                                                                                |
| `whatsapp/identity.ts`   | canonical jids: a person or 1:1 chat is keyed by its phone number once its LID mapping is known                          |
| `whatsapp/normalize.ts`  | `WAMessage` → `MessageRecord` with Baileys' own helpers; edit/revoke/reaction carriers are recognized and never stored   |
| `whatsapp/outgoing.ts`   | outgoing content; images become JPEG with a thumbnail and dimensions                                                     |
| `whatsapp/media.ts`      | on-demand downloads (with media re-upload requests) into the media cache                                                 |
| `store/`                 | SQLite (WAL, migrations) with one repository per aggregate                                                               |
| `ingest/`                | Baileys events → store, one transaction per event batch; history, messages, chats/contacts, groups, LID canonicalization |
| `queries/`               | the scoped read model: every chat, message, search, media and recipient query filters by the principal's scope in SQL    |
| `policy.ts`              | principals (admin or token → profile), capability checks, the scope SQL                                                  |
| `outbox.ts`              | the persisted send queue                                                                                                 |
| `backfill.ts`            | on-demand history requests for older messages of one chat                                                                |
| `api/`                   | the Hono app: Host/Origin guard, bearer auth, one module per resource, admin routes only on the unix socket              |
| `mcp/`                   | the `/mcp` endpoint, one file per tool, injection-safe rendering                                                         |

### Connection

The engine links as a new companion device (`Browsers.macOS('Desktop')`) with full history sync. Credentials live in `WA_HOME/auth`; `wa link --relink` moves the old ones to `auth/previous/relinked-<time>/`. On disconnect:

- **logged out** (401): the socket ends, the credentials move to `auth/previous/logged-out-<time>/`, the state becomes `needs_link`; the API stays up and `wa link` starts over;
- **replaced** (440): another session took over; the engine stops connecting and reports it;
- **restart required** (515): reconnects at once;
- anything else: exponential backoff up to 60 seconds.

On open it fetches group metadata once and flushes the outbox. The own identity (phone number and LID) is read from the stored credentials, so it is known while offline.

### Identity

WhatsApp addresses the same person either as `<n>@s.whatsapp.net` (phone number) or `<n>@lid`. The store keeps one canonical jid per person and chat: the phone-number jid when a mapping is known, the LID otherwise. Mappings come from message keys, contacts, history sync and Baileys' LID store. When a mapping is learned for a chat stored under its LID, that chat is merged into the phone-number chat in one transaction (messages, collection membership, aliases). Every input jid or phone number is canonicalized before use.

### Ingest

- Messages are upserted on `(chat, id)`: a placeholder (undecryptable stub) is replaced when the content arrives; history timestamps (`Long`) go through `toNumber`.
- Edits and revokes apply only when they come from the original sender (or, for revokes in groups, an admin). A revoke that arrives before its message can be checked waits for it, and the message is stored as a tombstone if the revoke was genuine. Reactions are not stored.
- Delete-for-me and chat clears delete rows, search entries and cached media. Revokes keep a tombstone without content. Disappearing messages are purged after they expire. View-once media is never downloaded and stories (`status@broadcast`) are not ingested.
- Each message keeps its `raw` WebMessageInfo (thumbnails stripped). It never leaves the engine; `wa reindex` re-derives every row from it.

### History

The first sync after linking arrives as large `messaging-history.set` batches; WhatsApp reports completion separately (`complete` or `paused`), per phase; the sync as a whole is complete only once the full phase is. Progress and status are stored and shown by `wa status`, `wa link`, Raycast's Status command and the MCP `status` tool. `wa backfill <chat>` asks the phone for older messages 50 at a time; the answers arrive asynchronously as on-demand history batches.

### Outbox

A send is queued first: the engine assigns the WhatsApp message id up front and reuses it on every attempt, so a retry after a crash can't send twice. Uploaded files are copied into `WA_HOME/outbox`. Entries are sent one at a time with backoff, flushed on connect, given up after 8 failed attempts and expired after an hour.

## Data

Everything lives in `WA_HOME` (default `~/Library/Application Support/wa`; the path contains a space, quote it in shells):

| path          | what                                                |
| ------------- | --------------------------------------------------- |
| `wa.db`       | the SQLite store (WAL)                              |
| `auth/`       | WhatsApp credentials and Signal keys                |
| `engine.sock` | the admin socket                                    |
| `tokens/`     | token files for Raycast and MCP clients             |
| `media/`      | downloaded media, named `sha256(<chat>:<id>).<ext>` |
| `outbox/`     | files waiting to be sent                            |

The schema (`store/migrations/001-init.ts`) has chats (with aliases and the LID map), contacts, group participants, messages with an FTS5 index (`unicode61 remove_diacritics 2`, so `stefan` finds `Ștefan`), media, collections, profiles, tokens, outbox, audit log and sync state.

## Access

A request is made by a **principal**: the admin (anything on the unix socket) or a token, which is bound to a **profile**. A profile has capabilities (`chats:read`, `messages:read`, `media:read`, `send:self`, `send`, `link`) and a chat scope: all chats, or a set of **collections**. The scope is applied in SQL by every read, so a chat outside it is indistinguishable from one that doesn't exist. The built-in `raycast` profile (all chats, every capability but admin) is recreated at every start. See [security.md](security.md).

## HTTP API

JSON over `http://127.0.0.1:7373`, `Authorization: Bearer <token>`. Errors are `{ "error": { "code", "message" } }`. `@wa/sdk` has a typed client for all of it.

| route                                                    | capability              |
| -------------------------------------------------------- | ----------------------- |
| `GET /v1/health`                                         | none                    |
| `GET /v1/status`                                         | any token               |
| `GET /v1/qr`, `POST /v1/link`                            | `link`                  |
| `GET /v1/chats`, `GET /v1/chats/:chat`                   | `chats:read`            |
| `GET /v1/chats/:chat/messages`                           | `messages:read`         |
| `GET /v1/search`                                         | `messages:read`         |
| `GET /v1/messages/:chat/:id?context=n`                   | `messages:read`         |
| `GET /v1/media/:chat/:id[?download=1]`                   | `media:read`            |
| `GET /v1/recipients`                                     | `send` or `send:self`   |
| `POST /v1/send`, `GET /v1/outbox/:id`                    | `send` or `send:self`   |
| `/v1/admin/{collections,profiles,tokens,audit,backfill}` | admin, unix socket only |
| `ALL /mcp`                                               | the token's profile     |

## CLI

```
$ wa --help
usage: wa <command> [options]

commands:
  serve        run the engine in the foreground
  service      run the engine in the background with launchd
  link         link WhatsApp by scanning a QR code (--relink replaces the linked device)
  status       connection, history sync and what is stored
  chats        list chats, most recent first
  read         show a chat's latest messages
  search       full-text search over stored messages
  backfill     ask the phone for a chat's older messages
  collections  group chats into collections that profiles can be scoped to
  profiles     capabilities + chat scope that tokens are bound to
  tokens       bearer tokens for HTTP and MCP clients
  audit        recent sends, MCP tool calls and admin changes
  mcp          connect AI agents (Claude Code, Codex) to the engine over MCP
  reindex      re-derive every stored message from its raw payload
```

Every command and command group has its own `--help`. All of them:

```
wa serve [--port <port>]
wa service install
wa service uninstall
wa service status
wa service logs [-n lines] [-f]
wa link [--relink]
wa status [--json]
wa chats [query] [--collection c] [--kind dm|group|self|broadcast|newsletter|other] [--limit n] [--json]
wa read <chat> [--limit n] [--before <date|cursor>] [--json]
wa search <query> [--chat c] [--sender s] [--limit n] [--json]
wa backfill <chat> [--max n] [--json]
wa collections ls [--json]
wa collections create <name> [--description d]
wa collections add <name> <chat...>
wa collections rm <name> <chat...>
wa collections show <name> [--json]
wa collections delete <name>
wa profiles ls [--json]
wa profiles create <name> --caps a,b [--collections x,y | --all-chats]
wa profiles delete <name>
wa tokens ls [--profile p] [--json]
wa tokens create <profile> [--label l]
wa tokens revoke <id>
wa audit [--profile p] [--limit n] [--json]
wa mcp install --profile <p> [--project <dir>] [--client claude|codex]
wa mcp headers --token-file <file>
wa reindex
```

`<chat>` is a jid, a phone number or a unique part of the chat's name. Everything except `serve`, `service`, `mcp headers` and `reindex` needs a running engine and talks to it over `WA_HOME/engine.sock`.

`wa service install` copies the binary it runs from to `~/.local/bin/wa` and installs the launchd agent `com.mihaicrisan.wa` (`~/Library/LaunchAgents/com.mihaicrisan.wa.plist`): it starts at login, restarts when it exits, runs with umask 077 and logs to `~/Library/Logs/wa/engine.log`. `WA_HOME` (made absolute), `WA_PORT` and `WA_LOG_LEVEL` set during the install are kept in the plist. It also excludes `WA_HOME/auth` from Time Machine; the exclusion is on the directory, which the engine never replaces (earlier credentials move into `auth/previous/`), so it holds across relinks and logouts.

## Development

```sh
mise install && mise run install
mise run check        # what CI runs
mise run dev:engine   # the engine from source with reload, WA_HOME=.wa-dev, port 7374
```

| task                               | what it does                                                                            |
| ---------------------------------- | --------------------------------------------------------------------------------------- |
| `mise run check`                   | lint, format check, typecheck, tests, binary + selftest, Raycast build, gitignore check |
| `mise run typecheck`               | `tsc --noEmit` for every package                                                        |
| `mise run test`                    | every test suite (`bun test`)                                                           |
| `mise run lint` / `lint:fix`       | oxlint                                                                                  |
| `mise run format` / `format:check` | oxfmt                                                                                   |
| `mise run build`                   | compile `dist/wa`                                                                       |
| `mise run selftest`                | build `dist/wa` and run its offline selftest                                            |
| `mise run build:raycast`           | build the extension into `apps/raycast/dist` (never installs it)                        |
| `mise run dev:raycast`             | Raycast dev mode, which also loads the extension into Raycast                           |

Tests never reach WhatsApp. A fake `WhatsAppClient` emits Baileys-shaped event batches built with `proto.WebMessageInfo.fromObject`, each test gets a temporary `WA_HOME` and the server listens on port 0. The leak suites probe every HTTP route and MCP tool with out-of-scope chats.

Baileys is pinned to `7.0.0-rc14` exactly: release candidates compare as strings, and older ones carry a critical advisory.
