import { readFile } from "node:fs/promises";
import { DEFAULT_PORT } from "@wa/sdk";
import { raycastTokenPath } from "@wa/sdk/paths";

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
