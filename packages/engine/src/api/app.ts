import { Hono } from "hono";
import type { Logger } from "../logger";
import { errorHandler, notFound } from "./errors";
import { localOnlyGuard } from "./guard";
import { healthRoutes } from "./routes/health";

export interface AppOptions {
  version: string;
  logger: Logger;
  /** The bound TCP port, read lazily because port 0 is resolved only after listening. */
  port: () => number;
}

export function createApp({ version, logger, port }: AppOptions) {
  const app = new Hono();
  app.use(localOnlyGuard(port));
  app.route("/v1", healthRoutes(version));
  app.notFound(notFound);
  app.onError(errorHandler(logger));
  return app;
}
