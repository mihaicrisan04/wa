import { CHAT_KINDS, MEDIA_KINDS, type Chat, type MediaInfo, type Message } from "@wa/sdk";
import { z } from "zod";
import { requiredText, type MediaItem } from "../queries";

/** Output schemas: the JSON shapes of `@wa/sdk`, so structured results match the HTTP API. */
const nullableString = z.string().nullable();
const nullableNumber = z.number().nullable();

export const chatSchema = z.object({
  jid: z.string(),
  kind: z.enum(CHAT_KINDS),
  name: nullableString,
  archived: z.boolean(),
  pinned: nullableNumber,
  muteEndTime: nullableNumber,
  unreadCount: z.number(),
  lastMessageAt: nullableNumber,
}) satisfies z.ZodType<Chat>;

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
}) satisfies z.ZodType<Message>;

export const chatRefSchema = z.object({ jid: z.string(), name: nullableString });

export const mediaSchema = z.object({
  chat: z.string(),
  id: z.string(),
  kind: z.enum(MEDIA_KINDS),
  mimetype: nullableString,
  fileName: nullableString,
  size: nullableNumber,
  downloaded: z.boolean(),
}) satisfies z.ZodType<MediaInfo>;

export const mediaItemSchema = mediaSchema.extend({
  ts: z.number(),
  fromMe: z.boolean(),
  sender: nullableString,
  senderName: nullableString,
  caption: nullableString,
}) satisfies z.ZodType<MediaItem>;

/** Inputs shared by several tools. */
export const chatInput = requiredText.describe(
  "a chat jid, a phone number, or (part of) the chat's name",
);

export const timeInput = requiredText.describe("unix seconds or an ISO date");
