import {
  CHAT_KINDS,
  type Chat,
  type ChatCandidate,
  type ChatDetail,
  type Page,
  type Participant,
} from "@wa/sdk";
import { z } from "zod";
import { notFound } from "../errors";
import { and, collectionSql, scopeSql, type SqlFragment, type SqlParams } from "../policy";
import { decodeCursor, paginate } from "./cursor";
import { limitParam, optionalText } from "./fields";
import { resolveChat } from "./resolve";
import {
  CHAT_NAME,
  CHAT_SELECT,
  contactName,
  likePattern,
  RECENCY,
  toChat,
  type ChatRecordRow,
  type ReadContext,
} from "./rows";

export const chatListQuery = z.object({
  q: optionalText,
  collection: optionalText,
  kind: z.enum(CHAT_KINDS).optional(),
  limit: limitParam(50, 500),
  cursor: optionalText,
});
export type ChatListOptions = z.output<typeof chatListQuery>;

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
  const page = paginate(rows, options.limit, (last) => [last.last_message_at ?? 0, last.jid]);
  return { ...page, items: page.items.map(toChat) };
}

/** One visible chat, with its members when it is a group. */
export function getChat(ctx: ReadContext, jid: string): ChatDetail {
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
      `SELECT gp.jid, ${contactName("ct")} AS name, gp.role
       FROM group_participants AS gp LEFT JOIN contacts AS ct ON ct.jid = gp.jid
       WHERE gp.group_jid = $groupJid
       ORDER BY gp.role = 'left', gp.jid`,
    )
    .all({ groupJid });
}

/** Display names of visible chats; unnamed and out-of-scope ones are left out. */
export function chatNames(ctx: ReadContext, jids: string[]): Map<string, string> {
  const scope = scopeSql(ctx.principal, "ch.jid");
  const rows = ctx.store.db
    .query<{ jid: string; name: string | null }, SqlParams>(
      `SELECT ch.jid, ${CHAT_NAME} AS name
       FROM chats AS ch LEFT JOIN contacts AS ct ON ct.jid = ch.jid
       WHERE ch.jid IN (SELECT value FROM json_each($jids)) AND (${scope.sql})`,
    )
    .all({ ...scope.params, jids: JSON.stringify(jids) });
  return new Map(rows.flatMap((row) => (row.name === null ? [] : [[row.jid, row.name]])));
}

/** A visible chat by any reference, with its display name. */
export function chatRefOf(ctx: ReadContext, ref: string): { jid: string; name: string | null } {
  const jid = resolveChat(ctx, ref);
  return { jid, name: chatNames(ctx, [jid]).get(jid) ?? null };
}

/** The chats of a collection, stored or not; admin only, so not scoped. */
export function collectionChats(ctx: ReadContext, collection: string): ChatCandidate[] {
  const rows = ctx.store.db
    .query<{ jid: string; name: string | null; kind: ChatCandidate["kind"] | null }, SqlParams>(
      `SELECT cc.chat_jid AS jid, ${CHAT_NAME} AS name, ch.kind
       FROM collection_chats AS cc
       LEFT JOIN chats AS ch ON ch.jid = cc.chat_jid
       LEFT JOIN contacts AS ct ON ct.jid = cc.chat_jid
       WHERE cc.collection = $collection
       ORDER BY cc.chat_jid`,
    )
    .all({ collection });
  return rows.map((row) => ({ ...row, kind: row.kind ?? ctx.identity.kindOf(row.jid) }));
}
