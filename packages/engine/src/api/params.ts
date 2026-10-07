import type { Context } from "hono";
import { z } from "zod";
import { invalid } from "../errors";

export function limitParam(fallback: number, max: number) {
  return z.coerce.number().int().min(1).max(max).default(fallback);
}

/** A non-empty query parameter; an empty one counts as absent. */
export const optionalText = z
  .string()
  .trim()
  .optional()
  .transform((value) => value || undefined);

export const requiredText = z.string().trim().min(1);

/** `?download=1` style flags. */
export const flag = z
  .enum(["1", "0", "true", "false"])
  .optional()
  .transform((value) => value === "1" || value === "true");

/** Names of collections and profiles. */
export const nameParam = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/i, "use letters, digits, - and _ (max 64)");

/** A JSON request body checked against `schema`; malformed JSON is a 400 like any bad input. */
export async function jsonBody<T extends z.ZodType>(c: Context, schema: T): Promise<z.output<T>> {
  const body: unknown = await c.req.json().catch(() => {
    throw invalid("body: expected JSON");
  });
  return schema.parse(body);
}
