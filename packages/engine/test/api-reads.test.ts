import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type {
  ChatDetail,
  Message,
  MessageContext,
  MessagePage,
  Page,
  SearchHit,
  Status,
} from "@wa/sdk";
import {
  ANA_PN,
  BOB_PN,
  buildMessage,
  content,
  EVE_PN,
  fakeMediaDownload,
  ME_PN,
  startApi,
  type ApiHarness,
} from "../src/testing";
import {
  MASTER,
  MASTER_IMAGE_ID,
  MASTER_QUOTE_ID,
  MASTER_TEXT_ID,
  NOW,
  SECRET,
  worldEvents,
} from "./support/world";

let api: ApiHarness;
let all: string;
let master: string;

const PAGED_CHAT = "40700000099@s.whatsapp.net";
const IMAGE_BYTES = Buffer.from("not really a jpeg");

beforeAll(async () => {
  api = await startApi({
    engine: { mediaDownload: fakeMediaDownload(IMAGE_BYTES) },
  });
  await api.emit(worldEvents());
  await api.emit({
    "messages.upsert": {
      type: "append",
      messages: Array.from({ length: 7 }, (_, i) =>
        buildMessage({
          chat: PAGED_CHAT,
          id: `3EB0PAGE${i}`,
          ts: NOW - 10_000 + i * 10,
          message: content.text(`page message ${i}`),
        }),
      ),
    },
  });
  all = api.token({
    name: "everything",
    capabilities: ["chats:read", "messages:read", "media:read"],
    allChats: true,
  });
  master = api.token({
    name: "master",
    capabilities: ["chats:read", "messages:read", "media:read"],
    collections: { master: [MASTER] },
  });
});

afterAll(() => api.stop());

async function get<T>(path: string, token = all): Promise<T> {
  const response = await api.http(path, token);
  expect(response.status).toBe(200);
  return (await response.json()) as T;
}

const enc = encodeURIComponent;

describe("chats", () => {
  test("lists visible chats by recency, names DMs from contacts", async () => {
    const page = await get<Page<{ jid: string; name: string | null }>>("/v1/chats");
    expect(page.items.map((chat) => chat.jid)).toEqual([BOB_PN, MASTER, SECRET, PAGED_CHAT]);
    expect(page.items[0]!.name).toBe("Bob Hidden");
  });

  test("pages with an opaque cursor", async () => {
    const first = await get<Page<{ jid: string }>>("/v1/chats?limit=3");
    expect(first.items).toHaveLength(3);
    const second = await get<Page<{ jid: string }>>(`/v1/chats?limit=3&cursor=${first.nextCursor}`);
    expect(second.items.map((chat) => chat.jid)).toEqual([PAGED_CHAT]);
    expect(second.nextCursor).toBeNull();
  });

  test("filters by query and kind", async () => {
    const byName = await get<Page<{ jid: string }>>("/v1/chats?q=secret");
    expect(byName.items.map((chat) => chat.jid)).toEqual([SECRET]);
    const groups = await get<Page<{ jid: string }>>("/v1/chats?kind=group");
    expect(groups.items.map((chat) => chat.jid)).toEqual([MASTER, SECRET]);
  });

  test("a collection filter intersects with the scope", async () => {
    api.engine.store.collections.create("secrets", null);
    api.engine.store.collections.addChat("secrets", SECRET);
    const scoped = await get<Page<{ jid: string }>>("/v1/chats?collection=secrets", master);
    expect(scoped.items).toEqual([]);
    const admin = await get<Page<{ jid: string }>>("/v1/chats?collection=secrets");
    expect(admin.items.map((chat) => chat.jid)).toEqual([SECRET]);
  });

  test("a chat resolves by jid, phone or name, with participants", async () => {
    const detail = await get<ChatDetail>(`/v1/chats/${enc("master pp")}`);
    expect(detail).toMatchObject({ jid: MASTER, kind: "group", name: "Master PP" });
    expect(detail.participants).toEqual([
      { jid: ME_PN, name: null, role: "member" },
      { jid: ANA_PN, name: "Ana Master", role: "member" },
    ]);
    expect((await get<ChatDetail>(`/v1/chats/${enc("+40 700 000 003")}`)).jid).toBe(BOB_PN);
  });

  test("an ambiguous name lists candidates", async () => {
    const response = await api.http(`/v1/chats/${enc("p")}`, all);
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string; candidates: unknown[] } };
    expect(body.error.code).toBe("ambiguous");
    expect(body.error.candidates).toContainEqual({ jid: MASTER, name: "Master PP", kind: "group" });
  });

  test("a missing capability is a 403", async () => {
    const token = api.token({ name: "sender-only", capabilities: ["send:self"], allChats: true });
    const response = await api.http("/v1/chats", token);
    expect(response.status).toBe(403);
  });
});

