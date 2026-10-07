import type {
  CallToolResult,
  ImageContent,
  McpServer,
  StandardSchemaWithJSON,
} from "@modelcontextprotocol/server";
import type { Capability } from "@wa/sdk";
import { ZodError, type z } from "zod";
import type { ApiDeps } from "../api/context";
import { ApiError } from "../errors";
import { actorOf, can, type TokenPrincipal } from "../policy";
import type { ReadContext } from "../queries";
import { candidateLine, fenced, quote } from "./format";

/** What a tool call runs with; the read context is built per call, so nothing is cached. */
export interface ToolEnv {
  deps: ApiDeps;
  principal: TokenPrincipal;
  read(): ReadContext;
  /** Where `download_media` copies files too large to return inline. */
  exportDir: string;
}

export interface ToolResult<T> {
  /** Rendered between the fence lines. */
  lines: string[];
  structured: T;
  /** Content after the text, e.g. an inline image. */
  attachments?: ImageContent[];
  /** The chat the call was about, for the audit log. */
  chat?: string | null;
  /** How many items came back, for the audit log. */
  count?: number;
}

export interface ToolSpec<I extends z.ZodObject, O extends z.ZodObject> {
  name: string;
  title: string;
  description: string | ((principal: TokenPrincipal) => string);
  /** Any one of these lets a principal see and call the tool; none means every principal. */
  requires: Capability[];
  /** False for tools that change something (sending). */
  readOnly?: boolean;
  input: I;
  output: O;
  run(args: z.output<I>, env: ToolEnv): ToolResult<z.output<O>> | Promise<ToolResult<z.output<O>>>;
}

export interface Tool {
  name: string;
  allowedFor(principal: TokenPrincipal): boolean;
  register(server: McpServer, env: ToolEnv): void;
}

export function defineTool<I extends z.ZodObject, O extends z.ZodObject>(
  spec: ToolSpec<I, O>,
): Tool {
  return {
    name: spec.name,
    allowedFor: (principal) =>
      !spec.requires.length || spec.requires.some((capability) => can(principal, capability)),
    register(server, env) {
      const readOnly = spec.readOnly ?? true;
      server.registerTool(
        spec.name,
        {
          title: spec.title,
          description:
            typeof spec.description === "function"
              ? spec.description(env.principal)
              : spec.description,
          inputSchema: listedOnly(spec.input),
          outputSchema: spec.output as z.ZodObject,
          annotations: { readOnlyHint: readOnly, destructiveHint: false, openWorldHint: !readOnly },
        },
        async (args) => {
          try {
            const result = await spec.run(spec.input.parse(args), env);
            audit(env, spec.name, result.chat ?? null, { count: result.count ?? 1 });
            return {
              content: [
                { type: "text", text: fenced(result.lines) },
                ...(result.attachments ?? []),
              ],
              structuredContent: result.structured as Record<string, unknown>,
            } satisfies CallToolResult;
          } catch (err) {
            const failure = toFailure(err, env, spec.name);
            audit(env, spec.name, null, { error: failure.code });
            return failure.result;
          }
        },
      );
    },
  };
}

/**
 * Clients see `schema`, but the SDK lets every call through: the handler parses it, so a call
 * with bad arguments is audited like any other.
 */
function listedOnly(schema: z.ZodObject): StandardSchemaWithJSON {
  return { "~standard": { ...schema["~standard"], validate: (value) => ({ value }) } };
}

/** Every MCP tool call is audited: who, which tool, which chat and how much, never content. */
function audit(env: ToolEnv, tool: string, chat: string | null, detail: Record<string, unknown>) {
  env.deps.store.audit.record({
    ...actorOf(env.principal),
    action: `mcp:${tool}`,
    chatJid: chat,
    detail,
  });
}

/** Errors the caller may see become a tool error; anything else is logged and stays generic. */
function toFailure(err: unknown, env: ToolEnv, tool: string) {
  let code = "internal";
  let lines = ["error internal: internal error"];
  if (err instanceof ApiError) {
    code = err.code;
    lines = [`error ${err.code}: ${quote(err.message)}`];
    if (err.candidates?.length) {
      lines.push("did you mean one of:", ...err.candidates.map(candidateLine));
    }
  } else if (err instanceof ZodError) {
    code = "invalid_request";
    lines = [`error invalid_request: ${quote(err.issues.map(issueText).join("; "))}`];
  } else {
    env.deps.logger.error({ err, tool }, "mcp tool failed");
  }
  const result: CallToolResult = {
    isError: true,
    content: [{ type: "text", text: fenced(lines) }],
  };
  return { code, result };
}

function issueText(issue: z.core.$ZodIssue): string {
  return issue.path.length ? `${issue.path.join(".")}: ${issue.message}` : issue.message;
}
