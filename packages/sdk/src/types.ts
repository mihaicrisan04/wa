export const DEFAULT_PORT = 7373;

/** How to (re)start the engine, for clients' "not running" errors. */
export const START_ENGINE = "`wa service install` (or `wa serve` in a terminal)";

/** How many older messages `admin.backfill.start` asks for when `max` is left out. */
export const BACKFILL_DEFAULT_MAX = 500;

/** WhatsApp's cap for documents; the engine accepts uploads up to this size. */
export const MAX_UPLOAD_BYTES = 2 * 1024 ** 3;
export const UPLOAD_TOO_LARGE = "WhatsApp only takes files up to 2 GB";

export interface Health {
  ok: boolean;
  version: string;
}

export type ApiErrorCode =
  | "already_linked"
  | "ambiguous"
  | "builtin"
  | "exists"
  | "forbidden"
  | "forbidden_host"
  | "forbidden_origin"
  | "internal"
  | "invalid_request"
  | "not_found"
  | "not_linked"
  | "not_media"
  | "offline"
  | "token_in_query"
  | "too_large"
  | "unauthorized"
  | "view_once"
  /** The SDK's own: a failed response without a JSON error body. */
  | "http_error";

export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string; candidates?: ChatCandidate[] };
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

export const CONNECTION_STATES = [
  /** No credentials yet; idle until linked. */
  "not_linked",
  /** Socket open for pairing, QR codes are being issued. */
  "linking",
  "connecting",
  "open",
  "reconnecting",
  /** Logged out from the phone; credentials were moved aside. */
  "needs_link",
  /** Another session took over; never reconnects on its own. */
  "replaced",
  "stopped",
] as const;
export type ConnectionState = (typeof CONNECTION_STATES)[number];

export const CHAT_KINDS = ["dm", "group", "self", "broadcast", "newsletter", "other"] as const;
export type ChatKind = (typeof CHAT_KINDS)[number];

export const MEDIA_KINDS = ["image", "video", "audio", "document", "sticker"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/** The message types the engine names; other WhatsApp content keeps its own type name. */
export const MESSAGE_TYPES = [
  "text",
  ...MEDIA_KINDS,
  "location",
  "contact",
  "poll",
  "event",
  /** Content still on its way from the phone. */
  "placeholder",
  "revoked",
] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

export function isMessageType(type: string): type is MessageType {
  return MESSAGE_TYPES.some((known) => known === type);
}

export const HISTORY_SYNC_STATUSES = ["complete", "paused"] as const;
export type HistorySyncStatus = (typeof HISTORY_SYNC_STATUSES)[number];

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
  /** Of the furthest phase: null while syncing or before it started. */
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

export type ParticipantRole = "member" | "admin" | "superadmin" | "left";

export interface Participant {
  jid: string;
  name: string | null;
  role: ParticipantRole;
}

export interface ChatDetail extends Chat {
  ephemeralExpiration: number | null;
  createdAt: number | null;
  /** Groups only; empty for other chats. */
  participants: Participant[];
}

/** What every list endpoint returns; paged lists add their cursors to it. */
export interface Items<T> {
  items: T[];
}

export interface Page<T> extends Items<T> {
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
  /** One of `MESSAGE_TYPES`, or the type name of content the engine doesn't name. */
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

/** `items` are oldest first. */
export interface MessagePage extends Items<Message> {
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
  kind: MediaKind;
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

/** Why a backfill stopped. */
export type BackfillStopReason =
  | "max"
  /** WhatsApp has nothing older. */
  | "empty"
  /** The phone did not answer. */
  | "timeout"
  /** Nothing stored in the chat to page back from. */
  | "no_anchor"
  | "disconnected"
  /** The engine shut down. */
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
