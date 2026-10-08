import type { Capability } from "@wa/sdk";
import type { MiddlewareHandler } from "hono";
import { ApiError } from "../errors";
import { ADMIN, assertCan } from "../policy";
import type { Store } from "../store";
import { authenticate } from "../tokens";
import type { AppEnv } from "./context";

const QUERY_TOKEN_PARAMS = ["token", "access_token", "auth", "authorization"];
const BEARER = /^Bearer\s+(\S+)$/i;

/** TCP clients: a bearer token in the Authorization header, never in the URL. */
export function bearerAuth(store: Store): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const query = Object.keys(c.req.query()).map((name) => name.toLowerCase());
    if (QUERY_TOKEN_PARAMS.some((name) => query.includes(name))) {
      throw new ApiError(
        400,
        "token_in_query",
        "send the token in the Authorization header, not the URL",
      );
    }
    const token = BEARER.exec(c.req.header("authorization") ?? "")?.[1];
    const principal = token ? authenticate(store, token) : null;
    if (!principal) {
      c.header("WWW-Authenticate", "Bearer");
      throw new ApiError(401, "unauthorized", "a valid bearer token is required");
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

/** Lets a request through when its principal holds any one of `capabilities`. */
export function requires(...capabilities: Capability[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    assertCan(c.get("principal"), ...capabilities);
    await next();
  };
}
