import { Action, ActionPanel, Detail, Icon } from "@raycast/api";
import { WaApiError, type Qr, type WaClient } from "@wa/sdk";
import QRCode from "qrcode";
import { useCallback, useEffect, useRef, useState } from "react";
import { engineClient, enginePort } from "../lib/engine";
import { describeError, type ErrorDescription } from "../lib/errors";
import { isFinal, linkMarkdown, linkStep, type LinkStep } from "../lib/link-flow";
import { escapeMarkdown } from "../lib/markdown";

const POLL_MS = 2_000;

interface View {
  step: LinkStep;
  qrImage?: string;
  me?: string | null;
}

/** `link()` answers with the new pairing state; already linked is not an error here. */
async function startPairing(client: WaClient): Promise<Qr> {
  try {
    return await client.link();
  } catch (error) {
    if (error instanceof WaApiError && error.code === "already_linked") return client.qr();
    throw error;
  }
}

/** Starts pairing when nothing is linked, then shows QR codes until the link is up. */
export function LinkView() {
  const [view, setView] = useState<View | null>(null);
  const [failure, setFailure] = useState<ErrorDescription | null>(null);
  const pairingStarted = useRef(false);
  const shownQr = useRef<{ qr: string; image: string } | null>(null);

  const poll = useCallback(async (): Promise<LinkStep | null> => {
    try {
      const client = await engineClient();
      let step = linkStep(await client.qr(), pairingStarted.current);
      if (step.kind === "start") {
        pairingStarted.current = true;
        step = linkStep(await startPairing(client), true);
      }
      const next: View = { step };
      if (step.kind === "qr") {
        if (shownQr.current?.qr !== step.qr) {
          const image = await QRCode.toDataURL(step.qr, { width: 512, margin: 2 });
          shownQr.current = { qr: step.qr, image };
        }
        next.qrImage = shownQr.current?.image;
      }
      if (step.kind === "linked") next.me = (await client.status()).me?.jid ?? null;
      setFailure(null);
      setView(next);
      return step;
    } catch (error) {
      setFailure(describeError(error, enginePort()));
      return null;
    }
  }, []);

  const [round, setRound] = useState(0);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const tick = async () => {
      const step = await poll();
      if (!cancelled && !(step && isFinal(step))) timer = setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [poll, round]);

  const restart = () => {
    pairingStarted.current = false;
    setView(null);
    setRound((value) => value + 1);
  };

  const markdown = failure
    ? `# ${escapeMarkdown(failure.title)}\n\n${escapeMarkdown(failure.message)}`
    : view
      ? linkMarkdown(view.step, view)
      : "";

  return (
    <Detail
      isLoading={!view && !failure}
      markdown={markdown}
      actions={
        <ActionPanel>
          {view?.step.kind === "stopped" || failure ? (
            <Action title="Start Again" icon={Icon.ArrowClockwise} onAction={restart} />
          ) : (
            <Action
              title="Refresh"
              icon={Icon.ArrowClockwise}
              shortcut={{ modifiers: ["cmd"], key: "r" }}
              onAction={restart}
            />
          )}
        </ActionPanel>
      }
    />
  );
}
