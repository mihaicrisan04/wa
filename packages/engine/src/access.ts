import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProfileCapability } from "@wa/sdk";
import type { TokenPrincipal } from "./policy";
import type { ProfileSpec, Store, TokenRow } from "./store";

export const RAYCAST_PROFILE: ProfileSpec = {
  name: "raycast",
  capabilities: ["chats:read", "messages:read", "media:read", "send:self", "send", "link"],
  allChats: true,
  collections: [],
};

/** Profiles the engine recreates at every start; deleting them is refused. */
export const BUILTIN_PROFILES: ReadonlySet<string> = new Set([RAYCAST_PROFILE.name]);

const RAYCAST_TOKEN_LABEL = "raycast (built-in)";

export function tokensDir(home: string): string {
  return join(home, "tokens");
}

export function raycastTokenPath(home: string): string {
  return join(tokensDir(home), "raycast.token");
}

/** `wa_` + base64url(32 random bytes). */
function generateToken(): string {
  return `wa_${randomBytes(32).toString("base64url")}`;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface IssuedToken {
  row: TokenRow;
  /** The only time the token itself exists outside the client. */
  token: string;
}

export function issueToken(store: Store, profile: string, label: string | null): IssuedToken {
  const token = generateToken();
  const row = store.tokens.insert({
    id: `t_${randomBytes(6).toString("hex")}`,
    profile,
    hash: hashToken(token),
    label,
  });
  return { row, token };
}

/** Revocation and the profile are read on every call: nothing is cached. */
export function authenticate(store: Store, token: string): TokenPrincipal | null {
  const row = store.tokens.findActive(hashToken(token));
  if (!row) return null;
  const profile = store.profiles.get(row.profile);
  if (!profile) return null;
  store.tokens.touch(row.id);
  return {
    kind: "token",
    tokenId: row.id,
    profile: profile.name,
    capabilities: new Set<ProfileCapability>(profile.capabilities),
    allChats: profile.allChats,
  };
}

/**
 * The built-in `raycast` profile, and a token for it in `tokens/raycast.token` (0600) that the
 * extension reads when its token preference is empty. A token that still works is kept.
 */
export async function ensureRaycastAccess(store: Store, home: string): Promise<void> {
  store.profiles.put(RAYCAST_PROFILE);
  const path = raycastTokenPath(home);
  const existing = (await readFile(path, "utf8").catch(() => "")).trim();
  if (existing && store.tokens.findActive(hashToken(existing))?.profile === RAYCAST_PROFILE.name) {
    await chmod(path, 0o600);
    return;
  }

  for (const row of store.tokens.list(RAYCAST_PROFILE.name)) {
    if (row.label === RAYCAST_TOKEN_LABEL) store.tokens.revoke(row.id);
  }
  const { token } = issueToken(store, RAYCAST_PROFILE.name, RAYCAST_TOKEN_LABEL);
  await mkdir(tokensDir(home), { recursive: true, mode: 0o700 });
  const partial = `${path}.${process.pid}.part`;
  await writeFile(partial, `${token}\n`, { mode: 0o600 });
  await rename(partial, path);
}
