import { describe, expect, test } from "bun:test";
import { proto, toNumber } from "@whiskeysockets/baileys";
import { buildMessage, content, keyOf } from "../src/testing";
import { actionFromUpdate, normalizeMessage, type JidResolver } from "../src/whatsapp/normalize";
import { parseRaw } from "../src/whatsapp/raw";
import { ANA_LID, ANA_PN, GROUP, ME_PN } from "./support/jids";

const resolve: JidResolver = {
  chat: (jid) => (jid === ANA_LID ? ANA_PN : jid),
  user: (jid) => (jid.replace(/:\d+@/, "@") === ANA_LID ? ANA_PN : jid.replace(/:\d+@/, "@")),
  me: () => ME_PN,
};

function record(message = buildMessage({ chat: ANA_PN })) {
  const normalized = normalizeMessage(message, resolve, "live");
  if (normalized.kind !== "message") throw new Error(`expected a message, got ${normalized.kind}`);
  return normalized.record;
}

describe("storable messages", () => {
  test("plain text with a Long timestamp", () => {
    const message = buildMessage({
      chat: ANA_PN,
      ts: 1_700_000_123,
      message: content.text("salut"),
    });
    expect(record(message)).toMatchObject({
      chatJid: ANA_PN,
      id: message.key.id,
      fromMe: false,
      senderJid: ANA_PN,
      ts: 1_700_000_123,
      type: "text",
      text: "salut",
      media: null,
      source: "live",
    });
  });

  test("unwraps ephemeral and document-with-caption wrappers", () => {
    const ephemeral = buildMessage({
      chat: ANA_PN,
      message: content.ephemeral(content.extendedText("brb")),
    });
    expect(record(ephemeral)).toMatchObject({ type: "text", text: "brb" });

    const document = buildMessage({
      chat: ANA_PN,
      message: {
        documentWithCaptionMessage: {
          message: content.document({ caption: "tema 2", fileName: "tema-2.pdf" }),
        },
      },
    });
    expect(record(document)).toMatchObject({
      type: "document",
      caption: "tema 2",
      fileName: "tema-2.pdf",
      media: { kind: "document", mimetype: "application/pdf", fileName: "tema-2.pdf", size: 1024 },
    });
  });

  test("view-once media is flagged and its raw is not kept", () => {
    const message = buildMessage({
      chat: ANA_PN,
      message: content.viewOnce(content.image({ caption: "once" })),
    });
    expect(record(message)).toMatchObject({
      type: "image",
      caption: "once",
      viewOnce: true,
      raw: null,
      media: { kind: "image" },
    });
  });

  test("own messages are sent by the own canonical jid", () => {
    const message = buildMessage({ chat: ANA_PN, fromMe: true });
    expect(record(message)).toMatchObject({ fromMe: true, senderJid: ME_PN, senderAlt: null });
  });

  test("group senders are canonical and keep the other address", () => {
    const message = buildMessage({
      chat: GROUP,
      participant: `${ANA_LID.replace("@", ":3@")}`,
      participantAlt: ANA_PN,
      addressingMode: "lid",
    });
    expect(record(message)).toMatchObject({
      chatJid: GROUP,
      senderJid: ANA_PN,
      senderAlt: ANA_LID,
    });
  });

  test("quotes keep the quoted chat, participant and a text snapshot", () => {
    const original = buildMessage({
      chat: GROUP,
      participant: ANA_LID,
      message: content.text("în grup"),
    });
    const reply = buildMessage({ chat: ANA_PN, message: content.reply("privately", original) });
    expect(record(reply)).toMatchObject({
      text: "privately",
      quotedId: original.key.id,
      quotedChatJid: GROUP,
      quotedParticipant: ANA_PN,
      quotedText: "în grup",
    });
  });

  test("disappearing messages get an expiry", () => {
    const message = buildMessage({
      chat: ANA_PN,
      ts: 1_700_000_000,
      message: content.extendedText("poof", { expiration: 86_400 }),
    });
    expect(record(message).expiresAt).toBe(1_700_086_400);
  });

  test("polls and locations are searchable text", () => {
    const poll = buildMessage({
      chat: GROUP,
      participant: ANA_PN,
      message: {
        pollCreationMessageV3: {
          name: "Când predăm?",
          options: [{ optionName: "luni" }, { optionName: "marți" }],
        },
      },
    });
    expect(record(poll)).toMatchObject({ type: "poll", text: "Când predăm?\nluni\nmarți" });
  });
});

