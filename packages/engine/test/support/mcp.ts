import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { Client as LegacyClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport as LegacyTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ApiHarness } from "../../src/testing";

export interface ToolCall {
  isError: boolean;
  /** The text block. */
  text: string;
  structured: Record<string, unknown> | undefined;
  content: { type: string; [key: string]: unknown }[];
  /** Everything the client got, for leak checks. */
  serialized: string;
}

export interface McpSession {
  client: Client | LegacyClient;
  tools(): Promise<string[]>;
  call(name: string, args?: Record<string, unknown>): Promise<ToolCall>;
  close(): Promise<void>;
}

const openSessions = new Set<McpSession>();

/** Closes the sessions tests left open, also when they failed before closing them; for `afterEach`. */
export async function closeOpenSessions(): Promise<void> {
  await Promise.all([...openSessions].map((session) => session.close()));
}

/** An MCP client on `/mcp` with `token`; `legacy` uses the v1 `@modelcontextprotocol/sdk` client. */
export async function connectMcp(
  api: ApiHarness,
  token: string,
  { legacy = false }: { legacy?: boolean } = {},
): Promise<McpSession> {
  const url = new URL(`http://127.0.0.1:${api.engine.port}/mcp`);
  const requestInit = { headers: { authorization: `Bearer ${token}` } };
  const info = { name: "wa-test", version: "1.0.0" };
  const client = legacy ? new LegacyClient(info) : new Client(info);
  const transport = legacy
    ? new LegacyTransport(url, { requestInit })
    : new StreamableHTTPClientTransport(url, { requestInit });
  await client.connect(transport as never);
  const session: McpSession = {
    client,
    async tools() {
      const { tools } = await client.listTools();
      return tools.map((tool) => tool.name).sort();
    },
    async call(name, args = {}) {
      const result = await client.callTool({ name, arguments: args });
      const content = result.content as ToolCall["content"];
      return {
        isError: result.isError === true,
        text: content
          .filter((block) => block.type === "text")
          .map((block) => block.text as string)
          .join("\n"),
        structured: result.structuredContent as Record<string, unknown> | undefined,
        content,
        serialized: JSON.stringify(result),
      };
    },
    async close() {
      openSessions.delete(session);
      await client.close();
    },
  };
  openSessions.add(session);
  return session;
}

/** The lines between the fence, without the note and the fence itself. */
export function body(text: string): string[] {
  const lines = text.split("\n");
  return lines.slice(2, -1);
}
