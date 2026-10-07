import { SNIPPET_CLOSE, SNIPPET_OPEN, type Message } from "@wa/sdk";

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

/** `+40700000001` for phone-number jids, the jid otherwise. */
export function who(jid: string | null, name?: string | null): string {
  if (name) return name;
  if (!jid) return "?";
  const phone = /^(\d+)@s\.whatsapp\.net$/.exec(jid)?.[1];
  return phone ? `+${phone}` : jid;
}

/** One line per message, newlines folded so one message can't pass for several. */
export function messageLine(message: Message): string {
  const sender = message.fromMe ? "me" : who(message.sender, message.senderName);
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

export function oneLine(text: string): string {
  return text.replace(/\s*\n\s*/g, " ⏎ ");
}

/** Search highlights: bold on a terminal, `«…»` otherwise. */
export function highlight(snippet: string, isTTY = false): string {
  const [open, close] = isTTY ? ["\u001b[1m", "\u001b[22m"] : ["«", "»"];
  return oneLine(snippet.replaceAll(SNIPPET_OPEN, open).replaceAll(SNIPPET_CLOSE, close));
}