describe("placeholders and tombstones", () => {
  test("a ciphertext stub is a placeholder", () => {
    const stub = buildMessage({
      chat: ANA_PN,
      message: null,
      stubType: proto.WebMessageInfo.StubType.CIPHERTEXT,
    });
    expect(record(stub)).toMatchObject({ type: "placeholder", text: null, deletedAt: null });
  });

  test("a revoked history message is a tombstone", () => {
    const stub = buildMessage({
      chat: ANA_PN,
      ts: 1_700_000_000,
      message: null,
      stubType: proto.WebMessageInfo.StubType.REVOKE,
    });
    expect(record(stub)).toMatchObject({ type: "revoked", text: null, deletedAt: 1_700_000_000 });
  });

  test("other system stubs are skipped", () => {
    const stub = buildMessage({
      chat: GROUP,
      message: null,
      stubType: proto.WebMessageInfo.StubType.GROUP_PARTICIPANT_ADD,
    });
    expect(normalizeMessage(stub, resolve, "history")).toEqual({ kind: "skip", reason: "system" });
  });
});

describe("carriers are never storable", () => {
  const target = buildMessage({ chat: GROUP, participant: ANA_PN, message: content.text("v1") });

  test("edits become an action for their target", () => {
    const edit = buildMessage({
      chat: GROUP,
      participant: ANA_LID,
      message: content.edit(keyOf(target), "v2"),
    });
    const normalized = normalizeMessage(edit, resolve, "live");
    expect(normalized).toMatchObject({
      kind: "carrier",
      action: {
        type: "edit",
        chatJid: GROUP,
        targetId: target.key.id,
        actor: { fromMe: false, jid: ANA_PN },
        content: { conversation: "v2" },
        carrierId: edit.key.id,
      },
    });
  });

  test("revokes become an action", () => {
    const revoke = buildMessage({
      chat: GROUP,
      participant: ANA_PN,
      message: content.revoke(keyOf(target)),
    });
    expect(normalizeMessage(revoke, resolve, "live")).toMatchObject({
      kind: "carrier",
      action: { type: "revoke", targetId: target.key.id, actor: { jid: ANA_PN } },
    });
  });

  test("reactions and key distribution messages carry nothing to store", () => {
    const reaction = buildMessage({
      chat: GROUP,
      participant: ANA_PN,
      message: content.reaction(keyOf(target), "👍"),
    });
    const keys = buildMessage({
      chat: GROUP,
      participant: ANA_PN,
      message: { senderKeyDistributionMessage: { groupId: GROUP } },
    });
    expect(normalizeMessage(reaction, resolve, "live")).toEqual({ kind: "carrier", action: null });
    expect(normalizeMessage(keys, resolve, "live")).toEqual({ kind: "carrier", action: null });
  });

  test("status broadcasts are skipped", () => {
    const story = buildMessage({ chat: "status@broadcast", participant: ANA_PN });
    expect(normalizeMessage(story, resolve, "live")).toEqual({ kind: "skip", reason: "status" });
  });
});

describe("live updates", () => {
  const key = { remoteJid: GROUP, id: "3EB0TARGET", fromMe: false, participant: ANA_LID };

  test("an edit update is an edit action", () => {
    const action = actionFromUpdate(
      {
        key,
        update: {
          message: { editedMessage: { message: { conversation: "fixed" } } },
          messageTimestamp: 1_700_000_500,
        },
      },
      resolve,
    );
    expect(action).toMatchObject({
      type: "edit",
      chatJid: GROUP,
      targetId: "3EB0TARGET",
      actor: { fromMe: false, jid: ANA_PN },
      ts: 1_700_000_500,
    });
  });

  test("a revoke update is a revoke action", () => {
    const action = actionFromUpdate(
      { key, update: { message: null, messageStubType: proto.WebMessageInfo.StubType.REVOKE } },
      resolve,
    );
    expect(action).toMatchObject({ type: "revoke", targetId: "3EB0TARGET" });
  });

  test("receipts and stars are ignored", () => {
    expect(
      actionFromUpdate({ key, update: { status: proto.WebMessageInfo.Status.READ } }, resolve),
    ).toBeNull();
    expect(actionFromUpdate({ key, update: { starred: true } }, resolve)).toBeNull();
  });
});

describe("raw", () => {
  test("round-trips Longs, bytes and the key's alt fields, without thumbnails", () => {
    const message = buildMessage({
      chat: GROUP,
      participant: ANA_LID,
      participantAlt: ANA_PN,
      addressingMode: "lid",
      ts: 1_700_000_321,
      message: content.image({ caption: "pic" }),
    });
    message.message!.imageMessage!.jpegThumbnail = new Uint8Array([1, 2, 3]);
    const raw = record(message).raw!;
    expect(raw).not.toContain("jpegThumbnail");

    const parsed = parseRaw(raw);
    expect(toNumber(parsed.messageTimestamp)).toBe(1_700_000_321);
    expect(parsed.key).toMatchObject({
      participant: ANA_LID,
      participantAlt: ANA_PN,
      addressingMode: "lid",
    });
    const image = parsed.message?.imageMessage;
    expect(Buffer.from(image!.mediaKey!)).toEqual(
      Buffer.from(message.message!.imageMessage!.mediaKey!),
    );
    expect(toNumber(image!.fileLength)).toBe(1024);
    expect(image?.caption).toBe("pic");
    expect(proto.WebMessageInfo.encode(parsed).finish().length).toBeGreaterThan(0);
  });
});
