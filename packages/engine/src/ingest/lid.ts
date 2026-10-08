import {
  isJidBroadcast,
  isJidGroup,
  isJidNewsletter,
  isLidUser,
  isPnUser,
  jidDecode,
  jidNormalizedUser,
  type BaileysEventMap,
  type LIDMapping,
  type WAMessageKey,
} from "@whiskeysockets/baileys";
import type { Logger } from "../logger";
import type { ChatKind, Store } from "../store";
import type { WhatsAppClient } from "../whatsapp/client";
import type { OwnIdentity } from "../whatsapp/connection";
import type { JidResolver } from "../whatsapp/normalize";

export type Batch = Partial<BaileysEventMap>;
type Jid = string | null | undefined;

/**
 * Canonical jids: a person or 1:1 chat is keyed by its phone-number jid once the LID mapping is
 * known, else by its LID. Learning a mapping later merges the LID-keyed data into the PN.
 */
export class Identity implements JidResolver {
  constructor(
    private readonly store: Store,
    readonly own: OwnIdentity | null,
  ) {}

  me(): string | null {
    return this.own?.pn ?? null;
  }

  user(jid: string): string {
    const normalized = jidNormalizedUser(jid) || jid;
    if (!isLidUser(normalized)) return normalized;
    return this.store.identity.pnForLid(normalized) ?? normalized;
  }

  chat(jid: string): string {
    const normalized = jidNormalizedUser(jid) || jid;
    return this.store.identity.chatForAlias(normalized) ?? this.user(normalized);
  }

  kindOf(chatJid: string): ChatKind {
    if (chatJid === this.own?.pn || chatJid === this.own?.lid) return "self";
    if (isJidGroup(chatJid)) return "group";
    if (isJidNewsletter(chatJid)) return "newsletter";
    if (isJidBroadcast(chatJid)) return "broadcast";
    if (isPnUser(chatJid) || isLidUser(chatJid)) return "dm";
    return "other";
  }

  /** Records a mapping; when it is new, folds everything keyed by the LID into the PN. */
  learn(mapping: LIDMapping): string[] {
    const pair = pairOf(mapping.lid, mapping.pn);
    if (!pair) return [];
    const { lid, pn } = pair;
    const { identity, media, messages, chats, participants, contacts } = this.store;
    if (!identity.setMapping(lid, pn)) return [];
    messages.moveChat(lid, pn);
    const orphanedFiles = media.moveChat(lid, pn);
    chats.merge(lid, pn, this.kindOf(pn));
    identity.repointAliases(lid, pn);
    identity.setAlias(lid, pn);
    messages.renameUser(lid, pn);
    participants.renameUser(lid, pn);
    contacts.merge(lid, pn);
    contacts.upsert(pn, { lid, phone: phoneOf(pn) });
    return orphanedFiles;
  }
}

export function phoneOf(pnJid: string): string | null {
  return isPnUser(pnJid) ? (jidDecode(pnJid)?.user ?? null) : null;
}

/** The LID↔PN pair two addresses of the same person form, if they do. */
export function pairOf(a: Jid, b: Jid): LIDMapping | null {
  if (!a || !b) return null;
  const [first, second] = [jidNormalizedUser(a), jidNormalizedUser(b)];
  if (isLidUser(first) && isPnUser(second)) return { lid: first, pn: second };
  if (isPnUser(first) && isLidUser(second)) return { lid: second, pn: first };
  return null;
}

/** Every mapping a batch reveals, plus the own LID → PN from the credentials. */
export function mappingsIn(batch: Batch, own: OwnIdentity | null): LIDMapping[] {
  const pairs: LIDMapping[] = [];
  const ownPair = pairOf(own?.lid, own?.pn);
  if (ownPair) pairs.push(ownPair);
  for (const group of sameEntityJids(batch)) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const pair = pairOf(group[i], group[j]);
        if (pair) pairs.push(pair);
      }
    }
  }
  return pairs;
}

/** LIDs in a batch that neither the store nor the batch itself can map to a PN yet. */
export function unmappedLids(batch: Batch, known: LIDMapping[], store: Store): string[] {
  const mapped = new Set(known.map((pair) => pair.lid));
  const lids = new Set<string>();
  for (const group of sameEntityJids(batch)) {
    for (const jid of group) {
      const normalized = jid ? jidNormalizedUser(jid) : "";
      if (isLidUser(normalized) && !mapped.has(normalized)) lids.add(normalized);
    }
  }
  return [...lids].filter((lid) => !store.identity.pnForLid(lid));
}

/** Asks Baileys' own LID store, which also holds mappings consolidated history dropped. */
export async function lookupLids(
  client: WhatsAppClient,
  lids: string[],
  logger: Logger,
): Promise<LIDMapping[]> {
  if (!lids.length) return [];
  try {
    const found = (await client.signalRepository.lidMapping.getPNsForLIDs(lids)) ?? [];
    // Baileys answers with device-qualified PNs (`<n>:0@s.whatsapp.net`)
    return found.flatMap(({ lid, pn }) => pairOf(lid, pn) ?? []);
  } catch (err) {
    logger.warn({ err, count: lids.length }, "could not look up LID mappings");
    return [];
  }
}

/** Groups of addresses that name the same person or chat, wherever a batch carries them. */
function* sameEntityJids(batch: Batch): Generator<Jid[]> {
  const history = batch["messaging-history.set"];
  for (const pair of history?.lidPnMappings ?? []) yield [pair.lid, pair.pn];
  for (const chat of history?.chats ?? []) yield [chat.id, chat.pnJid, chat.lidJid];
  const lidUpdate = batch["lid-mapping.update"];
  if (lidUpdate) yield [lidUpdate.lid, lidUpdate.pn];

  const contacts = [
    ...(history?.contacts ?? []),
    ...(batch["contacts.upsert"] ?? []),
    ...(batch["contacts.update"] ?? []),
  ];
  for (const contact of contacts) yield [contact.id, contact.lid, contact.phoneNumber];

  for (const group of [...(batch["groups.upsert"] ?? []), ...(batch["groups.update"] ?? [])]) {
    for (const participant of group.participants ?? []) {
      yield [participant.id, participant.lid, participant.phoneNumber];
    }
  }
  for (const participant of batch["group-participants.update"]?.participants ?? []) {
    yield [participant.id, participant.lid, participant.phoneNumber];
  }

  const keys: WAMessageKey[] = [
    ...(history?.messages ?? []).map((message) => message.key),
    ...(batch["messages.upsert"]?.messages ?? []).map((message) => message.key),
    ...(batch["messages.update"] ?? []).map((update) => update.key),
  ];
  for (const key of keys) {
    if (!key) continue;
    yield [key.remoteJid, key.remoteJidAlt];
    yield [key.participant, key.participantAlt];
  }
}
