/** The scoped read model: every query here filters by the principal's scope in SQL. */
export { chatName, listChats, getChat, type ChatListOptions } from "./chats";
export { encodeCursor, decodeCursor, parseBound, parseTime } from "./cursor";
export {
  getMessage,
  listMessages,
  messagesByRowid,
  visibleMessages,
  type MessageListOptions,
} from "./messages";
export { listMedia, type MediaItem, type MediaListOptions } from "./media";
export { listRecipients, sendTarget, type RecipientOptions } from "./recipients";
export { explicitJid, inScope, resolveChat, resolveSender, visibleChat } from "./resolve";
export { toChat, toMessage, type ReadContext } from "./rows";
export { searchVisible, type SearchQueryOptions } from "./search";
export { findMedia, readStatus, toMediaInfo } from "./status";
