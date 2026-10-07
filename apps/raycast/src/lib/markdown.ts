import { SNIPPET_CLOSE, SNIPPET_OPEN, type Message, type MessageContext } from "@wa/sdk";
import { senderLabel } from "./labels";

const INVISIBLE =
  // oxlint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;

/** Control characters and bidi overrides, which could disguise what a message says. */
export function stripInvisible(text: string): string {
  return text.replace(INVISIBLE, "");
}

/**
 * Message content is untrusted: escaping every markdown character keeps `![](url)` from loading a
 * remote image and fake headings or links from rendering.
 */
export function escapeMarkdown(text: string): string {
  return stripInvisible(text)
    .replace(/[\\`*_{}[\]()#+\-.!|<>~=]/g, "\\$&")
    .replace(/\r\n?/g, "\n")
    .replace(/\n/g, "  \n");
}

/** Plain one-line text of a search snippet, for list titles. */
export function snippetText(snippet: string): string {
  const plain = snippet.replaceAll(SNIPPET_OPEN, "").replaceAll(SNIPPET_CLOSE, "");
  return stripInvisible(plain).replace(/\s+/g, " ").trim();
}

const TIME_FORMAT = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

export function formatTime(ts: number): string {
  return TIME_FORMAT.format(new Date(ts * 1000));
}

function bodyMarkdown(message: Message): string {
  if (message.deletedAt) return "_deleted_";
  const parts: string[] = [];
  if (message.hasMedia || message.fileName) {
    const file = message.fileName ? ` ${escapeMarkdown(message.fileName)}` : "";
    parts.push(`_${escapeMarkdown(message.type)}_${file}${message.viewOnce ? " (view once)" : ""}`);
  }
  const text = message.text ?? message.caption;
  if (text) parts.push(escapeMarkdown(text));
  if (parts.length === 0) parts.push(`_${escapeMarkdown(message.type)}_`);
  if (message.editedAt) parts.push("_(edited)_");
  return parts.join("  \n");
}

function quoteMarkdown(message: Message): string | null {
  const text = message.quoted?.text;
  if (!text) return null;
  return text
    .split(/\r?\n/)
    .map((line) => `> ${escapeMarkdown(line)}`)
    .join("\n");
}

export function messageMarkdown(message: Message): string {
  const header = `**${escapeMarkdown(senderLabel(message))}** · ${formatTime(message.ts)}`;
  return [header, quoteMarkdown(message), bodyMarkdown(message)]
    .filter((part): part is string => part !== null)
    .join("\n\n");
}

/** The hit between the messages around it, separated by rules and marked with a heading. */
export function contextMarkdown(context: MessageContext, chatName: string): string {
  const sections = [
    `# ${escapeMarkdown(chatName)}`,
    ...context.before.map(messageMarkdown),
    `### Match\n\n${messageMarkdown(context.message)}`,
    ...context.after.map(messageMarkdown),
  ];
  return sections.join("\n\n---\n\n");
}
