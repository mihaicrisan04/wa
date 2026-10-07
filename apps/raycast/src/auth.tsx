import { Action, ActionPanel, Detail, getPreferenceValues } from "@raycast/api";
import { useEffect, useState } from "react";
import QRCode from "qrcode";

interface Preferences {
  phoneNumber: string;
  daemonPort: string;
}

interface AuthState {
  qrDataUrl: string | null;
  connected: boolean;
  phoneNumber: string | null;
  error: string | null;
}

export default function Command() {
  const [state, setState] = useState<AuthState>({
    qrDataUrl: null,
    connected: false,
    phoneNumber: null,
    error: null,
  });
  const [isLoading, setIsLoading] = useState(true);
  const prefs = getPreferenceValues<Preferences>();
  const port = parseInt(prefs.daemonPort) || 7272;

  async function poll() {
    try {
      const statusRes = await fetch(`http://localhost:${port}/status`);
      if (!statusRes.ok) throw new Error("daemon unreachable");
      const status = (await statusRes.json()) as { connected: boolean; phoneNumber: string | null };

      if (status.connected) {
        setState({
          qrDataUrl: null,
          connected: true,
          phoneNumber: status.phoneNumber,
          error: null,
        });
        setIsLoading(false);
        return;
      }

      const qrRes = await fetch(`http://localhost:${port}/qr`);
      const qrData = (await qrRes.json()) as { qr: string | null };

      if (qrData.qr) {
        const dataUrl = await QRCode.toDataURL(qrData.qr, { width: 512, margin: 2 });
        setState({ qrDataUrl: dataUrl, connected: false, phoneNumber: null, error: null });
      } else {
        setState({ qrDataUrl: null, connected: false, phoneNumber: null, error: null });
      }
    } catch {
      setState({
        qrDataUrl: null,
        connected: false,
        phoneNumber: null,
        error: "daemon not running",
      });
    }
    setIsLoading(false);
  }

  useEffect(() => {
    poll();
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, []);

  let markdown: string;

  if (state.error) {
    markdown = `# WhatsApp Auth\n\nDaemon is not running. Start it first:\n\n\`\`\`bash\ncd daemon && node index.js\n\`\`\``;
  } else if (state.connected) {
    markdown = `# Connected\n\nWhatsApp is connected as **${state.phoneNumber}**.\n\nYou're all set — close this and use "Send Link to WhatsApp".`;
  } else if (state.qrDataUrl) {
    markdown = `# Scan QR Code\n\nOpen WhatsApp on your phone:\n**Settings > Linked Devices > Link a Device**\n\n![QR Code](${state.qrDataUrl}?raycast-height=350)`;
  } else {
    markdown = `# Connecting...\n\nWaiting for QR code from daemon...`;
  }

  return (
    <Detail
      isLoading={isLoading}
      markdown={markdown}
      actions={
        <ActionPanel>
          <Action title="Refresh" onAction={poll} />
        </ActionPanel>
      }
    />
  );
}
