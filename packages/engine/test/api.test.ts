import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createWaClient } from "@wa/sdk";
import { Hono } from "hono";
import pino from "pino";
import { z } from "zod";
import { createApp } from "../src/api/app";
import { ApiError, errorHandler } from "../src/api/errors";
import { startEngine, type Engine } from "../src/engine";
import { FakeWhatsAppClient, makeTempHome, type TempHome } from "../src/testing";

const logger = pino({ level: "silent" });

describe("engine HTTP listener", () => {
  let temp: TempHome;
  let engine: Engine;

  beforeEach(async () => {
    temp = await makeTempHome();
    engine = await startEngine(temp.config, { client: new FakeWhatsAppClient(), logger });
  });

  afterEach(async () => {
    await engine.stop();
    await temp.cleanup();
  });

  test("serves /v1/health through the sdk on an ephemeral port", async () => {
    expect(engine.port).toBeGreaterThan(0);
    const client = createWaClient({ baseUrl: `http://127.0.0.1:${engine.port}` });
    expect(await client.health()).toEqual({ ok: true, version: "0.1.0" });
  });

  test("accepts localhost as the host name", async () => {
    const response = await fetch(`http://localhost:${engine.port}/v1/health`);
    expect(response.status).toBe(200);
  });

  test("unknown routes are a JSON 404", async () => {
    const response = await fetch(`http://127.0.0.1:${engine.port}/v1/nope`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: "not_found", message: "not found" } });
  });
});

describe("local-only guard", () => {
  const app = createApp({ version: "test", logger, port: () => 7373 });
  const health = (headers: Record<string, string>) => app.request("/v1/health", { headers });

  test.each(["127.0.0.1:7373", "localhost:7373", "LOCALHOST:7373"])(
    "allows Host %s",
    async (host) => {
      expect((await health({ host })).status).toBe(200);
    },
  );

  test.each(["evil.example:7373", "127.0.0.1:7374", "127.0.0.1", "localhost"])(
    "rejects Host %s (DNS rebinding)",
    async (host) => {
      const response = await health({ host });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: "forbidden_host" } });
    },
  );

  test("rejects a missing Host", async () => {
    expect((await app.request("http://x/v1/health", { headers: {} })).status).toBe(403);
  });

  test.each(["http://127.0.0.1:7373", "null", "https://evil.example"])(
    "rejects any Origin (%s)",
    async (origin) => {
      const response = await health({ host: "127.0.0.1:7373", origin });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: "forbidden_origin" } });
    },
  );
});

describe("error handler", () => {
  const app = new Hono()
    .get("/api-error", () => {
      throw new ApiError(409, "not_linked", "WhatsApp is not linked yet");
    })
    .get("/invalid", (c) =>
      c.json(z.object({ limit: z.coerce.number().max(200) }).parse(c.req.query())),
    )
    .get("/crash", () => {
      throw new Error("SQLITE_CORRUPT: database disk image is malformed at /secret/path");
    });
  app.onError(errorHandler(logger));

  test("maps ApiError to its status and code", async () => {
    const response = await app.request("/api-error");
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: "not_linked", message: "WhatsApp is not linked yet" },
    });
  });

  test("turns zod validation failures into a 400", async () => {
    const response = await app.request("/invalid?limit=500");
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "invalid_request" } });
  });

  test("hides internal error text behind a generic 500", async () => {
    const response = await app.request("/crash");
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain("SQLITE");
    expect(JSON.parse(text)).toEqual({ error: { code: "internal", message: "internal error" } });
  });
});
