import { nowSeconds } from "../clock";
import type { Database } from "./db";

export interface ContactRow {
  jid: string;
  lid: string | null;
  phone: string | null;
  name: string | null;
  push_name: string | null;
  verified_name: string | null;
  updated_at: number;
}

/** Only the fields present are written. */
export interface ContactPatch {
  lid?: string | null;
  phone?: string | null;
  name?: string | null;
  pushName?: string | null;
  verifiedName?: string | null;
}

const PATCH_COLUMNS: Record<keyof ContactPatch, string> = {
  lid: "lid",
  phone: "phone",
  name: "name",
  pushName: "push_name",
  verifiedName: "verified_name",
};

export class ContactsRepo {
  constructor(private readonly db: Database) {}

  get(jid: string): ContactRow | null {
    return this.db
      .query<ContactRow, { jid: string }>("SELECT * FROM contacts WHERE jid = $jid")
      .get({ jid });
  }

  upsert(jid: string, patch: ContactPatch): void {
    const entries = (Object.keys(patch) as (keyof ContactPatch)[])
      .filter((field) => patch[field] !== undefined)
      .map((field) => [PATCH_COLUMNS[field], patch[field] ?? null] as const);
    const columns = entries.map(([column]) => column);
    this.db
      .query(
        `INSERT INTO contacts (jid, updated_at${columns.map((column) => `, ${column}`).join("")})
         VALUES ($jid, $now${columns.map((column) => `, $${column}`).join("")})
         ON CONFLICT (jid) DO UPDATE SET updated_at = excluded.updated_at${columns
           .map((column) => `, ${column} = coalesce(excluded.${column}, contacts.${column})`)
           .join("")}`,
      )
      .run({ jid, now: nowSeconds(), ...Object.fromEntries(entries) } as never);
  }

  /** Folds contact `from` into `to`, keeping the target's fields where both have one. */
  merge(from: string, to: string): void {
    const source = this.get(from);
    if (!source) return;
    this.upsert(to, {});
    this.db
      .query(
        `UPDATE contacts SET
           lid = coalesce(lid, $lid), phone = coalesce(phone, $phone), name = coalesce(name, $name),
           push_name = coalesce(push_name, $pushName),
           verified_name = coalesce(verified_name, $verifiedName)
         WHERE jid = $to`,
      )
      .run({
        to,
        lid: source.lid,
        phone: source.phone,
        name: source.name,
        pushName: source.push_name,
        verifiedName: source.verified_name,
      });
    this.db.query("DELETE FROM contacts WHERE jid = $from").run({ from });
  }
}
