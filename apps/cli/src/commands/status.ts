import { parseArgs } from "node:util";
import type { Status } from "@wa/sdk";
import type { Command } from "../command";
import { engineClient } from "../engine-client";
import { phasesSummary, syncSummary } from "../history";
import { json, table, who } from "../output";

export const status: Command = {
  name: "status",
  summary: "connection, history sync and what is stored",
  async run(args, io) {
    const { values } = parseArgs({
      args,
      options: { json: { type: "boolean" }, help: { type: "boolean", short: "h" } },
      strict: true,
    });
    if (values.help) {
      io.out("usage: wa status [--json]");
      return 0;
    }
    const current = await engineClient(io.env).status();
    if (values.json) io.out(json(current));
    else for (const line of describe(current)) io.out(line);
    return 0;
  },
};

function describe(current: Status): string[] {
  const account = current.me ? `${who(current.me.jid)} (${current.me.jid})` : "not linked";
  const { history } = current;
  const rows = [
    ["engine", `v${current.version}`],
    ["state", current.needsLink ? `${current.state} (run \`wa link\`)` : current.state],
    ["account", account],
    ["history", syncSummary(history)],
    ...(history.phases.length ? [["sync phases", phasesSummary(history)]] : []),
    ["chats", String(current.counts.chats)],
    ["messages", String(current.counts.messages)],
    ["outbox", `${current.outbox.pending} pending`],
  ];
  return table(rows);
}
