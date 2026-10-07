import { Action, ActionPanel, Detail, Icon } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useEffect } from "react";
import { LinkView } from "./components/link-view";
import { engineClient, enginePort } from "./lib/engine";
import { describeError } from "./lib/errors";
import { escapeMarkdown } from "./lib/markdown";
import { needsLink, statusMarkdown, statusRows } from "./lib/status-view";

const REFRESH_MS = 5_000;

async function loadStatus() {
  return (await engineClient()).status();
}

export default function Command() {
  const { data, error, isLoading, revalidate } = usePromise(loadStatus, [], {
    onError: () => undefined,
  });
  const port = enginePort();

  useEffect(() => {
    const timer = setInterval(revalidate, REFRESH_MS);
    return () => clearInterval(timer);
  }, [revalidate]);

  let markdown = "";
  if (error) {
    const { title, message } = describeError(error, port);
    markdown = `# ${escapeMarkdown(title)}\n\n${escapeMarkdown(message)}`;
  } else if (data) {
    markdown = statusMarkdown(data);
  }

  const refresh = (
    <Action
      title="Refresh"
      icon={Icon.ArrowClockwise}
      shortcut={{ modifiers: ["cmd"], key: "r" }}
      onAction={revalidate}
    />
  );

  return (
    <Detail
      isLoading={isLoading}
      markdown={markdown}
      metadata={
        data && !error ? (
          <Detail.Metadata>
            {statusRows(data, port).map((row) => (
              <Detail.Metadata.Label key={row.title} title={row.title} text={row.text} />
            ))}
          </Detail.Metadata>
        ) : undefined
      }
      actions={
        <ActionPanel>
          {data && needsLink(data) ? (
            <Action.Push title="Link WhatsApp" icon={Icon.Link} target={<LinkView />} />
          ) : null}
          {refresh}
          {data?.me ? (
            <Action.CopyToClipboard title="Copy Own Chat ID" content={data.me.jid} />
          ) : null}
        </ActionPanel>
      }
    />
  );
}
