import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_PORT } from "@wa/sdk";
import { z } from "zod";
import packageJson from "../package.json";

export { DEFAULT_PORT };
export const ENGINE_VERSION: string = packageJson.version;

const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface EngineConfig {
  /** Data directory; the default contains a space, so always quote it in shell commands. */
  home: string;
  host: "127.0.0.1";
  /** 0 picks an ephemeral port (tests). */
  port: number;
  logLevel: LogLevel;
}

const envSchema = z.object({
  WA_HOME: z.string().trim().min(1).optional(),
  WA_PORT: z.coerce.number().int().min(0).max(65_535).optional(),
  WA_LOG_LEVEL: z.enum(LOG_LEVELS).optional(),
});

export function defaultHome(userHome: string = homedir()): string {
  return join(userHome, "Library", "Application Support", "wa");
}

export class ConfigError extends Error {}

export function loadConfig(env: Record<string, string | undefined> = process.env): EngineConfig {
  const result = envSchema.safeParse({
    WA_HOME: env.WA_HOME || undefined,
    WA_PORT: env.WA_PORT || undefined,
    WA_LOG_LEVEL: env.WA_LOG_LEVEL || undefined,
  });
  if (!result.success) {
    const problems = result.error.issues.map(
      (issue) => `${issue.path.join(".")}: ${issue.message}`,
    );
    throw new ConfigError(`invalid configuration (${problems.join("; ")})`);
  }
  const parsed = result.data;
  return {
    home: parsed.WA_HOME ?? defaultHome(),
    host: "127.0.0.1",
    port: parsed.WA_PORT ?? DEFAULT_PORT,
    logLevel: parsed.WA_LOG_LEVEL ?? "info",
  };
}

export function databasePath(home: string): string {
  return join(home, "wa.db");
}

/** The admin channel: the CLI talks to the engine over this unix socket. */
export function socketPath(home: string): string {
  return join(home, "engine.sock");
}

/** Every file the engine creates is 0600 and every directory 0700. */
export function restrictFileModes(): void {
  process.umask(0o077);
}
