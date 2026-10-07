import { ChatsRepo } from "./chats";
import { ContactsRepo } from "./contacts";
import { nowSeconds, openDatabase, type Database } from "./db";
import { IdentityRepo } from "./identity";
import { MediaRepo } from "./media";
import { MessagesRepo } from "./messages";
import { ParticipantsRepo } from "./participants";
import { searchMessages, type SearchHit, type SearchOptions } from "./search";
import { SyncRepo } from "./sync";

export class Store {
  readonly chats: ChatsRepo;
  readonly identity: IdentityRepo;
  readonly contacts: ContactsRepo;
  readonly participants: ParticipantsRepo;
  readonly messages: MessagesRepo;
  readonly media: MediaRepo;
  readonly sync: SyncRepo;

  constructor(readonly db: Database) {
    this.chats = new ChatsRepo(db);
    this.identity = new IdentityRepo(db);
    this.contacts = new ContactsRepo(db);
    this.participants = new ParticipantsRepo(db);
    this.messages = new MessagesRepo(db);
    this.media = new MediaRepo(db);
    this.sync = new SyncRepo(db);
  }

  /** Runs `work` in one SQLite transaction (nested calls become savepoints). */
  transaction<T>(work: () => T): T {
    return this.db.transaction(work)();
  }

  /** Like `transaction`, but takes the write lock before the first read. */
  writeTransaction<T>(work: () => T): T {
    return this.db.transaction(work).immediate();
  }

  /** Deletes disappearing messages past their expiry; returns cached files to remove. */
  purgeExpired(now: number = nowSeconds()): string[] {
    return this.transaction(() =>
      this.messages.expired(now).flatMap((key) => {
        const file = this.media.remove(key);
        this.messages.delete(key);
        return file ? [file] : [];
      }),
    );
  }

  search(query: string, options?: SearchOptions): SearchHit[] {
    return searchMessages(this.db, query, options);
  }

  close(): void {
    this.db.close();
  }
}

export function openStore(path: string): Store {
  return new Store(openDatabase(path));
}

export { nowSeconds } from "./db";
export type { ChatKind, ChatPatch, ChatRow } from "./chats";
export type { ContactPatch, ContactRow } from "./contacts";
export type { MediaRow } from "./media";
export {
  PLACEHOLDER_TYPE,
  REVOKED_TYPE,
  type MediaInfo,
  type MessageKeyRef,
  type MessageRecord,
  type MessageRow,
} from "./messages";
export type { Participant, ParticipantRole } from "./participants";
export {
  SNIPPET_CLOSE,
  SNIPPET_OPEN,
  toFtsQuery,
  type SearchHit,
  type SearchOptions,
} from "./search";
