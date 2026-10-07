import type { Principal } from "../policy";
import type { Store } from "../store";

export interface VisibleScope {
  allChats: boolean;
  /** The collections whose chats the principal sees; empty with `allChats`. */
  collections: string[];
}

/** Read live, like every scope check: a membership change shows up on the next call. */
export function visibleScope(store: Store, principal: Principal): VisibleScope {
  if (principal.kind === "admin" || principal.allChats) return { allChats: true, collections: [] };
  return { allChats: false, collections: store.profiles.get(principal.profile)?.collections ?? [] };
}

export function describeScope(scope: VisibleScope): string {
  if (scope.allChats) return "all chats";
  if (!scope.collections.length) return "no chats (the profile has no collections)";
  const names = scope.collections.map((name) => JSON.stringify(name)).join(", ");
  return `only the chats in the ${scope.collections.length === 1 ? "collection" : "collections"} ${names}`;
}
