import type { CreatedToken, TokenInfo } from "@wa/sdk";
import { Hono } from "hono";
import { z } from "zod";
import { issueToken } from "../../../tokens";
import { notFound } from "../../../errors";
import { recordAudit } from "../../../policy";
import { optionalText } from "../../../queries";
import type { TokenRow } from "../../../store";
import type { ApiDeps, AppEnv } from "../../context";
import { jsonBody, nameParam } from "../../params";

const createBody = z.object({ profile: nameParam, label: z.string().trim().max(200).optional() });
const listQuery = z.object({ profile: optionalText });

export function tokenRoutes({ store }: ApiDeps) {
  return new Hono<AppEnv>()
    .get("/tokens", (c) => {
      const { profile } = listQuery.parse(c.req.query());
      return c.json({ items: store.tokens.list(profile).map(toTokenInfo) satisfies TokenInfo[] });
    })
    .post("/tokens", async (c) => {
      const body = await jsonBody(c, createBody);
      if (!store.profiles.get(body.profile)) throw notFound("profile not found");
      const { row, token } = issueToken(store, body.profile, body.label || null);
      recordAudit(store, c.get("principal"), "token.create", {
        detail: { profile: body.profile, tokenId: row.id },
      });
      return c.json({ ...toTokenInfo(row), token } satisfies CreatedToken, 201);
    })
    .delete("/tokens/:id", (c) => {
      const id = c.req.param("id");
      const revoked = store.tokens.revoke(id);
      if (revoked)
        recordAudit(store, c.get("principal"), "token.revoke", { detail: { tokenId: id } });
      const row = revoked ?? store.tokens.get(id);
      if (!row) throw notFound("token not found");
      return c.json(toTokenInfo(row));
    });
}

function toTokenInfo(row: TokenRow): TokenInfo {
  return {
    id: row.id,
    profile: row.profile,
    label: row.label,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  };
}
