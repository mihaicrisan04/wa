import {
  Action,
  ActionPanel,
  Clipboard,
  Icon,
  List,
  showToast,
  Toast,
  getPreferenceValues,
} from "@raycast/api";
import { useEffect, useState } from "react";
import { sendToDaemon } from "./lib/daemon-client";
import { readClipboard, describeContent, type ClipboardContent } from "./lib/clipboard-media";

interface Preferences {
  phoneNumber: string;
  daemonPort: string;
}

interface ClipboardEntry {
  content: ClipboardContent;
  offset: number;
}

function iconForType(type: ClipboardContent["type"]): Icon {
  switch (type) {
    case "url":
      return Icon.Link;
    case "text":
      return Icon.Text;
    case "file":
      return Icon.Document;
    case "image":
      return Icon.Image;
    default:
      return Icon.QuestionMark;
  }
}

function tagForType(type: ClipboardContent["type"]): string {
  switch (type) {
    case "url":
      return "link";
    case "text":
      return "text";
    case "file":
      return "file";
    case "image":
      return "image";
    default:
      return "";
  }
}

export default function Command() {
  const [entries, setEntries] = useState<ClipboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const prefs = getPreferenceValues<Preferences>();
  const port = parseInt(prefs.daemonPort) || 7272;

  useEffect(() => {
    async function loadClipboard() {
      const found: ClipboardEntry[] = [];

      for (let offset = 0; offset <= 5; offset++) {
        try {
          const { text, file } = await Clipboard.read({ offset });
          const content = readClipboard(text, file);
          if (content.type !== "empty") {
            found.push({ content, offset });
          }
        } catch {
          // offset not available
        }
      }

      setEntries(found);
      setIsLoading(false);
    }
    loadClipboard();
  }, []);

  async function handleSend(entry: ClipboardEntry) {
    const { content } = entry;
    const label = describeContent(content);

    const payload = { phoneNumber: prefs.phoneNumber } as Record<string, string>;
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

    const toast = await showToast({ style: Toast.Style.Animated, title: "Sending to WhatsApp..." });
    try {
      await sendToDaemon(
        port,
        payload as { text?: string; filePath?: string; phoneNumber: string },
      );
      toast.style = Toast.Style.Success;
      toast.title = "Sent to WhatsApp";
      toast.message = label;
    } catch (err) {
      toast.style = Toast.Style.Failure;
      toast.title = "Failed to send";
      toast.message = err instanceof Error ? err.message : "Is the daemon running?";
    }
  }

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Pick something to send to WhatsApp">
      {entries.map((entry) => (
        <List.Item
          key={entry.offset}
          icon={iconForType(entry.content.type)}
          title={describeContent(entry.content)}
          subtitle={
            entry.offset === 0
              ? "Current"
              : `${entry.offset} ${entry.offset === 1 ? "copy" : "copies"} ago`
          }
          accessories={[{ tag: tagForType(entry.content.type) }]}
          actions={
            <ActionPanel>
              <Action title="Send to WhatsApp" onAction={() => handleSend(entry)} />
            </ActionPanel>
          }
        />
      ))}
      {!isLoading && entries.length === 0 && (
        <List.EmptyView title="Nothing in clipboard history" description="Copy something first" />
      )}
    </List>
  );
}
