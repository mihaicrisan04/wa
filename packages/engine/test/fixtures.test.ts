import { describe, expect, test } from "bun:test";
import {
  extractMessageContent,
  getContentType,
  isJidGroup,
  normalizeMessageContent,
  proto,
  toNumber,
} from "@whiskeysockets/baileys";
import {
  ANA_PN,
  BOB_LID,
  BOB_PN,
  buildMessage,
  content,
  EVE_PN,
  GROUP,
  historySet,
  HistorySyncType,
  keyOf,
} from "../src/testing";

describe("buildMessage", () => {
  test("behaves like a decoded WhatsApp payload", () => {
    const message = buildMessage({
      chat: ANA_PN,
      ts: 1_700_000_123,
      message: content.image(),
    });

    expect(message.messageTimestamp).not.toBeTypeOf("number");
    expect(toNumber(message.messageTimestamp)).toBe(1_700_000_123);
    expect(message.message?.imageMessage?.mediaKey).toBeInstanceOf(Uint8Array);
    expect(message.message?.imageMessage?.fileLength).not.toBeTypeOf("number");
    expect(message.key).toMatchObject({ remoteJid: ANA_PN, fromMe: false });
    expect(message.key.id).toStartWith("3EB0");
  });

  test("keeps the key alt fields that protobuf would drop", () => {
    const message = buildMessage({
      chat: GROUP,
      participant: BOB_LID,
      participantAlt: BOB_PN,
      addressingMode: "lid",
    });
    expect(isJidGroup(message.key.remoteJid!)).toBe(true);
    expect(message.key).toMatchObject({
      participant: BOB_LID,
      participantAlt: BOB_PN,
      addressingMode: "lid",
    });
  });

  test("wrappers unwrap through Baileys helpers", () => {
    const viewOnce = buildMessage({
      chat: ANA_PN,
      message: content.viewOnce(content.image({ caption: "once" })),
    });
    const ephemeral = buildMessage({
      chat: ANA_PN,
      message: content.ephemeral(content.text("brb")),
    });

    expect(getContentType(normalizeMessageContent(viewOnce.message) ?? undefined)).toBe(
      "imageMessage",
    );
    expect(extractMessageContent(viewOnce.message)?.imageMessage?.caption).toBe("once");
    expect(normalizeMessageContent(ephemeral.message)?.conversation).toBe("brb");
  });

  test("builds edit, revoke and reaction carriers pointing at their target", () => {
    const target = buildMessage({ chat: ANA_PN, message: content.text("v1") });
    const edit = buildMessage({
      chat: ANA_PN,
      message: content.edit(keyOf(target), "v2"),
    });
    const revoke = buildMessage({
      chat: ANA_PN,
      message: content.revoke(keyOf(target)),
    });
    const reaction = buildMessage({
      chat: ANA_PN,
      message: content.reaction(keyOf(target), "👍"),
    });

    expect(edit.message?.protocolMessage).toMatchObject({
      type: proto.Message.ProtocolMessage.Type.MESSAGE_EDIT,
      key: { id: target.key.id },
      editedMessage: { conversation: "v2" },
    });
    expect(revoke.message?.protocolMessage?.type).toBe(proto.Message.ProtocolMessage.Type.REVOKE);
    expect(getContentType(reaction.message ?? undefined)).toBe("reactionMessage");
  });

  test("supports stub-only messages such as revoked history entries", () => {
    const stub = buildMessage({
      chat: ANA_PN,
      message: null,
      stubType: proto.WebMessageInfo.StubType.REVOKE,
    });
    expect(stub.message).toBeNull();
    expect(stub.messageStubType).toBe(proto.WebMessageInfo.StubType.REVOKE);
  });

  test("replies carry the quoted message", () => {
    const quoted = buildMessage({
      chat: GROUP,
      participant: EVE_PN,
    });
    const reply = buildMessage({
      chat: EVE_PN,
      message: content.reply("privately", quoted),
    });
    expect(reply.message?.extendedTextMessage?.contextInfo).toMatchObject({
      stanzaId: quoted.key.id,
      remoteJid: GROUP,
      participant: EVE_PN,
    });
  });
});

test("historySet defaults to a finished FULL sync", () => {
  expect(historySet()).toMatchObject({
    syncType: HistorySyncType.FULL,
    progress: 100,
    isLatest: true,
  });
});
