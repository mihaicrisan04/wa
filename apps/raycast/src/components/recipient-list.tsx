import { Action, ActionPanel, Icon, List } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import type { Recipient } from "@wa/sdk";
import { useState } from "react";
import { describeContent } from "../lib/clipboard-media";
import type { SendableContent } from "../lib/deliver";
import { engineClient, enginePort } from "../lib/engine";
import { describeError } from "../lib/errors";
import { chatTitle, kindLabel, phoneOf } from "../lib/labels";
import { sendClipboardTo, sendWithToast, type SendTarget } from "../lib/send-clipboard";
import { ErrorView, showErrorToast } from "./error-view";

const LIMIT = 50;

async function loadRecipients(query: string): Promise<Recipient[]> {
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
        <ErrorView {...describeError(error, enginePort())} onRetry={revalidate} />
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
            icon={iconFor(recipient)}
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

function iconFor(recipient: Recipient): Icon {
  switch (recipient.kind) {
    case "group":
      return Icon.TwoPeople;
    case "self":
      return Icon.Star;
    case "dm":
      return Icon.Person;
    default:
      return Icon.Bubble;
  }
}
