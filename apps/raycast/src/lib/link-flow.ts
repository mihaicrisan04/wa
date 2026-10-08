import type { Qr } from "@wa/sdk";
import { phoneOf } from "./labels";
import { escapeMarkdown } from "./markdown";

export type LinkStep =
  | { kind: "linked" }
  /** Linked, the engine is (re)connecting; also the moment right after a scan. */
  | { kind: "connecting" }
  /** Not linked and we haven't asked the engine to pair yet. */
  | { kind: "start" }
  | { kind: "qr"; qr: string }
  | { kind: "waiting" }
  /** We started pairing and it ended unscanned (WhatsApp stops after a few QR codes). */
  | { kind: "stopped" }
  | { kind: "replaced" }
  | { kind: "engine_stopped" };

export function linkStep({ state, qr }: Qr, pairingStarted: boolean): LinkStep {
  switch (state) {
    case "open":
      return { kind: "linked" };
    case "connecting":
    case "reconnecting":
      return { kind: "connecting" };
    case "linking":
      return qr ? { kind: "qr", qr } : { kind: "waiting" };
    case "not_linked":
    case "needs_link":
      return pairingStarted ? { kind: "stopped" } : { kind: "start" };
    case "replaced":
      return { kind: "replaced" };
    case "stopped":
      return { kind: "engine_stopped" };
  }
}

export function isFinal(step: LinkStep): boolean {
  return step.kind === "linked" || step.kind === "stopped" || step.kind === "replaced";
}

const RESTART = "Restart the engine (`wa service install`, or `wa serve` in a terminal).";

export function linkMarkdown(
  step: LinkStep,
  details: { qrImage?: string; me?: string | null },
): string {
  switch (step.kind) {
    case "linked": {
      const who = details.me ? ` as **${escapeMarkdown(phoneOf(details.me) ?? details.me)}**` : "";
      return `# Linked\n\nWhatsApp is linked${who}. History keeps syncing in the background; **Status** shows how far it got.`;
    }
    case "connecting":
      return "# Connecting\n\nWhatsApp is linked and the engine is connecting.";
    case "qr":
      return details.qrImage
        ? `# Scan the QR code\n\nOn your phone: **WhatsApp → Settings → Linked Devices → Link a Device**\n\n![QR code](${details.qrImage}?raycast-height=350)`
        : "# Scan the QR code\n\nDrawing the QR code…";
    case "start":
    case "waiting":
      return "# Starting\n\nWaiting for a QR code from WhatsApp…";
    case "stopped":
      return "# Pairing stopped\n\nThe QR code expired before it was scanned. Press ↵ to start again.";
    case "replaced":
      return `# Replaced\n\nAnother client took over this WhatsApp link, so the engine disconnected. ${RESTART}`;
    case "engine_stopped":
      return `# Engine stopped\n\nThe wa engine is shutting down. ${RESTART}`;
  }
}
