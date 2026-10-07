import { PROFILE_CAPABILITIES, type ProfileCapability } from "@wa/sdk";
import { nowSeconds } from "../clock";
import type { Database } from "./db";

export interface CollectionRow {
  name: string;
  description: string | null;
  created_at: number;
  chat_count: number;
}

const COLLECTION_SELECT = `
  SELECT c.name, c.description, c.created_at,
    (SELECT count(*) FROM collection_chats WHERE collection = c.name) AS chat_count
  FROM collections AS c WHERE $name IS NULL OR c.name = $name`;

export class CollectionsRepo {
  constructor(private readonly db: Database) {}

  list(): CollectionRow[] {
    return this.db
      .query<CollectionRow, { name: null }>(`${COLLECTION_SELECT} ORDER BY c.name`)
      .all({ name: null });
  }

  get(name: string): CollectionRow | null {
    return this.db.query<CollectionRow, { name: string }>(COLLECTION_SELECT).get({ name });
  }

  /** False when it already exists. */
  create(name: string, description: string | null): boolean {
    return (
      this.db
        .query(
          `INSERT INTO collections (name, description, created_at) VALUES ($name, $description, $now)
           ON CONFLICT (name) DO NOTHING`,
        )
        .run({ name, description, now: nowSeconds() }).changes > 0
    );
  }

  delete(name: string): boolean {
    return this.db.query("DELETE FROM collections WHERE name = $name").run({ name }).changes > 0;
  }

  addChat(name: string, chatJid: string): void {
    this.db
      .query(
        `INSERT INTO collection_chats (collection, chat_jid) VALUES ($name, $chatJid)
         ON CONFLICT DO NOTHING`,
      )
      .run({ name, chatJid });
  }

  removeChat(name: string, chatJid: string): boolean {
    return (
      this.db
        .query("DELETE FROM collection_chats WHERE collection = $name AND chat_jid = $chatJid")
        .run({ name, chatJid }).changes > 0
    );
  }

  chats(name: string): string[] {
    return this.db
      .query<{ chat_jid: string }, { name: string }>(
        "SELECT chat_jid FROM collection_chats WHERE collection = $name ORDER BY chat_jid",
      )
      .all({ name })
      .map((row) => row.chat_jid);
  }
}

export interface ProfileSpec {
  name: string;
  capabilities: ProfileCapability[];
  allChats: boolean;
  collections: string[];
}

export interface ProfileRecord extends ProfileSpec {
  createdAt: number;
}

interface ProfileRow {
  name: string;
  capabilities: string;
  all_chats: number;
  created_at: number;
}

export class ProfilesRepo {
  constructor(private readonly db: Database) {}

  list(): ProfileRecord[] {
    return this.db
      .query<ProfileRow, []>("SELECT * FROM profiles ORDER BY name")
      .all()
      .map((row) => this.toRecord(row));
  }

  get(name: string): ProfileRecord | null {
    const row = this.db
      .query<ProfileRow, { name: string }>("SELECT * FROM profiles WHERE name = $name")
      .get({ name });
    return row ? this.toRecord(row) : null;
  }

  /** False when it already exists; every collection must exist (foreign key). */
  create(spec: ProfileSpec): boolean {
    return this.db.transaction(() => {
      const created =
        this.db
          .query(
            `INSERT INTO profiles (name, capabilities, all_chats, created_at)
             VALUES ($name, $capabilities, $allChats, $now) ON CONFLICT (name) DO NOTHING`,
          )
          .run({ ...profileParams(spec), now: nowSeconds() }).changes > 0;
      if (created) this.setCollections(spec.name, spec.collections);
      return created;
    })();
  }

  /** Creates the profile or brings an existing one back to `spec`. */
  put(spec: ProfileSpec): void {
    this.db.transaction(() => {
      if (this.create(spec)) return;
      this.db
        .query(
          "UPDATE profiles SET capabilities = $capabilities, all_chats = $allChats WHERE name = $name",
        )
        .run(profileParams(spec));
      this.setCollections(spec.name, spec.collections);
    })();
  }

  delete(name: string): boolean {
    return this.db.query("DELETE FROM profiles WHERE name = $name").run({ name }).changes > 0;
  }

  private setCollections(profile: string, collections: string[]): void {
    this.db.query("DELETE FROM profile_collections WHERE profile = $profile").run({ profile });
    for (const collection of new Set(collections)) {
      this.db
        .query(
          "INSERT INTO profile_collections (profile, collection) VALUES ($profile, $collection)",
        )
        .run({ profile, collection });
    }
  }

  private toRecord(row: ProfileRow): ProfileRecord {
    const collections = this.db
      .query<{ collection: string }, { profile: string }>(
        "SELECT collection FROM profile_collections WHERE profile = $profile ORDER BY collection",
      )
      .all({ profile: row.name })
      .map((entry) => entry.collection);
    return {
      name: row.name,
      capabilities: parseCapabilities(row.capabilities),
      allChats: row.all_chats === 1,
      collections,
      createdAt: row.created_at,
    };
  }
}

function profileParams(spec: ProfileSpec) {
  return {
    name: spec.name,
    capabilities: JSON.stringify(spec.capabilities),
    allChats: spec.allChats ? 1 : 0,
  };
}

/** Unknown names (e.g. from a newer engine) are dropped rather than trusted. */
function parseCapabilities(json: string): ProfileCapability[] {
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) return [];
  return PROFILE_CAPABILITIES.filter((capability) => parsed.includes(capability));
}

export interface TokenRow {
  id: string;
  profile: string;
  label: string | null;
  created_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
}

const TOKEN_COLUMNS = "id, profile, label, created_at, last_used_at, revoked_at";

/** Only hashes are stored; the token itself is shown once, when created. */
export class TokensRepo {
  constructor(private readonly db: Database) {}

  insert(row: { id: string; profile: string; hash: string; label: string | null }): TokenRow {
    return this.db
      .query<TokenRow, Record<string, string | number | null>>(
        `INSERT INTO tokens (id, profile, token_hash, label, created_at)
         VALUES ($id, $profile, $hash, $label, $now) RETURNING ${TOKEN_COLUMNS}`,
      )
      .get({ ...row, now: nowSeconds() })!;
  }

  /** The live token with this hash; revoked ones are never found. */
  findActive(hash: string): TokenRow | null {
    return this.db
      .query<TokenRow, { hash: string }>(
        `SELECT ${TOKEN_COLUMNS} FROM tokens WHERE token_hash = $hash AND revoked_at IS NULL`,
      )
      .get({ hash });
  }

  get(id: string): TokenRow | null {
    return this.db
      .query<TokenRow, { id: string }>(`SELECT ${TOKEN_COLUMNS} FROM tokens WHERE id = $id`)
      .get({ id });
  }

  list(profile?: string): TokenRow[] {
    return this.db
      .query<TokenRow, { profile: string | null }>(
        `SELECT ${TOKEN_COLUMNS} FROM tokens
         WHERE $profile IS NULL OR profile = $profile ORDER BY created_at, id`,
      )
      .all({ profile: profile ?? null });
  }

  revoke(id: string): boolean {
    return (
      this.db
        .query("UPDATE tokens SET revoked_at = $now WHERE id = $id AND revoked_at IS NULL")
        .run({ id, now: nowSeconds() }).changes > 0
    );
  }

  /** Minute resolution is plenty and spares a write on every request. */
  touch(id: string): void {
    this.db
      .query(
        `UPDATE tokens SET last_used_at = $now
         WHERE id = $id AND (last_used_at IS NULL OR last_used_at < $now - 60)`,
      )
      .run({ id, now: nowSeconds() });
  }
}
