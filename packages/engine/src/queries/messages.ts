import type { Message, MessageContext, MessagePage } from "@wa/sdk";
import { z } from "zod";
import { notFound } from "../errors";
import { and, scopeSql, type SqlFragment, type SqlParams } from "../policy";
import { nowSeconds } from "../clock";
import { encodeCursor, parseBound, type Position } from "./cursor";
import { limitParam, optionalText } from "./fields";
import { messageSelect, toMessage, type MessageRecordRow, type ReadContext } from "./rows";

export const messageListQuery = z.object({
  before: optionalText,
  after: optionalText,
  /** A message id to center the page on. */
  around: optionalText,
  limit: limitParam(50, 200),
});
export type MessageListOptions = z.output<typeof messageListQuery>;

/** How many messages `getMessage` adds on each side. */
export const contextParam = z.coerce.number().int().min(0).max(50).default(0);

type Order = "ASC" | "DESC";

/** Visible messages `m`: in scope, and not past a disappearing timer the purge hasn't caught. */
export function visibleMessages(ctx: ReadContext): SqlFragment {
  return and(scopeSql(ctx.principal, "m.chat_jid"), {
    sql: "m.expires_at IS NULL OR m.expires_at > $now",
    params: { now: nowSeconds() },
  });
}

function selectMessages(
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

/** Up to `limit` rows, and whether `where` holds more past them, from one `limit + 1` query. */
function selectWithMore(
  ctx: ReadContext,
  where: SqlFragment,
  order: Order,
  limit: number,
): { rows: MessageRecordRow[]; more: boolean } {
  const rows = selectMessages(ctx, where, order, limit + 1);
  return { rows: rows.slice(0, limit), more: rows.length > limit };
}

/** Rows oldest first; `older`/`newer` say whether the chat has more on that side, if known. */
interface Slice {
  rows: MessageRecordRow[];
  older?: boolean;
  newer?: boolean;
}

/** One page of a visible chat, oldest first, with cursors to walk further either way. */
export function listMessages(
  ctx: ReadContext,
  chatJid: string,
  options: MessageListOptions,
): MessagePage {
  const chat = inChat(chatJid);
  const slice = options.around
    ? pageAround(ctx, chat, options.around, options.limit)
    : pageBetween(ctx, chat, options);

  const cursorBeyond = (
    side: "<" | ">",
    row: MessageRecordRow | undefined,
    known: boolean | undefined,
  ): string | null => {
    if (!row) return null;
    const edge = beyond(side, positionOf(row), "edge");
    const more = known ?? selectMessages(ctx, and(chat, edge), "ASC", 1).length > 0;
    return more ? encodeCursor(positionOf(row)) : null;
  };
  return {
    items: slice.rows.map(toMessage),
    older: cursorBeyond("<", slice.rows.at(0), slice.older),
    newer: cursorBeyond(">", slice.rows.at(-1), slice.newer),
  };
}

/** The anchor message with about half the page on each side of it. */
function pageAround(ctx: ReadContext, chat: SqlFragment, id: string, limit: number): Slice {
  const anchor = findMessage(ctx, chat, id);
  const position = positionOf(anchor);
  const olderCount = Math.floor((limit - 1) / 2);
  const older = selectWithMore(ctx, and(chat, beyond("<", position, "a")), "DESC", olderCount);
  const newer = selectWithMore(
    ctx,
    and(chat, beyond(">", position, "a")),
    "ASC",
    limit - 1 - olderCount,
  );
  return {
    rows: [...older.rows.reverse(), anchor, ...newer.rows],
    older: older.more,
    newer: newer.more,
  };
}

/** The first page after `after`, or else the last page before `before` (or the latest). */
function pageBetween(
  ctx: ReadContext,
  chat: SqlFragment,
  { before, after, limit }: MessageListOptions,
): Slice {
  const bounds = [chat];
  if (before) bounds.push(beyond("<", parseBound(before, "before"), "before"));
  if (after) {
    bounds.push(beyond(">", parseBound(after, "after"), "after"));
    const { rows, more } = selectWithMore(ctx, and(...bounds), "ASC", limit);
    // with a `before` bound too, running out of rows doesn't mean nothing newer exists
    return { rows, newer: more || !before ? more : undefined };
  }
  const { rows, more } = selectWithMore(ctx, and(...bounds), "DESC", limit);
  // nothing is newer than the latest page
  return { rows: rows.reverse(), older: more, newer: before ? undefined : false };
}

/** A visible message with up to `context` messages on each side. */
export function getMessage(
  ctx: ReadContext,
  chatJid: string,
  id: string,
  context: number,
): MessageContext {
  const chat = inChat(chatJid);
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
