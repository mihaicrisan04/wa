import type { Page } from "@wa/sdk";
import { z } from "zod";
import { invalid } from "../errors";

type CursorKey = (string | number)[];

/** Opaque page cursors: base64url JSON of the sort key the next page starts after. */
export function encodeCursor(key: CursorKey): string {
  return Buffer.from(JSON.stringify(key)).toString("base64url");
}

export function decodeCursor<T extends z.ZodType>(cursor: string, schema: T): z.infer<T> {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    const result = schema.safeParse(decoded);
    if (result.success) return result.data;
  } catch {
    // falls through to the error below
  }
  throw invalid("cursor: not a cursor this server issued");
}

/** A page from `limit + 1` fetched rows: the extra row only says another page exists. */
export function paginate<T>(rows: T[], limit: number, keyOf: (last: T) => CursorKey): Page<T> {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > limit && last !== undefined ? encodeCursor(keyOf(last)) : null,
  };
}

/** A message position: `(ts, rowid)`, compared as a pair. */
export type Position = [ts: number, rowid: number];

const positionSchema = z.tuple([z.number().int(), z.number().int()]);

const MAX_ROWID = Number.MAX_SAFE_INTEGER;
const TIME = /^(\d+$|\d{4}-\d{2}-\d{2})/;

/** A cursor from an earlier page, unix seconds or an ISO date; both sides are exclusive. */
export function parseBound(value: string, side: "before" | "after"): Position {
  if (!TIME.test(value)) return decodeCursor(value, positionSchema);
  const ts = parseTime(value, side);
  return side === "before" ? [ts, 0] : [ts, MAX_ROWID];
}

/** Unix seconds from unix seconds or an ISO date, for plain time filters. */
export function parseTime(value: string, field: string): number {
  if (/^\d+$/.test(value)) return Number(value);
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw invalid(`${field}: expected unix seconds or an ISO date`);
  return Math.floor(ms / 1000);
}
