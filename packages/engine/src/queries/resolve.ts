import type { ChatCandidate } from "@wa/sdk";
import { jidDecode } from "@whiskeysockets/baileys";
import { ambiguous, notFound } from "../errors";
import { scopeSql, seesAllChats, type SqlFragment, type SqlParams } from "../policy";
import { CHAT_NAME, likePattern, type ReadContext } from "./rows";

const PHONE = /^\+?[\d\s().-]+$/;
const MIN_PHONE_DIGITS = 5;
const MAX_CANDIDATES = 10;

/** The canonical jid an explicit jid or phone number names; null when `ref` is a name. */
export function explicitJid(ctx: ReadContext, ref: string): string | null {
  const input = ref.trim();
  if (input.includes("@")) {
    if (!jidDecode(input)?.user) throw notFound("chat not found");
    return ctx.identity.chat(input);
  }
  const digits = input.replace(/\D/g, "");
  if (PHONE.test(input) && digits.length >= MIN_PHONE_DIGITS) {
    return ctx.identity.chat(`${digits}@s.whatsapp.net`);
  }
  return null;
}

/** True when the principal may see `jid`, whether or not the chat has been stored yet. */
export function inScope(ctx: ReadContext, jid: string): boolean {
  const scope = scopeSql(ctx.principal, "$jid");
  const row = ctx.store.db
    .query<{ ok: number }, SqlParams>(`SELECT (${scope.sql}) AS ok`)
    .get({ ...scope.params, jid });
  return row?.ok === 1;
}

/** A stored chat the principal may see; anything else is "not found". */
export function visibleChat(ctx: ReadContext, jid: string): boolean {
  const scope = scopeSql(ctx.principal, "ch.jid");
  return (
    ctx.store.db
      .query(`SELECT 1 FROM chats AS ch WHERE ch.jid = $jid AND (${scope.sql})`)
      .get({ ...scope.params, jid }) !== null
  );
}

/**
 * A chat reference as users type it: a jid, a phone number, or a name. Names match only among
 * visible chats (exact before partial), so candidates never come from outside the scope.
 * `stored: false` accepts a jid or number of a chat that does not exist yet (sending, admin).
 */
export function resolveChat(
  ctx: ReadContext,
  ref: string,
  { stored = true }: { stored?: boolean } = {},
): string {
  const jid = explicitJid(ctx, ref);
  if (jid) {
    const ok = stored ? visibleChat(ctx, jid) : inScope(ctx, jid);
    if (!ok) throw notFound("chat not found");
    return jid;
  }
  const scope = scopeSql(ctx.principal, "ch.jid");
  return pickByName(ref, "chat", (pattern) =>
    ctx.store.db
      .query<ChatCandidate, SqlParams>(
        `SELECT ch.jid, ${CHAT_NAME} AS name, ch.kind
         FROM chats AS ch LEFT JOIN contacts AS ct ON ct.jid = ch.jid
         WHERE ${CHAT_NAME} LIKE $pattern ESCAPE '\\' AND (${scope.sql})
         ORDER BY coalesce(ch.last_message_at, 0) DESC, ch.jid`,
      )
      .all({ ...scope.params, pattern }),
  );
}

/** A person by jid, number or name; names match only people seen in visible chats. */
export function resolveSender(ctx: ReadContext, ref: string): string {
  const jid = explicitJid(ctx, ref);
  if (jid) return ctx.identity.user(jid);
  const visible = visiblePeople(ctx);
  return pickByName(ref, "sender", (pattern) =>
    ctx.store.db
      .query<ChatCandidate, SqlParams>(
        `SELECT ct.jid, coalesce(ct.name, ct.verified_name, ct.push_name) AS name, 'dm' AS kind
         FROM contacts AS ct
         WHERE coalesce(ct.name, ct.verified_name, ct.push_name) LIKE $pattern ESCAPE '\\'
           AND (${visible.sql})
         ORDER BY ct.jid`,
      )
      .all({ ...visible.params, pattern }),
  );
}

/** Contacts `ct` the principal has met in a visible chat: as the chat, a member or a sender. */
function visiblePeople(ctx: ReadContext): SqlFragment {
  if (seesAllChats(ctx.principal)) return { sql: "1", params: {} };
  const chats = scopeSql(ctx.principal, "ch.jid");
  const groups = scopeSql(ctx.principal, "gp.group_jid");
  const messages = scopeSql(ctx.principal, "m.chat_jid");
  return {
    sql: `ct.jid IN (SELECT ch.jid FROM chats AS ch WHERE ${chats.sql})
      OR ct.jid IN (SELECT gp.jid FROM group_participants AS gp WHERE ${groups.sql})
      OR ct.jid IN (SELECT m.sender_jid FROM messages AS m WHERE ${messages.sql})`,
    params: { ...chats.params, ...groups.params, ...messages.params },
  };
}

function pickByName(
  input: string,
  what: "chat" | "sender",
  search: (pattern: string) => ChatCandidate[],
): string {
  const name = input.trim();
  if (!name) throw notFound(`${what} not found`);
  const matches = search(likePattern(name));
  const exact = matches.filter((match) => match.name?.toLowerCase() === name.toLowerCase());
  const candidates = exact.length ? exact : matches;
  if (candidates.length === 1) return candidates[0]!.jid;
  if (!candidates.length) throw notFound(`${what} not found`);
  throw ambiguous(name, candidates.slice(0, MAX_CANDIDATES));
}
