import { z } from "zod";
import { invalid } from "../errors";

/** Opaque page cursors: base64url JSON of the sort key the next page starts after. */
export function encodeCursor(key: (string | number)[]): string {
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

/** A message position: `(ts, rowid)`, compared as a pair. */
export type Position = [ts: number, rowid: number];

export const positionSchema = z.tuple([z.number().int(), z.number().int()]);

const MAX_ROWID = Number.MAX_SAFE_INTEGER;

/**
 * `before`/`after` take a cursor from an earlier page, unix seconds or an ISO date. Both are
 * exclusive: `before=T` keeps messages older than T, `after=T` newer than T.
 */
export function parseBound(value: string, side: "before" | "after"): Position {
  if (/^\d+$/.test(value)) return timeBound(Number(value), side);
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
    const ms = Date.parse(value);
    if (Number.isNaN(ms)) throw invalid(`${side}: not a valid date`);
    return timeBound(Math.floor(ms / 1000), side);
  }
  return decodeCursor(value, positionSchema);
}

function timeBound(ts: number, side: "before" | "after"): Position {
  return side === "before" ? [ts, 0] : [ts, MAX_ROWID];
}

/** Unix seconds from unix seconds or an ISO date, for plain time filters. */
export function parseTime(value: string, field: string): number {
  if (/^\d+$/.test(value)) return Number(value);
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw invalid(`${field}: expected unix seconds or an ISO date`);
  return Math.floor(ms / 1000);
}
