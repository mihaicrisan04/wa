import {
  isJidStatusBroadcast,
  isLidUser,
  jidNormalizedUser,
  toNumber,
  type Chat,
  type ChatUpdate,
  type Contact,
} from "@whiskeysockets/baileys";
import type { ChatPatch } from "../store";
import type { IngestContext } from "./context";
import { phoneOf } from "./lid";

type ChatFields = Partial<Chat> & Pick<ChatUpdate, "conditional">;

/** Chats from history and `chats.upsert`: only fields actually sent are written. */
export function ingestChat(ctx: IngestContext, chat: ChatFields): void {
  writeChat(ctx, chat, false);
}

/** Like `ingestChat`, but a positive unread count adds to the stored one. */
export function ingestChatUpdate(ctx: IngestContext, chat: ChatFields): void {
  writeChat(ctx, chat, true);
}

function writeChat(ctx: IngestContext, chat: ChatFields, isUpdate: boolean): void {
  if (!chat.id || isJidStatusBroadcast(chat.id)) return;
  const jid = ctx.identity.chat(chat.id);
  ctx.store.chats.upsert(jid, ctx.identity.kindOf(jid), {
    ...chatPatch(chat),
    ...unreadPatch(chat, isUpdate),
  });
}

export function deleteChats(ctx: IngestContext, ids: string[]): void {
  const { store } = ctx;
  for (const id of ids) {
    const jid = ctx.identity.chat(id);
    ctx.orphanedFiles.push(...store.media.removeChat(jid));
    store.messages.deleteChat(jid);
    store.participants.deleteGroup(jid);
    store.chats.delete(jid);
  }
}

export function ingestContact(ctx: IngestContext, contact: Partial<Contact>): void {
  if (!contact.id || isJidStatusBroadcast(contact.id)) return;
  const jid = ctx.identity.user(contact.id);
  const lid = [contact.lid, contact.id]
    .map((candidate) => (candidate ? jidNormalizedUser(candidate) : ""))
    .find((candidate) => isLidUser(candidate));
  ctx.store.contacts.upsert(jid, {
    lid,
    phone: phoneOf(jid) ?? undefined,
    name: contact.name || undefined,
    pushName: contact.notify || undefined,
    verifiedName: contact.verifiedName || undefined,
  });
}

/** Never reads `conditional`: Baileys resolves it before emitting, and it is not data. */
function chatPatch(chat: ChatFields): ChatPatch {
  const patch: ChatPatch = {};
  const sent = (field: keyof Chat) => Object.hasOwn(chat, field) && chat[field] !== undefined;

  const name = chat.name || chat.displayName;
  if (name) patch.name = name;
  if (sent("archived")) patch.archived = Boolean(chat.archived);
  if (sent("pinned")) patch.pinned = chat.pinned ? toNumber(chat.pinned) : null;
  // -1 is "muted forever"
  if (sent("muteEndTime")) patch.muteEndTime = nonZero(chat.muteEndTime);
  if (sent("ephemeralExpiration")) patch.ephemeralExpiration = chat.ephemeralExpiration || null;
  const lastMessageAt = positive(chat.conversationTimestamp) ?? positive(chat.lastMsgTimestamp);
  if (lastMessageAt) patch.lastMessageAt = lastMessageAt;
  const createdAt = positive(chat.createdAt);
  if (createdAt) patch.createdAt = createdAt;
  return patch;
}

/**
 * Baileys emits each incoming message as `chats.update` with `unreadCount: 1` (summed while
 * buffering), a read as 0 and marked-unread as -1; history and upserts carry the full count.
 */
function unreadPatch(chat: ChatFields, isUpdate: boolean): ChatPatch {
  if (chat.markedAsUnread) return { unread: { set: -1 } };
  if (typeof chat.unreadCount !== "number") return {};
  if (isUpdate && chat.unreadCount > 0) return { unread: { add: chat.unreadCount } };
  return { unread: { set: chat.unreadCount } };
}

function nonZero(value: Parameters<typeof toNumber>[0]): number | null {
  const number = toNumber(value);
  return number !== 0 ? number : null;
}

function positive(value: Parameters<typeof toNumber>[0]): number | null {
  const number = toNumber(value);
  return number > 0 ? number : null;
}
