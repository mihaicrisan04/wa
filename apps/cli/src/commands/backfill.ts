import { parseArgs } from "node:util";
import { BACKFILL_DEFAULT_MAX, type BackfillJob } from "@wa/sdk";
import { EXIT_FAILURE, UsageError, type Command, type CommandIO } from "../command";
import { engineClient } from "../engine-client";
import { json, time, who } from "../output";
import { positiveInt } from "./chats";

const POLL_MS = 1_000;

export const backfill: Command = {
  name: "backfill",
  summary: "ask the phone for a chat's older messages",
  async run(args, io) {
    const { values, positionals } = parseArgs({
      args,
      options: {
        max: { type: "string" },
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
      allowPositionals: true,
      strict: true,
    });
    if (values.help) {
      io.out(
        `usage: wa backfill <chat> [--max n] [--json]\n\nAsks the phone for messages older than the oldest one stored, 50 at a time,\nuntil it has nothing older or --max (default ${BACKFILL_DEFAULT_MAX}) are stored. The phone must be\nonline. <chat> is a jid, a phone number or a unique part of the chat's name.`,
      );
      return 0;
    }
    const chat = positionals.join(" ");
    if (!chat) throw new UsageError("which chat? (a jid, a phone number or a name)");
    const max = values.max === undefined ? undefined : positiveInt(values.max, "--max");

    const wa = engineClient(io.env);
    let job = await wa.admin.backfill.start({ chat, max });
    if (!values.json) {
      io.out(
        `asking the phone for up to ${job.max} older messages of ${who(job.chat, job.chatName)}`,
      );
    }
    let shown = job.fetched;
    while (job.state === "running") {
      await Bun.sleep(io.pollMs ?? POLL_MS);
      job = await wa.admin.backfill.get(job.id);
      if (!values.json && job.fetched !== shown) {
        shown = job.fetched;
        io.out(`${job.fetched} so far, back to ${time(job.oldestAt)}`);
      }
    }
    if (values.json) io.out(json(job));
    else report(job, io);
    return FAILED.has(job.stopReason) ? EXIT_FAILURE : 0;
  },
};

const FAILED: ReadonlySet<BackfillJob["stopReason"]> = new Set([
  "no_anchor",
  "disconnected",
  "stopped",
  "failed",
]);

function report(job: BackfillJob, io: CommandIO): void {
  const fetched = `fetched ${job.fetched} older message${job.fetched === 1 ? "" : "s"}`;
  const oldest = job.oldestAt ? `; the oldest stored is from ${time(job.oldestAt)}` : "";
  switch (job.stopReason) {
    case "max":
      return io.out(`${fetched} (the --max of ${job.max})${oldest}`);
    case "empty":
      return io.out(`${fetched}; the phone has nothing older${oldest}`);
    case "timeout":
      return io.out(
        `${fetched}; the phone stopped answering (is it online? run it again to continue)${oldest}`,
      );
    case "no_anchor":
      return io.err(
        "wa backfill: nothing stored in this chat yet, so there is nothing to page back from",
      );
    case "disconnected":
      return io.err(
        `wa backfill: WhatsApp disconnected after ${job.fetched} messages; run it again once it is back`,
      );
    case "stopped":
      return io.err(`wa backfill: the engine stopped after ${job.fetched} messages`);
    default:
      return io.err(`wa backfill: failed after ${job.fetched} messages (see the engine log)`);
  }
}
