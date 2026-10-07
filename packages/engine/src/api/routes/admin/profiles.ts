import { PROFILE_CAPABILITIES, type Profile } from "@wa/sdk";
import { Hono } from "hono";
import { z } from "zod";
import { BUILTIN_PROFILES } from "../../../tokens";
import { ApiError, invalid, notFound } from "../../../errors";
import { ADMIN, auditActor } from "../../../policy";
import type { ProfileRecord } from "../../../store";
import type { ApiDeps, AppEnv } from "../../context";
import { jsonBody, nameParam } from "../../params";

const createBody = z.object({
  name: nameParam,
  capabilities: z.array(z.enum(PROFILE_CAPABILITIES)).min(1),
  collections: z.array(nameParam).optional(),
  allChats: z.boolean().optional(),
});

export function profileRoutes({ store }: ApiDeps) {
  const audit = (action: string, profile: string) =>
    store.audit.record({ ...auditActor(ADMIN), action, detail: { profile } });

  return new Hono<AppEnv>()
    .get("/profiles", (c) =>
      c.json({ items: store.profiles.list().map(toProfile) satisfies Profile[] }),
    )
    .post("/profiles", async (c) => {
      const body = await jsonBody(c, createBody);
      const collections = [...new Set(body.collections ?? [])];
      if (body.allChats && collections.length) {
        throw invalid("give either collections or allChats, not both");
      }
      const missing = collections.filter((name) => !store.collections.get(name));
      if (missing.length) throw notFound(`unknown collection: ${missing.join(", ")}`);
      const created = store.profiles.create({
        name: body.name,
        capabilities: [...new Set(body.capabilities)],
        allChats: body.allChats ?? false,
        collections,
      });
      if (!created) throw new ApiError(409, "exists", `profile "${body.name}" already exists`);
      audit("profile.create", body.name);
      return c.json(toProfile(store.profiles.get(body.name)!), 201);
    })
    .delete("/profiles/:name", (c) => {
      const name = c.req.param("name");
      if (BUILTIN_PROFILES.has(name)) {
        throw new ApiError(409, "builtin", `"${name}" is built in and can't be deleted`);
      }
      if (!store.profiles.delete(name)) throw notFound("profile not found");
      audit("profile.delete", name);
      return c.json({ ok: true });
    });
}

function toProfile(record: ProfileRecord): Profile {
  return { ...record, builtin: BUILTIN_PROFILES.has(record.name) };
}
