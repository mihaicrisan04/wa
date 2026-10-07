import type { Capability, ProfileCapability } from "@wa/sdk";
import { ApiError } from "./errors";

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

export const ADMIN: Principal = { kind: "admin" };

export function can(principal: Principal, capability: Capability): boolean {
  if (principal.kind === "admin") return true;
  return capability !== "admin" && principal.capabilities.has(capability);
}

/** Passes when the principal holds any one of `capabilities`. */
export function assertCan(principal: Principal, ...capabilities: Capability[]): void {
  if (capabilities.some((capability) => can(principal, capability))) return;
  throw new ApiError(
    403,
    "forbidden",
    `this token lacks the ${capabilities.join(" or ")} capability`,
  );
}

export type SqlParams = Record<string, string | number | null>;

export interface SqlFragment {
  sql: string;
  params: SqlParams;
}

export const TRUE: SqlFragment = { sql: "1", params: {} };

export function seesAllChats(principal: Principal): boolean {
  return principal.kind === "admin" || principal.allChats;
}

/**
 * Restricts `column` (a canonical chat jid) to the chats the principal may see. Every read path
 * goes through this, and membership is read live, so a change applies to the next request.
 */
export function scopeSql(principal: Principal, column: string): SqlFragment {
  if (principal.kind === "admin" || principal.allChats) return TRUE;
  return {
    sql: `${column} IN (
      SELECT scope_cc.chat_jid FROM collection_chats AS scope_cc
      JOIN profile_collections AS scope_pc ON scope_pc.collection = scope_cc.collection
      WHERE scope_pc.profile = $scope_profile)`,
    params: { scope_profile: principal.profile },
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
  return {
    sql: fragments.map((fragment) => `(${fragment.sql})`).join(" AND ") || "1",
    params: Object.assign({}, ...fragments.map((fragment) => fragment.params)),
  };
}

/** Who to record in the audit log. */
export function actorOf(principal: Principal): { tokenId: string | null; profile: string | null } {
  return principal.kind === "admin"
    ? { tokenId: null, profile: null }
    : { tokenId: principal.tokenId, profile: principal.profile };
}
