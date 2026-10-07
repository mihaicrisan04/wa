import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { stat, writeFile } from "node:fs/promises";
import type {
  AuditEntry,
  ChatCandidate,
  CollectionDetail,
  CreatedToken,
  Page,
  Profile,
  TokenInfo,
} from "@wa/sdk";
import { EngineRunningError } from "../src/api/socket";
import { socketPath } from "../src/config";
import { startEngine } from "../src/engine";
import {
  ANA_PN,
  BOB_PN,
  FakeWhatsAppClient,
  json,
  makeTempHome,
  silentLogger,
  startApi,
  type ApiHarness,
} from "../src/testing";
import { MASTER, SECRET, worldEvents } from "./support/world";

let api: ApiHarness;

beforeEach(async () => {
  api = await startApi();
  await api.emit(worldEvents());
});

afterEach(() => api.stop());

async function admin<T>(path: string, init?: RequestInit, status = 200): Promise<T> {
  const response = await api.admin(path, init);
  expect(`${path} ${response.status}`).toBe(`${path} ${status}`);
  return (await response.json()) as T;
}

describe("the admin socket", () => {
  test("is 0600 and needs no token", async () => {
    expect(((await stat(api.engine.socketPath)).mode & 0o777).toString(8)).toBe("600");
    expect(await admin<{ items: unknown[] }>("/v1/admin/collections")).toEqual({ items: [] });
  });

  test("admin routes don't exist on the TCP listener", async () => {
    const tcpRoutes = api.engine.apps.tcp.routes.map((route) => route.path);
    expect(tcpRoutes.filter((path) => path.startsWith("/v1/admin"))).toEqual([]);
    const token = await api.raycastToken();
    expect((await api.http("/v1/admin/collections", token)).status).toBe(404);
  });

  test("a second engine on the same WA_HOME is refused", async () => {
    const second = startEngine(api.temp.config, {
      client: new FakeWhatsAppClient(),
      logger: silentLogger,
    });
    await expect(second).rejects.toBeInstanceOf(EngineRunningError);
    expect((await api.admin("/v1/health")).status).toBe(200);
  });

  test("a socket file left by a crash is replaced", async () => {
    const temp = await makeTempHome();
    try {
      await writeFile(socketPath(temp.home), "");
      const engine = await startEngine(temp.config, {
        client: new FakeWhatsAppClient(),
        logger: silentLogger,
      });
      try {
        const response = await fetch("http://localhost/v1/health", { unix: engine.socketPath });
        expect(response.status).toBe(200);
      } finally {
        await engine.stop();
      }
      expect(await stat(engine.socketPath).catch(() => null)).toBeNull();
    } finally {
      await temp.cleanup();
    }
  });
});

describe("collections", () => {
  test("create, add by jid, number and name, show, remove, delete", async () => {
    await admin("/v1/admin/collections", json({ name: "master", description: "uni" }), 201);
    const added = await admin<CollectionDetail>(
      "/v1/admin/collections/master/chats",
      json({ chats: ["Master PP", "+40 700 000 002", BOB_PN] }),
    );
    const expected: ChatCandidate[] = [
      { jid: MASTER, name: "Master PP", kind: "group" },
      { jid: ANA_PN, name: "Ana Master", kind: "dm" },
      { jid: BOB_PN, name: "Bob Hidden", kind: "dm" },
    ];
    expect(added.chats).toEqual(expected);
    expect(added).toMatchObject({ name: "master", description: "uni", chatCount: 3 });

    const removed = await admin<CollectionDetail>(
      `/v1/admin/collections/master/chats/${encodeURIComponent(BOB_PN)}`,
      { method: "DELETE" },
    );
    expect(removed.chatCount).toBe(2);
    await admin("/v1/admin/collections/master", { method: "DELETE" });
    await admin("/v1/admin/collections/master", undefined, 404);
  });

  test("duplicates, bad names, unknown collections and ambiguous chats are refused", async () => {
    await admin("/v1/admin/collections", json({ name: "master" }), 201);
    await admin("/v1/admin/collections", json({ name: "master" }), 409);
    await admin("/v1/admin/collections", json({ name: "no spaces" }), 400);
    await admin("/v1/admin/collections/nope/chats", json({ chats: [MASTER] }), 404);
    const ambiguous = await admin<{ error: { candidates: { jid: string }[] } }>(
      "/v1/admin/collections/master/chats",
      json({ chats: ["p"] }),
      409,
    );
    expect(ambiguous.error.candidates.map((candidate) => candidate.jid)).toContain(SECRET);
  });
});

