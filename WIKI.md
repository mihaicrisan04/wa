# wiki

extra docs that don't need to live in the README.

## architecture

two parts that talk over HTTP on `localhost:7272`.

**daemon**: a standalone 64MB binary compiled with Bun. holds a persistent WebSocket to WhatsApp via [Baileys](https://github.com/WhiskeySockets/Baileys) (a reverse-engineered WhatsApp Web client). runs in the background via launchd, auto-starts on login, exposes a tiny HTTP API. contacts sync from WhatsApp on first auth and persist to `contacts.json`. images are converted from PNG to JPEG via jimp before sending, otherwise WhatsApp treats large PNGs as documents.

**Raycast extension**: short-lived commands that read your clipboard, detect the content type (URL, text, file, screenshot), and POST to the daemon. screenshots come from the macOS pasteboard via Swift, since Raycast's clipboard API doesn't expose raw image data.

why two parts? Raycast extensions are short-lived Node.js processes, but Baileys needs a long-lived WebSocket. so the daemon owns the connection and the extension just makes HTTP calls.

## what it sends

- **links** and **plain text** become text messages
- **images** (png, jpg, gif, webp) get converted to JPEG and sent as WhatsApp images
- **videos** (mp4, mov, etc.) go through as WhatsApp videos
- **everything else** (pdf, docs, zip, ...) is sent as a WhatsApp document
- **clipboard images / screenshots** are extracted from the macOS pasteboard and converted to JPEG

## setup details

prerequisites: macOS, [Raycast](https://raycast.com), [mise](https://mise.jdx.dev/) (recommended) or Node.js 20+ and [Bun](https://bun.sh) 1.3+.

without mise:

```bash
npm install
cd daemon && npm install
bun build --compile --minify index.js --outfile whatsapp-bookmark
```

after running `mise daemon:auth`:

1. scan the QR with WhatsApp (Settings > Linked Devices > Link a Device)
2. wait for `saved X contacts to disk`
3. Ctrl+C

## mise tasks

| task | what it does |
|------|--------------|
| `mise daemon` (alias `mise d`) | start the daemon |
| `mise daemon:dev` | start the daemon with bun (dev mode) |
| `mise daemon:build` | compile the standalone binary |
| `mise daemon:auth` | fresh auth, wipes credentials and shows new QR |
| `mise daemon:enable` | install as login service (launchd) |
| `mise daemon:disable` | remove the login service |
| `mise daemon:logs` | tail logs at `/tmp/whatsapp-bookmark-daemon.log` |
| `mise install` | install all deps |
| `mise dev` | raycast dev mode |
| `mise lint` / `mise lint:fix` | run oxlint |
| `mise format` / `mise format:check` | run oxfmt |

## troubleshooting

**daemon gives 405 errors / no QR code**: WhatsApp changes their protocol version periodically. the daemon fetches the current one at startup, so this usually means it fell back to `FALLBACK_WA_VERSION` in `daemon/index.js` after a failed fetch. bump that constant and run `mise daemon:build`.

**messages don't appear on my phone**: the phone number in Raycast preferences must match your WhatsApp number with country code, no `+`.

**screenshots send as documents instead of images**: the PNG to JPEG conversion failed. check that jimp is installed (`cd daemon && npm ls jimp`) and rebuild the binary.

**daemon disconnects often**: normal. Baileys auto-reconnects with exponential backoff. if it says "logged out", run `mise daemon:auth`.

**contacts list is empty**: contacts sync on first auth. if you skipped or it timed out, run `mise daemon:auth` again and wait for `saved X contacts to disk`.

## caveats

- personal use only, can't be published to the Raycast store
- Baileys reverse-engineers WhatsApp Web, which violates Meta's ToS
- ban risk for personal use is very low but not zero
- credentials live in `daemon/auth_info/` and contacts in `daemon/contacts.json`, both gitignored
- macOS only (Swift for clipboard image extraction, launchd for auto-start)
