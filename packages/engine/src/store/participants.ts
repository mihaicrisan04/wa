import type { Database } from "./db";

export type ParticipantRole = "member" | "admin" | "superadmin" | "left";

export interface Participant {
  jid: string;
  role: ParticipantRole;
}

/** `group_participants`: current members with their role, plus past members as `left`. */
export class ParticipantsRepo {
  constructor(private readonly db: Database) {}

  list(groupJid: string): Participant[] {
    return this.db
      .query<Participant, { groupJid: string }>(
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
  replace(groupJid: string, participants: Participant[]): void {
    this.db
      .query("UPDATE group_participants SET role = 'left' WHERE group_jid = $groupJid")
      .run({ groupJid });
    for (const participant of participants) this.set(groupJid, participant);
  }

  set(groupJid: string, { jid, role }: Participant): void {
    this.db
      .query(
        `INSERT INTO group_participants (group_jid, jid, role) VALUES ($groupJid, $jid, $role)
         ON CONFLICT (group_jid, jid) DO UPDATE SET role = excluded.role`,
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

  /** Re-points a person across every group; a clash keeps the existing row. */
  renameUser(from: string, to: string): void {
    this.db
      .query(
        `INSERT INTO group_participants (group_jid, jid, role)
         SELECT group_jid, $to, role FROM group_participants WHERE jid = $from
         ON CONFLICT (group_jid, jid) DO UPDATE SET role = CASE
           WHEN group_participants.role = 'left' THEN excluded.role ELSE group_participants.role END`,
      )
      .run({ from, to });
    this.db.query("DELETE FROM group_participants WHERE jid = $from").run({ from });
  }
}
