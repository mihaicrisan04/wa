import type { Database } from "./db";

export const PLACEHOLDER_TYPE = "placeholder";
export const REVOKED_TYPE = "revoked";

export interface MediaInfo {
  kind: string;
  mimetype: string | null;
  fileName: string | null;
  size: number | null;
}

/** A normalized message, ready to be written. Jids are canonical. */
export interface MessageRecord {
  chatJid: string;
  id: string;
  fromMe: boolean;
  senderJid: string | null;
  senderAlt: string | null;
  /** Unix seconds. */
  ts: number;
  type: string;
  text: string | null;
  caption: string | null;
  fileName: string | null;
  quotedId: string | null;
  quotedChatJid: string | null;
  quotedParticipant: string | null;
  quotedText: string | null;
  editedAt: number | null;
  deletedAt: number | null;
  expiresAt: number | null;
  viewOnce: boolean;
  source: "live" | "history";
  /** BufferJSON of the WebMessageInfo; null for view-once messages. */
  raw: string | null;
  media: MediaInfo | null;
}

export interface MessageRow {
  rowid: number;
  chat_jid: string;
  id: string;
  from_me: number;
  sender_jid: string | null;
  sender_alt: string | null;
  ts: number;
  type: string;
  text: string | null;
  caption: string | null;
  file_name: string | null;
  quoted_id: string | null;
  quoted_chat_jid: string | null;
  quoted_participant: string | null;
  quoted_text: string | null;
  edited_at: number | null;
  deleted_at: number | null;
  expires_at: number | null;
  has_media: number;
  view_once: number;
  source: "live" | "history";
  raw: string | null;
}

export type MessageKeyRef = {
  chatJid: string;
  id: string;
};

const COLUMNS = [
  "chat_jid",
  "id",
  "from_me",
  "sender_jid",
  "sender_alt",
  "ts",
  "type",
  "text",
  "caption",
  "file_name",
  "quoted_id",
  "quoted_chat_jid",
  "quoted_participant",
  "quoted_text",
  "edited_at",
  "deleted_at",
  "expires_at",
  "has_media",
  "view_once",
  "source",
  "raw",
] as const;

/** Content columns an incoming copy may overwrite; `source` keeps the first sighting. */
const UPDATABLE = COLUMNS.filter((column) => !["chat_jid", "id", "source"].includes(column));

const REWRITABLE = UPDATABLE.filter((column) => column !== "edited_at" && column !== "deleted_at");

/**
 * A stored row is replaced when it is a placeholder or the incoming copy has content, but a
 * tombstone is never resurrected and an older copy never reverts an edit.
 */
const UPSERT_SQL = `
  INSERT INTO messages (${COLUMNS.join(", ")})
  VALUES (${COLUMNS.map((column) => `$${column}`).join(", ")})
  ON CONFLICT (chat_jid, id) DO UPDATE SET
    ${UPDATABLE.map((column) => `${column} = excluded.${column}`).join(",\n    ")}
  WHERE messages.deleted_at IS NULL AND (
    excluded.deleted_at IS NOT NULL
    OR messages.type = '${PLACEHOLDER_TYPE}'
    OR (
      excluded.type != '${PLACEHOLDER_TYPE}'
      AND (messages.edited_at IS NULL OR coalesce(excluded.edited_at, 0) >= messages.edited_at)
    )
  )
  RETURNING rowid`;

export function recordParams(record: MessageRecord) {
  return {
    chat_jid: record.chatJid,
    id: record.id,
    from_me: record.fromMe ? 1 : 0,
    sender_jid: record.senderJid,
    sender_alt: record.senderAlt,
    ts: record.ts,
    type: record.type,
    text: record.text,
    caption: record.caption,
    file_name: record.fileName,
    quoted_id: record.quotedId,
    quoted_chat_jid: record.quotedChatJid,
    quoted_participant: record.quotedParticipant,
    quoted_text: record.quotedText,
    edited_at: record.editedAt,
    deleted_at: record.deletedAt,
    expires_at: record.expiresAt,
    has_media: record.media ? 1 : 0,
    view_once: record.viewOnce ? 1 : 0,
    source: record.source,
    raw: record.raw,
  };
}

export class MessagesRepo {
  constructor(private readonly db: Database) {}

  /** Returns false when the stored row wins (see UPSERT_SQL). */
  upsert(record: MessageRecord): boolean {
    return this.db.query(UPSERT_SQL).get(recordParams(record)) !== null;
  }

  get(chatJid: string, id: string): MessageRow | null {
    return this.db
      .query<MessageRow, MessageKeyRef>(
        "SELECT * FROM messages WHERE chat_jid = $chatJid AND id = $id",
      )
      .get({ chatJid, id });
  }

