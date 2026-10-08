import { afterEach, beforeEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OutboxEntry } from "@wa/sdk";

export const PEER = "40700000002@s.whatsapp.net";

export { messageFixture as message } from "@wa/sdk/testing";

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

/** A fresh temp dir for every test of the calling file, removed after each; call the result for its path. */
export function useTempDir(): () => string {
  let dir = "";
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "wa raycast test "));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));
  return () => dir;
}
