import type { MediaInfo, MessageContext, Page, SearchHit } from "@wa/sdk";
import { Hono } from "hono";
import { z } from "zod";
import { mediaUnavailable } from "../../errors";
import {
  contextParam,
  findMedia,
  getMessage,
  resolveChat,
  searchMessages,
  searchQuery,
  toMediaInfo,
} from "../../queries";
import type { CachedMedia } from "../../whatsapp/media";
import { requires } from "../auth";
import { readContext, type ApiDeps, type AppEnv } from "../context";
import { flag } from "../params";

const contextQuery = z.object({ context: contextParam });
const mediaQuery = z.object({ download: flag });

export function messageRoutes(deps: ApiDeps) {
  return new Hono<AppEnv>()
    .get("/search", requires("messages:read"), (c) => {
      const query = searchQuery.parse(c.req.query());
      const ctx = readContext(deps, c.get("principal"));
      return c.json(searchMessages(ctx, query) satisfies Page<SearchHit>);
    })
    .get("/messages/:chat/:id", requires("messages:read"), (c) => {
      const { context } = contextQuery.parse(c.req.query());
      const ctx = readContext(deps, c.get("principal"));
      const chat = resolveChat(ctx, c.req.param("chat"));
      return c.json(getMessage(ctx, chat, c.req.param("id"), context) satisfies MessageContext);
    })
    .get("/media/:chat/:id", requires("media:read"), async (c) => {
      const ctx = readContext(deps, c.get("principal"));
      const row = findMedia(ctx, resolveChat(ctx, c.req.param("chat")), c.req.param("id"));
      const { download } = mediaQuery.parse(c.req.query());
      if (!download) return c.json(toMediaInfo(row) satisfies MediaInfo);

      deps.noTimeout(c.req.raw);
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
