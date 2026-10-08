import type { ChatDetail, MessagePage, Page, Chat } from "@wa/sdk";
import { Hono } from "hono";
import { z } from "zod";
import { assertCan } from "../../policy";
import { getChat, listChats, listMessages } from "../../queries";
import { readContext, type ApiDeps, type AppEnv } from "../context";
import { limitParam, optionalText } from "../params";

const CHAT_KINDS = ["dm", "group", "self", "broadcast", "newsletter", "other"] as const;

const listQuery = z.object({
  q: optionalText,
  collection: optionalText,
  kind: z.enum(CHAT_KINDS).optional(),
  limit: limitParam(50, 500),
  cursor: optionalText,
});

const messagesQuery = z.object({
  before: optionalText,
  after: optionalText,
  around: optionalText,
  limit: limitParam(50, 200),
});

export function chatRoutes(deps: ApiDeps) {
  return new Hono<AppEnv>()
    .get("/chats", (c) => {
      assertCan(c.get("principal"), "chats:read");
      const query = listQuery.parse(c.req.query());
      return c.json(listChats(readContext(c, deps), query) satisfies Page<Chat>);
    })
    .get("/chats/:chat", (c) => {
      assertCan(c.get("principal"), "chats:read");
      return c.json(getChat(readContext(c, deps), c.req.param("chat")) satisfies ChatDetail);
    })
    .get("/chats/:chat/messages", (c) => {
      assertCan(c.get("principal"), "messages:read");
      const query = messagesQuery.parse(c.req.query());
      const page = listMessages(readContext(c, deps), c.req.param("chat"), query);
      return c.json(page satisfies MessagePage);
    });
}
