import type { Chat, ChatKind, Message } from "@wa/sdk";
import type { Identity } from "../whatsapp/identity";
import { scopeSql, type Principal, type SqlFragment } from "../policy";
import type { Store } from "../store";

/** What every read query works with: the store, who is asking, and jid canonicalization. */
export interface ReadContext {
  store: Store;
  principal: Principal;
  identity: Identity;
}

export const CHAT_NAME = "coalesce(ch.name, ct.name, ct.verified_name, ct.push_name)";

/** `ch` with its display name; DMs take it from the contact. */
export const CHAT_SELECT = `
  SELECT ch.jid, ch.kind, ${CHAT_NAME} AS name, ch.archived, ch.pinned, ch.mute_end_time,
    ch.unread_count, ch.last_message_at, ch.ephemeral_expiration, ch.created_at
  FROM chats AS ch LEFT JOIN contacts AS ct ON ct.jid = ch.jid`;

export interface ChatRecordRow {
  jid: string;
  kind: ChatKind;
  name: string | null;
  archived: number;
  pinned: number | null;
  mute_end_time: number | null;
  unread_count: number;
  last_message_at: number | null;
  ephemeral_expiration: number | null;
  created_at: number | null;
}

export function toChat(row: ChatRecordRow): Chat {
  return {
    jid: row.jid,
    kind: row.kind,
    name: row.name,
    archived: row.archived === 1,
    pinned: row.pinned,
    muteEndTime: row.mute_end_time,
    unreadCount: row.unread_count,
    lastMessageAt: row.last_message_at,
  };
}

export interface MessageRecordRow {
  rowid: number;
  chat_jid: string;
  id: string;
  from_me: number;
  sender_jid: string | null;
  sender_name: string | null;
  ts: number;
  type: string;
  text: string | null;
  caption: string | null;
  file_name: string | null;
  quoted_id: string | null;
  quoted_chat_jid: string | null;
  quoted_participant: string | null;
  quoted_text: string | null;
  quote_visible: number;
  edited_at: number | null;
  deleted_at: number | null;
  expires_at: number | null;
  has_media: number;
  view_once: number;
}

/**
 * Messages `m` as clients may see them. `raw` is never selected; a quote's id, chat and sender
 * only come along when the quoted chat is visible too ("reply privately" quotes another chat).
 */
export function messageSelect(principal: Principal): SqlFragment {
  const quoteScope = scopeSql(principal, "m.quoted_chat_jid");
  return {
    sql: `
      SELECT m.rowid, m.chat_jid, m.id, m.from_me, m.sender_jid,
        coalesce(sc.name, sc.verified_name, sc.push_name) AS sender_name,
        m.ts, m.type, m.text, m.caption, m.file_name,
        m.quoted_id, m.quoted_chat_jid, m.quoted_participant, m.quoted_text,
        CASE WHEN m.quoted_chat_jid IS NULL OR m.quoted_chat_jid = m.chat_jid
          OR (${quoteScope.sql}) THEN 1 ELSE 0 END AS quote_visible,
        m.edited_at, m.deleted_at, m.expires_at, m.has_media, m.view_once
      FROM messages AS m LEFT JOIN contacts AS sc ON sc.jid = m.sender_jid`,
    params: quoteScope.params,
  };
}

export function toMessage(row: MessageRecordRow): Message {
  const visible = row.quote_visible === 1;
  const hasQuote = row.quoted_id !== null || row.quoted_text !== null;
  return {
    chat: row.chat_jid,
    id: row.id,
    fromMe: row.from_me === 1,
    sender: row.sender_jid,
    senderName: row.sender_name,
    ts: row.ts,
    type: row.type,
    text: row.text,
    caption: row.caption,
    fileName: row.file_name,
    quoted: hasQuote
      ? {
          id: visible ? row.quoted_id : null,
          chat: visible ? row.quoted_chat_jid : null,
          sender: visible ? row.quoted_participant : null,
          text: row.quoted_text,
        }
      : null,
    editedAt: row.edited_at,
    deletedAt: row.deleted_at,
    expiresAt: row.expires_at,
    hasMedia: row.has_media === 1,
    viewOnce: row.view_once === 1,
  };
}

/** `%input%` for LIKE with `\` as the escape character. */
export function likePattern(input: string): string {
  return `%${input.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}
