import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { OutboxEntry, OutboxStatus, SendResult, WaClient } from "@wa/sdk";
import type { ClipboardContent } from "./clipboard-media";

export type SendableContent = Exclude<ClipboardContent, { type: "empty" }>;

type SendClient = Pick<WaClient, "send" | "sendFile">;
type OutboxClient = Pick<WaClient, "outbox">;

/** Text goes as JSON; files are uploaded as bytes, the engine never reads our paths. */
export async function sendContent(
  client: SendClient,
  to: string,
  content: SendableContent,
): Promise<SendResult> {
  switch (content.type) {
    case "text":
      return client.send({ to, text: content.text });
    case "url":
      return client.send({ to, text: content.url });
    case "file":
    case "image": {
      const bytes = await readFile(content.filePath);
      return client.sendFile({ to, file: new Blob([bytes]), fileName: basename(content.filePath) });
    }
  }
}

export interface DeliveryOptions {
  timeoutMs?: number;
  intervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const SETTLED: ReadonlySet<OutboxStatus> = new Set(["sent", "failed", "expired"]);

/**
 * Sends are queued in the engine's outbox; poll briefly so the toast can say "sent". Still queued
 * at the deadline means WhatsApp is offline and the engine sends it once it reconnects.
 */
export async function waitForDelivery(
  client: OutboxClient,
  outboxId: string,
  { timeoutMs = 6_000, intervalMs = 400, sleep = delay }: DeliveryOptions = {},
): Promise<OutboxEntry> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const entry = await client.outbox(outboxId);
    if (SETTLED.has(entry.status) || Date.now() >= deadline) return entry;
    await sleep(intervalMs);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface DeliveryReport {
  ok: boolean;
  title: string;
  message?: string;
}

export function reportDelivery(entry: OutboxEntry, recipient: string): DeliveryReport {
  switch (entry.status) {
    case "sent":
      return { ok: true, title: `Sent to ${recipient}` };
    case "queued":
    case "sending":
      return {
        ok: true,
        title: `Queued for ${recipient}`,
        message:
          entry.attempts > 0
            ? "The first try failed; the engine keeps retrying for up to an hour."
            : "WhatsApp is offline; the engine sends it when it reconnects (within an hour).",
      };
    case "failed":
      return { ok: false, title: "Failed to send", message: entry.error ?? undefined };
    case "expired":
      return { ok: false, title: "Not sent", message: "WhatsApp stayed offline for an hour." };
  }
}
