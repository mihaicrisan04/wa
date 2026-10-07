import type { MiddlewareHandler } from "hono";
import { errorBody } from "./errors";

/**
 * Only same-machine, non-browser clients: the Host must name the loopback listener
 * (defeats DNS rebinding) and any Origin header means a web page is calling.
 */
export function localOnlyGuard(port: () => number): MiddlewareHandler {
  return async (c, next) => {
    const host = c.req.header("host");
    const allowed = [`127.0.0.1:${port()}`, `localhost:${port()}`];
    if (!host || !allowed.includes(host.toLowerCase())) {
      return c.json(
        errorBody("forbidden_host", "requests must target 127.0.0.1 or localhost"),
        403,
      );
    }
    if (c.req.header("origin") !== undefined) {
      return c.json(errorBody("forbidden_origin", "browser requests are not allowed"), 403);
    }
    await next();
  };
}
