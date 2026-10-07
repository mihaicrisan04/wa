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

/** Only the fields present (and not null) are written. */
export interface ContactPatch {
  lid?: string | null;
  phone?: string | null;
  name?: string | null;
  pushName?: string | null;
  verifiedName?: string | null;
}

export class ContactsRepo {
  constructor(private readonly db: Database) {}

  get(jid: string): ContactRow | null {
    return this.db
      .query<ContactRow, { jid: string }>("SELECT * FROM contacts WHERE jid = $jid")
      .get({ jid });
  }

  upsert(jid: string, patch: ContactPatch): void {
    this.db
      .query(
        `INSERT INTO contacts (jid, lid, phone, name, push_name, verified_name, updated_at)
         VALUES ($jid, $lid, $phone, $name, $pushName, $verifiedName, $now)
         ON CONFLICT (jid) DO UPDATE SET
           lid = coalesce(excluded.lid, contacts.lid),
           phone = coalesce(excluded.phone, contacts.phone),
           name = coalesce(excluded.name, contacts.name),
           push_name = coalesce(excluded.push_name, contacts.push_name),
           verified_name = coalesce(excluded.verified_name, contacts.verified_name),
           updated_at = excluded.updated_at`,
      )
      .run({
        jid,
        lid: patch.lid ?? null,
        phone: patch.phone ?? null,
        name: patch.name ?? null,
        pushName: patch.pushName ?? null,
        verifiedName: patch.verifiedName ?? null,
        now: nowSeconds(),
      });
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