describe("messages", () => {
  const ids = (page: { messages: Message[] }) => page.messages.map((message) => message.id);

  test("the latest page comes oldest first, with cursors both ways", async () => {
    const latest = await get<MessagePage>(`/v1/chats/${enc(PAGED_CHAT)}/messages?limit=3`);
    expect(ids(latest)).toEqual(["3EB0PAGE4", "3EB0PAGE5", "3EB0PAGE6"]);
    expect(latest.newer).toBeNull();
    const older = await get<MessagePage>(
      `/v1/chats/${enc(PAGED_CHAT)}/messages?limit=3&before=${latest.older}`,
    );
    expect(ids(older)).toEqual(["3EB0PAGE1", "3EB0PAGE2", "3EB0PAGE3"]);
    const newer = await get<MessagePage>(
      `/v1/chats/${enc(PAGED_CHAT)}/messages?limit=2&after=${older.newer}`,
    );
    expect(ids(newer)).toEqual(["3EB0PAGE4", "3EB0PAGE5"]);
  });

  test("around centers on a message; before/after take plain times too", async () => {
    const around = await get<MessagePage>(
      `/v1/chats/${enc(PAGED_CHAT)}/messages?around=3EB0PAGE3&limit=3`,
    );
    expect(ids(around)).toEqual(["3EB0PAGE2", "3EB0PAGE3", "3EB0PAGE4"]);
    const after = await get<MessagePage>(
      `/v1/chats/${enc(PAGED_CHAT)}/messages?after=${NOW - 10_000 + 45}&limit=10`,
    );
    expect(ids(after)).toEqual(["3EB0PAGE5", "3EB0PAGE6"]);
    expect(after.older).not.toBeNull();
  });

  test("limit is capped at 200", async () => {
    const response = await api.http(`/v1/chats/${enc(MASTER)}/messages?limit=201`, all);
    expect(response.status).toBe(400);
  });

  test("messages carry sender names but never raw", async () => {
    const response = await api.http(`/v1/chats/${enc(MASTER)}/messages`, all);
    const text = await response.text();
    expect(text).not.toContain('"raw"');
    const page = JSON.parse(text) as MessagePage;
    expect(page.messages[0]).toMatchObject({
      id: MASTER_TEXT_ID,
      sender: ANA_PN,
      senderName: "Ana Master",
      text: "tema-2 la PP: sarcină pentru Ștefan",
    });
  });

  test("a message with context", async () => {
    const found = await get<MessageContext>(
      `/v1/messages/${enc(MASTER)}/${MASTER_IMAGE_ID}?context=1`,
    );
    expect(found.message).toMatchObject({ type: "image", caption: "diagrama UML", hasMedia: true });
    expect(found.before.map((message) => message.id)).toEqual([MASTER_TEXT_ID]);
    expect(found.after.map((message) => message.id)).toEqual([MASTER_QUOTE_ID]);
  });

  test("quotes from a visible chat keep their reference", async () => {
    const found = await get<MessageContext>(`/v1/messages/${enc(MASTER)}/${MASTER_QUOTE_ID}`);
    expect(found.message.quoted).toMatchObject({ chat: SECRET, sender: EVE_PN });
  });

  test("an unknown message is a 404", async () => {
    const response = await api.http(`/v1/messages/${enc(MASTER)}/nope`, all);
    expect(response.status).toBe(404);
  });
});