  /** Rewrites everything derived from `raw` (reindex), keeping event-derived edit/delete times. */
  rewrite(rowid: number, record: MessageRecord): void {
    const params: Record<string, unknown> = recordParams(record);
    const assignments = REWRITABLE.map((column) => `${column} = $${column}`).join(", ");
    const values = Object.fromEntries(REWRITABLE.map((column) => [column, params[column]]));
    this.db
      .query(`UPDATE messages SET ${assignments} WHERE rowid = $rowid`)
      .run({ ...values, rowid } as never);
  }

  applyEdit(
    key: MessageKeyRef,
    edit: { text: string | null; caption: string | null; editedAt: number; raw: string | null },
  ): void {
    this.db
      .query(
        `UPDATE messages SET text = $text, caption = $caption, edited_at = $editedAt, raw = $raw
         WHERE chat_jid = $chatJid AND id = $id AND deleted_at IS NULL`,
      )
      .run({ ...key, ...edit });
  }

  /** Clears the content of a revoked message and keeps the row as a tombstone. */
  tombstone(key: MessageKeyRef, deletedAt: number, raw: string | null): void {
    this.db
      .query(
        `UPDATE messages SET type = '${REVOKED_TYPE}', text = NULL, caption = NULL, file_name = NULL,
           quoted_text = NULL, has_media = 0, deleted_at = $deletedAt, raw = $raw
         WHERE chat_jid = $chatJid AND id = $id AND deleted_at IS NULL`,
      )
      .run({ ...key, deletedAt, raw });
  }

  updateRaw(key: MessageKeyRef, raw: string): void {
    this.db
      .query("UPDATE messages SET raw = $raw WHERE chat_jid = $chatJid AND id = $id")
      .run({ ...key, raw });
  }

  delete(key: MessageKeyRef): boolean {
    return (
      this.db.query("DELETE FROM messages WHERE chat_jid = $chatJid AND id = $id").run(key)
        .changes > 0
    );
  }

  deleteChat(chatJid: string): number {
    return this.db.query("DELETE FROM messages WHERE chat_jid = $chatJid").run({ chatJid }).changes;
  }

  expired(now: number): MessageKeyRef[] {
    return this.db
      .query<MessageKeyRef, { now: number }>(
        "SELECT chat_jid AS chatJid, id FROM messages WHERE expires_at IS NOT NULL AND expires_at <= $now",
      )
      .all({ now });
  }

  latestTimestamp(chatJid: string): number | null {
    return (
      this.db
        .query<{ ts: number | null }, { chatJid: string }>(
          "SELECT max(ts) AS ts FROM messages WHERE chat_jid = $chatJid",
        )
        .get({ chatJid })?.ts ?? null
    );
  }

  /** Rows in rowid order, a page at a time, for reindexing. */
  page(afterRowid: number, limit: number): MessageRow[] {
    return this.db
      .query<MessageRow, { afterRowid: number; limit: number }>(
        "SELECT * FROM messages WHERE rowid > $afterRowid ORDER BY rowid LIMIT $limit",
      )
      .all({ afterRowid, limit });
  }

  /**
   * Moves a chat's messages to another jid. When both hold the same message id, the copy
   * with content wins over a placeholder, otherwise the target's copy is kept.
   */
  moveChat(from: string, to: string): void {
    this.db
      .query(
        `DELETE FROM messages AS target
         WHERE target.chat_jid = $to AND target.type = '${PLACEHOLDER_TYPE}' AND EXISTS (
           SELECT 1 FROM messages AS source
           WHERE source.chat_jid = $from AND source.id = target.id
             AND source.type != '${PLACEHOLDER_TYPE}'
         )`,
      )
      .run({ from, to });
    this.db
      .query(
        `DELETE FROM messages
         WHERE chat_jid = $from AND id IN (SELECT id FROM messages WHERE chat_jid = $to)`,
      )
      .run({ from, to });
    this.db.query("UPDATE messages SET chat_jid = $to WHERE chat_jid = $from").run({ from, to });
    this.db
      .query("UPDATE messages SET quoted_chat_jid = $to WHERE quoted_chat_jid = $from")
      .run({ from, to });
  }

  /** Re-points a person's messages from one of their jids to their canonical one. */
  renameUser(from: string, to: string): void {
    this.db
      .query(
        "UPDATE messages SET sender_jid = $to, sender_alt = coalesce(sender_alt, $from) WHERE sender_jid = $from",
      )
      .run({ from, to });
    this.db
      .query("UPDATE messages SET quoted_participant = $to WHERE quoted_participant = $from")
      .run({ from, to });
  }
}
