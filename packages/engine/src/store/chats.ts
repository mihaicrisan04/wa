import { nowSeconds, type Database } from "./db";

export type ChatKind = "dm" | "group" | "self" | "broadcast" | "newsletter" | "other";

export interface ChatRow {
  jid: string;
  kind: ChatKind;
  name: string | null;
  archived: number;
  /** Pin timestamp, null when not pinned. */
  pinned: number | null;
  /** Null when unmuted. */
  mute_end_time: number | null;
  /** -1 means marked as unread. */
  unread_count: number;
  ephemeral_expiration: number | null;
  last_message_at: number | null;
  created_at: number | null;
  updated_at: number;
}

/** Only the fields present are written, mirroring Baileys' partial chat updates. */
export interface ChatPatch {
  name?: string | null;
  archived?: boolean;
  pinned?: number | null;
  muteEndTime?: number | null;
  unreadCount?: number;
  ephemeralExpiration?: number | null;
  lastMessageAt?: number | null;
  createdAt?: number | null;
}

const PATCH_COLUMNS: Record<keyof ChatPatch, string> = {
  name: "name",
  archived: "archived",
  pinned: "pinned",
  muteEndTime: "mute_end_time",
  unreadCount: "unread_count",
  ephemeralExpiration: "ephemeral_expiration",
  lastMessageAt: "last_message_at",
  createdAt: "created_at",
};

export class ChatsRepo {
  constructor(private readonly db: Database) {}

  get(jid: string): ChatRow | null {
    return this.db
      .query<ChatRow, { jid: string }>("SELECT * FROM chats WHERE jid = $jid")
      .get({ jid });
  }

  /** Creates the chat if it is new; the kind follows the jid (a DM becomes `self` once linked). */
  ensure(jid: string, kind: ChatKind): void {
    this.db
      .query(
        `INSERT INTO chats (jid, kind, updated_at) VALUES ($jid, $kind, $now)
         ON CONFLICT (jid) DO UPDATE SET kind = excluded.kind WHERE chats.kind != excluded.kind`,
      )
      .run({ jid, kind, now: nowSeconds() });
  }

  upsert(jid: string, kind: ChatKind, patch: ChatPatch = {}): void {
    const entries = (Object.keys(patch) as (keyof ChatPatch)[])
      .filter((field) => patch[field] !== undefined)
      .map((field) => [PATCH_COLUMNS[field], toColumnValue(patch[field])] as const);
    const columns = entries.map(([column]) => column);
    const updates = columns.map((column) =>
      column === "last_message_at"
        ? "last_message_at = max(coalesce(chats.last_message_at, 0), coalesce(excluded.last_message_at, 0))"
        : `${column} = excluded.${column}`,
    );
    this.db
      .query(
        `INSERT INTO chats (jid, kind, updated_at${columns.map((column) => `, ${column}`).join("")})
         VALUES ($jid, $kind, $now${columns.map((column) => `, $${column}`).join("")})
         ON CONFLICT (jid) DO UPDATE SET kind = excluded.kind, updated_at = excluded.updated_at${updates
           .map((update) => `, ${update}`)
           .join("")}`,
      )
      .run({ jid, kind, now: nowSeconds(), ...Object.fromEntries(entries) } as never);
  }

  /** Moves the clock forward only: history arrives newest first, then older pages. */
  touch(jid: string, ts: number): void {
    this.db
      .query(
        `UPDATE chats SET last_message_at = $ts
         WHERE jid = $jid AND (last_message_at IS NULL OR last_message_at < $ts)`,
      )
      .run({ jid, ts });
  }

  delete(jid: string): boolean {
    return this.db.query("DELETE FROM chats WHERE jid = $jid").run({ jid }).changes > 0;
  }

  /**
   * Folds chat `from` into `to`: the target keeps its own settings and inherits the ones it
   * lacks, collection membership and queued sends move along, then `from` is dropped.
   */
  merge(from: string, to: string, kind: ChatKind): void {
    const source = this.get(from);
    if (source) {
      this.upsert(to, kind);
      this.db
        .query(
          `UPDATE chats SET
             name = coalesce(chats.name, $name),
             archived = chats.archived OR $archived,
             pinned = coalesce(chats.pinned, $pinned),
             mute_end_time = coalesce(chats.mute_end_time, $muteEndTime),
             unread_count = CASE WHEN chats.unread_count = 0 THEN $unreadCount ELSE chats.unread_count END,
             ephemeral_expiration = coalesce(chats.ephemeral_expiration, $ephemeralExpiration),
             last_message_at = max(coalesce(chats.last_message_at, 0), coalesce($lastMessageAt, 0)),
             created_at = coalesce(chats.created_at, $createdAt)
           WHERE jid = $to`,
        )
        .run({
          to,
          name: source.name,
          archived: source.archived,
          pinned: source.pinned,
          muteEndTime: source.mute_end_time,
          unreadCount: source.unread_count,
          ephemeralExpiration: source.ephemeral_expiration,
          lastMessageAt: source.last_message_at,
          createdAt: source.created_at,
        });
      this.delete(from);
    }
    this.db
      .query(
        `INSERT INTO collection_chats (collection, chat_jid)
         SELECT collection, $to FROM collection_chats WHERE chat_jid = $from
         ON CONFLICT DO NOTHING`,
      )
      .run({ from, to });
    this.db.query("DELETE FROM collection_chats WHERE chat_jid = $from").run({ from });
    this.db.query("UPDATE outbox SET chat_jid = $to WHERE chat_jid = $from").run({ from, to });
  }
}

function toColumnValue(value: ChatPatch[keyof ChatPatch]): string | number | null {
  if (typeof value === "boolean") return value ? 1 : 0;
  return value ?? null;
}
