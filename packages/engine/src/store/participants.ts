import type { ParticipantRole } from "@wa/sdk";
import type { Database } from "./db";

/** A group member as stored: a canonical jid and its role. */
export interface Member {
  jid: string;
  role: ParticipantRole;
}

const NEXT_SEQ = "(SELECT coalesce(max(role_seq), 0) + 1 FROM group_participants)";

/** `group_participants`: current members with their role, plus past members as `left`. */
export class ParticipantsRepo {
  constructor(private readonly db: Database) {}

  list(groupJid: string): Member[] {
    return this.db
      .query<Member, { groupJid: string }>(
        "SELECT jid, role FROM group_participants WHERE group_jid = $groupJid ORDER BY jid",
      )
      .all({ groupJid });
  }

  role(groupJid: string, jid: string): ParticipantRole | null {
    return (
      this.db
        .query<{ role: ParticipantRole }, { groupJid: string; jid: string }>(
          "SELECT role FROM group_participants WHERE group_jid = $groupJid AND jid = $jid",
        )
        .get({ groupJid, jid })?.role ?? null
    );
  }

  /** A full member list: everyone not in it who was a member is now `left`. */
  replace(groupJid: string, members: Member[]): void {
    this.db
      .query(
        `UPDATE group_participants SET role = 'left', role_seq = ${NEXT_SEQ}
         WHERE group_jid = $groupJid`,
      )
      .run({ groupJid });
    for (const member of members) this.set(groupJid, member);
  }

  set(groupJid: string, { jid, role }: Member): void {
    this.db
      .query(
        `INSERT INTO group_participants (group_jid, jid, role, role_seq)
         VALUES ($groupJid, $jid, $role, ${NEXT_SEQ})
         ON CONFLICT (group_jid, jid) DO UPDATE SET role = excluded.role, role_seq = excluded.role_seq`,
      )
      .run({ groupJid, jid, role });
  }

  /** Records someone who left, without demoting a current member. */
  addPast(groupJid: string, jid: string): void {
    this.db
      .query(
        `INSERT INTO group_participants (group_jid, jid, role) VALUES ($groupJid, $jid, 'left')
         ON CONFLICT (group_jid, jid) DO NOTHING`,
      )
      .run({ groupJid, jid });
  }

  deleteGroup(groupJid: string): void {
    this.db.query("DELETE FROM group_participants WHERE group_jid = $groupJid").run({ groupJid });
  }

  /** Re-points a person across every group; on a clash the role learned last wins. */
  renameUser(from: string, to: string): void {
    this.db
      .query(
        `INSERT INTO group_participants (group_jid, jid, role, role_seq)
         SELECT group_jid, $to, role, role_seq FROM group_participants WHERE jid = $from
         ON CONFLICT (group_jid, jid) DO UPDATE SET role = excluded.role, role_seq = excluded.role_seq
         WHERE excluded.role_seq > group_participants.role_seq`,
      )
      .run({ from, to });
    this.db.query("DELETE FROM group_participants WHERE jid = $from").run({ from });
  }
}
