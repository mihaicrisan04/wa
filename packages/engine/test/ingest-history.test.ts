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

    // Baileys never reports RECENT complete after its own pause; reaching 100% has to say it
    await h.emit(recent(70));
    expect(readHistorySync(h.store)).toMatchObject({ progress: 70, status: null });
    await h.emit(recent(100));
    expect(readHistorySync(h.store)).toMatchObject({
      progress: 100,
      status: "complete",
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

describe("chats", () => {
  test("updates follow Baileys semantics and never persist conditional", async () => {
    await h.emit({ "chats.upsert": [{ id: ANA_PN, name: "Ana", unreadCount: 2 }] });
    h.client.emit("chats.update", [
      {
        id: ANA_PN,
        archived: true,
        pinned: 1_700_000_000,
        muteEndTime: 1_800_000_000,
        conditional: () => true,
      },
    ]);
    await h.client.idle();
    expect(h.store.chats.get(ANA_PN)).toMatchObject({
      name: "Ana",
      archived: 1,
      pinned: 1_700_000_000,
      mute_end_time: 1_800_000_000,
      unread_count: 2,
    });

    h.client.emit("chats.update", [
      { id: ANA_PN, pinned: null, muteEndTime: null, unreadCount: -1 },
    ]);
    await h.client.idle();
    expect(h.store.chats.get(ANA_PN)).toMatchObject({
      pinned: null,
      mute_end_time: null,
      unread_count: -1,
    });
  });

  test("muted forever (-1) stays muted", async () => {
    await h.emit({ "chats.update": [{ id: ANA_PN, muteEndTime: -1 }] });
    expect(h.store.chats.get(ANA_PN)?.mute_end_time).toBe(-1);
    await h.emit({ "chats.update": [{ id: ANA_PN, muteEndTime: 0 }] });
    expect(h.store.chats.get(ANA_PN)?.mute_end_time).toBeNull();
  });

  test("unread counts in updates add up, reset on read and mark unread", async () => {
    const unread = () => h.store.chats.get(ANA_PN)?.unread_count;
    const update = (unreadCount: number | null) =>
      h.emit({ "chats.update": [{ id: ANA_PN, unreadCount }] });

    await h.emit({ "chats.upsert": [{ id: ANA_PN, unreadCount: 2 }] });
    for (let i = 0; i < 3; i++) await update(1);
    expect(unread()).toBe(5);
    await h.buffered((client) => {
      client.emit("chats.update", [{ id: ANA_PN, unreadCount: 1 }]);
      client.emit("chats.update", [{ id: ANA_PN, unreadCount: 1 }]);
    });
    expect(unread()).toBe(7);
    await update(null);
    expect(unread()).toBe(7);
    await update(0);
    expect(unread()).toBe(0);
    await update(-1);
    expect(unread()).toBe(-1);
    await update(1);
    expect(unread()).toBe(1);
    await h.emit({ "chats.upsert": [{ id: ANA_PN, unreadCount: 4 }] });
    expect(unread()).toBe(4);
  });

  test("history chats carry archive, pin, mute and disappearing settings", async () => {
    await h.emit({
      "messaging-history.set": historySet({
        chats: [
          buildChat({
            id: GROUP,
            name: "PP",
            archived: true,
            pinned: 1_700_000_000,
            muteEndTime: 1_800_000_000,
            ephemeralExpiration: 604_800,
            markedAsUnread: true,
          }),
        ],
      }),
    });
    expect(h.store.chats.get(GROUP)).toMatchObject({
      kind: "group",
      name: "PP",
      archived: 1,
      pinned: 1_700_000_000,
      mute_end_time: 1_800_000_000,
      ephemeral_expiration: 604_800,
      unread_count: -1,
    });
  });
});

describe("groups", () => {
  test("full metadata sets the name, settings and participants with roles", async () => {
    h.client.groups = {
      [GROUP]: {
        id: GROUP,
        subject: "Programming Paradigms",
        owner: ANA_PN,
        creation: 1_600_000_000,
        ephemeralDuration: 86_400,
        participants: [
          { id: ANA_PN, admin: "superadmin" },
          { id: BOB_LID, phoneNumber: BOB_PN, admin: "admin" },
          { id: EVE_PN, admin: null },
        ],
      },
    };
    await h.client.groupFetchAllParticipating();
    await h.client.idle();

    expect(h.store.chats.get(GROUP)).toMatchObject({
      kind: "group",
      name: "Programming Paradigms",
      created_at: 1_600_000_000,
      ephemeral_expiration: 86_400,
    });
    expect(h.store.participants.list(GROUP)).toEqual([
      { jid: ANA_PN, role: "superadmin" },
      { jid: BOB_PN, role: "admin" },
      { jid: EVE_PN, role: "member" },
    ]);
    expect(h.ingest.groups.get(GROUP)?.participants).toHaveLength(3);
  });

  test("participant changes update roles and invalidate the metadata cache", async () => {
    await h.emit({
      "groups.upsert": [
        {
          id: GROUP,
          subject: "PP",
          owner: undefined,
          participants: [{ id: ANA_PN }, { id: EVE_PN }],
        },
      ],
    });
    expect(h.ingest.groups.get(GROUP)).toBeDefined();

    await h.emit({
      "group-participants.update": {
        id: GROUP,
        author: ANA_PN,
        participants: [{ id: EVE_PN }],
        action: "remove",
      },
    });
    await h.emit({
      "group-participants.update": {
        id: GROUP,
        author: ANA_PN,
        participants: [{ id: BOB_PN }],
        action: "add",
      },
    });
    await h.emit({
      "group-participants.update": {
        id: GROUP,
        author: ANA_PN,
        participants: [{ id: BOB_PN }],
        action: "promote",
      },
    });
    expect(h.store.participants.list(GROUP)).toEqual([
      { jid: ANA_PN, role: "member" },
      { jid: BOB_PN, role: "admin" },
      { jid: EVE_PN, role: "left" },
    ]);
    expect(h.ingest.groups.get(GROUP)).toBeUndefined();
  });

  test("a partial update renames without touching participants", async () => {
    await h.emit({
      "groups.upsert": [
        { id: GROUP, subject: "PP", owner: undefined, participants: [{ id: ANA_PN }] },
      ],
    });
    await h.emit({ "groups.update": [{ id: GROUP, subject: "PP 2026" }] });
    expect(h.store.chats.get(GROUP)?.name).toBe("PP 2026");
    expect(h.store.participants.list(GROUP)).toEqual([{ jid: ANA_PN, role: "member" }]);
    expect(h.ingest.groups.get(GROUP)?.subject).toBe("PP 2026");
  });
});
