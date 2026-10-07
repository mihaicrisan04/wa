import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { truncate, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createWaClient,
  MAX_UPLOAD_BYTES,
  type OutboxEntry,
  type SendFileInput,
  type SendResult,
  type Status,
  type WaClient,
} from "@wa/sdk";
import { readClipboard } from "../src/lib/clipboard-media";
import { isOnline, reportDelivery, sendContent, waitForDelivery } from "../src/lib/deliver";
import { outboxEntry, tempDir } from "./support";

let dir: string;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  ({ dir, cleanup } = await tempDir());
});
afterEach(() => cleanup());

const RESULT: SendResult = { outboxId: "o1", messageId: "3EB0AA", status: "queued" };

function recordingClient() {
  const texts: { to: string; text: string }[] = [];
  const files: SendFileInput[] = [];
  const client: Pick<WaClient, "send" | "sendFile"> = {
    send: async (input) => {
      texts.push(input);
      return RESULT;
    },
    sendFile: async (input) => {
      files.push(input);
      return RESULT;
    },
  };
  return { client, texts, files };
}

describe("sending clipboard content", () => {
  test("text and links go as JSON text", async () => {
    const { client, texts, files } = recordingClient();
    await sendContent(client, "self", { type: "text", text: "hi\nthere" });
    await sendContent(client, "120363000000000001@g.us", {
      type: "url",
      url: "https://example.com",
    });
    expect(texts).toEqual([
      { to: "self", text: "hi\nthere" },
      { to: "120363000000000001@g.us", text: "https://example.com" },
    ]);
    expect(files).toEqual([]);
  });

  test("files are uploaded as bytes with their base name, never as a path", async () => {
    const path = join(dir, "notes.pdf");
    await writeFile(path, "%PDF-1.7 bytes");
    const { client, files } = recordingClient();
    await sendContent(client, "self", { type: "file", filePath: path });
    expect(files).toHaveLength(1);
    const [upload] = files;
    expect(upload?.fileName).toBe("notes.pdf");
    expect(await upload?.file.text()).toBe("%PDF-1.7 bytes");
    expect(JSON.stringify(upload)).not.toContain(dir);
  });

  test("a file over WhatsApp's 2 GB cap is refused before any upload starts", async () => {
    const path = join(dir, "huge.mov");
    await writeFile(path, "");
    // sparse: the size is there without writing 2 GB to disk
    await truncate(path, MAX_UPLOAD_BYTES + 1);
    let uploads = 0;
    const client = createWaClient({
      fetch: async () => {
        uploads++;
        return new Response(null, { status: 500 });
      },
    });
    const error = await sendContent(client, "self", { type: "file", filePath: path }).catch(
      (err: unknown) => err,
    );
    expect(error).toMatchObject({ code: "too_large" });
    expect(uploads).toBe(0);
  });

  test("a Finder file URL from the clipboard is uploaded from its decoded path", async () => {
    const path = join(dir, "my photo.png");
    await writeFile(path, "png");
    const content = readClipboard(undefined, `file://${encodeURI(path)}`, {
      pasteboardImage: false,
    });
    expect(content).toEqual({ type: "file", filePath: path });
    if (content.type === "empty") throw new Error("unreachable");
    const { client, files } = recordingClient();
    await sendContent(client, "self", content);
    expect(files[0]?.fileName).toBe("my photo.png");
  });
});

describe("waiting for the outbox", () => {
  function outboxClient(statuses: OutboxEntry["status"][]) {
    let calls = 0;
    const client: Pick<WaClient, "outbox"> = {
      outbox: async (id) => {
        const status = statuses[Math.min(calls, statuses.length - 1)] ?? "queued";
        calls++;
        return outboxEntry({ outboxId: id, status });
      },
    };
    return { client, calls: () => calls };
  }

  test("polls until the entry is settled", async () => {
    const { client, calls } = outboxClient(["queued", "sending", "sent"]);
    const entry = await waitForDelivery(client, "o1", { sleep: async () => {} });
    expect(entry.status).toBe("sent");
    expect(calls()).toBe(3);
  });

  test("gives up at the deadline and reports what the engine has so far", async () => {
    const { client } = outboxClient(["queued"]);
    const entry = await waitForDelivery(client, "o1", { timeoutMs: 0 });
    expect(entry.status).toBe("queued");
  });

  test("failures and expiry stop polling right away", async () => {
    for (const status of ["failed", "expired"] as const) {
      const { client, calls } = outboxClient([status]);
      expect((await waitForDelivery(client, "o1")).status).toBe(status);
      expect(calls()).toBe(1);
    }
  });
});

describe("delivery report", () => {
  const report = (overrides: Partial<OutboxEntry>, online = true) =>
    reportDelivery(outboxEntry(overrides), "Ana", online);

  test("sent, failed and expired", () => {
    expect(report({ status: "sent" })).toEqual({ ok: true, title: "Sent to Ana" });
    expect(report({ status: "failed", error: "sending failed after 8 attempts" })).toEqual({
      ok: false,
      title: "Failed to send",
      message: "sending failed after 8 attempts",
    });
    expect(report({ status: "expired" }).ok).toBe(false);
  });

  test("a first try still uploading is in progress, not a failure", () => {
    // the engine counts the attempt as soon as it claims the entry
    expect(report({ status: "sending", attempts: 1 })).toEqual({
      ok: true,
      title: "Still sending to Ana",
      message: "The engine finishes it in the background.",
    });
  });

  test("queued: offline, waiting its turn, or retrying after a failed try", () => {
    expect(report({ status: "queued" }, false).message).toContain("offline");
    expect(report({ status: "queued" }, true).message).toBe(
      "Waiting behind other messages in the outbox.",
    );
    expect(report({ status: "queued", attempts: 2 }, true).message).toContain("retrying");
  });

  test("online means the engine says WhatsApp is open; an unreachable engine is offline", async () => {
    const statusOf = (state: Status["state"]) => ({
      status: async () => ({ state }) as Status,
    });
    expect(await isOnline(statusOf("open"))).toBe(true);
    expect(await isOnline(statusOf("reconnecting"))).toBe(false);
    expect(await isOnline({ status: () => Promise.reject(new Error("down")) })).toBe(false);
  });
});
