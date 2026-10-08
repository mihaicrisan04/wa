import type { Collection, CollectionDetail, Items } from "@wa/sdk";
import { Hono } from "hono";
import { z } from "zod";
import { conflict, notFound } from "../../../errors";
import { recordAudit } from "../../../policy";
import { collectionChats, requiredText, resolveChat, type ReadContext } from "../../../queries";
import type { CollectionRow } from "../../../store";
import { readContext, type ApiDeps, type AppEnv } from "../../context";
import { jsonBody, nameParam } from "../../params";

const createBody = z.object({
  name: nameParam,
  description: z.string().trim().max(500).optional(),
});
const chatsBody = z.object({ chats: z.array(requiredText).min(1).max(500) });

export function collectionRoutes(deps: ApiDeps) {
  const { store } = deps;
  return new Hono<AppEnv>()
    .get("/collections", (c) =>
      c.json({ items: store.collections.list().map(toCollection) } satisfies Items<Collection>),
    )
    .post("/collections", async (c) => {
      const body = await jsonBody(c, createBody);
      if (!store.collections.create(body.name, body.description || null)) {
        throw conflict("exists", `collection "${body.name}" already exists`);
      }
      const principal = c.get("principal");
      recordAudit(store, principal, "collection.create", { detail: { collection: body.name } });
      return c.json(detail(readContext(deps, principal), body.name), 201);
    })
    .get("/collections/:name", (c) =>
      c.json(detail(readContext(deps, c.get("principal")), c.req.param("name"))),
    )
    .delete("/collections/:name", (c) => {
      const name = c.req.param("name");
      if (!store.collections.delete(name)) throw notFound("collection not found");
      recordAudit(store, c.get("principal"), "collection.delete", {
        detail: { collection: name },
      });
      return c.json({ ok: true });
    })
    .post("/collections/:name/chats", async (c) => {
      const name = c.req.param("name");
      if (!store.collections.get(name)) throw notFound("collection not found");
      const { chats } = await jsonBody(c, chatsBody);
      const ctx = readContext(deps, c.get("principal"));
      const jids = chats.map((chat) => resolveChat(ctx, chat, { stored: false }));
      store.transaction(() => {
        for (const jid of jids) store.collections.addChat(name, jid);
      });
      recordAudit(store, ctx.principal, "collection.add", {
        detail: { collection: name, count: jids.length },
      });
      return c.json(detail(ctx, name));
    })
    .delete("/collections/:name/chats/:chat", (c) => {
      const name = c.req.param("name");
      const ctx = readContext(deps, c.get("principal"));
      const jid = resolveChat(ctx, c.req.param("chat"), { stored: false });
      if (!store.collections.removeChat(name, jid))
        throw notFound("chat is not in that collection");
      recordAudit(store, ctx.principal, "collection.remove", {
        detail: { collection: name, count: 1 },
      });
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
  return { ...toCollection(row), chats: collectionChats(ctx, name) };
}
