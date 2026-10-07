import { z } from "zod";
import { chatName, listMedia, resolveChat, type MediaItem } from "../../queries";
import { byteSize, chatRef, isoTime, quote } from "../format";
import { chatInput, chatRefSchema, limitInput, MEDIA_KINDS, mediaSchema } from "../schemas";
import { defineTool } from "../tool";

export const listMediaTool = defineTool({
  name: "list_media",
  title: "List media",
  description:
    "Photos, videos, audio, documents and stickers of one chat, newest first. Get one with download_media.",
  requires: ["media:read"],
  input: z.object({
    chat: chatInput,
    kind: z.enum(MEDIA_KINDS).optional(),
    query: z.string().trim().min(1).optional().describe("part of the file name or caption"),
    limit: limitInput(30, 200),
  }),
  output: z.object({
    chat: chatRefSchema,
    media: z.array(
      mediaSchema.extend({
        ts: z.number(),
        fromMe: z.boolean(),
        sender: z.string().nullable(),
        senderName: z.string().nullable(),
        caption: z.string().nullable(),
      }),
    ),
  }),
  run({ chat: ref, kind, query, limit }, env) {
    const ctx = env.read();
    const jid = resolveChat(ctx, ref);
    const media = listMedia(ctx, jid, { kind, query, limit });
    const chat = { jid, name: chatName(ctx, jid) };
    return {
      lines: [
        `chat ${chatRef(jid, chat.name)}, newest first:`,
        ...(media.length ? media.map(mediaLine) : ["no media found"]),
      ],
      structured: { chat, media },
      chat: jid,
      count: media.length,
    };
  },
});

function mediaLine(item: MediaItem): string {
  const sender = item.fromMe ? "me" : quote(item.senderName ?? item.sender ?? "unknown");
  const details = [
    `id ${quote(item.id)}`,
    quote(item.mimetype ?? "unknown type"),
    byteSize(item.size),
  ];
  if (item.fileName) details.push(`file ${quote(item.fileName)}`);
  if (item.caption) details.push(`caption ${quote(item.caption)}`);
  return `[${isoTime(item.ts)}] ${sender}: ${quote(item.kind)} · ${details.join(" · ")}`;
}
