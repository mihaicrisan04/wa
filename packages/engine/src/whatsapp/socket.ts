import {
  Browsers,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  makeWASocket,
  type GroupMetadata,
  type WAMessageKey,
  type proto,
} from "@whiskeysockets/baileys";
import { baileysLogger, type Logger } from "../logger";
import type { ClientFactory } from "./client";

export interface SocketHooks {
  /** Content of a stored message, used by Baileys to answer retry receipts. */
  getMessage?: (key: WAMessageKey) => Promise<proto.IMessage | undefined>;
  cachedGroupMetadata?: (jid: string) => Promise<GroupMetadata | undefined>;
}

export function baileysClientFactory(logger: Logger, hooks: SocketHooks = {}): ClientFactory {
  const socketLogger = baileysLogger(logger);
  return async (auth) => {
    const { version, isLatest, error } = await fetchLatestBaileysVersion();
    if (error)
      logger.warn({ err: error, version }, "could not fetch the latest WhatsApp web version");
    else if (!isLatest) logger.info({ version }, "not on the latest WhatsApp web version");

    return makeWASocket({
      version,
      auth: { creds: auth.creds, keys: makeCacheableSignalKeyStore(auth.keys, socketLogger) },
      browser: Browsers.macOS("Desktop"),
      syncFullHistory: true,
      // rc14's default skips FULL history syncs
      shouldSyncHistoryMessage: () => true,
      // staying "online" stops notifications on the phone
      markOnlineOnConnect: false,
      getMessage: hooks.getMessage ?? (async () => undefined),
      cachedGroupMetadata: hooks.cachedGroupMetadata ?? (async () => undefined),
      logger: socketLogger,
    });
  };
}
