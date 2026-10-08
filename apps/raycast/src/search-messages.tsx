import { Action, Icon, List } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import type { SearchHit } from "@wa/sdk";
import { useEffect, useState } from "react";
import { ErrorView, showErrorToast } from "./components/error-view";
import { MessageActions } from "./components/message-actions";
import { MessageDetail } from "./components/message-detail";
import { engineClient, enginePort } from "./lib/engine";
import { describeError } from "./lib/errors";
import { chatTitle, senderLabel } from "./lib/labels";
import { snippetText } from "./lib/markdown";
import { MEDIA_DIR, MEDIA_TTL_MS, pruneStaleFiles } from "./lib/temp-files";

const PAGE_SIZE = 30;
const MIN_QUERY = 2;

function searchPages(query: string) {
  return async ({ cursor }: { cursor?: string | null }) => {
    if (query.trim().length < MIN_QUERY) return { data: [] as SearchHit[], hasMore: false };
    const client = await engineClient();
    const page = await client.search({ q: query, limit: PAGE_SIZE, cursor: cursor ?? undefined });
    return { data: page.items, hasMore: page.nextCursor !== null, cursor: page.nextCursor };
  };
}

function hitChatName(hit: SearchHit): string {
  return chatTitle({ jid: hit.message.chat, name: hit.chatName });
}

const TYPE_ICONS: Record<string, Icon> = {
  image: Icon.Image,
  video: Icon.FilmStrip,
  audio: Icon.Microphone,
  document: Icon.Document,
  sticker: Icon.Emoji,
  location: Icon.Pin,
  contact: Icon.Person,
};

export default function Command() {
  const [query, setQuery] = useState("");
  useEffect(() => void pruneStaleFiles(MEDIA_DIR, MEDIA_TTL_MS), []);
  const { data, isLoading, error, pagination, revalidate } = usePromise(searchPages, [query], {
    onError: showErrorToast,
  });
  const searching = query.trim().length >= MIN_QUERY;

  return (
    <List
      isLoading={isLoading}
      pagination={pagination}
      searchBarPlaceholder="Search messages…"
      onSearchTextChange={setQuery}
      throttle
    >
      {error && !data?.length ? (
        <ErrorView {...describeError(error, enginePort())} onRetry={revalidate} />
      ) : isLoading ? null : (
        <List.EmptyView
          icon={Icon.MagnifyingGlass}
          title={searching ? "No messages found" : "Search your WhatsApp messages"}
          description={searching ? `Nothing matches "${query}"` : "Type at least two letters."}
        />
      )}
      {data?.map((hit) => {
        const chatName = hitChatName(hit);
        const { message } = hit;
        return (
          <List.Item
            key={`${message.chat}/${message.id}`}
            icon={TYPE_ICONS[message.type] ?? Icon.Bubble}
            title={snippetText(hit.snippet)}
            subtitle={chatName}
            accessories={[{ text: senderLabel(message) }, { date: new Date(message.ts * 1000) }]}
            actions={
              <MessageActions
                message={message}
                chatName={chatName}
                primary={
                  <Action.Push
                    title="Show Context"
                    icon={Icon.Eye}
                    target={<MessageDetail message={message} chatName={chatName} />}
                  />
                }
              />
            }
          />
        );
      })}
    </List>
  );
}
