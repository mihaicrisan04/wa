import type { Chat, ChatDetail, MessagePage, Page } from "@wa/sdk";
import { Hono } from "hono";
import {
  chatListQuery,
  getChat,
  listChats,
  listMessages,
  messageListQuery,
  resolveChat,
} from "../../queries";
import { requires } from "../auth";
import { readContext, type ApiDeps, type AppEnv } from "../context";

export function chatRoutes(deps: ApiDeps) {
  return new Hono<AppEnv>()
    .get("/chats", requires("chats:read"), (c) => {
      const query = chatListQuery.parse(c.req.query());
      return c.json(listChats(readContext(deps, c.get("principal")), query) satisfies Page<Chat>);
    })
    .get("/chats/:chat", requires("chats:read"), (c) => {
      const ctx = readContext(deps, c.get("principal"));
      return c.json(getChat(ctx, resolveChat(ctx, c.req.param("chat"))) satisfies ChatDetail);
    })
    .get("/chats/:chat/messages", requires("messages:read"), (c) => {
      const query = messageListQuery.parse(c.req.query());
      const ctx = readContext(deps, c.get("principal"));
      const page = listMessages(ctx, resolveChat(ctx, c.req.param("chat")), query);
      return c.json(page satisfies MessagePage);
    });
}
