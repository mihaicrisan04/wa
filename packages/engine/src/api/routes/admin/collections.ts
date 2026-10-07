import type { ChatCandidate, Collection, CollectionDetail } from "@wa/sdk";
import { Hono } from "hono";
import { z } from "zod";
import { ApiError, notFound } from "../../../errors";
import { ADMIN, actorOf } from "../../../policy";
import { resolveChat, type ReadContext } from "../../../queries";
import type { CollectionRow } from "../../../store";
import { readContext, type ApiDeps, type AppEnv } from "../../context";
import { jsonBody, nameParam, requiredText } from "../../params";

const createBody = z.object({
  name: nameParam,
  description: z.string().trim().max(500).optional(),
});
const chatsBody = z.object({ chats: z.array(requiredText).min(1).max(500) });

export function collectionRoutes(deps: ApiDeps) {
  const { store } = deps;
  const audit = (action: string, detail: Record<string, unknown>) =>
    store.audit.record({ ...actorOf(ADMIN), action, detail });

  return new Hono<AppEnv>()
    .get("/collections", (c) =>
      c.json({ items: store.collections.list().map(toCollection) satisfies Collection[] }),
    )
    .post("/collections", async (c) => {
      const body = await jsonBody(c, createBody);
      if (!store.collections.create(body.name, body.description || null)) {
        throw new ApiError(409, "exists", `collection "${body.name}" already exists`);
      }
      audit("collection.create", { collection: body.name });
      return c.json(detail(readContext(c, deps), body.name), 201);
    })
    .get("/collections/:name", (c) => c.json(detail(readContext(c, deps), c.req.param("name"))))
    .delete("/collections/:name", (c) => {
      const name = c.req.param("name");
      if (!store.collections.delete(name)) throw notFound("collection not found");
      audit("collection.delete", { collection: name });
      return c.json({ ok: true });
    })
    .post("/collections/:name/chats", async (c) => {
      const name = c.req.param("name");
      if (!store.collections.get(name)) throw notFound("collection not found");
      const { chats } = await jsonBody(c, chatsBody);
      const ctx = readContext(c, deps);
      const jids = chats.map((chat) => resolveChat(ctx, chat, { stored: false }));
      store.transaction(() => {
        for (const jid of jids) store.collections.addChat(name, jid);
      });
      audit("collection.add", { collection: name, count: jids.length });
      return c.json(detail(ctx, name));
    })
    .delete("/collections/:name/chats/:chat", (c) => {
      const name = c.req.param("name");
      const ctx = readContext(c, deps);
      const jid = resolveChat(ctx, c.req.param("chat"), { stored: false });
      if (!store.collections.removeChat(name, jid))
        throw notFound("chat is not in that collection");
      audit("collection.remove", { collection: name, count: 1 });
      return c.json(detail(ctx, name));
    });
}

function toCollection(row: CollectionRow): Collection {
  return {
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
    chatCount: row.chat_count,
  };
}

function detail(ctx: ReadContext, name: string): CollectionDetail {
  const row = ctx.store.collections.get(name);
  if (!row) throw notFound("collection not found");
  const chats = ctx.store.collections.chats(name).map((jid): ChatCandidate => {
    const named = ctx.store.db
      .query<{ name: string | null; kind: ChatCandidate["kind"] }, { jid: string }>(
        `SELECT coalesce(ch.name, ct.name, ct.verified_name, ct.push_name) AS name, ch.kind
         FROM (SELECT $jid AS jid) AS member
         LEFT JOIN chats AS ch ON ch.jid = member.jid
         LEFT JOIN contacts AS ct ON ct.jid = member.jid`,
      )
      .get({ jid });
    return { jid, name: named?.name ?? null, kind: named?.kind ?? ctx.identity.kindOf(jid) };
  });
  return { ...toCollection(row), chats };
}
