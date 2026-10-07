import type { HistoryPhase, HistorySync } from "@wa/sdk";
import { z } from "zod";
import { readStatus } from "../../queries";
import { describeScope, visibleScope } from "../scope";
import { defineTool } from "../tool";
import { isoTime } from "../format";

const syncStatus = z.enum(["complete", "paused"]).nullable();

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
      status: syncStatus,
      updatedAt: z.number().nullable(),
      phases: z.array(
        z.object({
          syncType: z.string(),
          progress: z.number().nullable(),
          status: syncStatus,
          chunks: z.number(),
          updatedAt: z.number(),
        }),
      ),
    }),
    counts: z.object({ chats: z.number(), messages: z.number() }),
    scope: z.object({ allChats: z.boolean(), collections: z.array(z.string()) }),
  }),
  run(_args, env) {
    const current = readStatus(env.read(), env.deps.version, env.deps.connection.status());
    const scope = visibleScope(env.deps.store, env.principal);
    const { history, counts } = current;
    return {
      lines: [
        `connection: ${current.state}${current.needsLink ? " (WhatsApp needs to be linked)" : ""}`,
        `linked as: ${current.me?.jid ?? "nobody yet"}`,
        `history sync: ${describeSync(history)}, last update ${isoTime(history.updatedAt)}`,
        ...(history.phases.length
          ? [`history phases: ${history.phases.map(describePhase).join(", ")}`]
          : []),
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

function describeSync(history: HistorySync): string {
  const progress = history.progress === null ? "" : ` (${history.progress}%)`;
  if (history.status) return `${history.status}${history.status === "paused" ? progress : ""}`;
  return history.phases.length ? `in progress${progress}` : "not started";
}

function describePhase(phase: HistoryPhase): string {
  if (phase.status) return `${phase.syncType} ${phase.status}`;
  if (phase.progress !== null) return `${phase.syncType} ${phase.progress}%`;
  return `${phase.syncType} ${plural(phase.chunks, "chunk")}`;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
