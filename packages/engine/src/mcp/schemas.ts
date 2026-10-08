import { z } from "zod";

/** Output schemas: the JSON shapes of `@wa/sdk`, so structured results match the HTTP API. */
const nullableString = z.string().nullable();
const nullableNumber = z.number().nullable();

export const CHAT_KINDS = ["dm", "group", "self", "broadcast", "newsletter", "other"] as const;
export const MEDIA_KINDS = ["image", "video", "audio", "document", "sticker"] as const;

export const chatSchema = z.object({
  jid: z.string(),
  kind: z.enum(CHAT_KINDS),
  name: nullableString,
  archived: z.boolean(),
  pinned: nullableNumber,
  muteEndTime: nullableNumber,
  unreadCount: z.number(),
  lastMessageAt: nullableNumber,
});

export const messageSchema = z.object({
  chat: z.string(),
  id: z.string(),
  fromMe: z.boolean(),
  sender: nullableString,
  senderName: nullableString,
  ts: z.number().describe("unix seconds"),
  type: z.string(),
  text: nullableString,
  caption: nullableString,
  fileName: nullableString,
  quoted: z
    .object({
      id: nullableString,
      chat: nullableString,
      sender: nullableString,
      text: nullableString,
    })
    .nullable(),
  editedAt: nullableNumber,
  deletedAt: nullableNumber,
  expiresAt: nullableNumber,
  hasMedia: z.boolean(),
  viewOnce: z.boolean(),
});

export const chatRefSchema = z.object({ jid: z.string(), name: nullableString });

export const mediaSchema = z.object({
  chat: z.string(),
  id: z.string(),
  kind: z.string(),
  mimetype: nullableString,
  fileName: nullableString,
  size: nullableNumber,
  downloaded: z.boolean(),
});

/** Inputs shared by several tools. */
export const chatInput = z
  .string()
  .trim()
  .min(1)
  .describe("a chat jid, a phone number, or (part of) the chat's name");

export const timeInput = z.string().trim().min(1).describe("unix seconds or an ISO date");

export function limitInput(fallback: number, max: number) {
  return z.number().int().min(1).max(max).default(fallback).describe(`at most ${max}`);
}
