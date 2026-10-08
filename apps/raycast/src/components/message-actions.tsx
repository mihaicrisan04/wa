import { Action, ActionPanel, Icon } from "@raycast/api";
import type { Message } from "@wa/sdk";
import type { ReactNode } from "react";
import { sendClipboardTo } from "../lib/send-clipboard";
import { MediaActions } from "./media-actions";

/** Shared by a search hit and its context view; `primary` goes first so it owns ↵. */
export function MessageActions({
  message,
  chatName,
  primary,
}: {
  message: Message;
  chatName: string;
  primary?: ReactNode;
}) {
  const text = message.text ?? message.caption;
  return (
    <ActionPanel>
      {primary}
      {text && !message.deletedAt ? (
        <Action.CopyToClipboard title="Copy Text" content={text} />
      ) : null}
      <MediaActions message={message} />
      <ActionPanel.Section title="Chat">
        <Action
          title={`Send Clipboard to ${chatName}`}
          icon={Icon.Message}
          shortcut={{ modifiers: ["cmd", "shift"], key: "enter" }}
          onAction={() => sendClipboardTo({ to: message.chat, name: chatName })}
        />
        <Action.CopyToClipboard
          title="Copy Chat ID"
          content={message.chat}
          shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
        />
      </ActionPanel.Section>
    </ActionPanel>
  );
}
