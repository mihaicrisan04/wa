import { parseArgs } from "node:util";
import { ConfigError, createLogger, loadConfig, reindexHome } from "@wa/engine";
import { EXIT_USAGE, type Command } from "../command";

export const reindex: Command = {
  name: "reindex",
  summary: "re-derive every stored message from its raw payload",
  async run(args, io) {
    const { values } = parseArgs({
      args,
      options: { help: { type: "boolean", short: "h" } },
      strict: true,
    });
    if (values.help) {
      io.out(
        "usage: wa reindex\n\nRe-reads every stored message (text, type, quotes, media info) from its raw\npayload and refreshes the search index. Safe while the engine runs.",
      );
      return 0;
    }
    let home: string;
    try {
      home = loadConfig(io.env).home;
    } catch (err) {
      if (!(err instanceof ConfigError)) throw err;
      io.err(`wa reindex: ${err.message}`);
      return EXIT_USAGE;
    }

    const result = await reindexHome(home, createLogger("warn"));
    if (!result) {
      io.out("nothing to reindex: no message store yet");
      return 0;
    }
    io.out(`reindexed ${result.rewritten} messages (${result.skipped} without a raw payload)`);
    return 0;
  },
};
