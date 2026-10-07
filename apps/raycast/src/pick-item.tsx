import { Action, ActionPanel, Clipboard, Icon, List } from "@raycast/api";
import { useEffect, useState } from "react";
import { RecipientList } from "./components/recipient-list";
import { describeContent, readClipboard } from "./lib/clipboard-media";
import type { SendableContent } from "./lib/deliver";
import { sendWithToast } from "./lib/send-clipboard";

/** Raycast keeps the current clipboard plus five earlier entries. */
const HISTORY_DEPTH = 5;

interface ClipboardEntry {
  content: SendableContent;
  offset: number;
}

async function loadEntries(): Promise<ClipboardEntry[]> {
  const entries: ClipboardEntry[] = [];
  for (let offset = 0; offset <= HISTORY_DEPTH; offset++) {
    const { text, file } = await Clipboard.read({ offset }).catch(() => ({
      text: undefined,
      file: undefined,
    }));
    const content = readClipboard(text, file, { pasteboardImage: offset === 0 });
    if (content.type !== "empty") entries.push({ content, offset });
  }
  return entries;
}

const ICONS: Record<SendableContent["type"], Icon> = {
  url: Icon.Link,
  text: Icon.Text,
  file: Icon.Document,
  image: Icon.Image,
};

const TAGS: Record<SendableContent["type"], string> = {
  url: "link",
  text: "text",
  file: "file",
  image: "image",
};

function ago(offset: number): string {
  if (offset === 0) return "Current";
  return `${offset} ${offset === 1 ? "copy" : "copies"} ago`;
}

export default function Command() {
  const [entries, setEntries] = useState<ClipboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    void loadEntries().then((found) => {
      setEntries(found);
      setIsLoading(false);
    });
  }, []);

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Pick something to send to WhatsApp">
      {entries.map(({ content, offset }) => (
        <List.Item
          key={offset}
          icon={ICONS[content.type]}
          title={describeContent(content)}
          subtitle={ago(offset)}
          accessories={[{ tag: TAGS[content.type] }]}
          actions={
            <ActionPanel>
              <Action
                title="Send to Yourself"
                icon={Icon.Message}
                onAction={() => sendWithToast({ to: "self", name: "yourself" }, content)}
              />
              <Action.Push
                title="Send to Chat…"
                icon={Icon.TwoPeople}
                shortcut={{ modifiers: ["cmd"], key: "enter" }}
                target={<RecipientList content={content} />}
              />
            </ActionPanel>
          }
        />
      ))}
      {!isLoading && (
        <List.EmptyView title="Nothing in clipboard history" description="Copy something first" />
      )}
    </List>
  );
}
