import { homedir } from "node:os";
import { join } from "node:path";
import { Action, ActionPanel, Icon, open, showInFinder, showToast, Toast } from "@raycast/api";
import type { Message } from "@wa/sdk";
import { engineClient, enginePort } from "../lib/engine";
import { describeError } from "../lib/errors";
import {
  cachedMediaPath,
  extensionFor,
  freePath,
  safeFileName,
  saveDownload,
} from "../lib/media-file";
import { MEDIA_DIR, MEDIA_TTL_MS, pruneStaleFiles } from "../lib/temp-files";

function hasDownloadableMedia(message: Message): boolean {
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

/** Downloaded fresh every time, so a message deleted or revoked since isn't served from disk. */
async function openMedia(message: Message): Promise<string> {
  await pruneStaleFiles(MEDIA_DIR, MEDIA_TTL_MS);
  const client = await engineClient();
  const download = await client.downloadMedia(message.chat, message.id);
  const extension = extensionFor(download.fileName ?? message.fileName, download.mimetype);
  const path = cachedMediaPath(MEDIA_DIR, message.chat, message.id, extension);
  await saveDownload(download, path);
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
