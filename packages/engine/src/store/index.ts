import { CollectionsRepo, ProfilesRepo, TokensRepo } from "./access";
import { AuditRepo } from "./audit";
import { ChatsRepo, type ChatKind } from "./chats";
import { ContactsRepo } from "./contacts";
import { nowSeconds } from "../clock";
import { openDatabase, type Database } from "./db";
import { IdentityRepo } from "./identity";
import { MediaRepo } from "./media";
import { MessagesRepo, type MessageKeyRef } from "./messages";
import { OutboxRepo } from "./outbox";
import { ParticipantsRepo } from "./participants";
import { PENDING_REVOKE_TTL, PendingRevokesRepo } from "./pending-revokes";
import { SyncRepo } from "./sync";

export class Store {
  readonly chats: ChatsRepo;
  readonly identity: IdentityRepo;
  readonly contacts: ContactsRepo;
  readonly participants: ParticipantsRepo;
  readonly messages: MessagesRepo;
  readonly pendingRevokes: PendingRevokesRepo;
  readonly media: MediaRepo;
  readonly sync: SyncRepo;
  readonly collections: CollectionsRepo;
  readonly profiles: ProfilesRepo;
  readonly tokens: TokensRepo;
  readonly outbox: OutboxRepo;
  readonly audit: AuditRepo;

  constructor(readonly db: Database) {
    this.chats = new ChatsRepo(db);
    this.identity = new IdentityRepo(db);
    this.contacts = new ContactsRepo(db);
    this.participants = new ParticipantsRepo(db);
    this.messages = new MessagesRepo(db);
    this.pendingRevokes = new PendingRevokesRepo(db);
    this.media = new MediaRepo(db);
    this.sync = new SyncRepo(db);
    this.collections = new CollectionsRepo(db);
    this.profiles = new ProfilesRepo(db);
    this.tokens = new TokensRepo(db);
    this.outbox = new OutboxRepo(db);
    this.audit = new AuditRepo(db);
  }

  /** Runs `work` in one SQLite transaction (nested calls become savepoints). */
  transaction<T>(work: () => T): T {
    return this.db.transaction(work)();
  }

  /** Like `transaction`, but takes the write lock before the first read. */
  writeTransaction<T>(work: () => T): T {
    return this.db.transaction(work).immediate();
  }

  /** Deletes a message with its search entry and media; returns the cached file to remove. */
  deleteMessage(key: MessageKeyRef): string | null {
    return this.transaction(() => {
      const file = this.media.remove(key);
      this.messages.delete(key);
      return file;
    });
  }

  /** Deletes every message of a chat with its media; returns the cached files to remove. */
  clearChat(chatJid: string): string[] {
    return this.transaction(() => {
      const files = this.media.removeChat(chatJid);
      this.messages.deleteChat(chatJid);
      return files;
    });
  }

  /**
   * Folds chat `from` into `to`: messages (the copy that knows more wins) with their media,
   * waiting revokes, settings, collection membership, queued sends and aliases. Returns the
   * cached files no longer needed.
   */
  moveChat(from: string, to: string, kind: ChatKind): string[] {
    return this.transaction(() => {
      this.messages.moveChat(from, to);
      const files = this.media.moveChat(from, to);
      this.pendingRevokes.moveChat(from, to);
      this.chats.merge(from, to, kind);
      this.collections.moveChat(from, to);
      this.outbox.moveChat(from, to);
      this.identity.repointAliases(from, to);
      this.identity.setAlias(from, to);
      return files;
    });
  }

  /** Re-points everything a person did or is under jid `from` to their canonical jid `to`. */
  renameUser(from: string, to: string): void {
    this.transaction(() => {
      this.messages.renameUser(from, to);
      this.pendingRevokes.renameUser(from, to);
      this.participants.renameUser(from, to);
      this.contacts.merge(from, to);
    });
  }

  /**
   * Deletes disappearing messages past their expiry and revokes that waited too long for their
   * message; returns cached files to remove.
   */
  purgeExpired(now: number = nowSeconds()): string[] {
    return this.transaction(() => {
      this.pendingRevokes.prune(now - PENDING_REVOKE_TTL);
      return this.messages.expired(now).flatMap((key) => this.deleteMessage(key) ?? []);
    });
  }

  close(): void {
    this.db.close();
  }
}

export function openStore(path: string): Store {
  return new Store(openDatabase(path));
}

export type { CollectionRow, ProfileRecord, ProfileSpec, TokenRow } from "./access";
export type { OutboxRow } from "./outbox";
export type { ChatKind, ChatPatch } from "./chats";
export type { MediaRow } from "./media";
export {
  PLACEHOLDER_TYPE,
  REVOKED_TYPE,
  type MediaInfo,
  type MessageKeyRef,
  type MessageRecord,
  type MessageRow,
  type OldestMessage,
} from "./messages";
export type { Member } from "./participants";
export type { PendingRevoke } from "./pending-revokes";
export type { HistoryPhaseState, HistoryPhases } from "./sync";
export { toFtsQuery } from "./search";
