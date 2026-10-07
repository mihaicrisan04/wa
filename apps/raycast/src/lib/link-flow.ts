import { START_ENGINE, type LinkStep } from "@wa/sdk";
import { accountLabel } from "./labels";
import { escapeMarkdown } from "./markdown";

const RESTART = `Restart it with ${START_ENGINE}.`;

export function linkMarkdown(
  step: LinkStep,
  details: { qrImage?: string; me?: string | null },
): string {
  switch (step.kind) {
    case "linked": {
      const who = details.me ? ` as **${escapeMarkdown(accountLabel(details.me))}**` : "";
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
