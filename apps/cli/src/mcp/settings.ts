import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FailureError } from "../command";

/** Claude Code reads `//` as an absolute path; a single `/` would be relative to the project. */
export function denyReadRule(absoluteDir: string): string {
  return `Read(/${absoluteDir}/**)`;
}

type Settings = { permissions?: { deny?: unknown[]; [key: string]: unknown } } & Record<
  string,
  unknown
>;

/**
 * Adds `rules` to `permissions.deny` in `<dir>/.claude/settings.local.json`, keeping everything
 * else. Returns the file, or null when the rules were already there.
 */
export async function addDenyRules(dir: string, rules: string[]): Promise<string | null> {
  const path = join(dir, ".claude", "settings.local.json");
  const text = await readFile(path, "utf8").catch((err: { code?: string }) => {
    if (err.code === "ENOENT") return "{}";
    throw err;
  });
  let settings: Settings;
  try {
    settings = JSON.parse(text) as Settings;
  } catch {
    throw new FailureError(`${path} is not valid JSON; fix it and run the install again`);
  }
  if (typeof settings !== "object" || settings === null || Array.isArray(settings)) {
    throw new FailureError(`${path} is not a JSON object`);
  }
  const deny = Array.isArray(settings.permissions?.deny) ? settings.permissions.deny : [];
  const missing = rules.filter((rule) => !deny.includes(rule));
  if (!missing.length) return null;
  settings.permissions = { ...settings.permissions, deny: [...deny, ...missing] };
  await mkdir(join(dir, ".claude"), { recursive: true });
  await writeFile(path, `${JSON.stringify(settings, null, 2)}\n`);
  return path;
}
