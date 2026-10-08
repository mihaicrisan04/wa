import { z } from "zod";
import { readStatus } from "../../queries";
import { describeScope, visibleScope } from "../scope";
import { defineTool } from "../tool";
import { isoTime } from "../format";

export const statusTool = defineTool({
  name: "status",
  title: "WhatsApp status",
  description:
    "Connection state, history sync progress and how many chats and messages this token can see.",
  requires: [],
  input: z.object({}),
  output: z.object({
    state: z.string(),
    needsLink: z.boolean(),
    me: z.object({ jid: z.string(), lid: z.string().nullable() }).nullable(),
    history: z.object({
      progress: z.number().nullable(),
      status: z.enum(["complete", "paused"]).nullable(),
      updatedAt: z.number().nullable(),
    }),
    counts: z.object({ chats: z.number(), messages: z.number() }),
    scope: z.object({ allChats: z.boolean(), collections: z.array(z.string()) }),
  }),
  run(_args, env) {
    const current = readStatus(env.read(), env.deps.version, env.deps.connection.status());
    const scope = visibleScope(env.deps.store, env.principal);
    const { history, counts } = current;
    const sync =
      history.status ??
      (history.progress === null ? "not started" : `in progress (${history.progress}%)`);
    return {
      lines: [
        `connection: ${current.state}${current.needsLink ? " (WhatsApp needs to be linked)" : ""}`,
        `linked as: ${current.me?.jid ?? "nobody yet"}`,
        `history sync: ${sync}, last update ${isoTime(history.updatedAt)}`,
        `visible: ${describeScope(scope)}`,
        `visible counts: ${plural(counts.chats, "chat")}, ${plural(counts.messages, "message")}`,
      ],
      structured: {
        state: current.state,
        needsLink: current.needsLink,
        me: current.me,
        history,
        counts,
        scope,
      },
      count: 1,
    };
  },
});

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
