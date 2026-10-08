import type { Status } from "@wa/sdk";
import { and, scopeSql, type SqlFragment, type SqlParams } from "../policy";
import type { ConnectionStatus } from "../whatsapp/connection";
import { readHistorySync } from "./history";
import { visibleMessages } from "./messages";
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
