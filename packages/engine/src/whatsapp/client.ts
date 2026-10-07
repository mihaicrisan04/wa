import type {
  AuthenticationState,
  GroupMetadata,
  WAMessageKey,
  WASocket,
  proto,
} from "@whiskeysockets/baileys";

/**
 * The slice of a Baileys socket the engine uses. Typed from Baileys itself so an
 * upgrade that changes this API breaks `tsc`, not production.
 */
export type WhatsAppClient = Pick<
  WASocket,
  | "ev"
  | "sendMessage"
  | "fetchMessageHistory"
  | "updateMediaMessage"
  | "groupFetchAllParticipating"
  | "signalRepository"
  | "user"
  | "end"
>;

export type ClientEvents = WhatsAppClient["ev"];

/** What the engine answers for Baileys from its store. */
export interface SocketHooks {
  /** Content of a stored message, used by Baileys to answer retry receipts. */
  getMessage?: (key: WAMessageKey) => Promise<proto.IMessage | undefined>;
  cachedGroupMetadata?: (jid: string) => Promise<GroupMetadata | undefined>;
}

/** Called for every (re)connect with the persisted auth state. */
export type ClientFactory = (
  auth: AuthenticationState,
  hooks?: SocketHooks,
) => WhatsAppClient | Promise<WhatsAppClient>;
