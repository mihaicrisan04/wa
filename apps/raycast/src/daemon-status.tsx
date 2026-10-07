import { Action, ActionPanel, Detail, getPreferenceValues } from "@raycast/api";
import { createWaClient } from "@wa/sdk";
import { useEffect, useState } from "react";

interface Preferences {
  phoneNumber: string;
  daemonPort: string;
}

interface DaemonInfo {
  status: "connected" | "disconnected" | "unreachable";
  phoneNumber?: string;
  engineVersion?: string;
}

async function waEngineVersion(): Promise<string | undefined> {
  try {
    return (await createWaClient({ timeoutMs: 2000 }).health()).version;
  } catch {
    return undefined;
  }
}

export default function Command() {
  const [info, setInfo] = useState<DaemonInfo>({ status: "unreachable" });
  const [isLoading, setIsLoading] = useState(true);
  const prefs = getPreferenceValues<Preferences>();
  const port = parseInt(prefs.daemonPort) || 7272;

  async function checkStatus() {
    setIsLoading(true);
    const engineVersion = await waEngineVersion();
    try {
      const res = await fetch(`http://localhost:${port}/status`);
      if (res.ok) {
        const data = (await res.json()) as { connected: boolean; phoneNumber?: string };
        setInfo({
          status: data.connected ? "connected" : "disconnected",
          phoneNumber: data.phoneNumber,
          engineVersion,
        });
      } else {
        setInfo({ status: "unreachable", engineVersion });
      }
    } catch {
      setInfo({ status: "unreachable", engineVersion });
    }
    setIsLoading(false);
  }

  useEffect(() => {
    checkStatus();
  }, []);

  const statusEmoji =
    info.status === "connected" ? "🟢" : info.status === "disconnected" ? "🟡" : "🔴";

  const markdown = `
# WhatsApp Daemon Status

**Status:** ${statusEmoji} ${info.status}
${info.phoneNumber ? `**Phone:** ${info.phoneNumber}` : ""}
**wa engine:** ${info.engineVersion ? `running (v${info.engineVersion})` : "not running"}

${info.status === "unreachable" ? "Start the daemon with:\n```bash\ncd daemon && node index.js\n```" : ""}
${info.status === "disconnected" ? "Scan the QR code in the daemon terminal to connect." : ""}
  `.trim();

  return (
    <Detail
      isLoading={isLoading}
      markdown={markdown}
      actions={
        <ActionPanel>
          <Action title="Refresh" onAction={checkStatus} />
        </ActionPanel>
      }
    />
  );
}
