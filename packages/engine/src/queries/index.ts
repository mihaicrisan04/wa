/** The scoped read model: every query here filters by the principal's scope in SQL. */
export { chatName, listChats, getChat, type ChatListOptions } from "./chats";
export { HISTORY_STALL_SECONDS, readHistorySync } from "./history";
export { encodeCursor, decodeCursor } from "./cursor";
export { getMessage, listMessages, type MessageListOptions } from "./messages";
export { listMedia, type MediaItem, type MediaListOptions } from "./media";
export { listRecipients, sendTarget, type RecipientOptions } from "./recipients";
export { inScope, resolveChat } from "./resolve";
export type { ReadContext } from "./rows";
export { searchVisible, type SearchQueryOptions } from "./search";
export { findMedia, readStatus, toMediaInfo } from "./status";
