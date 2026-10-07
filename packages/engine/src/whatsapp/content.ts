import { getContentType, toNumber, type proto } from "@whiskeysockets/baileys";
import type { MediaInfo } from "../store";

export type ContentType = keyof proto.IMessage;

const TYPE_NAMES: Partial<Record<ContentType, string>> = {
  conversation: "text",
  extendedTextMessage: "text",
  imageMessage: "image",
  videoMessage: "video",
  ptvMessage: "video",
  audioMessage: "audio",
  documentMessage: "document",
  stickerMessage: "sticker",
  locationMessage: "location",
  liveLocationMessage: "location",
  contactMessage: "contact",
  contactsArrayMessage: "contact",
  pollCreationMessage: "poll",
  pollCreationMessageV2: "poll",
  pollCreationMessageV3: "poll",
  eventMessage: "event",
};

const MEDIA_TYPES = new Set<ContentType>([
  "imageMessage",
  "videoMessage",
  "ptvMessage",
  "audioMessage",
  "documentMessage",
  "stickerMessage",
]);

/** Content that only changes or annotates another message; never stored as a row. */
export const CARRIER_TYPES = new Set<ContentType>([
  "protocolMessage",
  "reactionMessage",
  "encReactionMessage",
  "pollUpdateMessage",
  "encEventResponseMessage",
  "keepInChatMessage",
  "pinInChatMessage",
  "senderKeyDistributionMessage",
]);

export function contentTypeOf(content: proto.IMessage | null | undefined): ContentType | undefined {
  return getContentType(content ?? undefined);
}

export function typeName(type: ContentType): string {
  return TYPE_NAMES[type] ?? type.replace(/Message$/, "");
}

export interface ContentText {
  text: string | null;
  caption: string | null;
  fileName: string | null;
}

type AnyContent = {
  text?: string | null;
  caption?: string | null;
  fileName?: string | null;
  name?: string | null;
  address?: string | null;
  displayName?: string | null;
  description?: string | null;
  title?: string | null;
  options?: { optionName?: string | null }[] | null;
  contextInfo?: proto.IContextInfo | null;
  mimetype?: string | null;
  fileLength?: Parameters<typeof toNumber>[0];
  viewOnce?: boolean | null;
};

/** The body of `content`'s `type` field, read through the fields message types share. */
export function bodyOf(content: proto.IMessage, type: ContentType): AnyContent {
  const value = content[type];
  return value && typeof value === "object" ? (value as AnyContent) : {};
}

/** The searchable text of a (normalized) message: body, caption and file name. */
export function textOf(content: proto.IMessage | null | undefined): ContentText {
  const empty = { text: null, caption: null, fileName: null };
  const type = contentTypeOf(content);
  if (!content || !type) return empty;
  if (type === "conversation") return { ...empty, text: content.conversation || null };
  const body = bodyOf(content, type);
  if (MEDIA_TYPES.has(type)) {
    return { text: null, caption: body.caption || null, fileName: body.fileName || null };
  }
  const options = body.options?.map((option) => option.optionName).filter(Boolean) ?? [];
  const parts = [
    body.text,
    body.name,
    body.title,
    body.address,
    body.displayName,
    body.description,
    body.caption,
    ...options,
  ];
  const text = parts.filter((part): part is string => Boolean(part)).join("\n");
  return { ...empty, text: text || null };
}

export function mediaOf(content: proto.IMessage | null | undefined): MediaInfo | null {
  const type = contentTypeOf(content);
  if (!content || !type || !MEDIA_TYPES.has(type)) return null;
  const body = bodyOf(content, type);
  return {
    kind: typeName(type),
    mimetype: body.mimetype || null,
    fileName: body.fileName || null,
    size: body.fileLength == null ? null : toNumber(body.fileLength),
  };
}

export function contextInfoOf(
  content: proto.IMessage | null | undefined,
): proto.IContextInfo | null {
  const type = contentTypeOf(content);
  if (!content || !type) return null;
  return bodyOf(content, type).contextInfo ?? null;
}

/**
 * Applies an edit to the original content in place: the new text or caption replaces the old
 * one, everything else (media keys, quotes) stays.
 */
export function applyEditedText(original: proto.IMessage, edited: proto.IMessage): void {
  const { text, caption } = textOf(edited);
  const replacement = text ?? caption;
  const type = contentTypeOf(original);
  if (!type || replacement === null) return;
  if (type === "conversation") original.conversation = replacement;
  else if (type === "extendedTextMessage") bodyOf(original, type).text = replacement;
  else if (MEDIA_TYPES.has(type)) bodyOf(original, type).caption = replacement;
}
