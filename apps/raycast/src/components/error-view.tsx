import { Action, ActionPanel, Icon, List, showToast, Toast } from "@raycast/api";
import { describeEngineError } from "../lib/engine";
import type { ErrorDescription } from "../lib/errors";

export function showErrorToast(error: unknown): void {
  const { title, message } = describeEngineError(error);
  void showToast({ style: Toast.Style.Failure, title, message });
}

export function ErrorView({ title, message, onRetry }: ErrorDescription & { onRetry: () => void }) {
  return (
    <List.EmptyView
      icon={Icon.Warning}
      title={title}
      description={message}
      actions={
        <ActionPanel>
          <Action title="Try Again" icon={Icon.ArrowClockwise} onAction={onRetry} />
        </ActionPanel>
      }
    />
  );
}
