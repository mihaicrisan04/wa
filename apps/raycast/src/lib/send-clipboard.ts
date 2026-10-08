import { Clipboard, showToast, Toast } from "@raycast/api";
import { describeContent, readClipboard } from "./clipboard-media";
import {
  isOnline,
  reportDelivery,
  sendContent,
  waitForDelivery,
  type SendableContent,
} from "./deliver";
import { engineClient, enginePort } from "./engine";
import { describeError } from "./errors";
import { removeExtractedImages } from "./temp-files";

export interface SendTarget {
  /** "self", or a canonical chat jid. */
  to: string;
  name: string;
}

export async function sendClipboardTo(target: SendTarget): Promise<boolean> {
  const clipboard = await Clipboard.read();
  const content = readClipboard(clipboard.text, clipboard.file);
  if (content.type === "empty") {
    await showToast({ style: Toast.Style.Failure, title: "Nothing in clipboard" });
    return false;
  }
  try {
    return await sendWithToast(target, content);
  } finally {
    await removeExtractedImages([content]);
  }
}

export async function sendWithToast(
  target: SendTarget,
  content: SendableContent,
): Promise<boolean> {
  const toast = await showToast({
    style: Toast.Style.Animated,
    title: `Sending to ${target.name}…`,
    message: describeContent(content),
  });
  try {
    const client = await engineClient();
    const { outboxId } = await sendContent(client, target.to, content);
    const entry = await waitForDelivery(client, outboxId);
    const online = entry.status === "queued" ? await isOnline(client) : true;
    const report = reportDelivery(entry, target.name, online);
    toast.style = report.ok ? Toast.Style.Success : Toast.Style.Failure;
    toast.title = report.title;
    toast.message = report.message ?? describeContent(content);
    return report.ok;
  } catch (error) {
    const { title, message } = describeError(error, enginePort());
    toast.style = Toast.Style.Failure;
    toast.title = title;
    toast.message = message;
    return false;
  }
}
