import type { MediaInfo, Status } from "@wa/sdk";
import { notFound } from "../errors";
import { and, scopeSql, type SqlFragment, type SqlParams } from "../policy";
import type { MediaRow } from "../store";
import type { ConnectionStatus } from "../whatsapp/connection";
import { readHistorySync } from "./history";
import { visibleMessages } from "./messages";
import { resolveChat } from "./resolve";
import type { ReadContext } from "./rows";

const NEEDS_LINK: ReadonlySet<ConnectionStatus["state"]> = new Set(["not_linked", "needs_link"]);

/** Connection and sync state, with counts limited to what the principal can see. */
export function readStatus(
  ctx: ReadContext,
  version: string,
  connection: ConnectionStatus,
): Status {
  return {
    version,
    state: connection.state,
    needsLink: NEEDS_LINK.has(connection.state),
    me: connection.me ? { jid: connection.me.pn, lid: connection.me.lid } : null,
    lastDisconnect: connection.lastDisconnect,
    history: readHistorySync(ctx.store),
    counts: {
      chats: count(ctx, "chats AS ch", scopeSql(ctx.principal, "ch.jid")),
      messages: count(ctx, "messages AS m", visibleMessages(ctx)),
    },
    outbox: {
      pending: count(
        ctx,
        "outbox AS o",
        and(scopeSql(ctx.principal, "o.chat_jid"), {
          sql: "o.status IN ('queued', 'sending')",
          params: {},
        }),
      ),
    },
  };
}

function count(ctx: ReadContext, table: string, where: SqlFragment): number {
  return (
    ctx.store.db
      .query<{ n: number }, SqlParams>(`SELECT count(*) AS n FROM ${table} WHERE ${where.sql}`)
      .get(where.params)?.n ?? 0
  );
}

/** Media a visible, not deleted message carries. */
export function findMedia(ctx: ReadContext, ref: string, id: string): MediaRow {
  const chat = resolveChat(ctx, ref);
  const visible = visibleMessages(ctx);
  const row = ctx.store.db
    .query<MediaRow, SqlParams>(
      `SELECT md.* FROM media AS md
       JOIN messages AS m ON m.chat_jid = md.chat_jid AND m.id = md.message_id
       WHERE md.chat_jid = $chat AND md.message_id = $id AND m.deleted_at IS NULL
         AND (${visible.sql})`,
    )
    .get({ ...visible.params, chat, id });
  if (!row) throw notFound("media not found");
  return row;
}

export function toMediaInfo(row: MediaRow): MediaInfo {
  return {
    chat: row.chat_jid,
    id: row.message_id,
    kind: row.kind,
    mimetype: row.mimetype,
    fileName: row.file_name,
    size: row.size,
    downloaded: row.local_path !== null,
  };
}
