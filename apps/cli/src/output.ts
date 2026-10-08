import { phoneOf, SNIPPET_CLOSE, SNIPPET_OPEN, type Message } from "@wa/sdk";

/** Left-aligned columns, two spaces apart; the last column is not padded. */
export function table(rows: string[][]): string[] {
  const widths = rows[0]?.map((_, column) => Math.max(...rows.map((row) => row[column]!.length)));
  return rows.map((row) =>
    row
      .map((cell, column) => (column === row.length - 1 ? cell : cell.padEnd(widths![column]!)))
      .join("  ")
      .trimEnd(),
  );
}

export function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

const pad = (value: number) => String(value).padStart(2, "0");

/** Local time, `YYYY-MM-DD HH:MM`. */
export function time(unixSeconds: number | null | undefined): string {
  if (!unixSeconds) return "";
  const date = new Date(unixSeconds * 1000);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The name, else `+40700000001` for phone-number jids, else the jid. */
export function who(jid: string | null, name?: string | null): string {
  if (name) return oneLine(name);
  if (!jid) return "?";
  return phoneOf(jid) ?? jid;
}

export function senderOf(message: Message): string {
  return message.fromMe ? "me" : who(message.sender, message.senderName);
}

/** One line per message, so one message can't pass for several. */
export function messageLine(message: Message): string {
  const sender = senderOf(message);
  const body =
    message.deletedAt !== null
      ? "(deleted)"
      : [
          message.type !== "text" ? `[${message.type}]` : "",
          message.fileName ?? "",
          message.text ?? message.caption ?? "",
        ]
          .filter(Boolean)
          .join(" ");
  const quote = message.quoted?.text ? ` (replying to "${oneLine(message.quoted.text)}")` : "";
  return `[${time(message.ts)}] ${sender}: ${oneLine(body)}${quote}${message.editedAt ? " (edited)" : ""}`;
}

// C0/C1 controls (\r, ANSI/OSC escapes) and bidi overrides could redraw or disguise terminal output.
// oxlint-disable-next-line no-control-regex
const UNPRINTABLE = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;

/** Sender-controlled text made safe for a terminal: newlines folded, control characters shown as `�`. */
function oneLine(text: string): string {
  return text
    .replace(/\s*[\n\r]+\s*/g, " ⏎ ")
    .replace(/\t/g, " ")
    .replace(UNPRINTABLE, "\ufffd");
}

/** Search highlights: bold on a terminal, `«…»` otherwise. */
export function highlight(snippet: string, isTTY = false): string {
  const [open, close] = isTTY ? ["\u001b[1m", "\u001b[22m"] : ["«", "»"];
  return snippet
    .split(SNIPPET_OPEN)
    .map((part) => part.split(SNIPPET_CLOSE).map(oneLine).join(close))
    .join(open);
}
