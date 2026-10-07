import { BACKFILL_DEFAULT_MAX, plural, type BackfillJob } from "@wa/sdk";
import { positiveInt } from "../args";
import { EXIT_FAILURE, FailureError, UsageError } from "../command";
import { defineCommand } from "../define";
import { engineClient } from "../engine-client";
import { json, time, who } from "../output";

const POLL_MS = 1_000;

export const backfill = defineCommand({
  name: "backfill",
  summary: "ask the phone for a chat's older messages",
  usage: "wa backfill <chat> [--max n] [--json]",
  description: `Asks the phone for messages older than the oldest one stored, 50 at a time,\nuntil it has nothing older or --max (default ${BACKFILL_DEFAULT_MAX}) are stored. The phone must be\nonline. <chat> is a jid, a phone number or a unique part of the chat's name.`,
  options: {
    max: { type: "string" },
    json: { type: "boolean" },
  },
  variadic: true,
  async run({ values, positionals }, io) {
    const chat = positionals.join(" ");
    if (!chat) throw new UsageError("which chat? (a jid, a phone number or a name)");
    const max = positiveInt(values.max, "--max");

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
    const failure = failureOf(job);
    if (values.json) {
      io.out(json(job));
      return failure ? EXIT_FAILURE : 0;
    }
    if (failure) throw new FailureError(failure);
    io.out(summaryOf(job));
    return 0;
  },
});

/** Why the job stopped short, or null when it ended the way a backfill should. */
function failureOf(job: BackfillJob): string | null {
  switch (job.stopReason) {
    case "max":
    case "empty":
    case "timeout":
      return null;
    case "no_anchor":
      return "nothing stored in this chat yet, so there is nothing to page back from";
    case "disconnected":
      return `WhatsApp disconnected after ${job.fetched} messages; run it again once it is back`;
    case "stopped":
      return `the engine stopped after ${job.fetched} messages`;
    default:
      return `failed after ${job.fetched} messages (see the engine log)`;
  }
}

function summaryOf(job: BackfillJob): string {
  const fetched = `fetched ${plural(job.fetched, "older message")}`;
  const oldest = job.oldestAt ? `; the oldest stored is from ${time(job.oldestAt)}` : "";
  switch (job.stopReason) {
    case "max":
      return `${fetched} (the --max of ${job.max})${oldest}`;
    case "empty":
      return `${fetched}; the phone has nothing older${oldest}`;
    case "timeout":
    default:
      return `${fetched}; the phone stopped answering (is it online? run it again to continue)${oldest}`;
  }
}
