import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { OutboxEntry, SendFileInput, SendResult, WaClient } from "@wa/sdk";
import { readClipboard } from "../src/lib/clipboard-media";
import { reportDelivery, sendContent, waitForDelivery } from "../src/lib/deliver";
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
  test("sent, queued offline, retrying, failed and expired", () => {
    expect(reportDelivery(outboxEntry({ status: "sent" }), "Ana")).toEqual({
      ok: true,
      title: "Sent to Ana",
    });
    expect(reportDelivery(outboxEntry({ status: "queued" }), "Ana")).toMatchObject({
      ok: true,
      title: "Queued for Ana",
      message: expect.stringContaining("offline"),
    });
    expect(reportDelivery(outboxEntry({ status: "queued", attempts: 2 }), "Ana")).toMatchObject({
      ok: true,
      message: expect.stringContaining("retrying"),
    });
    expect(
      reportDelivery(
        outboxEntry({ status: "failed", error: "sending failed after 8 attempts" }),
        "Ana",
      ),
    ).toEqual({ ok: false, title: "Failed to send", message: "sending failed after 8 attempts" });
    expect(reportDelivery(outboxEntry({ status: "expired" }), "Ana").ok).toBe(false);
  });
});
