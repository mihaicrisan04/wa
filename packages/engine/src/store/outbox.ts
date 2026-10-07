import type { OutboxStatus } from "@wa/sdk";
import { nowSeconds, type Database } from "./db";

/** What to send; the file bytes themselves live at `file_path`. */
export type OutboxPayload = (
  | { kind: "text"; text: string }
  | { kind: "file"; caption: string | null; fileName: string; mimetype: string | null }
) & {
  /** The profile that queued it (null for admin); only it may read the entry back. */
  profile: string | null;
};

export interface OutboxRow {
  id: string;
  message_id: string;
  chat_jid: string;
  payload: string;
  file_path: string | null;
  status: OutboxStatus;
  attempts: number;
  error: string | null;
  expires_at: number;
  created_at: number;
  updated_at: number;
}

export interface NewOutboxEntry {
  id: string;
  messageId: string;
  chatJid: string;
  payload: OutboxPayload;
  filePath: string | null;
  expiresAt: number;
}

export class OutboxRepo {
  constructor(private readonly db: Database) {}

  insert(entry: NewOutboxEntry): OutboxRow {
    const now = nowSeconds();
    return this.db
      .query<OutboxRow, Record<string, string | number | null>>(
        `INSERT INTO outbox (id, message_id, chat_jid, payload, file_path, status, expires_at, created_at, updated_at)
         VALUES ($id, $messageId, $chatJid, $payload, $filePath, 'queued', $expiresAt, $now, $now)
         RETURNING *`,
      )
      .get({
        id: entry.id,
        messageId: entry.messageId,
        chatJid: entry.chatJid,
        payload: JSON.stringify(entry.payload),
        filePath: entry.filePath,
        expiresAt: entry.expiresAt,
        now,
      })!;
  }

  get(id: string): OutboxRow | null {
    return this.db
      .query<OutboxRow, { id: string }>("SELECT * FROM outbox WHERE id = $id")
      .get({ id });
  }

  /** The oldest entry still waiting; entries go out strictly in order. */
  next(): OutboxRow | null {
    return this.db
      .query<OutboxRow, []>(
        "SELECT * FROM outbox WHERE status = 'queued' ORDER BY created_at, rowid LIMIT 1",
      )
      .get();
  }

  markSending(id: string): void {
    this.db
      .query(
        `UPDATE outbox SET status = 'sending', attempts = attempts + 1, updated_at = $now
         WHERE id = $id`,
      )
      .run({ id, now: nowSeconds() });
  }

  finish(id: string, status: OutboxStatus, error: string | null = null): void {
    this.db
      .query("UPDATE outbox SET status = $status, error = $error, updated_at = $now WHERE id = $id")
      .run({ id, status, error, now: nowSeconds() });
  }

  /** A crash mid-send leaves rows `sending`; the fixed message id makes resending safe. */
  requeueInterrupted(): number {
    return this.db.query("UPDATE outbox SET status = 'queued' WHERE status = 'sending'").run()
      .changes;
  }

  /** Marks waiting entries past their expiry as expired; returns their files to remove. */
  expire(now: number = nowSeconds()): string[] {
    return this.db
      .query<{ file_path: string | null }, { now: number }>(
        `UPDATE outbox SET status = 'expired', updated_at = $now
         WHERE status IN ('queued', 'sending') AND expires_at <= $now
         RETURNING file_path`,
      )
      .all({ now })
      .flatMap((row) => (row.file_path ? [row.file_path] : []));
  }
}
