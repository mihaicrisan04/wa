import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ADMIN } from "../src/policy";
import { chatNames, type ReadContext } from "../src/queries";
import { ANA_PN, BOB_LID, BOB_PN, buildChat, EVE_PN, GROUP, historySet } from "../src/testing";
import { harness, type Harness } from "./support/harness";

let h: Harness;

beforeEach(() => {
  h = harness();
});
afterEach(() => h.close());

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

describe("contact names", () => {
  // what WhatsApp syncs as the full name of people not saved in the phone
  const MASKED = "+40\u2219\u2219\u2219\u2219\u2219\u2219\u221950";
  const displayName = () =>
    chatNames({ store: h.store, principal: ADMIN } as ReadContext, [ANA_PN]).get(ANA_PN);

  test("a masked phone number as the name falls back to the push name", async () => {
    await h.emit({
      "chats.upsert": [{ id: ANA_PN, name: MASKED }],
      "contacts.upsert": [{ id: ANA_PN, name: MASKED, notify: "Ana Pop" }],
    });
    expect(h.store.contacts.get(ANA_PN)?.name).toBeNull();
    expect(h.store.chats.get(ANA_PN)?.name).toBeNull();
    expect(displayName()).toBe("Ana Pop");
  });

  test("a saved name still wins over the push name", async () => {
    await h.emit({
      "chats.upsert": [{ id: ANA_PN }],
      "contacts.upsert": [{ id: ANA_PN, name: "Ana from work", notify: "Ana Pop" }],
    });
    await h.emit({ "contacts.upsert": [{ id: ANA_PN, name: MASKED }] });
    expect(displayName()).toBe("Ana from work");
  });

  test("history chats skip a masked name for the display name", async () => {
    await h.emit({
      "messaging-history.set": historySet({
        chats: [buildChat({ id: ANA_PN, name: MASKED, displayName: "Ana Pop" })],
      }),
    });
    expect(h.store.chats.get(ANA_PN)?.name).toBe("Ana Pop");
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
