import {
  extractMessageContent,
  getChatId,
  getKeyAuthor,
  isJidGroup,
  isJidStatusBroadcast,
  jidNormalizedUser,
  proto,
  toNumber,
  type WAMessage,
  type WAMessageKey,
  type WAMessageUpdate,
} from "@whiskeysockets/baileys";
import { nowSeconds, PLACEHOLDER_TYPE, REVOKED_TYPE, type MessageRecord } from "../store";
import { CARRIER_TYPES, contentTypeOf, contextInfoOf, mediaOf, textOf, typeName } from "./content";
import { serializeRaw } from "./raw";

const { StubType } = proto.WebMessageInfo;
const ProtocolType = proto.Message.ProtocolMessage.Type;

/** Maps any jid WhatsApp uses for a chat or a person to the canonical one. */
export interface JidResolver {
  chat(jid: string): string;
  user(jid: string): string;
  /** Own canonical jid, null before linking. */
  me(): string | null;
}

export interface Actor {
  fromMe: boolean;
  jid: string | null;
}

interface ActionBase {
  chatJid: string;
  targetId: string;
  actor: Actor;
  /** Unix seconds. */
  ts: number;
  /** Id of the carrier message that announced it, when it came as one. */
  carrierId: string | null;
}

export type MessageAction =
  | (ActionBase & { type: "edit"; content: proto.IMessage })
  | (ActionBase & { type: "revoke" });

export type Normalized =
  | { kind: "skip"; reason: "status" | "invalid" | "system" }
  | { kind: "carrier"; action: MessageAction | null }
  | {
      kind: "message";
      record: MessageRecord;
      pushName: string | null;
      /** An edit Baileys folded into this message while buffering. */
      foldedEdit: boolean;
    };

export function chatOf(key: WAMessageKey, resolve: JidResolver): string {
  return resolve.chat(jidNormalizedUser(getChatId(key)));
}

function actorOf(key: WAMessageKey, resolve: JidResolver): Actor {
  const fromMe = Boolean(key.fromMe);
  const author = fromMe ? null : getKeyAuthor(key);
  return { fromMe, jid: fromMe ? resolve.me() : author ? resolve.user(author) : null };
}

/** Classifies a WAMessage and, when it is storable, turns it into a row. */
export function normalizeMessage(
  message: WAMessage,
  resolve: JidResolver,
  source: MessageRecord["source"],
): Normalized {
  const key = message.key;
  if (!key?.remoteJid || !key.id) return { kind: "skip", reason: "invalid" };
  if (isJidStatusBroadcast(key.remoteJid)) return { kind: "skip", reason: "status" };

  const ts = toNumber(message.messageTimestamp);
  const content = extractMessageContent(message.message);
  const type = contentTypeOf(content);
  const stub = message.messageStubType;

  if (type && CARRIER_TYPES.has(type)) {
    return { kind: "carrier", action: carrierAction(message, content!, resolve, ts) };
  }
  if (message.message && !type) return { kind: "carrier", action: null };

  const base = baseRecord(key, resolve, ts, source);
  if (!type) {
    if (stub === StubType.REVOKE) {
      return asMessage(message, {
        ...base,
        type: REVOKED_TYPE,
        deletedAt: ts,
        raw: serializeRaw(message),
      });
    }
    if (stub === StubType.CIPHERTEXT || !stub) {
      return asMessage(message, { ...base, raw: serializeRaw(message) });
    }
    return { kind: "skip", reason: "system" };
  }

  const viewOnce = isViewOnce(message);
  const context = contextInfoOf(content);
  const foldedEdit = Boolean(message.message?.editedMessage);
  const record: MessageRecord = {
    ...base,
    type: typeName(type),
    ...textOf(content),
    ...quoteOf(context, base.chatJid, resolve),
    editedAt: foldedEdit ? ts : null,
    expiresAt: expiryOf(message, ts, context),
    viewOnce,
    raw: viewOnce ? null : serializeRaw(message),
    media: mediaOf(content),
  };
  return { kind: "message", record, pushName: message.pushName || null, foldedEdit };
}

/** Live edits and revokes as Baileys reports them for messages outside the current batch. */
export function actionFromUpdate(
  { key, update }: WAMessageUpdate,
  resolve: JidResolver,
): MessageAction | null {
  if (!key.remoteJid || !key.id || isJidStatusBroadcast(key.remoteJid)) return null;
  const edited = update.message?.editedMessage?.message;
  const revoked = update.messageStubType === StubType.REVOKE && update.message === null;
  if (!edited && !revoked) return null;
  const base = {
    chatJid: chatOf(key, resolve),
    targetId: key.id,
    actor: actorOf(key, resolve),
    carrierId: null,
  };
  if (edited) {
    const ts = toNumber(update.messageTimestamp) || nowSeconds();
    return { ...base, type: "edit", content: edited, ts };
  }
  return { ...base, type: "revoke", ts: nowSeconds() };
}

