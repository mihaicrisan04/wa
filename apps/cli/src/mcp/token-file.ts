import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tokensDir } from "@wa/engine";
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

/** Written whole or not at all, and only ever readable by the owner. */
export async function writeTokenFile(path: string, token: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const partial = `${path}.${process.pid}.part`;
  await writeFile(partial, `${token}\n`, { mode: 0o600 });
  await chmod(partial, 0o600);
  await rename(partial, path);
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
