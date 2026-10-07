import {
  CONNECTION_STATES,
  HISTORY_SYNC_STATUSES,
  phaseSummary,
  plural,
  syncSummary,
  type HistorySync,
} from "@wa/sdk";
import { z } from "zod";
import { readStatus } from "../../queries";
import { isoTimeOrNever } from "../format";
import { describeScope, visibleScope } from "../scope";
import { defineTool } from "../tool";

const syncStatus = z.enum(HISTORY_SYNC_STATUSES).nullable();

const historySchema = z.object({
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
}) satisfies z.ZodType<HistorySync>;

export const statusTool = defineTool({
  name: "status",
  title: "WhatsApp status",
  description:
    "Connection state, history sync progress and how many chats and messages this token can see.",
  requires: [],
  input: z.object({}),
  output: z.object({
    state: z.enum(CONNECTION_STATES),
    needsLink: z.boolean(),
    me: z.object({ jid: z.string(), lid: z.string().nullable() }).nullable(),
    history: historySchema,
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
        `history sync: ${syncSummary(history)}, last update ${isoTimeOrNever(history.updatedAt)}`,
        ...(history.phases.length
          ? [`history phases: ${history.phases.map(phaseSummary).join(", ")}`]
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
