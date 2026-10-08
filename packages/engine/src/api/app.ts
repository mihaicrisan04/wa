import { Hono } from "hono";
import { bearerAuth, socketAdmin } from "./auth";
import type { ApiDeps, AppEnv } from "./context";
import { errorHandler, notFound } from "./errors";
import { localOnlyGuard } from "./guard";
import { mcpRoute } from "../mcp/server";
import { adminRoutes } from "./routes/admin";
import { chatRoutes } from "./routes/chats";
import { healthRoutes } from "./routes/health";
import { messageRoutes } from "./routes/messages";
import { sendRoutes } from "./routes/send";
import { statusRoutes } from "./routes/status";

export type { ApiDeps } from "./context";

/**
 * `tcp`: the loopback listener for token clients (Raycast, MCP agents).
 * `unix`: `WA_HOME/engine.sock`, the CLI's admin channel; only it has the admin routes.
 */
export type Transport =
  | {
      kind: "tcp";
      /** The bound TCP port, read lazily because port 0 is resolved only after listening. */
      port: () => number;
    }
  | { kind: "unix" };

export function createApp(deps: ApiDeps, transport: Transport) {
  const app = new Hono<AppEnv>();
  if (transport.kind === "tcp") app.use(localOnlyGuard(transport.port));
  // registered before auth: the only route that needs no token
  app.route("/v1", healthRoutes(deps.version));
  app.use("/v1/*", transport.kind === "tcp" ? bearerAuth(deps.store) : socketAdmin());
  app.route("/v1", statusRoutes(deps));
  app.route("/v1", chatRoutes(deps));
  app.route("/v1", messageRoutes(deps));
  app.route("/v1", sendRoutes(deps));
  if (transport.kind === "unix") app.route("/v1/admin", adminRoutes(deps));
  if (transport.kind === "tcp") {
    app.use("/mcp", bearerAuth(deps.store));
    app.all("/mcp", mcpRoute(deps));
  }
  app.notFound(notFound);
  app.onError(errorHandler(deps.logger));
  return app;
}

export type App = ReturnType<typeof createApp>;
