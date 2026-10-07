import pino, { type Logger } from "pino";
import type { LogLevel } from "./config";

export type { Logger };

const BAILEYS_MAX_VERBOSITY = "warn";

export function createLogger(level: LogLevel): Logger {
  return pino({ level, base: undefined });
}

/** Baileys logs message content below warn, so its child logger never goes more verbose than that. */
export function baileysLogger(logger: Logger): Logger {
  const level =
    logger.levelVal > pino.levels.values[BAILEYS_MAX_VERBOSITY]!
      ? logger.level
      : BAILEYS_MAX_VERBOSITY;
  return logger.child({ module: "baileys" }, { level });
}
