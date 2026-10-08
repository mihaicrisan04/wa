import { copyFile, mkdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { z } from "zod";
import { mediaUnavailable } from "../../errors";
import { findMedia } from "../../queries";
import type { CachedMedia } from "../../whatsapp/media";
import { byteSize, chatRef, quote } from "../format";
import { chatInput } from "../schemas";
import { defineTool, type ToolEnv } from "../tool";

/** Larger images, and any other media, are copied out instead of inlined. */
export const INLINE_IMAGE_MAX_BYTES = 1024 * 1024;

export const downloadMediaTool = defineTool({
  name: "download_media",
  title: "Download media",
  description:
    "Fetches a message's media. Images up to 1 MB come back inline; anything else is copied to a temporary file whose path is returned.",
  requires: ["media:read"],
  input: z.object({ chat: chatInput, message_id: z.string().trim().min(1) }),
  output: z.object({
    chat: z.string(),
    id: z.string(),
    kind: z.string(),
    mimetype: z.string().nullable(),
    fileName: z.string().nullable(),
    size: z.number(),
    inline: z.boolean(),
    path: z.string().nullable().describe("the exported copy, when not inline"),
  }),
  async run({ chat: ref, message_id }, env) {
    const row = findMedia(env.read(), ref, message_id);
    const media = await env.deps.media
      .get({ chatJid: row.chat_jid, id: row.message_id })
      .catch(mediaUnavailable);
    const about = [
      `${quote(media.kind)} ${quote(media.mimetype ?? "unknown type")}, ${byteSize(media.size)}`,
      `from chat ${chatRef(row.chat_jid, null)}, message id ${quote(row.message_id)}`,
      ...(media.fileName ? [`file name ${quote(media.fileName)}`] : []),
    ];
    const structured = {
      chat: row.chat_jid,
      id: row.message_id,
      kind: media.kind,
      mimetype: media.mimetype,
      fileName: media.fileName,
      size: media.size,
    };

    if (isInlineImage(media)) {
      const data = (await readFile(media.path)).toString("base64");
      return {
        lines: [...about, "the image follows inline"],
        structured: { ...structured, inline: true, path: null },
        attachments: [{ type: "image", data, mimeType: media.mimetype! }],
        chat: row.chat_jid,
      };
    }
    const path = await exportCopy(env, media);
    return {
      lines: [...about, `saved to ${quote(path)}`],
      structured: { ...structured, inline: false, path },
      chat: row.chat_jid,
    };
  },
});

function isInlineImage(media: CachedMedia): boolean {
  return media.mimetype?.startsWith("image/") === true && media.size <= INLINE_IMAGE_MAX_BYTES;
}

/** `<exportDir>/<profile>/<hash>.<ext>`: the cache's own hashed name, never the cache path. */
async function exportCopy(env: ToolEnv, media: CachedMedia): Promise<string> {
  const dir = join(env.exportDir, env.principal.profile);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, basename(media.path));
  await copyFile(media.path, path);
  return path;
}
