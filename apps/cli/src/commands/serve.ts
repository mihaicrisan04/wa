import { parseArgs } from "node:util";
import { ConfigError, loadConfig, startEngine, type EngineConfig } from "@wa/engine";
import { EXIT_USAGE, type Command } from "../command";

export const serve: Command = {
  name: "serve",
  summary: "run the engine in the foreground",
  async run(args, io) {
    const { values } = parseArgs({
      args,
      options: { port: { type: "string" }, help: { type: "boolean", short: "h" } },
      strict: true,
    });
    if (values.help) {
      io.out(
        "usage: wa serve [--port <port>]\n\nWA_HOME, WA_PORT and WA_LOG_LEVEL are read from the environment.",
      );
      return 0;
    }
    let config: EngineConfig;
    try {
      config = loadConfig({ ...io.env, WA_PORT: values.port ?? io.env.WA_PORT });
    } catch (err) {
      if (!(err instanceof ConfigError)) throw err;
      io.err(`wa serve: ${err.message}`);
      return EXIT_USAGE;
    }

    const engine = await startEngine(config);
    await waitForShutdownSignal();
    await engine.stop();
    return 0;
  },
};

function waitForShutdownSignal(): Promise<void> {
  return new Promise((resolve) => {
    process.once("SIGINT", () => resolve());
    process.once("SIGTERM", () => resolve());
  });
}
