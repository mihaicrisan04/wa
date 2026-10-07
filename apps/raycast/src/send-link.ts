import { getPreferenceValues } from "@raycast/api";
import { sendClipboardTo } from "./lib/send-clipboard";

interface Preferences {
  phoneNumber: string;
  daemonPort: string;
}

export default async function Command() {
  const prefs = getPreferenceValues<Preferences>();
  const port = parseInt(prefs.daemonPort) || 7272;
  await sendClipboardTo(port, prefs.phoneNumber, "yourself");
}
