import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { Action, ActionPanel, Icon, open, showInFinder, showToast, Toast } from "@raycast/api";
import type { Message } from "@wa/sdk";
import { engineClient, enginePort } from "../lib/engine";
import { describeError } from "../lib/errors";
import {
  cachedMediaPath,
  exists,
  extensionFor,
  freePath,
  safeFileName,
  saveDownload,
} from "../lib/media-file";

const CACHE_DIR = join(tmpdir(), "wa-raycast");

export function hasDownloadableMedia(message: Message): boolean {
  return message.hasMedia && !message.viewOnce && !message.deletedAt;
}

export function MediaActions({ message }: { message: Message }) {
  if (!hasDownloadableMedia(message)) return null;
  return (
    <ActionPanel.Section title="Media">
      <Action
        title="Open Media"
        icon={Icon.Eye}
        shortcut={{ modifiers: ["cmd"], key: "o" }}
        onAction={() => withToast("Opening media…", () => openMedia(message))}
      />
      <Action
        title="Save Media to Downloads"
        icon={Icon.Download}
        shortcut={{ modifiers: ["cmd"], key: "s" }}
        onAction={() => withToast("Saving media…", () => saveMedia(message))}
      />
    </ActionPanel.Section>
  );
}

async function openMedia(message: Message): Promise<string> {
  const client = await engineClient();
  const info = await client.media(message.chat, message.id);
  const path = cachedMediaPath(
    CACHE_DIR,
    message.chat,
    message.id,
    extensionFor(info.fileName, info.mimetype),
  );
  if (!(await exists(path)))
    await saveDownload(await client.downloadMedia(message.chat, message.id), path);
  await open(path);
  return "Opened";
}

async function saveMedia(message: Message): Promise<string> {
  const client = await engineClient();
  const download = await client.downloadMedia(message.chat, message.id);
  const extension = extensionFor(download.fileName ?? message.fileName, download.mimetype);
  const fallback = `whatsapp-${message.type}-${message.ts}${extension}`;
  let name = safeFileName(download.fileName ?? message.fileName, fallback);
  if (!name.toLowerCase().endsWith(extension)) name += extension;
  const path = await freePath(join(homedir(), "Downloads"), name);
  await saveDownload(download, path);
  await showInFinder(path);
  return `Saved ${name}`;
}

async function withToast(title: string, run: () => Promise<string>): Promise<void> {
  const toast = await showToast({ style: Toast.Style.Animated, title });
  try {
    toast.title = await run();
    toast.style = Toast.Style.Success;
  } catch (error) {
    const description = describeError(error, enginePort());
    toast.style = Toast.Style.Failure;
    toast.title = description.title;
    toast.message = description.message;
  }
}
