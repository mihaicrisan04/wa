import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { proto } from "@whiskeysockets/baileys";
import { readHistoryPhases, type HistoryPage } from "../src/ingest";
import { readHistorySync } from "../src/queries";
import { buildChat, buildMessage, content, historySet } from "../src/testing";
import {
  ANA_LID,
  ANA_PN,
  BOB_LID,
  BOB_PN,
  EVE_PN,
  GROUP,
  count,
  harness,
  messageRows,
  type Harness,
} from "./support/harness";

const { HistorySyncType } = proto.HistorySync;

let h: Harness;

beforeEach(() => {
  h = harness();
});
afterEach(() => h.close());

describe("messaging-history.set", () => {
  test("a consolidated first sync stores every chunk, even without lidPnMappings", async () => {
    // Baileys stores the mappings in its LID store before emitting; consolidation then drops them
    await h.client.lidMapping.storeLIDPNMappings([{ lid: BOB_LID, pn: BOB_PN }]);
    await h.buffered((client) => {
      client.emit(
        "messaging-history.set",
        historySet({
          syncType: HistorySyncType.INITIAL_BOOTSTRAP,
          progress: 10,
          isLatest: true,
          chats: [
            buildChat({
              id: ANA_LID,
              pnJid: ANA_PN,
              name: "Ana",
              conversationTimestamp: 1_700_000_100,
            }),
          ],
          contacts: [{ id: ANA_LID, phoneNumber: ANA_PN, name: "Ana" }],
          messages: [
            buildMessage({
              chat: ANA_LID,
              ts: 1_700_000_100,
              message: content.text("from chunk one"),
            }),
          ],
          lidPnMappings: [{ lid: BOB_LID, pn: BOB_PN }],
        }),
      );
      client.emit(
        "messaging-history.set",
        historySet({
          syncType: HistorySyncType.FULL,
          progress: 60,
          isLatest: false,
          chats: [buildChat({ id: BOB_LID, conversationTimestamp: 1_600_000_000 })],
          messages: [
            buildMessage({
              chat: BOB_LID,
              ts: 1_600_000_000,
              message: content.text("from chunk two"),
            }),
          ],
        }),
      );
    });

    expect(messageRows(h.store, ANA_PN).map((row) => row.text)).toEqual(["from chunk one"]);
    expect(messageRows(h.store, BOB_PN).map((row) => row.text)).toEqual(["from chunk two"]);
    expect(h.store.chats.get(ANA_PN)).toMatchObject({
      kind: "dm",
      name: "Ana",
      last_message_at: 1_700_000_100,
    });
    expect(h.store.chats.get(ANA_LID)).toBeNull();
    expect(h.store.contacts.get(ANA_PN)).toMatchObject({
      name: "Ana",
      lid: ANA_LID,
      phone: "40700000002",
    });
    expect(h.store.messages.get(ANA_PN, messageRows(h.store, ANA_PN)[0]!.id)?.source).toBe(
      "history",
    );
    // consolidation keeps the last chunk's sync type and progress
    expect(readHistoryPhases(h)).toEqual({
      full: { progress: 60, status: null, explicit: null, chunks: 1, at: expect.any(Number) },
    });
  });

  test("messages come only from `messages`, never from each chat's truncated list", async () => {
    const onlyInChat = buildMessage({ chat: ANA_PN, message: content.text("truncated copy") });
    const chat = Object.assign(buildChat({ id: ANA_PN }), { messages: [{ message: onlyInChat }] });
    await h.emit({ "messaging-history.set": historySet({ chats: [chat] }) });
    expect(h.store.chats.get(ANA_PN)).not.toBeNull();
    expect(count(h.store, "SELECT * FROM messages")).toBe(0);
  });

  test("every sync type is ingested", async () => {
    await h.emit({
      "messaging-history.set": historySet({
        syncType: HistorySyncType.PUSH_NAME,
        contacts: [{ id: BOB_PN, notify: "Bobby" }],
      }),
    });
    await h.emit({
      "messaging-history.set": historySet({
        syncType: HistorySyncType.RECENT,
        messages: [buildMessage({ chat: BOB_PN, message: content.text("recent") })],
      }),
    });
    expect(h.store.contacts.get(BOB_PN)?.push_name).toBe("Bobby");
    expect(messageRows(h.store, BOB_PN).map((row) => row.text)).toEqual(["recent"]);
  });

  test("on-demand pages are stored without touching the initial sync progress", async () => {
    await h.emit({
      "messaging-history.set": historySet({
        syncType: HistorySyncType.FULL,
        progress: 80,
        isLatest: false,
      }),
    });
    const pages: HistoryPage[] = [];
    h.ingest.onHistoryPage((page) => pages.push(page));
    h.client.respondToHistory("req-1", [
      buildMessage({
        chat: ANA_LID,
        remoteJidAlt: ANA_PN,
        ts: 1_500_000_000,
        message: content.text("old"),
      }),
      buildMessage({ chat: ANA_PN, ts: 1_500_000_001, message: content.text("older") }),
      buildMessage({ chat: BOB_PN, ts: 1_500_000_000, message: content.text("other") }),
    ]);
    await h.client.idle();
    expect(messageRows(h.store, ANA_PN).map((row) => row.text)).toEqual(["old", "older"]);
    expect(readHistoryPhases(h)).toEqual({
      full: { progress: 80, status: null, explicit: null, chunks: 1, at: expect.any(Number) },
    });
    // the listener hears about it once it is stored, with canonical chats
    expect(pages).toEqual([
      {
        sessionId: "req-1",
        chats: new Map([
          [ANA_PN, 2],
          [BOB_PN, 1],
        ]),
      },
    ]);
  });

  test("messaging-history.status is kept per sync type", async () => {
    await h.emit({
      "messaging-history.status": {
        syncType: HistorySyncType.INITIAL_BOOTSTRAP,
        status: "complete",
        explicit: true,
      },
    });
    await h.emit({
      "messaging-history.set": historySet({ syncType: HistorySyncType.RECENT, progress: 40 }),
    });
    await h.emit({
      "messaging-history.status": {
        syncType: HistorySyncType.RECENT,
        status: "paused",
        explicit: false,
      },
    });
    expect(readHistoryPhases(h)).toEqual({
      initial_bootstrap: {
        progress: null,
        status: "complete",
        explicit: true,
        chunks: 0,
        at: expect.any(Number),
      },
      recent: {
        progress: 40,
        status: "paused",
        explicit: false,
        chunks: 1,
        at: expect.any(Number),
      },
    });
  });

  test("a pause Baileys guessed from silence clears once chunks resume", async () => {
    const recent = (progress: number) => ({
      "messaging-history.set": historySet({ syncType: HistorySyncType.RECENT, progress }),
    });
    await h.emit(recent(40));
    await h.emit({
      "messaging-history.status": {
        syncType: HistorySyncType.RECENT,
        status: "paused",
        explicit: false,
      },
    });
    expect(readHistorySync(h.store).status).toBe("paused");

    await h.emit(recent(70));
    expect(readHistorySync(h.store)).toMatchObject({ progress: 70, status: null });
    // the full sync still has to come after recent
    await h.emit(recent(100));
    expect(readHistorySync(h.store)).toMatchObject({
      progress: 100,
      status: null,
      phases: [{ syncType: "recent", progress: 100, status: null, chunks: 3 }],
    });
  });

  test("an explicit status survives later chunks", async () => {
    await h.emit({
      "messaging-history.status": {
        syncType: HistorySyncType.FULL,
        status: "complete",
        explicit: true,
      },
    });
    await h.emit({
      "messaging-history.set": historySet({ syncType: HistorySyncType.FULL, progress: 90 }),
    });
    expect(readHistoryPhases(h).full).toMatchObject({ status: "complete", explicit: true });
  });

  test("past participants are remembered as having left", async () => {
    await h.emit({
      "groups.upsert": [
        { id: GROUP, subject: "PP", owner: undefined, participants: [{ id: ANA_PN }] },
      ],
    });
    await h.emit({
      "messaging-history.set": historySet({
        pastParticipants: [
          { groupJid: GROUP, pastParticipants: [{ userJid: EVE_PN }, { userJid: ANA_PN }] },
        ],
      }),
    });
    expect(h.store.participants.list(GROUP)).toEqual([
      { jid: ANA_PN, role: "member" },
      { jid: EVE_PN, role: "left" },
    ]);
  });
});
