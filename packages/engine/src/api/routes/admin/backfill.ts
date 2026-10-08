import { BACKFILL_DEFAULT_MAX, type BackfillJob } from "@wa/sdk";
import { Hono } from "hono";
import { z } from "zod";
import { ApiError, notFound, notLinked } from "../../../errors";
import { ADMIN, auditActor } from "../../../policy";
import { chatName, resolveChat } from "../../../queries";
import { readContext, type ApiDeps, type AppEnv } from "../../context";
import { jsonBody, requiredText } from "../../params";

const BACKFILL_LIMIT = 10_000;

const startBody = z.object({
  chat: requiredText,
  max: z.number().int().min(1).max(BACKFILL_LIMIT).default(BACKFILL_DEFAULT_MAX),
});

/** Runs in the background: the POST answers right away, the CLI polls the run. */
export function backfillRoutes(deps: ApiDeps) {
  const { store, connection, backfills } = deps;
  return new Hono<AppEnv>()
    .post("/backfill", async (c) => {
      const body = await jsonBody(c, startBody);
      const ctx = readContext(c, deps);
      const chat = resolveChat(ctx, body.chat);
      if (!connection.isLinked()) throw notLinked();
      if (connection.status().state !== "open") {
        throw new ApiError(503, "offline", "WhatsApp is not connected, the phone can't be asked");
      }
      const job = backfills.start(chat, chatName(ctx, chat), body.max);
      store.audit.record({
        ...auditActor(ADMIN),
        action: "backfill",
        chatJid: chat,
        detail: { max: body.max },
      });
      return c.json(job satisfies BackfillJob, 202);
    })
    .get("/backfill/:id", (c) => {
      const job = backfills.get(c.req.param("id"));
      if (!job) throw notFound("backfill not found");
      return c.json(job satisfies BackfillJob);
    });
}
