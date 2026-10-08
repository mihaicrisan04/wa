import type { Capability, ProfileCapability } from "@wa/sdk";
import { forbidden } from "./errors";
import type { AuditRecord, Store } from "./store";

/** Who is asking: the CLI over the unix socket, or a bearer token bound to a profile. */
export type Principal =
  | { kind: "admin" }
  | {
      kind: "token";
      tokenId: string;
      profile: string;
      capabilities: ReadonlySet<ProfileCapability>;
      allChats: boolean;
    };

/** A bearer token's principal: the only kind that reaches the TCP routes, `/mcp` included. */
export type TokenPrincipal = Extract<Principal, { kind: "token" }>;

export const ADMIN: Principal = { kind: "admin" };

export function can(principal: Principal, capability: Capability): boolean {
  if (principal.kind === "admin") return true;
  return capability !== "admin" && principal.capabilities.has(capability);
}

/** True when the principal holds any one of `capabilities`, or when none are required. */
export function canAny(principal: Principal, capabilities: readonly Capability[]): boolean {
  return !capabilities.length || capabilities.some((capability) => can(principal, capability));
}

export function assertCan(principal: Principal, ...capabilities: Capability[]): void {
  if (canAny(principal, capabilities)) return;
  throw forbidden(`this token lacks the ${capabilities.join(" or ")} capability`);
}

export type SqlParams = Record<string, string | number | null>;

export interface SqlFragment {
  sql: string;
  params: SqlParams;
}

export const TRUE: SqlFragment = { sql: "1", params: {} };

/** The profile whose collections bound what the principal sees; null when it sees every chat. */
function scopingProfile(principal: Principal): string | null {
  return principal.kind === "admin" || principal.allChats ? null : principal.profile;
}

export function seesAllChats(principal: Principal): boolean {
  return scopingProfile(principal) === null;
}

/**
 * Restricts `column` (a canonical chat jid) to the chats the principal may see. Every read path
 * goes through this, and membership is read live, so a change applies to the next request.
 */
export function scopeSql(principal: Principal, column: string): SqlFragment {
  const profile = scopingProfile(principal);
  if (profile === null) return TRUE;
  return {
    sql: `${column} IN (
      SELECT scope_cc.chat_jid FROM collection_chats AS scope_cc
      JOIN profile_collections AS scope_pc ON scope_pc.collection = scope_cc.collection
      WHERE scope_pc.profile = $scope_profile)`,
    params: { scope_profile: profile },
  };
}

/** `?collection=`: intersects with the scope, never widens it. */
export function collectionSql(column: string, collection: string): SqlFragment {
  return {
    sql: `${column} IN (SELECT chat_jid FROM collection_chats WHERE collection = $in_collection)`,
    params: { in_collection: collection },
  };
}

export function and(...fragments: SqlFragment[]): SqlFragment {
  if (!fragments.length) return TRUE;
  return {
    sql: fragments.map((fragment) => `(${fragment.sql})`).join(" AND "),
    params: Object.assign({}, ...fragments.map((fragment) => fragment.params)),
  };
}

/** The token profile acting, or null for the admin. */
export function profileOf(principal: Principal): string | null {
  return principal.kind === "token" ? principal.profile : null;
}

/** Who to record in the audit log. */
function auditActor(principal: Principal): {
  tokenId: string | null;
  profile: string | null;
} {
  return {
    tokenId: principal.kind === "token" ? principal.tokenId : null,
    profile: profileOf(principal),
  };
}

export function recordAudit(
  store: Store,
  principal: Principal,
  action: string,
  about: Pick<AuditRecord, "chatJid" | "detail"> = {},
): void {
  store.audit.record({ ...auditActor(principal), action, ...about });
}
