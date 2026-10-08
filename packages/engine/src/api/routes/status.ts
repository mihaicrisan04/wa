import type { Qr, Status } from "@wa/sdk";
import { Hono } from "hono";
import { z } from "zod";
import { ApiError } from "../../errors";
import { HISTORY_PHASES_KEY } from "../../ingest";
import { actorOf, assertCan } from "../../policy";
import { readStatus } from "../../queries";
import { AlreadyLinkedError } from "../../whatsapp/connection";
import { readContext, type ApiDeps, type AppEnv } from "../context";

const linkBody = z.object({ relink: z.boolean().optional() }).default({});

export function statusRoutes(deps: ApiDeps) {
  const { connection } = deps;
  const qrOf = (): Qr => {
    const status = connection.status();
    return { state: status.state, qr: connection.isLinked() ? null : status.qr };
  };

  return new Hono<AppEnv>()
    .get("/status", (c) =>
      c.json(readStatus(readContext(c, deps), deps.version, connection.status()) satisfies Status),
    )
    .get("/qr", (c) => {
      assertCan(c.get("principal"), "link");
      return c.json(qrOf());
    })
    .post("/link", async (c) => {
      const principal = c.get("principal");
      assertCan(principal, "link");
      const { relink } = linkBody.parse(await c.req.json().catch(() => undefined));
      if (relink) assertCan(principal, "admin");
      try {
        await connection.link({ relink });
      } catch (err) {
        if (!(err instanceof AlreadyLinkedError)) throw err;
        throw new ApiError(409, "already_linked", "WhatsApp is already linked");
      }
      // a new device gets a new history sync; the old one's progress would read as done
      deps.store.sync.delete(HISTORY_PHASES_KEY);
      deps.store.audit.record({ ...actorOf(principal), action: relink ? "relink" : "link" });
      return c.json(qrOf());
    });
}
