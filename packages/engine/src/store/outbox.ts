import type { OutboxStatus } from "@wa/sdk";
import { nowSeconds } from "../clock";
import type { OutgoingContent } from "../whatsapp/outgoing";
import type { Database } from "./db";

interface StoredOutboxRow {
  id: string;
  message_id: string;
  chat_jid: string;
  /** The profile that queued it (null for admin); only it may read the entry back. */
  profile: string | null;
  payload: string;
  file_path: string | null;
  status: OutboxStatus;
  attempts: number;
  error: string | null;
  expires_at: number;
  created_at: number;
  updated_at: number;
}

/** An outbox row with its payload parsed; a file's bytes live at `file_path`. */
export type OutboxRow = Omit<StoredOutboxRow, "payload"> & { payload: OutgoingContent };

export interface NewOutboxEntry {
  id: string;
  messageId: string;
  chatJid: string;
  profile: string | null;
  payload: OutgoingContent;
  filePath: string | null;
  expiresAt: number;
}

export class OutboxRepo {
  constructor(private readonly db: Database) {}

  insert(entry: NewOutboxEntry): OutboxRow {
    const now = nowSeconds();
    const row = this.db
      .query<StoredOutboxRow, Record<string, string | number | null>>(
        `INSERT INTO outbox (id, message_id, chat_jid, profile, payload, file_path, status, expires_at, created_at, updated_at)
         VALUES ($id, $messageId, $chatJid, $profile, $payload, $filePath, 'queued', $expiresAt, $now, $now)
         RETURNING *`,
      )
      .get({
        id: entry.id,
        messageId: entry.messageId,
        chatJid: entry.chatJid,
        profile: entry.profile,
        payload: JSON.stringify(entry.payload),
        filePath: entry.filePath,
        expiresAt: entry.expiresAt,
        now,
      })!;
    return toRow(row);
  }

  get(id: string): OutboxRow | null {
    const row = this.db
      .query<StoredOutboxRow, { id: string }>("SELECT * FROM outbox WHERE id = $id")
      .get({ id });
    return row ? toRow(row) : null;
  }

  /** The oldest entry still waiting; entries go out strictly in order. */
  next(): OutboxRow | null {
    const row = this.db
      .query<StoredOutboxRow, []>(
        "SELECT * FROM outbox WHERE status = 'queued' ORDER BY created_at, rowid LIMIT 1",
      )
      .get();
    return row ? toRow(row) : null;
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
  requeueInterrupted(): void {
    this.db.query("UPDATE outbox SET status = 'queued' WHERE status = 'sending'").run();
  }

  moveChat(from: string, to: string): void {
    this.db.query("UPDATE outbox SET chat_jid = $to WHERE chat_jid = $from").run({ from, to });
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

function toRow(row: StoredOutboxRow): OutboxRow {
  return { ...row, payload: JSON.parse(row.payload) as OutgoingContent };
}
