import type { Chat, ChatDetail, ChatKind, Page, Participant } from "@wa/sdk";
import { z } from "zod";
import { notFound } from "../errors";
import { and, collectionSql, scopeSql, type SqlFragment, type SqlParams } from "../policy";
import { decodeCursor, encodeCursor } from "./cursor";
import { resolveChat } from "./resolve";
import {
  CHAT_NAME,
  CHAT_SELECT,
  likePattern,
  toChat,
  type ChatRecordRow,
  type ReadContext,
} from "./rows";

export interface ChatListOptions {
  q?: string;
  collection?: string;
  kind?: ChatKind;
  limit: number;
  cursor?: string;
}

const RECENCY = "coalesce(ch.last_message_at, 0)";
const chatCursor = z.tuple([z.number().int(), z.string()]);

/** Visible chats, most recent first. */
export function listChats(ctx: ReadContext, options: ChatListOptions): Page<Chat> {
  const filters: SqlFragment[] = [scopeSql(ctx.principal, "ch.jid")];
  if (options.collection) filters.push(collectionSql("ch.jid", options.collection));
  if (options.kind) filters.push({ sql: "ch.kind = $kind", params: { kind: options.kind } });
  if (options.q) {
    filters.push({
      sql: `(${CHAT_NAME} LIKE $q ESCAPE '\\' OR ch.jid LIKE $q ESCAPE '\\')`,
      params: { q: likePattern(options.q) },
    });
  }
  if (options.cursor) {
    const [recency, jid] = decodeCursor(options.cursor, chatCursor);
    filters.push({
      sql: `(${RECENCY}, ch.jid) < ($cursor_recency, $cursor_jid)`,
      params: { cursor_recency: recency, cursor_jid: jid },
    });
  }
  const where = and(...filters);
  const rows = ctx.store.db
    .query<ChatRecordRow, SqlParams>(
      `${CHAT_SELECT} WHERE ${where.sql}
       ORDER BY ${RECENCY} DESC, ch.jid DESC LIMIT $limit`,
    )
    .all({ ...where.params, limit: options.limit + 1 });
  const items = rows.slice(0, options.limit);
  const last = items.at(-1);
  return {
    items: items.map(toChat),
    nextCursor:
      rows.length > options.limit && last
        ? encodeCursor([last.last_message_at ?? 0, last.jid])
        : null,
  };
}

/** One visible chat by any reference, with its members when it is a group. */
export function getChat(ctx: ReadContext, ref: string): ChatDetail {
  const jid = resolveChat(ctx, ref);
  const scope = scopeSql(ctx.principal, "ch.jid");
  const row = ctx.store.db
    .query<ChatRecordRow, SqlParams>(`${CHAT_SELECT} WHERE ch.jid = $jid AND (${scope.sql})`)
    .get({ ...scope.params, jid });
  if (!row) throw notFound("chat not found");
  return {
    ...toChat(row),
    ephemeralExpiration: row.ephemeral_expiration,
    createdAt: row.created_at,
    participants: row.kind === "group" ? participantsOf(ctx, jid) : [],
  };
}

/** Members of a group the caller can already see (checked by `getChat`). */
function participantsOf(ctx: ReadContext, groupJid: string): Participant[] {
  return ctx.store.db
    .query<Participant, { groupJid: string }>(
      `SELECT gp.jid, coalesce(ct.name, ct.verified_name, ct.push_name) AS name, gp.role
       FROM group_participants AS gp LEFT JOIN contacts AS ct ON ct.jid = gp.jid
       WHERE gp.group_jid = $groupJid
       ORDER BY gp.role = 'left', gp.jid`,
    )
    .all({ groupJid });
}

/** The display name of a chat the caller already resolved as visible. */
export function chatName(ctx: ReadContext, jid: string): string | null {
  return (
    ctx.store.db
      .query<{ name: string | null }, { jid: string }>(
        `SELECT ${CHAT_NAME} AS name FROM chats AS ch LEFT JOIN contacts AS ct ON ct.jid = ch.jid
         WHERE ch.jid = $jid`,
      )
      .get({ jid })?.name ?? null
  );
}
