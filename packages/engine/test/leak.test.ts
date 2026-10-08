import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { PROFILE_CAPABILITIES } from "@wa/sdk";
import { json, startApi, type ApiHarness } from "./support/api";
import { BOB_PN, EVE_PN, ME_PN } from "./support/jids";
import {
  BOB_TEXT_ID,
  MASTER,
  MASTER_IMAGE_ID,
  MASTER_QUOTE_ID,
  SECRET,
  SECRET_IMAGE_ID,
  SECRET_MARKERS,
  SECRET_TEXT_ID,
  worldEvents,
} from "./support/world";

/**
 * The policy leak suite for HTTP: a token scoped to the "master" collection, with every
 * capability a profile can have, probes each route with in-scope and out-of-scope references.
 * Nothing about the secret group or the DM with Bob may come back: not as data, quotes,
 * participants, recipients, error text or ambiguity candidates; and `raw` never does.
 */
const LAB = "120363000000000042@g.us";
const enc = encodeURIComponent;

interface Case {
  /** A function for paths that depend on data created in `beforeAll`. */
  path: string | (() => string);
  init?: RequestInit;
  status: number;
  /** In-scope data that proves the request reached real data. */
  contains?: string[];
}

let api: ApiHarness;
let token: string;
let secretOutboxId: string;

const send = (to: string) => json({ to, text: "probe" });
const mcpToolsList: RequestInit = {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
};

/** Every route the TCP listener serves must appear here, or the coverage test fails. */
function cases(): Record<string, Case[]> {
  return {
    "GET /v1/health": [{ path: "/v1/health", status: 200 }],
    "GET /v1/status": [{ path: "/v1/status", status: 200, contains: ['"chats":2'] }],
    "GET /v1/qr": [{ path: "/v1/qr", status: 200 }],
    "POST /v1/link": [{ path: "/v1/link", init: json({}), status: 409 }],
    "GET /v1/chats": [
      { path: "/v1/chats", status: 200, contains: [MASTER, LAB] },
      { path: "/v1/chats?q=secret", status: 200 },
      { path: "/v1/chats?q=bob", status: 200 },
      { path: "/v1/chats?q=120363000000000099", status: 200 },
      { path: "/v1/chats?collection=secrets", status: 200 },
      { path: "/v1/chats?kind=group", status: 200, contains: [MASTER] },
    ],
    "GET /v1/chats/:chat": [
      { path: `/v1/chats/${enc(MASTER)}`, status: 200, contains: ["Ana Master"] },
      { path: `/v1/chats/${enc("proj")}`, status: 200, contains: [LAB] },
      { path: `/v1/chats/p`, status: 409, contains: [MASTER, LAB] },
      { path: `/v1/chats/${enc(SECRET)}`, status: 404 },
      { path: `/v1/chats/${enc("Secret Project")}`, status: 404 },
      { path: `/v1/chats/${enc(BOB_PN)}`, status: 404 },
      { path: `/v1/chats/${enc("+40 700 000 003")}`, status: 404 },
      { path: `/v1/chats/${enc("Bob Hidden")}`, status: 404 },
    ],
    "GET /v1/chats/:chat/messages": [
      {
        path: `/v1/chats/${enc(MASTER)}/messages`,
        status: 200,
        contains: [MASTER_QUOTE_ID, "the quoted snapshot"],
      },
      { path: `/v1/chats/${enc(MASTER)}/messages?around=${SECRET_TEXT_ID}`, status: 404 },
      { path: `/v1/chats/${enc(SECRET)}/messages`, status: 404 },
      { path: `/v1/chats/${enc(BOB_PN)}/messages`, status: 404 },
    ],
    "GET /v1/search": [
      { path: "/v1/search?q=about", status: 200, contains: [MASTER_QUOTE_ID] },
      { path: "/v1/search?q=SECRETWORD", status: 200 },
      { path: "/v1/search?q=plans", status: 200 },
      { path: `/v1/search?q=tema&chat=${enc("Secret Project")}`, status: 404 },
      { path: `/v1/search?q=tema&chat=${enc(SECRET)}`, status: 404 },
      { path: `/v1/search?q=SECRETWORD&sender=${enc("Eve Hidden")}`, status: 404 },
      { path: `/v1/search?q=SECRETWORD&sender=${enc(EVE_PN)}`, status: 200 },
      { path: `/v1/search?q=SECRETWORD&sender=bob`, status: 404 },
    ],
    "GET /v1/messages/:chat/:id": [
      {
        path: `/v1/messages/${enc(MASTER)}/${MASTER_QUOTE_ID}?context=5`,
        status: 200,
        contains: ["the quoted snapshot", MASTER_IMAGE_ID],
      },
      { path: `/v1/messages/${enc(SECRET)}/${SECRET_TEXT_ID}`, status: 404 },
      { path: `/v1/messages/${enc(MASTER)}/${SECRET_TEXT_ID}`, status: 404 },
      { path: `/v1/messages/${enc(BOB_PN)}/${BOB_TEXT_ID}`, status: 404 },
    ],
    "GET /v1/media/:chat/:id": [
      { path: `/v1/media/${enc(MASTER)}/${MASTER_IMAGE_ID}`, status: 200, contains: ["image"] },
      { path: `/v1/media/${enc(SECRET)}/${SECRET_IMAGE_ID}`, status: 404 },
      { path: `/v1/media/${enc(SECRET)}/${SECRET_IMAGE_ID}?download=1`, status: 404 },
      { path: `/v1/media/${enc(MASTER)}/${SECRET_IMAGE_ID}?download=1`, status: 404 },
    ],
    "GET /v1/recipients": [
      { path: "/v1/recipients", status: 200, contains: [MASTER, LAB] },
      { path: "/v1/recipients?q=bob", status: 200 },
      { path: "/v1/recipients?q=secret", status: 200 },
      { path: "/v1/recipients?q=eve", status: 200 },
    ],
    "POST /v1/send": [
      { path: "/v1/send", init: send(MASTER), status: 202 },
      { path: "/v1/send", init: send(SECRET), status: 404 },
      { path: "/v1/send", init: send("Secret Project"), status: 404 },
      { path: "/v1/send", init: send("Bob Hidden"), status: 404 },
      { path: "/v1/send", init: send("+40 700 000 003"), status: 404 },
      { path: "/v1/send", init: send(BOB_PN), status: 404 },
      { path: "/v1/send", init: send("p"), status: 409, contains: [MASTER, LAB] },
    ],
    "GET /v1/outbox/:id": [{ path: () => `/v1/outbox/${secretOutboxId}`, status: 404 }],
    // tools are probed one by one in mcp-leak.test.ts
    "ALL /mcp": [{ path: "/mcp", init: mcpToolsList, status: 200, contains: ["read_messages"] }],
  };
}

