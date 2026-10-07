import { z } from "zod";
import { chatRefOf, listMedia, mediaListQuery, type MediaItem } from "../../queries";
import { byteSize, chatRef, isoTime, quote, senderLabel } from "../format";
import { chatInput, chatRefSchema, mediaItemSchema } from "../schemas";
import { defineTool } from "../tool";

export const listMediaTool = defineTool({
  name: "list_media",
  title: "List media",
  description:
    "Photos, videos, audio, documents and stickers of one chat, newest first. Get one with download_media.",
  requires: ["media:read"],
  input: z.object({
    chat: chatInput,
    ...mediaListQuery.shape,
    query: mediaListQuery.shape.query.describe("part of the file name or caption"),
  }),
  output: z.object({ chat: chatRefSchema, media: z.array(mediaItemSchema) }),
  run({ chat: ref, ...options }, env) {
    const ctx = env.read();
    const chat = chatRefOf(ctx, ref);
    const media = listMedia(ctx, chat.jid, options);
    return {
      lines: [
        `chat ${chatRef(chat.jid, chat.name)}, newest first:`,
        ...(media.length ? media.map(mediaLine) : ["no media found"]),
      ],
      structured: { chat, media },
      chat: chat.jid,
      count: media.length,
    };
  },
});

function mediaLine(item: MediaItem): string {
  const details = [
    `id ${quote(item.id)}`,
    quote(item.mimetype ?? "unknown type"),
    byteSize(item.size),
  ];
  if (item.fileName) details.push(`file ${quote(item.fileName)}`);
  if (item.caption) details.push(`caption ${quote(item.caption)}`);
  return `[${isoTime(item.ts)}] ${senderLabel(item)}: ${quote(item.kind)} · ${details.join(" · ")}`;
}
