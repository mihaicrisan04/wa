// node:os/node:path only: the Raycast extension bundles this and runs it on Node, not Bun.
import { homedir } from "node:os";
import { join } from "node:path";

/** The engine's data dir when `WA_HOME` is unset. */
export function defaultHome(userHome: string = homedir()): string {
  return join(userHome, "Library", "Application Support", "wa");
}

export function tokensDir(home: string): string {
  return join(home, "tokens");
}

/** Written by the engine at every start for the built-in `raycast` profile. */
export function raycastTokenPath(home: string): string {
  return join(tokensDir(home), "raycast.token");
}
