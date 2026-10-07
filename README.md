# wa

A local WhatsApp engine for macOS. `wa` links to your WhatsApp account as a companion device, keeps your chats and messages in a local SQLite store with full-text search, and serves them to a few local clients: a CLI, a Raycast extension and AI agents over MCP. Each client gets a token bound to a profile that decides what it can do and which chats it can see.

<p>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/platform-macOS-lightgrey.svg" alt="macOS">
</p>

- **one engine**: `wa serve` owns the WhatsApp connection and all state; clients talk to it on `127.0.0.1:7373`
- **local history**: chats, contacts, groups and messages, including the full history sync, searchable with accents ignored; media downloaded on demand
- **scoped access**: profiles combine capabilities with a chat scope (all chats, or named collections), enforced in SQL for every read
- **agents**: an MCP endpoint, read-only by default, wired into a project with one command

## Quick start

Requires macOS, [mise](https://mise.jdx.dev) (installs Bun and Node) and WhatsApp on your phone.

```sh
git clone https://github.com/mihaicrisan04/wa.git && cd wa
mise install && mise run install
mise run build                 # compiles dist/wa
dist/wa service install        # copies it to ~/.local/bin/wa and starts the engine with launchd
wa link                        # scan the QR in WhatsApp → Linked devices, then watch the history sync
wa status
```

`~/.local/bin` must be on your `PATH`. Data lives in `~/Library/Application Support/wa` (override with `WA_HOME`), logs in `~/Library/Logs/wa/engine.log` (`wa service logs`).

## Clients

**CLI.** `wa chats`, `wa read <chat>`, `wa search <query>` and the admin commands (`collections`, `profiles`, `tokens`, `audit`) talk to the engine over its unix socket. `wa --help` lists everything.

**Raycast.** `apps/raycast` sends the clipboard (text, links, files, screenshots) to yourself or any chat, searches messages, links WhatsApp and shows the engine's status. With the default `WA_HOME` and port it needs no setup: it uses the token the engine writes for it. Against `mise run dev:engine` (`.wa-dev`, port 7374) or a custom `WA_HOME`, set its Token and Port preferences. Load it once with `mise run dev:raycast`.

**AI agents (MCP).** Give an agent a profile and wire it into a project:

```sh
wa collections create master
wa collections add master "Master PP" "Lab Project"
wa profiles create master --caps chats:read,messages:read,media:read --collections master
wa mcp install --profile master --project ~/dev/master
```

Claude Code in `~/dev/master` now sees only the chats in `master`, read-only. Codex is supported too (`--client codex`).

## Docs

- [docs/architecture.md](docs/architecture.md): how the engine is put together, the store, the API and development
- [docs/mcp.md](docs/mcp.md): MCP tools, scoping, rendering, Claude Code and Codex setup
- [docs/security.md](docs/security.md): threat model and what protects your data

## Caveats

wa uses [Baileys](https://github.com/WhiskeySockets/Baileys), an unofficial WhatsApp Web client. This is against WhatsApp's terms of service and carries a small risk of the account being banned. It is meant for personal use on your own account.

## License

[MIT](LICENSE)
