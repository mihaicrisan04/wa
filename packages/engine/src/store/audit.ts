import type { AuditEntry } from "@wa/sdk";
import { nowSeconds } from "../clock";
import type { Database } from "./db";

interface AuditRow {
  id: number;
  ts: number;
  token_id: string | null;
  profile: string | null;
  action: string;
  chat_jid: string | null;
  detail: string | null;
}

export interface AuditRecord {
  tokenId: string | null;
  profile: string | null;
  action: string;
  chatJid?: string | null;
  /** Counts and ids only, never message text or file names. */
  detail?: Record<string, unknown>;
}

export class AuditRepo {
  constructor(private readonly db: Database) {}

  record(entry: AuditRecord): void {
    this.db
      .query(
        `INSERT INTO audit_log (ts, token_id, profile, action, chat_jid, detail)
         VALUES ($ts, $tokenId, $profile, $action, $chatJid, $detail)`,
      )
      .run({
        ts: nowSeconds(),
        tokenId: entry.tokenId,
        profile: entry.profile,
        action: entry.action,
        chatJid: entry.chatJid ?? null,
        detail: entry.detail ? JSON.stringify(entry.detail) : null,
      });
  }

  /** Newest first; `beforeId` pages back. */
  list(options: { profile?: string; beforeId?: number; limit: number }): AuditEntry[] {
    return this.db
      .query<AuditRow, Record<string, string | number | null>>(
        `SELECT * FROM audit_log
         WHERE ($profile IS NULL OR profile = $profile) AND ($beforeId IS NULL OR id < $beforeId)
         ORDER BY id DESC LIMIT $limit`,
      )
      .all({
        profile: options.profile ?? null,
        beforeId: options.beforeId ?? null,
        limit: options.limit,
      })
      .map(toEntry);
  }
}

function toEntry(row: AuditRow): AuditEntry {
  return {
    id: row.id,
    ts: row.ts,
    tokenId: row.token_id,
    profile: row.profile,
    action: row.action,
    chat: row.chat_jid,
    detail: row.detail ? (JSON.parse(row.detail) as Record<string, unknown>) : null,
  };
}
