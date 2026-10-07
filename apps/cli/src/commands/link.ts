import { parseArgs } from "node:util";
import { WaApiError, type WaClient } from "@wa/sdk";
import QRCode from "qrcode";
import { EXIT_FAILURE, type Command, type CommandIO } from "../command";
import { engineClient } from "../engine-client";
import { who } from "../output";

const POLL_MS = 1_000;
/** Pairing gives up on its own after a few QR codes; this only guards against a stuck engine. */
const GIVE_UP_MS = 5 * 60_000;

export const link: Command = {
  name: "link",
  summary: "link WhatsApp by scanning a QR code (--relink replaces the linked device)",
  async run(args, io) {
    const { values } = parseArgs({
      args,
      options: { relink: { type: "boolean" }, help: { type: "boolean", short: "h" } },
      strict: true,
    });
    if (values.help) {
      io.out(
        "usage: wa link [--relink]\n\nShows a QR code to scan in WhatsApp → Linked devices → Link a device,\nthen waits until the link is up.",
      );
      return 0;
    }
    const wa = engineClient(io.env);
    try {
      await wa.link({ relink: values.relink });
    } catch (err) {
      if (!(err instanceof WaApiError) || err.code !== "already_linked") throw err;
      const { me } = await wa.status();
      io.err(`wa link: already linked as ${who(me?.jid ?? null)}; use --relink to link again`);
      return EXIT_FAILURE;
    }
    return waitForLink(wa, io);
  },
};

async function waitForLink(wa: WaClient, io: CommandIO): Promise<number> {
  const deadline = Date.now() + GIVE_UP_MS;
  let shown: string | null = null;
  while (Date.now() < deadline) {
    const { state, qr } = await wa.qr();
    if (state === "open") {
      const { me } = await wa.status();
      io.out(`linked as ${who(me?.jid ?? null)}`);
      return 0;
    }
    if (state === "not_linked" || state === "needs_link") {
      io.err("wa link: pairing stopped before a QR code was scanned; run `wa link` again");
      return EXIT_FAILURE;
    }
    if (qr && qr !== shown) {
      shown = qr;
      io.out(await QRCode.toString(qr, { type: "terminal", small: true }));
      io.out("scan it in WhatsApp → Linked devices → Link a device");
    }
    await Bun.sleep(io.pollMs ?? POLL_MS);
  }
  io.err("wa link: timed out waiting for the link");
  return EXIT_FAILURE;
}
