import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { stat, writeFile } from "node:fs/promises";
import { raycastTokenPath } from "@wa/sdk/paths";
import { hashToken } from "../src/tokens";
import { json, startApi, type ApiHarness } from "../src/testing";
import { MASTER, worldEvents } from "./support/world";

let api: ApiHarness;

beforeEach(async () => {
  api = await startApi();
  await api.emit(worldEvents());
});

afterEach(() => api.stop());

const enc = encodeURIComponent;

describe("tokens", () => {
  test("are wa_ + 32 random bytes, stored only as their sha256", async () => {
    const token = api.token({ name: "reader", capabilities: ["chats:read"], allChats: true });
    expect(token).toMatch(/^wa_[A-Za-z0-9_-]{43}$/);
    const stored = api.engine.store.db
      .query<{ token_hash: string }, []>("SELECT token_hash FROM tokens WHERE profile = 'reader'")
      .get();
    expect(stored?.token_hash).toBe(hashToken(token));
    const dump = JSON.stringify(api.engine.store.db.query("SELECT * FROM tokens").all());
    expect(dump).not.toContain(token);
  });

  test("are never accepted from the query string", async () => {
    const token = api.token({ name: "reader", capabilities: ["chats:read"], allChats: true });
    for (const name of ["token", "access_token", "Token"]) {
      const viaQuery = await api.http(`/v1/chats?${name}=${token}`, null);
      expect(viaQuery.status).toBe(400);
      expect(await viaQuery.json()).toMatchObject({ error: { code: "token_in_query" } });
      expect((await api.http(`/v1/chats?${name}=${token}`, token)).status).toBe(400);
    }
  });

  test("unknown, malformed and missing tokens are a 401", async () => {
    expect((await api.http("/v1/status", "wa_nope")).status).toBe(401);
    expect(
      (await api.http("/v1/status", null, { headers: { authorization: "Basic x" } })).status,
    ).toBe(401);
    expect((await api.http("/v1/status", null)).status).toBe(401);
  });

  test("revocation applies to the very next request", async () => {
    const token = api.token({ name: "reader", capabilities: ["chats:read"], allChats: true });
    expect((await api.http("/v1/chats", token)).status).toBe(200);
    const [row] = api.engine.store.tokens.list("reader");
    expect((await api.admin(`/v1/admin/tokens/${row!.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await api.http("/v1/chats", token)).status).toBe(401);
  });

  test("record when they were last used", async () => {
    const token = api.token({ name: "reader", capabilities: ["chats:read"], allChats: true });
    await api.http("/v1/chats", token);
    expect(api.engine.store.tokens.list("reader")[0]?.last_used_at).toBeNumber();
  });
});

describe("scope changes apply per request", () => {
  test("removing a chat from the collection hides it at once", async () => {
    const token = api.token({
      name: "master",
      capabilities: ["chats:read"],
      collections: { master: [MASTER] },
    });
    expect((await api.http(`/v1/chats/${enc(MASTER)}`, token)).status).toBe(200);

    await api.admin(`/v1/admin/collections/master/chats/${enc(MASTER)}`, { method: "DELETE" });
    expect((await api.http(`/v1/chats/${enc(MASTER)}`, token)).status).toBe(404);
  });

  test("deleting the profile kills its tokens", async () => {
    const token = api.token({ name: "temp", capabilities: ["chats:read"], allChats: true });
    await api.admin("/v1/admin/profiles/temp", { method: "DELETE" });
    expect((await api.http("/v1/chats", token)).status).toBe(401);
  });
});

describe("the raycast built-in", () => {
  test("has a working token in a 0600 file", async () => {
    const path = raycastTokenPath(api.temp.home);
    expect(((await stat(path)).mode & 0o777).toString(8)).toBe("600");
    const token = await api.raycastToken();
    expect((await api.http("/v1/chats", token)).status).toBe(200);
    expect((await api.http("/v1/qr", token)).status).toBe(200);
  });

  test("keeps its token across restarts, and replaces one that stopped working", async () => {
    const before = await api.raycastToken();
    await api.restart();
    expect(await api.raycastToken()).toBe(before);

    await writeFile(raycastTokenPath(api.temp.home), "wa_tampered\n");
    const { store } = await api.restart();
    const after = await api.raycastToken();
    expect(after).not.toBe(before);
    expect(store.tokens.findActive(hashToken(before))).toBeNull();
    expect(store.tokens.findActive(hashToken(after))?.profile).toBe("raycast");
  });

  test("can't be deleted", async () => {
    const response = await api.admin("/v1/admin/profiles/raycast", { method: "DELETE" });
    expect(response.status).toBe(409);
  });

  test("link starts pairing only while unlinked", async () => {
    const token = await api.raycastToken();
    const linked = await api.http("/v1/link", token, json({}));
    expect(linked.status).toBe(409);
    expect(await linked.json()).toMatchObject({ error: { code: "already_linked" } });
    const relink = await api.http("/v1/link", token, json({ relink: true }));
    expect(relink.status).toBe(403);
  });
});