beforeAll(async () => {
  api = await startApi();
  await api.emit(worldEvents());
  await api.emit({
    "groups.upsert": [
      { id: LAB, subject: "Lab Project", owner: undefined, participants: [{ id: ME_PN }] },
    ],
  });
  token = api.token({
    name: "master",
    capabilities: [...PROFILE_CAPABILITIES],
    collections: ["master"],
  });
  const { store } = api.engine;
  store.collections.addChat("master", MASTER);
  store.collections.addChat("master", LAB);
  store.collections.create("secrets", null);
  store.collections.addChat("secrets", SECRET);
  store.collections.addChat("secrets", BOB_PN);
  secretOutboxId = (await api.engine.outbox.enqueue(SECRET, { kind: "text", text: "x" }, null)).id;
});

afterAll(() => api.stop());

/** Routes that answer requests; `use()` middleware shows up as `ALL` on a wildcard path. */
function tcpRoutes(): string[] {
  const routes = api.engine.apps.tcp.routes
    .filter((route) => !(route.method === "ALL" && route.path.endsWith("*")))
    .map((route) => `${route.method} ${route.path}`);
  return [...new Set(routes)].sort();
}

test("every TCP route is covered by the leak suite", () => {
  expect(Object.keys(cases()).sort()).toEqual(tcpRoutes());
});

describe("a collection-scoped token never sees outside its scope", () => {
  const probes = Object.entries(cases()).flatMap(([route, list]) =>
    list.map((probe): [string, Case] => [route, probe]),
  );
  test.each(probes)("%s", async (_route, probe) => {
    const { init, status, contains = [] } = probe as Case;
    const path = typeof probe.path === "function" ? probe.path() : probe.path;
    const response = await api.http(path, token, init);
    const body = await response.text();
    expect(`${path} → ${response.status}`).toBe(`${path} → ${status}`);
    for (const marker of [...SECRET_MARKERS, '"raw"']) {
      expect(`${path} contains ${marker}: ${body.includes(marker)}`).toBe(
        `${path} contains ${marker}: false`,
      );
    }
    for (const expected of contains) expect(body).toContain(expected);
  });
});
