/** Every jid column holds the canonical jid (PN when the LID mapping is known, else LID). */
export const INIT = /* sql */ `
CREATE TABLE chats (
  jid TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('dm', 'group', 'self', 'broadcast', 'newsletter', 'other')),
  name TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER,
  mute_end_time INTEGER,
  unread_count INTEGER NOT NULL DEFAULT 0,
  ephemeral_expiration INTEGER,
  last_message_at INTEGER,
  created_at INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE INDEX chats_last_message_at ON chats (last_message_at);

CREATE TABLE chat_aliases (
  alias_jid TEXT PRIMARY KEY,
  chat_jid TEXT NOT NULL
);
CREATE INDEX chat_aliases_chat ON chat_aliases (chat_jid);

CREATE TABLE lid_map (
  lid TEXT PRIMARY KEY,
  pn TEXT NOT NULL
);
CREATE INDEX lid_map_pn ON lid_map (pn);

CREATE TABLE contacts (
  jid TEXT PRIMARY KEY,
  lid TEXT,
  phone TEXT,
  name TEXT,
  push_name TEXT,
  verified_name TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE group_participants (
  group_jid TEXT NOT NULL,
  jid TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('member', 'admin', 'superadmin', 'left')),
  PRIMARY KEY (group_jid, jid)
);
CREATE INDEX group_participants_jid ON group_participants (jid);

CREATE TABLE messages (
  rowid INTEGER PRIMARY KEY,
  chat_jid TEXT NOT NULL,
  id TEXT NOT NULL,
  from_me INTEGER NOT NULL,
  sender_jid TEXT,
  sender_alt TEXT,
  ts INTEGER NOT NULL,
  type TEXT NOT NULL,
  text TEXT,
  caption TEXT,
  file_name TEXT,
  quoted_id TEXT,
  quoted_chat_jid TEXT,
  quoted_participant TEXT,
  quoted_text TEXT,
  edited_at INTEGER,
  deleted_at INTEGER,
  expires_at INTEGER,
  has_media INTEGER NOT NULL DEFAULT 0,
  view_once INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL CHECK (source IN ('live', 'history')),
  raw TEXT,
  UNIQUE (chat_jid, id)
);
CREATE INDEX messages_chat_ts ON messages (chat_jid, ts, rowid);
CREATE INDEX messages_ts ON messages (ts);
CREATE INDEX messages_sender ON messages (sender_jid);
CREATE INDEX messages_expires_at ON messages (expires_at) WHERE expires_at IS NOT NULL;

CREATE TABLE pending_revokes (
  chat_jid TEXT NOT NULL,
  message_id TEXT NOT NULL,
  actor_from_me INTEGER NOT NULL,
  actor_jid TEXT,
  ts INTEGER NOT NULL
);
CREATE INDEX pending_revokes_message ON pending_revokes (chat_jid, message_id);
CREATE INDEX pending_revokes_actor ON pending_revokes (actor_jid);

CREATE VIRTUAL TABLE messages_fts USING fts5 (
  text, caption, file_name,
  content = 'messages', content_rowid = 'rowid',
  tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TRIGGER messages_fts_insert AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts (rowid, text, caption, file_name)
  VALUES (new.rowid, new.text, new.caption, new.file_name);
END;
CREATE TRIGGER messages_fts_delete AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts (messages_fts, rowid, text, caption, file_name)
  VALUES ('delete', old.rowid, old.text, old.caption, old.file_name);
END;
CREATE TRIGGER messages_fts_update AFTER UPDATE OF text, caption, file_name ON messages BEGIN
  INSERT INTO messages_fts (messages_fts, rowid, text, caption, file_name)
  VALUES ('delete', old.rowid, old.text, old.caption, old.file_name);
  INSERT INTO messages_fts (rowid, text, caption, file_name)
  VALUES (new.rowid, new.text, new.caption, new.file_name);
END;

CREATE TABLE media (
  chat_jid TEXT NOT NULL,
  message_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  mimetype TEXT,
  file_name TEXT,
  size INTEGER,
  local_path TEXT,
  downloaded_at INTEGER,
  PRIMARY KEY (chat_jid, message_id)
);

CREATE TABLE collections (
  name TEXT PRIMARY KEY,
  description TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE collection_chats (
  collection TEXT NOT NULL REFERENCES collections (name) ON DELETE CASCADE,
  chat_jid TEXT NOT NULL,
  PRIMARY KEY (collection, chat_jid)
);
CREATE INDEX collection_chats_chat ON collection_chats (chat_jid);

CREATE TABLE profiles (
  name TEXT PRIMARY KEY,
  capabilities TEXT NOT NULL,
  all_chats INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE profile_collections (
  profile TEXT NOT NULL REFERENCES profiles (name) ON DELETE CASCADE,
  collection TEXT NOT NULL REFERENCES collections (name) ON DELETE CASCADE,
  PRIMARY KEY (profile, collection)
);

CREATE TABLE tokens (
  id TEXT PRIMARY KEY,
  profile TEXT NOT NULL REFERENCES profiles (name) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER
);

CREATE TABLE outbox (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  chat_jid TEXT NOT NULL,
  payload TEXT NOT NULL,
  file_path TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'expired')),
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX outbox_status ON outbox (status, created_at);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,
  token_id TEXT,
  profile TEXT,
  action TEXT NOT NULL,
  chat_jid TEXT,
  detail TEXT
);
CREATE INDEX audit_log_ts ON audit_log (ts);

CREATE TABLE sync_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;
