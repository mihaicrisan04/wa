import type { Tool } from "../tool";
import { downloadMediaTool } from "./download-media";
import { getMessageTool } from "./get-message";
import { listChatsTool } from "./list-chats";
import { listMediaTool } from "./list-media";
import { readMessagesTool } from "./read-messages";
import { searchMessagesTool } from "./search-messages";
import { sendMessageTool } from "./send-message";
import { statusTool } from "./status";

/** Every MCP tool; a principal gets the ones its capabilities allow. */
export const TOOLS: Tool[] = [
  statusTool,
  listChatsTool,
  readMessagesTool,
  searchMessagesTool,
  getMessageTool,
  listMediaTool,
  downloadMediaTool,
  sendMessageTool,
];
