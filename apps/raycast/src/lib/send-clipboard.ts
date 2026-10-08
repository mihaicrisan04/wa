import { Clipboard, showToast, Toast } from "@raycast/api";
import { sendToDaemon } from "./daemon-client";
import { readClipboard, describeContent } from "./clipboard-media";

export async function sendClipboardTo(
  port: number,
  phoneNumber: string,
  displayName: string,
): Promise<boolean> {
  const clipboard = await Clipboard.read();
  const content = readClipboard(clipboard.text, clipboard.file);

  if (content.type === "empty") {
    await showToast({ style: Toast.Style.Failure, title: "Nothing in clipboard" });
    return false;
  }

  const label = describeContent(content);
  const toast = await showToast({
    style: Toast.Style.Animated,
    title: `Sending to ${displayName}...`,
  });

  const payload = { phoneNumber } as Record<string, string>;

  switch (content.type) {
    case "url":
      payload.text = content.url;
      break;
    case "text":
      payload.text = content.text;
      break;
    case "file":
    case "image":
      payload.filePath = content.filePath;
      break;
  }

  try {
    await sendToDaemon(port, payload as { text?: string; filePath?: string; phoneNumber: string });
    toast.style = Toast.Style.Success;
    toast.title = `Sent to ${displayName}`;
    toast.message = label;
    return true;
  } catch (err) {
    toast.style = Toast.Style.Failure;
    toast.title = "Failed to send";
    toast.message = err instanceof Error ? err.message : "Is the daemon running?";
    return false;
  }
}
