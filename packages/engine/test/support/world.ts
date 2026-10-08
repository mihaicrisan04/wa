import type { BaileysEventMap, GroupMetadata } from "@whiskeysockets/baileys";
import { buildMessage, content } from "../../src/testing";
import { ANA_PN, BOB_PN, EVE_PN, GROUP, ME_PN } from "./jids";

/**
 * A small account: the "master" group (shared with Ana) is what scoped tokens may see; the
 * "Secret Project" group (with Eve) and the DM with Bob must stay invisible to them.
 */
export const MASTER = GROUP;
export const SECRET = "120363000000000099@g.us";
export const NOW = Math.floor(Date.now() / 1000);

export const MASTER_TEXT_ID = "3EB0MASTER01";
export const MASTER_IMAGE_ID = "3EB0MASTER02";
export const MASTER_QUOTE_ID = "3EB0MASTER03";
export const SECRET_TEXT_ID = "3EB0SECRET01";
export const SECRET_IMAGE_ID = "3EB0SECRET02";
export const BOB_TEXT_ID = "3EB0BOB00001";

/** Strings that must never reach a principal scoped to the master collection. */
export const SECRET_MARKERS = [
  SECRET,
  SECRET.split("@")[0]!,
  BOB_PN,
  BOB_PN.split("@")[0]!,
  EVE_PN,
  EVE_PN.split("@")[0]!,
  "Secret Project",
  "Bob Hidden",
  "Eve Hidden",
  "SECRETWORD",
  SECRET_TEXT_ID,
  SECRET_IMAGE_ID,
  BOB_TEXT_ID,
];

export function group(id: string, subject: string, members: string[]): GroupMetadata {
  return {
    id,
    subject,
    owner: undefined,
    participants: members.map((jid) => ({ id: jid, admin: null })),
  };
}

const secretMessage = buildMessage({
  chat: SECRET,
  id: SECRET_TEXT_ID,
  participant: EVE_PN,
  ts: NOW - 500,
  message: content.text("SECRETWORD plans for the launch"),
});

export function worldEvents(): Partial<BaileysEventMap> {
  return {
    "contacts.upsert": [
      { id: ANA_PN, name: "Ana Master" },
      { id: BOB_PN, name: "Bob Hidden" },
      { id: EVE_PN, name: "Eve Hidden" },
    ],
    "groups.upsert": [
      group(MASTER, "Master PP", [ME_PN, ANA_PN]),
      group(SECRET, "Secret Project", [ME_PN, EVE_PN]),
    ],
    "messages.upsert": {
      type: "append",
      messages: [
        buildMessage({
          chat: MASTER,
          id: MASTER_TEXT_ID,
          participant: ANA_PN,
          ts: NOW - 300,
          message: content.text("tema-2 la PP: sarcină pentru Ștefan"),
        }),
        buildMessage({
          chat: MASTER,
          id: MASTER_IMAGE_ID,
          participant: ANA_PN,
          ts: NOW - 200,
          message: content.image({ caption: "diagrama UML" }),
        }),
        // "reply privately": quotes the secret group from inside the master group
        buildMessage({
          chat: MASTER,
          id: MASTER_QUOTE_ID,
          fromMe: true,
          ts: NOW - 100,
          message: content.extendedText("about that", {
            stanzaId: SECRET_TEXT_ID,
            participant: EVE_PN,
            remoteJid: SECRET,
            quotedMessage: { conversation: "the quoted snapshot" },
          }),
        }),
        secretMessage,
        buildMessage({
          chat: SECRET,
          id: SECRET_IMAGE_ID,
          participant: EVE_PN,
          ts: NOW - 400,
          message: content.image({ caption: "SECRETWORD whiteboard" }),
        }),
        buildMessage({
          chat: BOB_PN,
          id: BOB_TEXT_ID,
          ts: NOW - 50,
          message: content.text("SECRETWORD from Bob Hidden"),
        }),
      ],
    },
  };
}
