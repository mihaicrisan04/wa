import { phaseSummary, syncSummary, type Status } from "@wa/sdk";
import { defineCommand } from "../define";
import { engineClient } from "../engine-client";
import { json, table, who } from "../output";

export const status = defineCommand({
  name: "status",
  summary: "connection, history sync and what is stored",
  usage: "wa status [--json]",
  options: { json: { type: "boolean" } },
  async run({ values }, io) {
    const current = await engineClient(io.env).status();
    if (values.json) io.out(json(current));
    else for (const line of describe(current)) io.out(line);
    return 0;
  },
});

function describe(current: Status): string[] {
  const account = current.me ? `${who(current.me.jid)} (${current.me.jid})` : "not linked";
  const { history } = current;
  const phases = history.phases.map(phaseSummary).join(" · ");
  const rows = [
    ["engine", `v${current.version}`],
    ["state", current.needsLink ? `${current.state} (run \`wa link\`)` : current.state],
    ["account", account],
    ["history", syncSummary(history)],
    ...(phases ? [["sync phases", phases]] : []),
    ["chats", String(current.counts.chats)],
    ["messages", String(current.counts.messages)],
    ["outbox", `${current.outbox.pending} pending`],
  ];
  return table(rows);
}
