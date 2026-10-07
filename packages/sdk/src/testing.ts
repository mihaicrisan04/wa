import type { Message } from "./types";

/** A synthetic text message from Eve in her DM, for client tests; `overrides` change any field. */
export function messageFixture(overrides: Partial<Message> = {}): Message {
  return {
    chat: "40700000002@s.whatsapp.net",
    id: "M1",
    fromMe: false,
    sender: "40700000002@s.whatsapp.net",
    senderName: "Eve",
    ts: 1_760_000_000,
    type: "text",
    text: "hello",
    caption: null,
    fileName: null,
    quoted: null,
    editedAt: null,
    deletedAt: null,
    expiresAt: null,
    hasMedia: false,
    viewOnce: false,
    ...overrides,
  };
}
