import type { HistorySync, Status } from "@wa/sdk";
import { phoneOf, stateLabel } from "./labels";
import { escapeMarkdown, formatTime } from "./markdown";

export function historyLabel(history: HistorySync): string {
  if (history.status === "complete") return "Complete";
  const progress = history.progress === null ? null : `${Math.round(history.progress)}%`;
  if (history.status === "paused") return progress ? `Paused at ${progress}` : "Paused";
  if (progress) return `Syncing, ${progress}`;
  return history.phases.length ? "Syncing" : "Not started";
}

export function needsLink(status: Status): boolean {
  return status.needsLink || status.state === "not_linked";
}

export interface StatusRow {
  title: string;
  text: string;
}

export function statusRows(status: Status, port: number): StatusRow[] {
  const rows: StatusRow[] = [
    { title: "WhatsApp", text: stateLabel(status.state) },
    {
      title: "Linked As",
      text: status.me ? (phoneOf(status.me.jid) ?? status.me.jid) : "Not linked",
    },
    { title: "History Sync", text: historyLabel(status.history) },
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
  if (needsLink(status)) return `${heading}\n\nRun **Link WhatsApp** (↵) to scan a QR code.`;
  if (status.state === "replaced") {
    return `${heading}\n\nAnother client took over this WhatsApp link. Restart the engine to reconnect.`;
  }
  const who = status.me ? ` as ${escapeMarkdown(phoneOf(status.me.jid) ?? status.me.jid)}` : "";
  const sync =
    status.history.status === "complete"
      ? "History sync is complete."
      : `History sync: ${historyLabel(status.history).toLowerCase()}.`;
  return `${heading}\n\nLinked${who}. ${sync}`;
}
