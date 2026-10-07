import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_PORT } from "@wa/sdk";

export function defaultHome(): string {
  return join(homedir(), "Library", "Application Support", "wa");
}

/** Written by the engine at every start for the built-in `raycast` profile. */
export function raycastTokenPath(home: string): string {
  return join(home, "tokens", "raycast.token");
}

export class MissingTokenError extends Error {
  constructor(readonly path: string) {
    super(`no token in the Token preference or ${path}`);
    this.name = "MissingTokenError";
  }
}

/** The Token preference wins; otherwise the engine's raycast token file, read fresh every time. */
export async function resolveToken(preference: string | undefined, home: string): Promise<string> {
  const fromPreference = preference?.trim();
  if (fromPreference) return fromPreference;
  const path = raycastTokenPath(home);
  const fromFile = (await readFile(path, "utf8").catch(() => "")).trim();
  if (!fromFile) throw new MissingTokenError(path);
  return fromFile;
}

export function parsePort(value: string | undefined): number {
  const port = Number(value?.trim());
  return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : DEFAULT_PORT;
}

export function engineUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}
