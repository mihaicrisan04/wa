import { openAsBlob } from "node:fs";
import { basename } from "node:path";
import type { OutboxEntry, OutboxStatus, SendResult, WaClient } from "@wa/sdk";
import type { ClipboardContent } from "./clipboard-media";

export type SendableContent = Exclude<ClipboardContent, { type: "empty" }>;

type SendClient = Pick<WaClient, "send" | "sendFile">;
type OutboxClient = Pick<WaClient, "outbox">;
type StatusClient = Pick<WaClient, "status">;

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
      // streamed from disk: a file up to WhatsApp's 2 GB cap never has to fit in memory
      const file = await openAsBlob(content.filePath);
      return client.sendFile({ to, file, fileName: basename(content.filePath) });
    }
  }
}

export interface DeliveryOptions {
  timeoutMs?: number;
  intervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const SETTLED: ReadonlySet<OutboxStatus> = new Set(["sent", "failed", "expired"]);

/** Sends are queued in the engine's outbox; poll briefly so the toast can say "sent". */
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

/** Only asked when an entry is still queued, to tell "offline" from "waiting its turn". */
export async function isOnline(client: StatusClient): Promise<boolean> {
  return client.status().then(
    (status) => status.state === "open",
    () => false,
  );
}

export function reportDelivery(
  entry: OutboxEntry,
  recipient: string,
  online: boolean,
): DeliveryReport {
  switch (entry.status) {
    case "sent":
      return { ok: true, title: `Sent to ${recipient}` };
    case "sending":
      return {
        ok: true,
        title: `Still sending to ${recipient}`,
        message: "The engine finishes it in the background.",
      };
    case "queued":
      return { ok: true, title: `Queued for ${recipient}`, message: queuedReason(entry, online) };
    case "failed":
      return { ok: false, title: "Failed to send", message: entry.error ?? undefined };
    case "expired":
      return { ok: false, title: "Not sent", message: "WhatsApp stayed offline for an hour." };
  }
}

function queuedReason(entry: OutboxEntry, online: boolean): string {
  if (entry.attempts > 0) return "A try failed; the engine keeps retrying for up to an hour.";
  if (!online)
    return "WhatsApp is offline; the engine sends it when it reconnects (within an hour).";
  return "Waiting behind other messages in the outbox.";
}
