import type { MiddlewareHandler } from "hono";
import { authenticate } from "../access";
import { ADMIN } from "../policy";
import type { Store } from "../store";
import type { AppEnv } from "./context";
import { errorBody } from "./errors";

const QUERY_TOKEN_PARAMS = ["token", "access_token", "auth", "authorization"];
const BEARER = /^Bearer\s+(\S+)$/i;

/** TCP clients: a bearer token in the Authorization header, never in the URL. */
export function bearerAuth(store: Store): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const query = Object.keys(c.req.query()).map((name) => name.toLowerCase());
    if (QUERY_TOKEN_PARAMS.some((name) => query.includes(name))) {
      return c.json(
        errorBody("token_in_query", "send the token in the Authorization header, not the URL"),
        400,
      );
    }
    const token = BEARER.exec(c.req.header("authorization") ?? "")?.[1];
    const principal = token ? authenticate(store, token) : null;
    if (!principal) {
      c.header("WWW-Authenticate", "Bearer");
      return c.json(errorBody("unauthorized", "a valid bearer token is required"), 401);
    }
    c.set("principal", principal);
    await next();
  };
}

/** The unix socket is reachable only by the owning user (0600), so it is the admin. */
export function socketAdmin(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.set("principal", ADMIN);
    await next();
  };
}
