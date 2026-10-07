import { z } from "zod";

/** Accepts numbers and numeric strings, so query strings and MCP arguments share it. */
export function limitParam(fallback: number, max: number) {
  return z.coerce.number().int().min(1).max(max).default(fallback).describe(`at most ${max}`);
}

/** A non-empty string; an empty one counts as absent. */
export const optionalText = z
  .string()
  .trim()
  .transform((value) => value || undefined)
  .optional();

export const requiredText = z.string().trim().min(1);