describe("search", () => {
  const hitIds = (page: Page<SearchHit>) => page.items.map((hit) => hit.message.id);

  test("folds diacritics and marks the match", async () => {
    const page = await get<Page<SearchHit>>("/v1/search?q=sarcina");
    expect(hitIds(page)).toEqual([MASTER_TEXT_ID]);
    expect(page.items[0]!.snippet).toContain("\u0002sarcină\u0003");
    expect(hitIds(await get<Page<SearchHit>>("/v1/search?q=stefan"))).toEqual([MASTER_TEXT_ID]);
  });

  test.each(["tema-2", "PP:", "c++", "don't"])("never fails on %s", async (q) => {
    expect((await api.http(`/v1/search?q=${enc(q)}`, all)).status).toBe(200);
  });

  test("filters by chat, sender, type and time", async () => {
    const inSecret = hitIds(await get(`/v1/search?q=SECRETWORD&chat=${enc("Secret Project")}`));
    expect(inSecret.sort()).toEqual(["3EB0SECRET01", "3EB0SECRET02"]);
    expect(hitIds(await get(`/v1/search?q=SECRETWORD&sender=${enc("Bob Hidden")}`))).toEqual([
      "3EB0BOB00001",
    ]);
    expect(hitIds(await get(`/v1/search?q=SECRETWORD&sender=${enc("Eve")}&type=text`))).toEqual([
      "3EB0SECRET01",
    ]);
    expect(hitIds(await get(`/v1/search?q=SECRETWORD&type=image`))).toEqual(["3EB0SECRET02"]);
    expect(hitIds(await get(`/v1/search?q=SECRETWORD&after=${NOW - 100}`))).toEqual([
      "3EB0BOB00001",
    ]);
  });

  test("pages with a cursor", async () => {
    const first = await get<Page<SearchHit>>("/v1/search?q=SECRETWORD&limit=2");
    expect(first.items).toHaveLength(2);
    const rest = await get<Page<SearchHit>>(
      `/v1/search?q=SECRETWORD&limit=2&cursor=${first.nextCursor}`,
    );
    expect(rest.items).toHaveLength(1);
    expect(rest.nextCursor).toBeNull();
  });

  test("a query is required", async () => {
    expect((await api.http("/v1/search", all)).status).toBe(400);
  });
});

describe("media", () => {
  test("metadata, then bytes once downloaded", async () => {
    const info = await get<{ kind: string; downloaded: boolean }>(
      `/v1/media/${enc(MASTER)}/${MASTER_IMAGE_ID}`,
    );
    expect(info).toMatchObject({ kind: "image", downloaded: false });

    const response = await api.http(`/v1/media/${enc(MASTER)}/${MASTER_IMAGE_ID}?download=1`, all);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("content-disposition")).toStartWith("attachment; filename=");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(IMAGE_BYTES);
    const after = await get<{ downloaded: boolean; size: number }>(
      `/v1/media/${enc(MASTER)}/${MASTER_IMAGE_ID}`,
    );
    expect(after).toMatchObject({ downloaded: true, size: IMAGE_BYTES.length });
  });

  test("a message without media is a 404", async () => {
    const response = await api.http(`/v1/media/${enc(MASTER)}/${MASTER_TEXT_ID}`, all);
    expect(response.status).toBe(404);
  });
});

describe("status", () => {
  test("counts only what the token sees", async () => {
    const full = await get<Status>("/v1/status");
    const scoped = await get<Status>("/v1/status", master);
    expect(full).toMatchObject({ state: "open", needsLink: false, me: { jid: ME_PN } });
    expect(scoped.counts).toEqual({ chats: 1, messages: 3 });
    expect(full.counts.chats).toBeGreaterThan(scoped.counts.chats);
  });

  test("qr needs the link capability", async () => {
    expect((await api.http("/v1/qr", all)).status).toBe(403);
  });
});
