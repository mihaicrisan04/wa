import type { Qr, Status } from "@wa/sdk";
import { Hono } from "hono";
import { z } from "zod";
import { conflict } from "../../errors";
import { assertCan, recordAudit } from "../../policy";
import { readStatus } from "../../queries";
import { AlreadyLinkedError } from "../../whatsapp/connection";
import { requires } from "../auth";
import { readContext, type ApiDeps, type AppEnv } from "../context";
import { jsonBody } from "../params";

const linkBody = z.object({ relink: z.boolean().optional() }).default({});

export function statusRoutes(deps: ApiDeps) {
  const { connection } = deps;
  const qrOf = (): Qr => {
    const status = connection.status();
    return { state: status.state, qr: connection.isLinked() ? null : status.qr };
  };

  return new Hono<AppEnv>()
    .get("/status", (c) => {
      const ctx = readContext(deps, c.get("principal"));
      return c.json(readStatus(ctx, deps.version, connection.status()) satisfies Status);
    })
    .get("/qr", requires("link"), (c) => c.json(qrOf()))
    .post("/link", requires("link"), async (c) => {
      const principal = c.get("principal");
      const { relink } = await jsonBody(c, linkBody, { optional: true });
      if (relink) assertCan(principal, "admin");
      try {
        await connection.link({ relink });
      } catch (err) {
        if (!(err instanceof AlreadyLinkedError)) throw err;
        throw conflict("already_linked", "WhatsApp is already linked");
      }
      deps.store.sync.clearHistoryPhases();
      recordAudit(deps.store, principal, relink ? "relink" : "link");
      return c.json(qrOf());
    });
}
