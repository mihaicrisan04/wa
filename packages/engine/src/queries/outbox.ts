import type { OutboxEntry } from "@wa/sdk";
import { notFound } from "../errors";
import type { OutboxRow } from "../store";
import { inScope } from "./resolve";
import type { ReadContext } from "./rows";

/** An entry is visible to the profile that queued it, while its chat is still in scope. */
export function getOutboxEntry(ctx: ReadContext, id: string): OutboxEntry {
  const row = ctx.store.outbox.get(id);
  if (!row || !mayRead(ctx, row)) throw notFound();
  return toOutboxEntry(row);
}

function mayRead(ctx: ReadContext, row: OutboxRow): boolean {
  const { principal } = ctx;
  if (principal.kind === "admin") return true;
  if (row.profile !== principal.profile) return false;
  return row.chat_jid === ctx.identity.me() || inScope(ctx, row.chat_jid);
}

function toOutboxEntry(row: OutboxRow): OutboxEntry {
  return {
    outboxId: row.id,
    messageId: row.message_id,
    chat: row.chat_jid,
    status: row.status,
    attempts: row.attempts,
    error: row.error,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}
