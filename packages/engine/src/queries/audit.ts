import type { AuditEntry, Page } from "@wa/sdk";
import { z } from "zod";
import type { Store } from "../store";
import { decodeCursor, paginate } from "./cursor";
import { limitParam, optionalText } from "./fields";

export const auditQuery = z.object({
  profile: optionalText,
  limit: limitParam(50, 500),
  cursor: optionalText,
});

const auditCursor = z.tuple([z.number().int()]);

/** The audit log, newest first. */
export function listAudit(store: Store, options: z.output<typeof auditQuery>): Page<AuditEntry> {
  const [beforeId] = options.cursor ? decodeCursor(options.cursor, auditCursor) : [undefined];
  const rows = store.audit.list({ profile: options.profile, beforeId, limit: options.limit + 1 });
  return paginate(rows, options.limit, (last) => [last.id]);
}
