import { Detail } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import type { Message } from "@wa/sdk";
import { describeEngineError, engineClient } from "../lib/engine";
import { senderLabel } from "../lib/labels";
import { contextMarkdown, errorMarkdown, formatTime } from "../lib/markdown";
import { showErrorToast } from "./error-view";
import { MessageActions } from "./message-actions";

const CONTEXT = 5;

async function loadContext(chat: string, id: string) {
  const client = await engineClient();
  return client.message(chat, id, { context: CONTEXT });
}

/** A search hit with the messages around it. */
export function MessageDetail({ message, chatName }: { message: Message; chatName: string }) {
  const { data, isLoading, error } = usePromise(loadContext, [message.chat, message.id], {
    onError: showErrorToast,
  });

  let markdown = "";
  if (data) markdown = contextMarkdown(data, chatName);
  else if (error) markdown = errorMarkdown(describeEngineError(error));
  const shown = data?.message ?? message;

  return (
    <Detail
      isLoading={isLoading}
      navigationTitle={chatName}
      markdown={markdown}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title="Chat" text={chatName} />
          <Detail.Metadata.Label title="From" text={senderLabel(shown)} />
          <Detail.Metadata.Label title="Sent" text={formatTime(shown.ts)} />
          <Detail.Metadata.Label title="Type" text={shown.type} />
          {shown.fileName ? <Detail.Metadata.Label title="File" text={shown.fileName} /> : null}
          {shown.editedAt ? (
            <Detail.Metadata.Label title="Edited" text={formatTime(shown.editedAt)} />
          ) : null}
        </Detail.Metadata>
      }
      actions={<MessageActions message={shown} chatName={chatName} />}
    />
  );
}
