import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { proto } from "@whiskeysockets/baileys";
import { HISTORY_PROGRESS_KEY, HISTORY_STATUS_KEY, type HistoryProgress } from "../src/ingest";
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
    expect(h.store.sync.get<HistoryProgress>(HISTORY_PROGRESS_KEY)).toMatchObject({
      syncType: HistorySyncType.FULL,
      progress: 60,
      isLatest: true,
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
    h.client.respondToHistory("req-1", [
      buildMessage({ chat: ANA_PN, ts: 1_500_000_000, message: content.text("old") }),
    ]);
    await h.client.idle();
    expect(messageRows(h.store, ANA_PN).map((row) => row.text)).toEqual(["old"]);
    expect(h.store.sync.get<HistoryProgress>(HISTORY_PROGRESS_KEY)?.progress).toBe(80);
  });

  test("completion comes from messaging-history.status", async () => {
    await h.emit({
      "messaging-history.status": {
        syncType: HistorySyncType.FULL,
        status: "complete",
        explicit: true,
      },
    });
    expect(h.store.sync.get(HISTORY_STATUS_KEY)).toMatchObject({
      syncType: HistorySyncType.FULL,
      status: "complete",
      explicit: true,
    });
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
