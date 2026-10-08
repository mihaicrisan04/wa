import type { Recipient } from "@wa/sdk";
import { isJidGroup, isLidUser, isPnUser } from "@whiskeysockets/baileys";
import { ApiError, invalid, notFound, notLinked } from "../errors";
import { can, scopeSql, seesAllChats, type SqlParams } from "../policy";
import { inScope, resolveChat } from "./resolve";
import { CHAT_NAME, likePattern, type ReadContext } from "./rows";

export interface RecipientOptions {
  q?: string;
  limit: number;
}

/**
 * Who the principal may send to, most recent first: visible people and groups, plus (for
 * all-chats principals) address-book contacts never chatted with. With only `send:self`, just
 * the own chat.
 */
export function listRecipients(ctx: ReadContext, options: RecipientOptions): Recipient[] {
  if (!can(ctx.principal, "send")) return selfRecipient(ctx);
  const scope = scopeSql(ctx.principal, "ch.jid");
  const pattern = options.q ? likePattern(options.q) : null;
  const chats = ctx.store.db
    .query<Recipient, SqlParams>(
      `SELECT ch.jid, ${CHAT_NAME} AS name, ch.kind, ch.last_message_at AS lastMessageAt
       FROM chats AS ch LEFT JOIN contacts AS ct ON ct.jid = ch.jid
       WHERE ch.kind IN ('dm', 'group', 'self') AND (${scope.sql})
         AND ($pattern IS NULL OR ${CHAT_NAME} LIKE $pattern ESCAPE '\\' OR ch.jid LIKE $pattern ESCAPE '\\')
       ORDER BY coalesce(ch.last_message_at, 0) DESC, ch.jid
       LIMIT $limit`,
    )
    .all({ ...scope.params, pattern, limit: options.limit });
  if (!seesAllChats(ctx.principal) || chats.length >= options.limit) return chats;

  const contacts = ctx.store.db
    .query<Recipient, SqlParams>(
      `SELECT ct.jid, ct.name, 'dm' AS kind, NULL AS lastMessageAt
       FROM contacts AS ct
       WHERE ct.name IS NOT NULL AND ct.jid LIKE '%@s.whatsapp.net'
         AND NOT EXISTS (SELECT 1 FROM chats WHERE jid = ct.jid)
         AND ($pattern IS NULL OR ct.name LIKE $pattern ESCAPE '\\' OR ct.jid LIKE $pattern ESCAPE '\\')
       ORDER BY ct.name COLLATE NOCASE, ct.jid
       LIMIT $limit`,
    )
    .all({ pattern, limit: options.limit - chats.length });
  return [...chats, ...contacts];
}

function selfRecipient(ctx: ReadContext): Recipient[] {
  const me = ctx.identity.me();
  if (!me) return [];
  const chat = ctx.store.chats.get(me);
  return [
    {
      jid: me,
      name: chat?.name ?? null,
      kind: "self",
      lastMessageAt: chat?.last_message_at ?? null,
    },
  ];
}

/**
 * The chat a send goes to. `send:self` reaches only the own chat ("self" or the exact own jid,
 * never a device jid); anything else needs `send` and a chat in scope.
 */
export function sendTarget(ctx: ReadContext, to: string): string {
  const own = ctx.identity.own;
  const input = to.trim();
  if (input === "self" || input === own?.pn || (own?.lid && input === own.lid)) {
    if (!own) throw notLinked();
    if (can(ctx.principal, "send:self") || (can(ctx.principal, "send") && inScope(ctx, own.pn))) {
      return own.pn;
    }
    throw notFound("chat not found");
  }
  if (!can(ctx.principal, "send")) {
    throw new ApiError(403, "forbidden", "this token can only send to yourself");
  }
  const jid = resolveChat(ctx, input, { stored: false });
  if (!isPnUser(jid) && !isLidUser(jid) && !isJidGroup(jid)) {
    throw invalid("to: not a person or a group");
  }
  return jid;
}
