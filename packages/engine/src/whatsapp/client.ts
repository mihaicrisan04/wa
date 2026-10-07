import type { AuthenticationState, WASocket } from "@whiskeysockets/baileys";

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

/** Called for every (re)connect with the persisted auth state. */
export type ClientFactory = (auth: AuthenticationState) => WhatsAppClient | Promise<WhatsAppClient>;
