import type { MiddlewareHandler } from "hono";
import { ApiError } from "../errors";

/**
 * Only same-machine, non-browser clients: the Host must name the loopback listener
 * (defeats DNS rebinding) and any Origin header means a web page is calling.
 */
export function localOnlyGuard(port: () => number): MiddlewareHandler {
  return async (c, next) => {
    const host = c.req.header("host");
    const allowed = [`127.0.0.1:${port()}`, `localhost:${port()}`];
    if (!host || !allowed.includes(host.toLowerCase())) {
      throw new ApiError(403, "forbidden_host", "requests must target 127.0.0.1 or localhost");
    }
    if (c.req.header("origin") !== undefined) {
      throw new ApiError(403, "forbidden_origin", "browser requests are not allowed");
    }
    await next();
  };
}
