export interface Health {
  ok: boolean;
  version: string;
}

export interface ApiErrorBody {
  error: { code: string; message: string; candidates?: ChatCandidate[] };
}

export const CAPABILITIES = [
  "chats:read",
  "messages:read",
  "media:read",
  "send:self",
  "send",
  "link",
  "admin",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

/** `admin` only exists on the engine's unix socket, it is never granted to a profile. */
export const PROFILE_CAPABILITIES = CAPABILITIES.filter(
  (capability): capability is Exclude<Capability, "admin"> => capability !== "admin",
);
export type ProfileCapability = (typeof PROFILE_CAPABILITIES)[number];

export type ConnectionState =
  | "not_linked"
  | "linking"
  | "connecting"
  | "open"
  | "reconnecting"
  | "needs_link"
  | "replaced"
  | "stopped";

export const CHAT_KINDS = ["dm", "group", "self", "broadcast", "newsletter", "other"] as const;
export type ChatKind = (typeof CHAT_KINDS)[number];

export type HistorySyncStatus = "complete" | "paused";

/** One WhatsApp history sync type (`initial_bootstrap`, `recent`, `full`, `push_name`…). */
export interface HistoryPhase {
  syncType: string;
  /** 0-100 from the phase's last chunk. */
  progress: number | null;
  status: HistorySyncStatus | null;
  /** Chunks received so far. */
  chunks: number;
  updatedAt: number;
}

export interface HistorySync {
  /** 0-100 of the furthest phase (full, else recent), null before any chunk. */
  progress: number | null;
  /**
   * `complete` once the furthest phase is done, `paused` when WhatsApp stopped sending before
   * that; null while syncing or before it started. `isLatest` alone does not mean done.
   */
  status: HistorySyncStatus | null;
  updatedAt: number | null;
  /** Oldest first. */
  phases: HistoryPhase[];
}

export interface Status {
  version: string;
  state: ConnectionState;
  needsLink: boolean;
  me: { jid: string; lid: string | null } | null;
  /** `at` is unix seconds, like every other timestamp. */
  lastDisconnect: { code: number | null; at: number } | null;
  history: HistorySync;
  /** Only what the caller can see. */
  counts: { chats: number; messages: number };
  outbox: { pending: number };
}

export interface Qr {
  state: ConnectionState;
  /** Present only while pairing. */
  qr: string | null;
}

export interface Chat {
  jid: string;
  kind: ChatKind;
  name: string | null;
  archived: boolean;
  /** Pin time (unix seconds), null when not pinned. */
  pinned: number | null;
  /** Null when unmuted, -1 when muted forever. */
  muteEndTime: number | null;
  /** -1 means marked as unread. */
  unreadCount: number;
  lastMessageAt: number | null;
}

export interface Participant {
  jid: string;
  name: string | null;
  role: "member" | "admin" | "superadmin" | "left";
}

export interface ChatDetail extends Chat {
  ephemeralExpiration: number | null;
  createdAt: number | null;
  /** Groups only; empty for other chats. */
  participants: Participant[];
}

export interface Page<T> {
  items: T[];
  /** Pass back as `cursor` for the next page; null on the last one. */
  nextCursor: string | null;
}

export interface Quote {
  /** Id, chat and sender are only given when the quoted chat is visible to the caller. */
  id: string | null;
  chat: string | null;
  sender: string | null;
  /** The snapshot of the quoted text the reply carried. */
  text: string | null;
}

export interface Message {
  chat: string;
  id: string;
  fromMe: boolean;
  sender: string | null;
  senderName: string | null;
  /** Unix seconds. */
  ts: number;
  type: string;
  text: string | null;
  caption: string | null;
  fileName: string | null;
  quoted: Quote | null;
  editedAt: number | null;
  deletedAt: number | null;
  expiresAt: number | null;
  hasMedia: boolean;
  viewOnce: boolean;
}

export interface MessagePage {
  /** Oldest first. */
  messages: Message[];
  /** Pass as `before` for older messages; null when there are none. */
  older: string | null;
  /** Pass as `after` for newer messages; null when there are none. */
  newer: string | null;
}

export interface MessageContext {
  message: Message;
  before: Message[];
  after: Message[];
}

export interface SearchHit {
  message: Message;
  chatName: string | null;
  /** Matched terms are wrapped in `SNIPPET_OPEN` / `SNIPPET_CLOSE`. */
  snippet: string;
  rank: number;
}

export const SNIPPET_OPEN = "\u0002";
export const SNIPPET_CLOSE = "\u0003";

export interface MediaInfo {
  chat: string;
  id: string;
  kind: string;
  mimetype: string | null;
  fileName: string | null;
  size: number | null;
  downloaded: boolean;
}

export interface Recipient {
  jid: string;
  name: string | null;
  kind: ChatKind;
  lastMessageAt: number | null;
}

export type OutboxStatus = "queued" | "sending" | "sent" | "failed" | "expired";

export interface OutboxEntry {
  outboxId: string;
  messageId: string;
  chat: string;
  status: OutboxStatus;
  attempts: number;
  error: string | null;
  createdAt: number;
  expiresAt: number;
}

export interface SendResult {
  outboxId: string;
  messageId: string;
  status: OutboxStatus;
}

export interface ChatCandidate {
  jid: string;
  name: string | null;
  kind: ChatKind;
}

export interface Collection {
  name: string;
  description: string | null;
  createdAt: number;
  chatCount: number;
}

export interface CollectionDetail extends Collection {
  chats: ChatCandidate[];
}

export interface Profile {
  name: string;
  capabilities: ProfileCapability[];
  allChats: boolean;
  collections: string[];
  builtin: boolean;
  createdAt: number;
}

export interface TokenInfo {
  id: string;
  profile: string;
  label: string | null;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

export interface CreatedToken extends TokenInfo {
  /** Shown once; only its hash is stored. */
  token: string;
}

export interface AuditEntry {
  id: number;
  ts: number;
  tokenId: string | null;
  /** Null for admin actions over the unix socket. */
  profile: string | null;
  action: string;
  chat: string | null;
  detail: Record<string, unknown> | null;
}

/**
 * Why a backfill stopped: `max` reached, `empty` (WhatsApp has nothing older), `timeout` (the
 * phone did not answer), `no_anchor` (nothing stored in the chat to page back from),
 * `disconnected`, `stopped` (the engine shut down) or `failed`.
 */
export type BackfillStopReason =
  | "max"
  | "empty"
  | "timeout"
  | "no_anchor"
  | "disconnected"
  | "stopped"
  | "failed";

/** A `wa backfill` run: pages of older messages requested from the phone, one after another. */
export interface BackfillJob {
  id: string;
  chat: string;
  chatName: string | null;
  state: "running" | "done";
  max: number;
  /** Older messages stored so far. */
  fetched: number;
  /** History requests sent to the phone. */
  requests: number;
  /** Unix seconds of the chat's oldest stored message. */
  oldestAt: number | null;
  stopReason: BackfillStopReason | null;
  startedAt: number;
  finishedAt: number | null;
}
