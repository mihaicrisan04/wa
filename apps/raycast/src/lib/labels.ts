import type { ChatKind, ConnectionState, Message } from "@wa/sdk";

/** `+40712345678` for a phone-number jid (device suffix dropped), null for groups, LIDs, etc. */
export function phoneOf(jid: string | null): string | null {
  const match = jid ? /^(\d+)(?::\d+)?@s\.whatsapp\.net$/.exec(jid) : null;
  return match ? `+${match[1]}` : null;
}

export function chatTitle(chat: { jid: string; name: string | null; kind?: ChatKind }): string {
  if (chat.kind === "self") return chat.name ? `${chat.name} (you)` : "You";
  return chat.name || phoneOf(chat.jid) || chat.jid;
}

export function senderLabel(message: Pick<Message, "fromMe" | "sender" | "senderName">): string {
  if (message.fromMe) return "You";
  return message.senderName || phoneOf(message.sender) || message.sender || "Unknown";
}

const KIND_LABELS: Record<ChatKind, string> = {
  dm: "contact",
  group: "group",
  self: "you",
  broadcast: "broadcast",
  newsletter: "channel",
  other: "other",
};

export function kindLabel(kind: ChatKind): string {
  return KIND_LABELS[kind];
}

const STATE_LABELS: Record<ConnectionState, string> = {
  not_linked: "Not linked",
  linking: "Waiting for a QR scan",
  connecting: "Connecting",
  open: "Connected",
  reconnecting: "Reconnecting",
  needs_link: "Logged out, link again",
  replaced: "Replaced by another session",
  stopped: "Stopped",
};

export function stateLabel(state: ConnectionState): string {
  return STATE_LABELS[state];
}
