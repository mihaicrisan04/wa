import {
  extractMessageContent,
  normalizeMessageContent,
  type proto,
  type WAMessage,
} from "@whiskeysockets/baileys";
import { PLACEHOLDER_TYPE, type MessageRecord, type MessageRow } from "../store";
import { applyEditedText, contentTypeOf, textOf, typeName } from "../whatsapp/content";
import { revokedMessage, type MessageAction } from "../whatsapp/normalize";
import { parseRaw, serializeRaw } from "../whatsapp/raw";
import type { IngestContext } from "./context";

interface Target {
  chatJid: string;
  fromMe: boolean;
  senderJid: string | null;
}

/**
 * Applies an edit or revoke to a stored message, if whoever sent it may do so. Placeholders
 * count too, so a copy decrypted later cannot bring back what was edited or revoked.
 */
export function applyAction(ctx: IngestContext, action: MessageAction): void {
  const row = ctx.store.messages.get(action.chatJid, action.targetId);
  if (!row || row.deleted_at !== null) return;
  const target = { chatJid: row.chat_jid, fromMe: row.from_me === 1, senderJid: row.sender_jid };
  if (!isAuthorized(ctx, action, target)) {
    ctx.logger.warn(
      { chat: row.chat_jid, id: row.id, action: action.type },
      "ignoring an edit or revoke that does not come from the sender",
    );
    return;
  }
  if (action.type === "edit") applyEdit(ctx, row, action);
  else applyRevoke(ctx, row, action.ts);
}

/** Edits come only from the sender; revokes also from a group admin. */
export function isAuthorized(ctx: IngestContext, action: MessageAction, target: Target): boolean {
  const { actor } = action;
  const isSender = actor.fromMe
    ? target.fromMe
    : !target.fromMe && actor.jid !== null && actor.jid === target.senderJid;
  if (isSender) return true;
  if (action.type !== "revoke") return false;
  const actorJid = actor.fromMe ? ctx.identity.me() : actor.jid;
  if (!actorJid) return false;
  const role = ctx.store.participants.role(target.chatJid, actorJid);
  return role === "admin" || role === "superadmin";
}

/**
 * An incoming copy that loses to a stored edit Baileys folded in (or one applied before the
 * original decrypted) takes that edit on, so the original's media and quote are kept.
 */
export function withStoredEdit(ctx: IngestContext, record: MessageRecord): MessageRecord | null {
  if (!record.raw || record.type === PLACEHOLDER_TYPE) return null;
  const stored = ctx.store.messages.get(record.chatJid, record.id);
  if (!stored?.raw || stored.deleted_at !== null || stored.edited_at === null) return null;
  const edit = normalizeMessageContent(parseRaw(stored.raw).message?.editedMessage?.message);
  const message = parseRaw(record.raw);
  const original = normalizeMessageContent(message.message);
  if (!edit || !original) return null;
  applyEditedText(original, edit);
  const { text, caption } = textOf(extractMessageContent(message.message));
  return { ...record, text, caption, editedAt: stored.edited_at, raw: serializeRaw(message) };
}

function applyEdit(
  ctx: IngestContext,
  row: MessageRow,
  action: Extract<MessageAction, { type: "edit" }>,
): void {
  if (row.edited_at !== null && row.edited_at >= action.ts) return;
  const edited = normalizeMessageContent(action.content);
  if (!edited) return;
  const message = row.raw ? parseRaw(row.raw) : null;
  if (message) foldEdit(message, edited);
  const content = extractMessageContent(message?.message ?? edited);
  const type = contentTypeOf(content);
  if (!type) return;
  const { text, caption } = textOf(content);
  ctx.store.messages.applyEdit(
    { chatJid: row.chat_jid, id: row.id },
    {
      type: row.type === PLACEHOLDER_TYPE ? typeName(type) : row.type,
      text,
      caption,
      editedAt: action.ts,
      raw: message ? serializeRaw(message) : null,
    },
  );
}

/** Edits a stored message in place; one not decrypted yet holds just the edit, as Baileys folds it. */
function foldEdit(message: WAMessage, edited: proto.IMessage): void {
  const original = normalizeMessageContent(message.message);
  if (original) {
    applyEditedText(original, edited);
    return;
  }
  message.message = { editedMessage: { message: edited } };
  message.messageStubType = null;
}

function applyRevoke(ctx: IngestContext, row: MessageRow, deletedAt: number): void {
  const key = { chatJid: row.chat_jid, id: row.id };
  const raw = row.raw ? serializeRaw(revokedMessage(parseRaw(row.raw))) : null;
  ctx.store.messages.tombstone(key, deletedAt, raw);
  const file = ctx.store.media.remove(key);
  if (file) ctx.orphanedFiles.push(file);
}
