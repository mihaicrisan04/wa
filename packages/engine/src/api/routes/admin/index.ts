import { Hono } from "hono";
import type { ApiDeps, AppEnv } from "../../context";
import { auditRoutes } from "./audit";
import { collectionRoutes } from "./collections";
import { profileRoutes } from "./profiles";
import { tokenRoutes } from "./tokens";

/** Mounted only on the unix socket, where every request is the admin. */
export function adminRoutes(deps: ApiDeps) {
  return new Hono<AppEnv>()
    .route("/", collectionRoutes(deps))
    .route("/", profileRoutes(deps))
    .route("/", tokenRoutes(deps))
    .route("/", auditRoutes(deps));
}
