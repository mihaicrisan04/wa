import type { BaileysEventMap, WAMessage } from "@whiskeysockets/baileys";
import { Ingest } from "../../src/ingest";
import { openStore, type Store } from "../../src/store";
import { FakeWhatsAppClient, ME, ME_LID, ME_PN, silentLogger } from "../../src/testing";
import type { OwnIdentity } from "../../src/whatsapp/connection";

export interface Harness {
  store: Store;
  client: FakeWhatsAppClient;
  ingest: Ingest;
  /** Emits the events as one batch and waits until they are stored. */
  emit(events: Partial<BaileysEventMap>): Promise<void>;
  /** Emits the messages as one live `notify` upsert. */
  upsert(...messages: WAMessage[]): Promise<void>;
  /** Emits through Baileys' buffer, so updates fold into upserts like during a sync. */
  buffered(work: (client: FakeWhatsAppClient) => void): Promise<void>;
  close(): void;
}

export function harness(own: OwnIdentity | null = { pn: ME_PN, lid: ME_LID }): Harness {
  const store = openStore(":memory:");
  const client = new FakeWhatsAppClient(ME);
  const ingest = new Ingest({ store, logger: silentLogger, me: () => own });
  ingest.attach(client);
  const emit = async (events: Partial<BaileysEventMap>) => {
    client.emitBatch(events);
    await client.idle();
  };
  return {
    store,
    client,
    ingest,
    emit,
    upsert: (...messages) => emit({ "messages.upsert": { messages, type: "notify" } }),
    async buffered(work) {
      client.buffered(() => work(client));
      await client.idle();
    },
    close: () => store.close(),
  };
}

export function messageRows(store: Store, chatJid: string) {
  return store.db
    .query<
      {
        id: string;
        type: string;
        text: string | null;
        caption: string | null;
        sender_jid: string | null;
        deleted_at: number | null;
        edited_at: number | null;
        ts: number;
      },
      { chatJid: string }
    >(
      "SELECT id, type, text, caption, sender_jid, deleted_at, edited_at, ts FROM messages WHERE chat_jid = $chatJid ORDER BY ts, rowid",
    )
    .all({ chatJid });
}

export function count(store: Store, sql: string): number {
  return store.db.query<{ n: number }, []>(`SELECT count(*) AS n FROM (${sql})`).get()!.n;
}
