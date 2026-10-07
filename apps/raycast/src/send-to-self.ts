import { sendClipboardTo } from "./lib/send-clipboard";

export default async function Command() {
  await sendClipboardTo({ to: "self", name: "yourself" });
}
