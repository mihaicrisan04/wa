import type { MessageRecord } from "../store";
import { ANA_PN } from "./jids";

/** A stored text message from Ana; `overrides` change any field. */
export function messageRecord(overrides: Partial<MessageRecord> = {}): MessageRecord {
  return {
    chatJid: ANA_PN,
    id: "3EB0A",
    fromMe: false,
    senderJid: ANA_PN,
    senderAlt: null,
    ts: 1_700_000_000,
    type: "text",
    text: "hello",
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
    source: "live",
    raw: "{}",
    media: null,
    ...overrides,
  };
}
