import type { AuditEntry, Page } from "@wa/sdk";
import { Hono } from "hono";
import { auditQuery, listAudit } from "../../../queries";
import type { ApiDeps, AppEnv } from "../../context";

export function auditRoutes({ store }: ApiDeps) {
  return new Hono<AppEnv>().get("/audit", (c) => {
    const query = auditQuery.parse(c.req.query());
    return c.json(listAudit(store, query) satisfies Page<AuditEntry>);
  });
}
