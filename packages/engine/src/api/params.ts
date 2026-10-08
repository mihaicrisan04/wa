import type { Context } from "hono";
import { z } from "zod";
import { invalid } from "../errors";

/** `?download=1` style flags. */
export const flag = z
  .enum(["1", "0", "true", "false"])
  .optional()
  .transform((value) => value === "1" || value === "true");

/** Names of collections and profiles. */
export const nameParam = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/i, "use letters, digits, - and _ (max 64)");

/** A JSON body checked against `schema`; malformed JSON is a 400, and `optional` allows none. */
export async function jsonBody<T extends z.ZodType>(
  c: Context,
  schema: T,
  { optional = false }: { optional?: boolean } = {},
): Promise<z.output<T>> {
  const text = await c.req.text();
  return schema.parse(optional && !text.trim() ? undefined : parseJson(text));
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw invalid("body: expected JSON");
  }
}
