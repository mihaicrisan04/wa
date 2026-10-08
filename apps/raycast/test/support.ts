import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Message, OutboxEntry } from "@wa/sdk";

export const PEER = "40700000002@s.whatsapp.net";

export function message(overrides: Partial<Message> = {}): Message {
  return {
    chat: PEER,
    id: "M1",
    fromMe: false,
    sender: PEER,
    senderName: "Eve",
    ts: 1_760_000_000,
    type: "text",
    text: "hello",
    caption: null,
    fileName: null,
    quoted: null,
    editedAt: null,
    deletedAt: null,
    expiresAt: null,
    hasMedia: false,
    viewOnce: false,
    ...overrides,
  };
}

export function outboxEntry(overrides: Partial<OutboxEntry> = {}): OutboxEntry {
  return {
    outboxId: "o1",
    messageId: "3EB0AA",
    chat: PEER,
    status: "queued",
    attempts: 0,
    error: null,
    createdAt: 1_760_000_000,
    expiresAt: 1_760_003_600,
    ...overrides,
  };
}

export async function tempDir(): Promise<{ dir: string; cleanup(): Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "wa raycast test "));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}
