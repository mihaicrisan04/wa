import {
  isJidBroadcast,
  isJidGroup,
  isJidNewsletter,
  isLidUser,
  isPnUser,
  jidNormalizedUser,
} from "@whiskeysockets/baileys";
import type { ChatKind, Store } from "../store";
import type { OwnIdentity } from "./connection";
import type { JidResolver } from "./normalize";

/**
 * Canonical jids: a person or 1:1 chat is keyed by its phone-number jid once the LID mapping is
 * known, else by its LID. Read-only; ingest learns the mappings.
 */
export class Identity implements JidResolver {
  constructor(
    private readonly store: Store,
    readonly own: OwnIdentity | null,
  ) {}

  me(): string | null {
    return this.own?.pn ?? null;
  }

  user(jid: string): string {
    const normalized = jidNormalizedUser(jid) || jid;
    if (!isLidUser(normalized)) return normalized;
    return this.store.identity.pnForLid(normalized) ?? normalized;
  }

  chat(jid: string): string {
    const normalized = jidNormalizedUser(jid) || jid;
    return this.store.identity.chatForAlias(normalized) ?? this.user(normalized);
  }

  kindOf(chatJid: string): ChatKind {
    if (chatJid === this.own?.pn || chatJid === this.own?.lid) return "self";
    if (isJidGroup(chatJid)) return "group";
    if (isJidNewsletter(chatJid)) return "newsletter";
    if (isJidBroadcast(chatJid)) return "broadcast";
    if (isPnUser(chatJid) || isLidUser(chatJid)) return "dm";
    return "other";
  }
}
