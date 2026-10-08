import type {
  BaileysEventMap,
  GroupMetadata,
  GroupParticipant,
  proto,
} from "@whiskeysockets/baileys";
import type { Participant, ParticipantRole } from "../store";
import type { IngestContext } from "./context";
import type { Batch } from "./lid";

/** `groups.upsert` and `groups.update` (full metadata from `groupFetchAllParticipating`, or partial). */
export function ingestGroup(ctx: IngestContext, group: Partial<GroupMetadata>): void {
  if (!group.id) return;
  const jid = ctx.identity.chat(group.id);
  ctx.store.chats.upsert(jid, "group", {
    name: group.subject || undefined,
    ephemeralExpiration:
      group.ephemeralDuration === undefined ? undefined : group.ephemeralDuration || null,
    createdAt: group.creation || undefined,
  });
  if (group.participants) {
    ctx.store.participants.replace(
      jid,
      group.participants.map((participant) => toParticipant(ctx, participant)),
    );
  }
}

export function ingestParticipantsUpdate(
  ctx: IngestContext,
  update: BaileysEventMap["group-participants.update"],
): void {
  const jid = ctx.identity.chat(update.id);
  for (const participant of update.participants) {
    const user = ctx.identity.user(participant.id);
    const role = ROLE_BY_ACTION[update.action];
    if (role) ctx.store.participants.set(jid, { jid: user, role });
  }
}

export function ingestPastParticipants(
  ctx: IngestContext,
  groups: proto.IPastParticipants[],
): void {
  for (const group of groups) {
    if (!group.groupJid) continue;
    const jid = ctx.identity.chat(group.groupJid);
    for (const past of group.pastParticipants ?? []) {
      if (past.userJid) ctx.store.participants.addPast(jid, ctx.identity.user(past.userJid));
    }
  }
}

const ROLE_BY_ACTION: Record<
  BaileysEventMap["group-participants.update"]["action"],
  ParticipantRole | null
> = {
  add: "member",
  remove: "left",
  promote: "admin",
  demote: "member",
  modify: null,
};

function toParticipant(ctx: IngestContext, participant: GroupParticipant): Participant {
  const role: ParticipantRole =
    participant.admin === "superadmin" || participant.isSuperAdmin
      ? "superadmin"
      : participant.admin === "admin" || participant.isAdmin
        ? "admin"
        : "member";
  return { jid: ctx.identity.user(participant.id), role };
}

/**
 * Group metadata for Baileys' `cachedGroupMetadata`, kept exactly as WhatsApp sent it (raw
 * jids, since sending encrypts to them). Membership changes drop the entry so Baileys refetches.
 */
export class GroupCache {
  private readonly groups = new Map<string, GroupMetadata>();

  get(jid: string): GroupMetadata | undefined {
    return this.groups.get(jid);
  }

  apply(batch: Batch): void {
    for (const group of [...(batch["groups.upsert"] ?? []), ...(batch["groups.update"] ?? [])]) {
      if (!group.id) continue;
      const cached = this.groups.get(group.id);
      if (group.participants && group.subject !== undefined) {
        this.groups.set(group.id, { ...cached, ...group } as GroupMetadata);
      } else if (cached && !group.participants) {
        this.groups.set(group.id, { ...cached, ...group });
      } else {
        this.groups.delete(group.id);
      }
    }
    const changed = batch["group-participants.update"];
    if (changed) this.groups.delete(changed.id);
    for (const id of batch["chats.delete"] ?? []) this.groups.delete(id);
  }
}
