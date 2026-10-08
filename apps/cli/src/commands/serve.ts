import { EngineRunningError, loadConfig, startEngine, type Engine } from "@wa/engine";
import { FailureError } from "../command";
import { defineCommand } from "../define";
import { errorCode } from "../exec";

export const serve = defineCommand({
  name: "serve",
  summary: "run the engine in the foreground",
  usage: "wa serve [--port <port>]",
  description: "WA_HOME, WA_PORT and WA_LOG_LEVEL are read from the environment.",
  options: { port: { type: "string" } },
  async run({ values }, io) {
    const config = loadConfig({ ...io.env, WA_PORT: values.port ?? io.env.WA_PORT });
    let engine: Engine;
    try {
      engine = await startEngine(config);
    } catch (err) {
      if (err instanceof EngineRunningError || isAddressInUse(err)) {
        throw new FailureError(err.message);
      }
      throw err;
    }
    await waitForShutdownSignal();
    await engine.stop();
    return 0;
  },
});

function waitForShutdownSignal(): Promise<void> {
  return new Promise((resolve) => {
    process.once("SIGINT", () => resolve());
    process.once("SIGTERM", () => resolve());
  });
}

function isAddressInUse(err: unknown): err is Error {
  return err instanceof Error && errorCode(err) === "EADDRINUSE";
}
