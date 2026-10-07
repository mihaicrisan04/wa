import { nowSeconds, type Database } from "./db";
import type { MediaInfo, MessageKeyRef } from "./messages";

export interface MediaRow {
  chat_jid: string;
  message_id: string;
  kind: string;
  mimetype: string | null;
  file_name: string | null;
  size: number | null;
  local_path: string | null;
  downloaded_at: number | null;
}

export class MediaRepo {
  constructor(private readonly db: Database) {}

  /** Records what a message carries; an existing download stays cached. */
  upsert(key: MessageKeyRef, info: MediaInfo): void {
    this.db
      .query(
        `INSERT INTO media (chat_jid, message_id, kind, mimetype, file_name, size)
         VALUES ($chatJid, $id, $kind, $mimetype, $fileName, $size)
         ON CONFLICT (chat_jid, message_id) DO UPDATE SET
           kind = excluded.kind, mimetype = excluded.mimetype,
           file_name = excluded.file_name, size = coalesce(media.size, excluded.size)`,
      )
      .run({ ...key, ...info });
  }

  get(key: MessageKeyRef): MediaRow | null {
    return this.db
      .query<MediaRow, MessageKeyRef>(
        "SELECT * FROM media WHERE chat_jid = $chatJid AND message_id = $id",
      )
      .get(key);
  }

  /** False when the message was deleted, revoked or moved meanwhile: the file is not kept. */
  markDownloaded(key: MessageKeyRef, localPath: string, size: number): boolean {
    const { changes } = this.db
      .query(
        `UPDATE media SET local_path = $localPath, size = $size, downloaded_at = $now
         WHERE chat_jid = $chatJid AND message_id = $id AND EXISTS (
           SELECT 1 FROM messages
           WHERE chat_jid = media.chat_jid AND id = media.message_id AND deleted_at IS NULL
         )`,
      )
      .run({ ...key, localPath, size, now: nowSeconds() });
    return changes > 0;
  }

  /** Deletes the row and returns the cached file to remove, if any. */
  remove(key: MessageKeyRef): string | null {
    const row = this.db
      .query<{ local_path: string | null }, MessageKeyRef>(
        "DELETE FROM media WHERE chat_jid = $chatJid AND message_id = $id RETURNING local_path",
      )
      .get(key);
    return row?.local_path ?? null;
  }

  removeChat(chatJid: string): string[] {
    return this.db
      .query<{ local_path: string | null }, { chatJid: string }>(
        "DELETE FROM media WHERE chat_jid = $chatJid RETURNING local_path",
      )
      .all({ chatJid })
      .flatMap((row) => (row.local_path ? [row.local_path] : []));
  }

  /**
   * Follows `MessagesRepo.moveChat` (run it first): on a clash the target's copy is kept, and
   * media of messages the merge left revoked goes.
   */
  moveChat(from: string, to: string): string[] {
    const clashes = this.db
      .query<{ local_path: string | null }, { from: string; to: string }>(
        `DELETE FROM media
         WHERE chat_jid = $from AND message_id IN (SELECT message_id FROM media WHERE chat_jid = $to)
         RETURNING local_path`,
      )
      .all({ from, to });
    this.db.query("UPDATE media SET chat_jid = $to WHERE chat_jid = $from").run({ from, to });
    const revoked = this.db
      .query<{ local_path: string | null }, { to: string }>(
        `DELETE FROM media
         WHERE chat_jid = $to AND message_id IN (
           SELECT id FROM messages WHERE chat_jid = $to AND deleted_at IS NOT NULL
         )
         RETURNING local_path`,
      )
      .all({ to });
    return [...clashes, ...revoked].flatMap((row) => (row.local_path ? [row.local_path] : []));
  }
}
