import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { tokensDir } from "@wa/sdk";
import { FailureError } from "../command";

const TOKEN_FORMAT = /^wa_[A-Za-z0-9_-]{43}$/;

/** Short and stable per project directory (already resolved with realpath). */
export function projectKey(dir: string): string {
  return createHash("sha1").update(dir).digest("hex").slice(0, 8);
}

/** `WA_HOME/tokens/mcp-<profile>-<suffix>.token` */
export function mcpTokenPath(home: string, profile: string, suffix: string): string {
  return join(tokensDir(home), `mcp-${profile}-${suffix}.token`);
}

export async function readTokenFile(path: string): Promise<string> {
  const token = (
    await readFile(path, "utf8").catch(() => {
      throw new FailureError(`can't read the token file ${path}`);
    })
  ).trim();
  if (!TOKEN_FORMAT.test(token)) throw new FailureError(`${path} does not hold a wa token`);
  return token;
}
