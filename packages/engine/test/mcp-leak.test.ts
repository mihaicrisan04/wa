import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { PROFILE_CAPABILITIES } from "@wa/sdk";
import { authenticate } from "../src/tokens";
import { chatName, type ReadContext } from "../src/queries";
import { startApi, type ApiHarness } from "./support/api";
import { BOB_PN, EVE_PN, ME_PN } from "./support/jids";
import { connectMcp, type McpSession } from "./support/mcp";
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
 * The policy leak suite for MCP: a session scoped to the "master" collection, with every
 * capability a profile can have, calls each tool with in-scope and out-of-scope references.
 * Nothing about the secret group or the DM with Bob may come back in text, structured content,
 * errors or candidates; and `raw` never does.
 */
const LAB = "120363000000000042@g.us";

interface Probe {
  args: Record<string, unknown>;
  isError: boolean;
  /** In-scope data that proves the call reached real data. */
  contains?: string[];
}

let api: ApiHarness;
let exportDir: string;
let session: McpSession;
let masterToken: string;

/** Every tool a full-capability token gets must appear here, or the coverage test fails. */
function probes(): Record<string, Probe[]> {
  return {
    status: [{ args: {}, isError: false, contains: ["2 chats"] }],
    list_chats: [
      { args: {}, isError: false, contains: [MASTER, LAB] },
      { args: { query: "secret" }, isError: false },
      { args: { query: "bob" }, isError: false },
      { args: { query: "120363000000000099" }, isError: false },
      { args: { collection: "secrets" }, isError: false },
    ],
    read_messages: [
      {
        args: { chat: MASTER },
        isError: false,
        contains: [MASTER_QUOTE_ID, "the quoted snapshot"],
      },
      { args: { chat: MASTER, around_message_id: SECRET_TEXT_ID }, isError: true },
      { args: { chat: SECRET }, isError: true },
      { args: { chat: "Secret Project" }, isError: true },
      { args: { chat: BOB_PN }, isError: true },
      { args: { chat: "+40 700 000 003" }, isError: true },
      { args: { chat: "Bob Hidden" }, isError: true },
      { args: { chat: "p" }, isError: true, contains: [MASTER, LAB] },
    ],
    search_messages: [
      { args: { query: "about" }, isError: false, contains: [MASTER_QUOTE_ID] },
      { args: { query: "SECRETWORD" }, isError: false },
      { args: { query: "plans" }, isError: false },
      { args: { query: "tema", chat: "Secret Project" }, isError: true },
      { args: { query: "tema", chat: SECRET }, isError: true },
      { args: { query: "SECRETWORD", sender: "Eve Hidden" }, isError: true },
      { args: { query: "SECRETWORD", sender: EVE_PN }, isError: false },
      { args: { query: "SECRETWORD", sender: "bob" }, isError: true },
    ],
    get_message: [
      {
        args: { chat: MASTER, message_id: MASTER_QUOTE_ID, context: 5 },
        isError: false,
        contains: ["the quoted snapshot", MASTER_IMAGE_ID],
      },
      { args: { chat: SECRET, message_id: SECRET_TEXT_ID }, isError: true },
      { args: { chat: MASTER, message_id: SECRET_TEXT_ID }, isError: true },
      { args: { chat: BOB_PN, message_id: BOB_TEXT_ID }, isError: true },
    ],
    list_media: [
      { args: { chat: MASTER }, isError: false, contains: [MASTER_IMAGE_ID] },
      { args: { chat: SECRET }, isError: true },
      { args: { chat: "Secret Project", kind: "image" }, isError: true },
      { args: { chat: MASTER, query: "whiteboard" }, isError: false },
    ],
    download_media: [
      { args: { chat: MASTER, message_id: MASTER_IMAGE_ID }, isError: false, contains: ["image"] },
      { args: { chat: SECRET, message_id: SECRET_IMAGE_ID }, isError: true },
      { args: { chat: MASTER, message_id: SECRET_IMAGE_ID }, isError: true },
    ],
    send_message: [
      { args: { to: MASTER, text: "probe" }, isError: false, contains: [MASTER] },
      { args: { to: "self", text: "probe" }, isError: false, contains: [ME_PN] },
      { args: { to: SECRET, text: "probe" }, isError: true },
      { args: { to: "Secret Project", text: "probe" }, isError: true },
      { args: { to: "Bob Hidden", text: "probe" }, isError: true },
      { args: { to: "+40 700 000 003", text: "probe" }, isError: true },
      { args: { to: BOB_PN, text: "probe" }, isError: true },
      { args: { to: "p", text: "probe" }, isError: true, contains: [MASTER, LAB] },
    ],
  };
}

beforeAll(async () => {
  exportDir = await mkdtemp(join(tmpdir(), "wa export leak "));
  api = await startApi({
    engine: {
      exportDir,
      mediaDownload: (async () => Readable.from([Buffer.from("jpeg")])) as never,
    },
  });
  await api.emit(worldEvents());
  await api.emit({
    "groups.upsert": [
      { id: LAB, subject: "Lab Project", owner: undefined, participants: [{ id: ME_PN }] },
    ],
  });
  const token = api.token({
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
  session = await connectMcp(api, token);
  masterToken = token;
});

afterAll(async () => {
  await session.close();
  await api.stop();
  await rm(exportDir, { recursive: true, force: true });
});

test("every tool is covered by the leak suite", async () => {
  expect(Object.keys(probes()).sort()).toEqual(await session.tools());
});

test("tool descriptions and instructions name nothing out of scope", async () => {
  const { tools } = await session.client.listTools();
  const listed = JSON.stringify(tools) + (session.client.getInstructions() ?? "");
  for (const marker of SECRET_MARKERS) expect(listed).not.toContain(marker);
});

test("chat names are looked up through the scope too", () => {
  const { store } = api.engine;
  const principal = authenticate(store, masterToken)!;
  const ctx = { store, principal } as ReadContext;
  expect(chatName(ctx, MASTER)).toBe("Master PP");
  expect(chatName(ctx, SECRET)).toBeNull();
});

describe("a collection-scoped session never sees outside its scope", () => {
  const cases = Object.entries(probes()).flatMap(([tool, list]) =>
    list.map((probe): [string, string, Probe] => [tool, JSON.stringify(probe.args), probe]),
  );
  test.each(cases)("%s %s", async (tool, args, probe) => {
    const result = await session.call(tool, probe.args);
    expect(`${tool} ${args} → error ${result.isError}`).toBe(
      `${tool} ${args} → error ${probe.isError}`,
    );
    for (const marker of [...SECRET_MARKERS, '"raw"']) {
      expect(`${tool} ${args} contains ${marker}: ${result.serialized.includes(marker)}`).toBe(
        `${tool} ${args} contains ${marker}: false`,
      );
    }
    for (const expected of probe.contains ?? []) expect(result.serialized).toContain(expected);
  });
});
