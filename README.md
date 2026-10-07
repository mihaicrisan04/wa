# whatsapp bookmark

<!-- TODO: replace with the actual demo gif -->
<p align="center">
  <img width="1020" height="1006" alt="image" src="https://github.com/user-attachments/assets/868b2c65-79d8-494e-9cbc-16cd15143d08" />
</p>

<p align="center">
  a Raycast extension for sending clipboard stuff (links, text, images, files) to WhatsApp, to yourself or any contact.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/platform-macOS-lightgrey.svg" alt="macOS">
  <a href="https://github.com/mihaicrisan04/whatsapp-bookmark/releases/latest"><img src="https://img.shields.io/github/v/release/mihaicrisan04/whatsapp-bookmark?label=release" alt="latest release"></a>
</p>

## prerequisites

- macOS
- [Raycast](https://raycast.com)
- [mise](https://mise.jdx.dev/) (handles node and bun for you)

## quick start

```bash
git clone https://github.com/mihaicrisan04/whatsapp-bookmark.git
cd whatsapp-bookmark
mise install && mise run install
mise run check        # lint, typecheck, tests, builds dist/wa and the Raycast extension
mise run dev:engine   # engine from source on a dev data dir, port 7374
mise run dev:raycast  # Raycast dev mode
```

> the repo is mid-migration to the `wa` engine; full setup docs come with the README rewrite.

the Raycast extension talks to the engine on `127.0.0.1:7373` (change it with the Port preference; `dev:engine` uses 7374). it needs no setup: with the Token preference empty it uses the token the engine writes to `~/Library/Application Support/wa/tokens/raycast.token`.

## commands

- **send to yourself**: clipboard goes to your own chat, no UI
- **send to chat**: pick a contact or group (most recent first), send the clipboard
- **pick item to send**: pick from the last 6 clipboard items, send to yourself or a chat
- **search messages**: full-text search with context, copy text, open or save media
- **link WhatsApp**: scan the QR to link the engine
- **status**: connection, history sync, counts and outbox

## more

- [WIKI.md](WIKI.md) for architecture, mise tasks, troubleshooting, caveats
- [LICENSE](LICENSE), MIT
