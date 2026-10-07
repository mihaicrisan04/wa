import type { Message, MessageContext, MessagePage } from "@wa/sdk";
import { notFound } from "../errors";
import { and, scopeSql, type SqlFragment, type SqlParams } from "../policy";
import { nowSeconds } from "../store";
import { encodeCursor, parseBound, type Position } from "./cursor";
import { resolveChat } from "./resolve";
import { messageSelect, toMessage, type MessageRecordRow, type ReadContext } from "./rows";

export interface MessageListOptions {
  before?: string;
  after?: string;
  /** A message id to center the page on. */
  around?: string;
  limit: number;
}

type Order = "ASC" | "DESC";

/** Visible messages `m`: in scope, and not past a disappearing timer the purge hasn't caught. */
export function visibleMessages(ctx: ReadContext): SqlFragment {
  return and(scopeSql(ctx.principal, "m.chat_jid"), {
    sql: "m.expires_at IS NULL OR m.expires_at > $now",
    params: { now: nowSeconds() },
  });
}

export function selectMessages(
  ctx: ReadContext,
  where: SqlFragment,
  order: Order,
  limit: number,
): MessageRecordRow[] {
  const select = messageSelect(ctx.principal);
  const filter = and(visibleMessages(ctx), where);
  return ctx.store.db
    .query<MessageRecordRow, SqlParams>(
      `${select.sql} WHERE ${filter.sql}
       ORDER BY m.ts ${order}, m.rowid ${order} LIMIT $limit`,
    )
    .all({ ...select.params, ...filter.params, limit });
}

function inChat(chat: string): SqlFragment {
  return { sql: "m.chat_jid = $chat", params: { chat } };
}

function beyond(side: "<" | ">", [ts, rowid]: Position, name: string): SqlFragment {
  return {
    sql: `(m.ts, m.rowid) ${side} ($${name}_ts, $${name}_rowid)`,
    params: { [`${name}_ts`]: ts, [`${name}_rowid`]: rowid },
  };
}

const positionOf = (row: MessageRecordRow): Position => [row.ts, row.rowid];

/** One page of a chat, oldest first, with cursors to walk further either way. */
export function listMessages(
  ctx: ReadContext,
  ref: string,
  options: MessageListOptions,
): MessagePage {
  const chat = inChat(resolveChat(ctx, ref));
  const { limit } = options;
  let rows: MessageRecordRow[];
  if (options.around) {
    const anchor = findMessage(ctx, chat, options.around);
    const olderCount = Math.floor((limit - 1) / 2);
    const older = selectMessages(
      ctx,
      and(chat, beyond("<", positionOf(anchor), "a")),
      "DESC",
      olderCount,
    );
    const newer = selectMessages(
      ctx,
      and(chat, beyond(">", positionOf(anchor), "a")),
      "ASC",
      limit - 1 - olderCount,
    );
    rows = [...older.reverse(), anchor, ...newer];
  } else if (options.after) {
    const bounds = [chat, beyond(">", parseBound(options.after, "after"), "after")];
    if (options.before) bounds.push(beyond("<", parseBound(options.before, "before"), "before"));
    rows = selectMessages(ctx, and(...bounds), "ASC", limit);
  } else {
    const bounds = [chat];
    if (options.before) bounds.push(beyond("<", parseBound(options.before, "before"), "before"));
    rows = selectMessages(ctx, and(...bounds), "DESC", limit).reverse();
  }

  const [first, last] = [rows.at(0), rows.at(-1)];
  const hasMore = (side: "<" | ">", row: MessageRecordRow | undefined) =>
    row !== undefined &&
    selectMessages(ctx, and(chat, beyond(side, positionOf(row), "edge")), "ASC", 1).length > 0;
  return {
    messages: rows.map(toMessage),
    older: hasMore("<", first) ? encodeCursor(positionOf(first!)) : null,
    newer: hasMore(">", last) ? encodeCursor(positionOf(last!)) : null,
  };
}

/** A message with up to `context` messages on each side. */
export function getMessage(
  ctx: ReadContext,
  ref: string,
  id: string,
  context: number,
): MessageContext {
  const chat = inChat(resolveChat(ctx, ref));
  const row = findMessage(ctx, chat, id);
  const position = positionOf(row);
  const before = context
    ? selectMessages(ctx, and(chat, beyond("<", position, "p")), "DESC", context).reverse()
    : [];
  const after = context
    ? selectMessages(ctx, and(chat, beyond(">", position, "p")), "ASC", context)
    : [];
  return {
    message: toMessage(row),
    before: before.map(toMessage),
    after: after.map(toMessage),
  };
}

/** Messages by rowid, in the order given; rows the principal can't see are left out. */
export function messagesByRowid(ctx: ReadContext, rowids: number[]): Map<number, Message> {
  if (!rowids.length) return new Map();
  const rows = selectMessages(
    ctx,
    {
      sql: "m.rowid IN (SELECT value FROM json_each($rowids))",
      params: { rowids: JSON.stringify(rowids) },
    },
    "ASC",
    rowids.length,
  );
  return new Map(rows.map((row) => [row.rowid, toMessage(row)]));
}

function findMessage(ctx: ReadContext, chat: SqlFragment, id: string): MessageRecordRow {
  const [row] = selectMessages(ctx, and(chat, { sql: "m.id = $id", params: { id } }), "ASC", 1);
  if (!row) throw notFound("message not found");
  return row;
}
