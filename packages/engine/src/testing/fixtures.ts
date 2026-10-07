import { randomBytes } from "node:crypto";
import {
  proto,
  type BaileysEventMap,
  type Chat,
  type WAMessage,
  type WAMessageKey,
} from "@whiskeysockets/baileys";

// synthetic fixtures only: everything here is built from scratch, never captured from an account

let sequence = 0;

export function fixtureId(): string {
  sequence++;
  return `3EB0FIXTURE${sequence.toString(16).toUpperCase().padStart(8, "0")}`;
}

export interface MessageFixture {
  chat: string;
  id?: string;
  fromMe?: boolean;
  /** Sender inside a group (`key.participant`). */
  participant?: string;
  /** Unix seconds. */
  ts?: number;
  pushName?: string;
  message?: proto.IMessage | null;
  stubType?: proto.WebMessageInfo.StubType;
  remoteJidAlt?: string;
  participantAlt?: string;
  addressingMode?: "pn" | "lid";
}

/**
 * Builds a WebMessageInfo the way Baileys hands it over: through `fromObject` and a
 * protobuf encode/decode round trip, so timestamps are real `Long`s and bytes are
 * `Uint8Array`s. The key's alt fields are not in the protobuf, so they are re-attached.
 */
export function buildMessage(fixture: MessageFixture): WAMessage {
  const info = proto.WebMessageInfo.fromObject({
    key: {
      remoteJid: fixture.chat,
      fromMe: fixture.fromMe ?? false,
      id: fixture.id ?? fixtureId(),
      participant: fixture.participant,
    },
    messageTimestamp: fixture.ts ?? Math.floor(Date.now() / 1000),
    pushName: fixture.pushName,
    message: fixture.message === undefined ? content.text("hello") : fixture.message,
    messageStubType: fixture.stubType,
  });
  const decoded = proto.WebMessageInfo.decode(proto.WebMessageInfo.encode(info).finish());

  const key: WAMessageKey = decoded.key ?? new proto.MessageKey();
  if (fixture.remoteJidAlt) key.remoteJidAlt = fixture.remoteJidAlt;
  if (fixture.participantAlt) key.participantAlt = fixture.participantAlt;
  if (fixture.addressingMode) key.addressingMode = fixture.addressingMode;
  return Object.assign(decoded, { key });
}

/** A history conversation, decoded the way Baileys hands it over (only sent fields are own). */
export function buildChat(conversation: proto.IConversation & { id: string }): Chat {
  const encoded = proto.Conversation.encode(proto.Conversation.fromObject(conversation)).finish();
  return proto.Conversation.decode(encoded);
}

export function keyOf(message: WAMessage): WAMessageKey {
  return { ...message.key };
}

interface MediaFixture {
  mimetype?: string;
  caption?: string;
  fileName?: string;
}

function mediaFields(mimetype: string) {
  return {
    mimetype,
    url: "https://mmg.whatsapp.net/fixture",
    directPath: "/v/t62.fixture",
    mediaKey: randomBytes(32),
    fileSha256: randomBytes(32),
    fileEncSha256: randomBytes(32),
    fileLength: 1024,
    mediaKeyTimestamp: Math.floor(Date.now() / 1000),
  };
}

/** `proto.IMessage` builders for the shapes the engine has to understand. */
export const content = {
  text: (text: string): proto.IMessage => ({ conversation: text }),

  extendedText: (text: string, contextInfo?: proto.IContextInfo): proto.IMessage => ({
    extendedTextMessage: { text, contextInfo },
  }),

  reply: (text: string, quoted: WAMessage): proto.IMessage => ({
    extendedTextMessage: {
      text,
      contextInfo: {
        stanzaId: quoted.key.id,
        participant: quoted.key.participant ?? quoted.key.remoteJid,
        remoteJid: quoted.key.remoteJid,
        quotedMessage: quoted.message,
      },
    },
  }),

  image: ({ mimetype = "image/jpeg", caption }: MediaFixture = {}): proto.IMessage => ({
    imageMessage: { ...mediaFields(mimetype), caption, width: 64, height: 48 },
  }),

  document: ({
    mimetype = "application/pdf",
    caption,
    fileName = "notes.pdf",
  }: MediaFixture = {}): proto.IMessage => ({
    documentMessage: { ...mediaFields(mimetype), caption, fileName },
  }),

  viewOnce: (inner: proto.IMessage): proto.IMessage => ({ viewOnceMessageV2: { message: inner } }),

  ephemeral: (inner: proto.IMessage): proto.IMessage => ({ ephemeralMessage: { message: inner } }),

  edit: (target: WAMessageKey, text: string, timestampMs = Date.now()): proto.IMessage => ({
    protocolMessage: {
      key: target,
      type: proto.Message.ProtocolMessage.Type.MESSAGE_EDIT,
      editedMessage: { conversation: text },
      timestampMs,
    },
  }),

  revoke: (target: WAMessageKey): proto.IMessage => ({
    protocolMessage: { key: target, type: proto.Message.ProtocolMessage.Type.REVOKE },
  }),

  reaction: (target: WAMessageKey, emoji: string): proto.IMessage => ({
    reactionMessage: { key: target, text: emoji, senderTimestampMs: Date.now() },
  }),
};

export type HistorySet = BaileysEventMap["messaging-history.set"];

/** Re-exported so packages without a Baileys dependency can build history events. */
export const HistorySyncType = proto.HistorySync.HistorySyncType;

export function historySet(partial: Partial<HistorySet> = {}): HistorySet {
  return {
    chats: [],
    contacts: [],
    messages: [],
    syncType: HistorySyncType.FULL,
    progress: 100,
    isLatest: true,
    ...partial,
  };
}
