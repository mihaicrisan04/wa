import type { MediaInfo, MessageContext, Page, SearchHit } from "@wa/sdk";
import { Hono } from "hono";
import { z } from "zod";
import { mediaUnavailable } from "../../errors";
import { assertCan } from "../../policy";
import { findMedia, getMessage, searchVisible, toMediaInfo } from "../../queries";
import type { CachedMedia } from "../../whatsapp/media";
import { readContext, type ApiDeps, type AppEnv } from "../context";
import { flag, limitParam, optionalText, requiredText } from "../params";

const searchQuery = z.object({
  q: requiredText,
  chat: optionalText,
  sender: optionalText,
  after: optionalText,
  before: optionalText,
  type: optionalText,
  limit: limitParam(50, 200),
  cursor: optionalText,
});

const contextQuery = z.object({ context: z.coerce.number().int().min(0).max(50).default(0) });

export function messageRoutes(deps: ApiDeps) {
  return new Hono<AppEnv>()
    .get("/search", (c) => {
      assertCan(c.get("principal"), "messages:read");
      const query = searchQuery.parse(c.req.query());
      return c.json(searchVisible(readContext(c, deps), query) satisfies Page<SearchHit>);
    })
    .get("/messages/:chat/:id", (c) => {
      assertCan(c.get("principal"), "messages:read");
      const { context } = contextQuery.parse(c.req.query());
      const found = getMessage(
        readContext(c, deps),
        c.req.param("chat"),
        c.req.param("id"),
        context,
      );
      return c.json(found satisfies MessageContext);
    })
    .get("/media/:chat/:id", async (c) => {
      assertCan(c.get("principal"), "media:read");
      const row = findMedia(readContext(c, deps), c.req.param("chat"), c.req.param("id"));
      const { download } = z.object({ download: flag }).parse(c.req.query());
      if (!download) return c.json(toMediaInfo(row) satisfies MediaInfo);

      deps.noTimeout?.(c.req.raw);
      const media = await deps.media
        .get({ chatJid: row.chat_jid, id: row.message_id })
        .catch(mediaUnavailable);
      return new Response(Bun.file(media.path), {
        headers: {
          "content-type": media.mimetype ?? "application/octet-stream",
          "content-length": String(media.size),
          "content-disposition": attachment(media, row.message_id),
        },
      });
    });
}

/** Sender-controlled names only ever reach this header, ASCII-folded and quoted safely. */
function attachment(media: CachedMedia, id: string): string {
  const name = media.fileName?.replace(/[\\/\r\n"]/g, "_") || `${id}${extensionOf(media.path)}`;
  const ascii = name.replace(/[^\x20-\x7e]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

function extensionOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "" : path.slice(dot);
}
