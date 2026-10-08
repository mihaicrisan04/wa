import type { Database } from "./db";
import type { MessageKeyRef } from "./messages";

/** How long a revoke waits for its message before it is dropped, in seconds. */
export const PENDING_REVOKE_TTL = 30 * 24 * 60 * 60;

/** A revoke whose target's sender is not known yet. */
export interface PendingRevoke {
  actor: { fromMe: boolean; jid: string | null };
  /** Unix seconds. */
  ts: number;
}

/** `pending_revokes`: revokes waiting for a copy of their message that says who sent it. */
export class PendingRevokesRepo {
  constructor(private readonly db: Database) {}

  add(key: MessageKeyRef, { actor, ts }: PendingRevoke): void {
    this.db
      .query(
        `INSERT INTO pending_revokes (chat_jid, message_id, actor_from_me, actor_jid, ts)
         VALUES ($chatJid, $id, $fromMe, $jid, $ts)`,
      )
      .run({ ...key, fromMe: actor.fromMe ? 1 : 0, jid: actor.jid, ts });
  }

  /** Removes and returns the revokes waiting for this message. */
  take(key: MessageKeyRef): PendingRevoke[] {
    return this.db
      .query<{ actor_from_me: number; actor_jid: string | null; ts: number }, MessageKeyRef>(
        `DELETE FROM pending_revokes WHERE chat_jid = $chatJid AND message_id = $id
         RETURNING actor_from_me, actor_jid, ts`,
      )
      .all(key)
      .map((row) => ({
        actor: { fromMe: row.actor_from_me === 1, jid: row.actor_jid },
        ts: row.ts,
      }));
  }

  /** Drops revokes made before `before` (unix seconds); their message is unlikely to ever arrive. */
  prune(before: number): void {
    this.db.query("DELETE FROM pending_revokes WHERE ts < $before").run({ before });
  }

  moveChat(from: string, to: string): void {
    this.db
      .query("UPDATE pending_revokes SET chat_jid = $to WHERE chat_jid = $from")
      .run({ from, to });
  }

  renameUser(from: string, to: string): void {
    this.db
      .query("UPDATE pending_revokes SET actor_jid = $to WHERE actor_jid = $from")
      .run({ from, to });
  }
}