describe("profiles", () => {
  test("create with capabilities and collections, list, delete", async () => {
    await admin("/v1/admin/collections", json({ name: "master" }), 201);
    const created = await admin<Profile>(
      "/v1/admin/profiles",
      json({
        name: "master",
        capabilities: ["chats:read", "messages:read"],
        collections: ["master"],
      }),
      201,
    );
    expect(created).toMatchObject({ allChats: false, collections: ["master"], builtin: false });
    const { items } = await admin<{ items: Profile[] }>("/v1/admin/profiles");
    expect(items.map((profile) => profile.name)).toEqual(["master", "raycast"]);
    expect(items[1]).toMatchObject({ builtin: true, allChats: true });
    await admin("/v1/admin/profiles/master", { method: "DELETE" });
  });

  test("admin can't be granted, and the spec must be consistent", async () => {
    const create = (body: unknown, status: number) =>
      admin("/v1/admin/profiles", json(body), status);
    await create({ name: "root", capabilities: ["admin"] }, 400);
    await create({ name: "x", capabilities: [] }, 400);
    await create({ name: "x", capabilities: ["send"], collections: ["missing"] }, 404);
    await admin("/v1/admin/collections", json({ name: "c" }), 201);
    await create({ name: "x", capabilities: ["send"], collections: ["c"], allChats: true }, 400);
    await create({ name: "raycast", capabilities: ["send"] }, 409);
  });
});

describe("tokens and audit", () => {
  test("a token is shown once and listed without it", async () => {
    await admin(
      "/v1/admin/profiles",
      json({ name: "p", capabilities: ["chats:read"], allChats: true }),
      201,
    );
    const created = await admin<CreatedToken>(
      "/v1/admin/tokens",
      json({ profile: "p", label: "laptop" }),
      201,
    );
    expect(created.token).toStartWith("wa_");
    expect((await api.http("/v1/chats", created.token)).status).toBe(200);

    const listing = await api.admin("/v1/admin/tokens?profile=p");
    const text = await listing.text();
    expect(text).not.toContain(created.token);
    expect(text).not.toContain("hash");
    const { items } = JSON.parse(text) as { items: TokenInfo[] };
    expect(items).toEqual([
      expect.objectContaining({ id: created.id, label: "laptop", revokedAt: null }),
    ]);

    const revoked = await admin<TokenInfo>(`/v1/admin/tokens/${created.id}`, { method: "DELETE" });
    expect(revoked.revokedAt).toBeNumber();
    await admin("/v1/admin/tokens", json({ profile: "missing" }), 404);
  });

  test("admin changes and sends are audited, newest first, paged", async () => {
    await admin("/v1/admin/collections", json({ name: "a" }), 201);
    await admin("/v1/admin/collections", json({ name: "b" }), 201);
    await admin("/v1/admin/collections", json({ name: "c" }), 201);
    const first = await admin<Page<AuditEntry>>("/v1/admin/audit?limit=2");
    expect(first.items.map((entry) => entry.detail?.collection)).toEqual(["c", "b"]);
    expect(first.items[0]).toMatchObject({ action: "collection.create", profile: null });
    const rest = await admin<Page<AuditEntry>>(
      `/v1/admin/audit?limit=2&cursor=${first.nextCursor}`,
    );
    expect(rest.items.map((entry) => entry.detail?.collection)).toContain("a");
    const byProfile = await admin<Page<AuditEntry>>("/v1/admin/audit?profile=nobody");
    expect(byProfile.items).toEqual([]);
  });
});

test("a malformed JSON body is a 400 on every admin write", async () => {
  await admin("/v1/admin/collections", json({ name: "master" }), 201);
  const malformed = {
    method: "POST",
    body: "{not json",
    headers: { "content-type": "application/json" },
  };
  for (const path of [
    "/v1/admin/collections",
    "/v1/admin/collections/master/chats",
    "/v1/admin/profiles",
    "/v1/admin/tokens",
  ]) {
    const body = await admin<{ error: { code: string } }>(path, malformed, 400);
    expect(body.error.code).toBe("invalid_request");
  }
});
