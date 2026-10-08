import { syncSummary, type Status } from "@wa/sdk";
import { accountLabel, stateLabel } from "./labels";
import { escapeMarkdown, formatTime } from "./markdown";

interface StatusRow {
  title: string;
  text: string;
}

export function statusRows(status: Status, port: number): StatusRow[] {
  const rows: StatusRow[] = [
    { title: "WhatsApp", text: stateLabel(status.state) },
    {
      title: "Linked As",
      text: status.me ? accountLabel(status.me.jid) : "Not linked",
    },
    { title: "History Sync", text: capitalize(syncSummary(status.history)) },
    { title: "Chats", text: status.counts.chats.toLocaleString("en-US") },
    { title: "Messages", text: status.counts.messages.toLocaleString("en-US") },
    { title: "Outbox", text: status.outbox.pending ? `${status.outbox.pending} waiting` : "Empty" },
    { title: "Engine", text: `v${status.version} on 127.0.0.1:${port}` },
  ];
  if (status.lastDisconnect) {
    const code = status.lastDisconnect.code === null ? "" : ` (code ${status.lastDisconnect.code})`;
    rows.push({ title: "Last Disconnect", text: `${formatTime(status.lastDisconnect.at)}${code}` });
  }
  return rows;
}

export function statusMarkdown(status: Status): string {
  const heading = `# ${stateLabel(status.state)}`;
  if (status.needsLink) return `${heading}\n\nRun **Link WhatsApp** (↵) to scan a QR code.`;
  if (status.state === "replaced") {
    return `${heading}\n\nAnother client took over this WhatsApp link. Restart the engine to reconnect.`;
  }
  const who = status.me ? ` as ${escapeMarkdown(accountLabel(status.me.jid))}` : "";
  const sync =
    status.history.status === "complete"
      ? "History sync is complete."
      : `History sync: ${syncSummary(status.history)}.`;
  return `${heading}\n\nLinked${who}. ${sync}`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
