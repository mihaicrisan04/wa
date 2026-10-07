import { createLogger, loadConfig, reindexHome } from "@wa/engine";
import { defineCommand } from "../define";

export const reindex = defineCommand({
  name: "reindex",
  summary: "re-derive every stored message from its raw payload",
  usage: "wa reindex",
  description:
    "Re-reads every stored message (text, type, quotes, media info) from its raw\npayload and refreshes the search index. Safe while the engine runs.",
  async run(_input, io) {
    const result = await reindexHome(loadConfig(io.env).home, createLogger("warn"));
    if (!result) {
      io.out("nothing to reindex: no message store yet");
      return 0;
    }
    io.out(`reindexed ${result.rewritten} messages (${result.skipped} without a raw payload)`);
    return 0;
  },
});