/** What a revoked message looks like in history: its key and time, no content. */
export function revokedMessage(original: WAMessage): WAMessage {
  return {
    key: original.key,
    messageTimestamp: original.messageTimestamp,
    messageStubType: StubType.REVOKE,
    message: null,
  };
}

/** Keeps the key and time of a message but none of its content, so a later copy replaces it. */
export function placeholder(record: MessageRecord): MessageRecord {
  return {
    ...record,
    type: PLACEHOLDER_TYPE,
    text: null,
    caption: null,
    fileName: null,
    quotedText: null,
    editedAt: null,
    media: null,
  };
}

function asMessage(message: WAMessage, record: MessageRecord): Normalized {
  return { kind: "message", record, pushName: message.pushName || null, foldedEdit: false };
}

/** A placeholder row: key, sender and time, no content yet. */
function baseRecord(
  key: WAMessageKey,
  resolve: JidResolver,
  ts: number,
  source: MessageRecord["source"],
): MessageRecord {
  const sender = actorOf(key, resolve);
  return {
    chatJid: chatOf(key, resolve),
    id: key.id!,
    fromMe: sender.fromMe,
    senderJid: sender.jid,
    senderAlt: sender.fromMe ? null : senderAlt(key, sender.jid),
    ts,
    type: PLACEHOLDER_TYPE,
    text: null,
    caption: null,
    fileName: null,
    quotedId: null,
    quotedChatJid: null,
    quotedParticipant: null,
    quotedText: null,
    editedAt: null,
    deletedAt: null,
    expiresAt: null,
    viewOnce: false,
    source,
    raw: null,
    media: null,
  };
}

/** The other address WhatsApp gave for the sender (LID when the canonical one is the PN). */
function senderAlt(key: WAMessageKey, senderJid: string | null): string | null {
  const candidates = isJidGroup(key.remoteJid!)
    ? [key.participant, key.participantAlt]
    : [key.remoteJid, key.remoteJidAlt];
  const alt = candidates
    .filter((jid): jid is string => Boolean(jid))
    .map(jidNormalizedUser)
    .find((jid) => jid && jid !== senderJid);
  return alt ?? null;
}

function carrierAction(
  message: WAMessage,
  content: proto.IMessage,
  resolve: JidResolver,
  ts: number,
): MessageAction | null {
  const protocol = content.protocolMessage;
  const targetId = protocol?.key?.id;
  if (!protocol || !targetId) return null;
  const base = {
    chatJid: chatOf(message.key, resolve),
    targetId,
    actor: actorOf(message.key, resolve),
    carrierId: message.key.id ?? null,
  };
  if (protocol.type === ProtocolType.REVOKE) return { ...base, type: "revoke", ts };
  if (protocol.type === ProtocolType.MESSAGE_EDIT && protocol.editedMessage) {
    const editedAt = protocol.timestampMs ? Math.floor(toNumber(protocol.timestampMs) / 1000) : ts;
    return { ...base, type: "edit", content: protocol.editedMessage, ts: editedAt };
  }
  return null;
}

function quoteOf(context: proto.IContextInfo | null, chatJid: string, resolve: JidResolver) {
  if (!context?.stanzaId) {
    return { quotedId: null, quotedChatJid: null, quotedParticipant: null, quotedText: null };
  }
  const quoted = textOf(extractMessageContent(context.quotedMessage));
  return {
    quotedId: context.stanzaId,
    quotedChatJid: context.remoteJid ? resolve.chat(jidNormalizedUser(context.remoteJid)) : chatJid,
    quotedParticipant: context.participant ? resolve.user(context.participant) : null,
    quotedText: quoted.text ?? quoted.caption ?? quoted.fileName,
  };
}

function expiryOf(
  message: WAMessage,
  ts: number,
  context: proto.IContextInfo | null,
): number | null {
  const start = toNumber(message.ephemeralStartTimestamp);
  if (start && message.ephemeralDuration) return start + message.ephemeralDuration;
  return context?.expiration ? ts + context.expiration : null;
}

const VIEW_ONCE_WRAPPERS = [
  "viewOnceMessage",
  "viewOnceMessageV2",
  "viewOnceMessageV2Extension",
] as const;
const OTHER_WRAPPERS = ["ephemeralMessage", "documentWithCaptionMessage", "editedMessage"] as const;

function isViewOnce(message: WAMessage): boolean {
  if (message.key.isViewOnce) return true;
  let content = message.message;
  for (let depth = 0; content && depth < 5; depth++) {
    if (VIEW_ONCE_WRAPPERS.some((wrapper) => content?.[wrapper])) return true;
    const type = contentTypeOf(content);
    if (type && (content[type] as { viewOnce?: boolean | null } | null)?.viewOnce) return true;
    content = OTHER_WRAPPERS.map((wrapper) => content?.[wrapper]?.message).find(Boolean);
  }
  return false;
}
