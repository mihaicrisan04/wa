import {
  linkStep,
  plural,
  START_ENGINE,
  syncSummary,
  WaApiError,
  type ConnectionState,
  type Status,
  type WaClient,
} from "@wa/sdk";
import QRCode from "qrcode";
import { FailureError, type CommandIO } from "../command";
import { defineCommand } from "../define";
import { engineClient } from "../engine-client";
import { who } from "../output";

const POLL_MS = 1_000;
/** Pairing gives up on its own after a few QR codes; this only guards against a stuck engine. */
const GIVE_UP_MS = 5 * 60_000;
/** The phone may never send history (or stop silently); stop watching after this long without news. */
const HISTORY_IDLE_MS = 3 * 60_000;
/** States in which the history sync can still move. */
const SYNCING: ReadonlySet<ConnectionState> = new Set(["open", "connecting", "reconnecting"]);

export const link = defineCommand({
  name: "link",
  summary: "link WhatsApp by scanning a QR code (--relink replaces the linked device)",
  usage: "wa link [--relink]",
  description:
    "Shows a QR code to scan in WhatsApp → Linked devices → Link a device,\nthen follows the history sync until WhatsApp finishes or pauses it.\nCtrl-C stops watching; the sync carries on in the engine (see `wa status`).",
  options: { relink: { type: "boolean" } },
  async run({ values }, io) {
    const wa = engineClient(io.env);
    try {
      await wa.link({ relink: values.relink });
    } catch (err) {
      if (!(err instanceof WaApiError) || err.code !== "already_linked") throw err;
      const { me } = await wa.status();
      throw new FailureError(
        `already linked as ${who(me?.jid ?? null)}; use --relink to link again`,
      );
    }
    return waitForLink(wa, io);
  },
});

async function waitForLink(wa: WaClient, io: CommandIO): Promise<number> {
  const deadline = Date.now() + GIVE_UP_MS;
  let shown: string | null = null;
  while (Date.now() < deadline) {
    const step = linkStep(await wa.qr(), true);
    switch (step.kind) {
      case "linked": {
        const { me } = await wa.status();
        io.out(`linked as ${who(me?.jid ?? null)}`);
        return watchHistory(wa, io);
      }
      case "stopped":
        throw new FailureError("pairing stopped before a QR code was scanned; run `wa link` again");
      case "replaced":
        throw new FailureError("another session took over this WhatsApp link (`wa status`)");
      case "engine_stopped":
        throw new FailureError(
          `the wa engine is shutting down: restart it with ${START_ENGINE}, then run \`wa link\` again`,
        );
      case "qr":
        if (step.qr !== shown) {
          shown = step.qr;
          io.out(await QRCode.toString(step.qr, { type: "terminal", small: true }));
          io.out("scan it in WhatsApp → Linked devices → Link a device");
        }
    }
    await Bun.sleep(io.pollMs ?? POLL_MS);
  }
  throw new FailureError("timed out waiting for the link");
}

async function watchHistory(wa: WaClient, io: CommandIO): Promise<number> {
  io.out("syncing history from your phone; keep WhatsApp open on it (Ctrl-C stops watching)");
  const idleMs = io.historyIdleMs ?? HISTORY_IDLE_MS;
  let shown = "";
  // live messages move the counts too; only the sync itself counts as news
  let phases = "";
  let lastNews = Date.now();
  for (;;) {
    const current = await wa.status();
    if (!SYNCING.has(current.state)) {
      throw new FailureError(
        `the connection is ${current.state}, the history sync stopped (\`wa status\`)`,
      );
    }
    const line = progressLine(current);
    if (line !== shown) io.out(line);
    shown = line;
    const latest = JSON.stringify(current.history.phases);
    if (latest !== phases) lastNews = Date.now();
    phases = latest;
    if (current.history.status) {
      io.out(doneLine(current));
      return 0;
    }
    if (Date.now() - lastNews > idleMs) {
      io.out(
        "no news from the history sync for a while; it carries on in the background (`wa status`)",
      );
      return 0;
    }
    await Bun.sleep(io.pollMs ?? POLL_MS);
  }
}

function progressLine({ history, counts }: Status): string {
  const sync = history.phases.length ? syncSummary(history) : "waiting for the phone";
  return `history: ${sync}, ${plural(counts.messages, "message")} stored`;
}

function doneLine({ history, counts }: Status): string {
  const stored = `${plural(counts.chats, "chat")}, ${plural(counts.messages, "message")} stored`;
  if (history.status === "complete") return `history sync complete: ${stored}`;
  return `history sync ${syncSummary(history)}: ${stored}; WhatsApp may send the rest later, and \`wa backfill <chat>\` fetches older messages`;
}
