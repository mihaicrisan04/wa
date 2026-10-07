import type { Health } from "@wa/sdk";
import { Hono } from "hono";

export function healthRoutes(version: string) {
  return new Hono().get("/health", (c) => c.json({ ok: true, version } satisfies Health));
}
