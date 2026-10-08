import {
  Browsers,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  makeWASocket,
  type AuthenticationState,
  type UserFacingSocketConfig,
  type WAVersion,
} from "@whiskeysockets/baileys";
import { baileysLogger, type Logger } from "../logger";
import type { ClientFactory, SocketHooks } from "./client";

export function baileysClientFactory(logger: Logger): ClientFactory {
  const socketLogger = baileysLogger(logger);
  return async (auth, hooks = {}) => {
    const { version, isLatest, error } = await fetchLatestBaileysVersion();
    if (error)
      logger.warn({ err: error, version }, "could not fetch the latest WhatsApp web version");
    else if (!isLatest) logger.info({ version }, "not on the latest WhatsApp web version");
    return makeWASocket(socketConfig({ version, auth, logger: socketLogger, hooks }));
  };
}

export function socketConfig({
  version,
  auth,
  logger,
  hooks,
}: {
  version: WAVersion;
  auth: AuthenticationState;
  logger: Logger;
  hooks: SocketHooks;
}): UserFacingSocketConfig {
  return {
    version,
    auth: { creds: auth.creds, keys: makeCacheableSignalKeyStore(auth.keys, logger) },
    browser: Browsers.macOS("Desktop"),
    syncFullHistory: true,
    // rc14's default skips FULL history syncs
    shouldSyncHistoryMessage: () => true,
    // staying "online" stops notifications on the phone
    markOnlineOnConnect: false,
    getMessage: hooks.getMessage ?? (async () => undefined),
    cachedGroupMetadata: hooks.cachedGroupMetadata ?? (async () => undefined),
    logger,
  };
}
