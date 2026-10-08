import type { Database } from "./db";

/** `lid_map` (LID → phone-number jid) and `chat_aliases` (any jid → canonical chat jid). */
export class IdentityRepo {
  constructor(private readonly db: Database) {}

  pnForLid(lid: string): string | null {
    return (
      this.db
        .query<{ pn: string }, { lid: string }>("SELECT pn FROM lid_map WHERE lid = $lid")
        .get({ lid })?.pn ?? null
    );
  }

  /** Returns false when the mapping was already known. */
  setMapping(lid: string, pn: string): boolean {
    return (
      this.db
        .query(
          `INSERT INTO lid_map (lid, pn) VALUES ($lid, $pn)
           ON CONFLICT (lid) DO UPDATE SET pn = excluded.pn WHERE lid_map.pn != excluded.pn`,
        )
        .run({ lid, pn }).changes > 0
    );
  }

  chatForAlias(alias: string): string | null {
    return (
      this.db
        .query<{ chat_jid: string }, { alias: string }>(
          "SELECT chat_jid FROM chat_aliases WHERE alias_jid = $alias",
        )
        .get({ alias })?.chat_jid ?? null
    );
  }

  setAlias(alias: string, chat: string): void {
    this.db
      .query(
        `INSERT INTO chat_aliases (alias_jid, chat_jid) VALUES ($alias, $chat)
         ON CONFLICT (alias_jid) DO UPDATE SET chat_jid = excluded.chat_jid`,
      )
      .run({ alias, chat });
  }

  repointAliases(from: string, to: string): void {
    this.db
      .query("UPDATE chat_aliases SET chat_jid = $to WHERE chat_jid = $from")
      .run({ from, to });
    this.db.query("DELETE FROM chat_aliases WHERE alias_jid = chat_jid").run();
  }
}
