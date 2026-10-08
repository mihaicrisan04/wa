import type { AuditEntry, Page } from "@wa/sdk";
import { Hono } from "hono";
import { z } from "zod";
import { decodeCursor, encodeCursor } from "../../../queries";
import type { AuditRow } from "../../../store";
import type { ApiDeps, AppEnv } from "../../context";
import { limitParam, optionalText } from "../../params";

const auditQuery = z.object({
  profile: optionalText,
  limit: limitParam(50, 500),
  cursor: optionalText,
});
const auditCursor = z.tuple([z.number().int()]);

/** Newest first. */
export function auditRoutes({ store }: ApiDeps) {
  return new Hono<AppEnv>().get("/audit", (c) => {
    const query = auditQuery.parse(c.req.query());
    const [beforeId] = query.cursor ? decodeCursor(query.cursor, auditCursor) : [undefined];
    const rows = store.audit.list({ profile: query.profile, beforeId, limit: query.limit + 1 });
    const items = rows.slice(0, query.limit);
    const page: Page<AuditEntry> = {
      items: items.map(toAuditEntry),
      nextCursor: rows.length > query.limit ? encodeCursor([items.at(-1)!.id]) : null,
    };
    return c.json(page);
  });
}

function toAuditEntry(row: AuditRow): AuditEntry {
  return {
    id: row.id,
    ts: row.ts,
    tokenId: row.token_id,
    profile: row.profile,
    action: row.action,
    chat: row.chat_jid,
    detail: row.detail ? (JSON.parse(row.detail) as Record<string, unknown>) : null,
  };
}
