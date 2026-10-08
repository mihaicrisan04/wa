import { Action, ActionPanel, Icon, List } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { phoneOf, type ChatKind } from "@wa/sdk";
import { useState } from "react";
import { describeContent } from "../lib/clipboard-media";
import type { SendableContent } from "../lib/deliver";
import { describeEngineError, engineClient } from "../lib/engine";
import { chatTitle, kindLabel } from "../lib/labels";
import { sendClipboardTo, sendWithToast, type SendTarget } from "../lib/send-clipboard";
import { ErrorView, showErrorToast } from "./error-view";

const LIMIT = 50;

const KIND_ICONS: Record<ChatKind, Icon> = {
  dm: Icon.Person,
  group: Icon.TwoPeople,
  self: Icon.Star,
  broadcast: Icon.Bubble,
  newsletter: Icon.Bubble,
  other: Icon.Bubble,
};

async function loadRecipients(query: string) {
  const client = await engineClient();
  return client.recipients({ q: query.trim() || undefined, limit: LIMIT });
}

/** Contacts and groups by recency; sends `content` when given, else whatever is on the clipboard. */
export function RecipientList({ content }: { content?: SendableContent }) {
  const [query, setQuery] = useState("");
  const { data, isLoading, error, revalidate } = usePromise(loadRecipients, [query], {
    onError: showErrorToast,
  });

  const send = (target: SendTarget) =>
    content ? sendWithToast(target, content) : sendClipboardTo(target);

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder={content ? `Send ${describeContent(content)} to…` : "Search chats…"}
      onSearchTextChange={setQuery}
      throttle
    >
      {error && !data ? (
        <ErrorView {...describeEngineError(error)} onRetry={revalidate} />
      ) : isLoading ? null : (
        <List.EmptyView
          title={query ? "No matching chats" : "No chats yet"}
          description={query ? `Nothing matches "${query}"` : "Chats show up once WhatsApp syncs."}
        />
      )}
      {data?.map((recipient) => {
        const title = chatTitle(recipient);
        return (
          <List.Item
            key={recipient.jid}
            icon={KIND_ICONS[recipient.kind]}
            title={title}
            subtitle={
              recipient.kind === "dm" && recipient.name ? (phoneOf(recipient.jid) ?? "") : ""
            }
            accessories={[
              { tag: kindLabel(recipient.kind) },
              ...(recipient.lastMessageAt
                ? [{ date: new Date(recipient.lastMessageAt * 1000) }]
                : []),
            ]}
            actions={
              <ActionPanel>
                <Action
                  title={content ? "Send" : "Send Clipboard"}
                  icon={Icon.Message}
                  onAction={() => send({ to: recipient.jid, name: title })}
                />
                <Action.CopyToClipboard title="Copy Chat ID" content={recipient.jid} />
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}
