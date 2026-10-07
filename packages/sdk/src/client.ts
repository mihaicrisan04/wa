import type {
  ApiErrorBody,
  AuditEntry,
  Chat,
  ChatCandidate,
  ChatDetail,
  ChatKind,
  Collection,
  CollectionDetail,
  CreatedToken,
  Health,
  MediaInfo,
  MessageContext,
  MessagePage,
  OutboxEntry,
  Page,
  Profile,
  ProfileCapability,
  Qr,
  Recipient,
  SearchHit,
  SendResult,
  Status,
  TokenInfo,
} from "./types";

export const DEFAULT_PORT = 7373;

/** WhatsApp's cap for documents; the engine accepts uploads up to this size. */
export const MAX_UPLOAD_BYTES = 2 * 1024 ** 3;

export interface WaClientOptions {
  /** Defaults to the local engine on the default port. */
  baseUrl?: string;
  token?: string;
  /** For JSON requests; media downloads are not cut off. */
  timeoutMs?: number;
  fetch?: (input: string, init: RequestInit) => Promise<Response>;
}

export class WaApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** For `ambiguous`: the chats the reference could mean. */
    readonly candidates: ChatCandidate[] = [],
  ) {
    super(message);
    this.name = "WaApiError";
  }
}

export interface ChatsParams {
  q?: string;
  collection?: string;
  kind?: ChatKind;
  limit?: number;
  cursor?: string;
}

export interface MessagesParams {
  /** A cursor from `older`, unix seconds or an ISO date. */
  before?: string;
  /** A cursor from `newer`, unix seconds or an ISO date. */
  after?: string;
  /** A message id to center the page on. */
  around?: string;
  limit?: number;
}

export interface SearchParams {
  q: string;
  chat?: string;
  sender?: string;
  after?: string;
  before?: string;
  type?: string;
  limit?: number;
  cursor?: string;
}

export interface MediaDownload {
  /** Stream `response.body`, or read it whole with `arrayBuffer()`. */
  response: Response;
  mimetype: string | null;
  fileName: string | null;
  size: number | null;
}

export interface SendFileInput {
  to: string;
  file: Blob;
  fileName: string;
  caption?: string;
}

export interface ProfileInput {
  name: string;
  capabilities: ProfileCapability[];
  collections?: string[];
  allChats?: boolean;
}

/** Admin calls work only over the engine's unix socket (the `wa` CLI). */
export interface WaAdminClient {
  collections: {
    list(): Promise<Collection[]>;
    create(input: { name: string; description?: string }): Promise<CollectionDetail>;
    get(name: string): Promise<CollectionDetail>;
    delete(name: string): Promise<void>;
    /** Chats by jid, phone number or unique name. */
    addChats(name: string, chats: string[]): Promise<CollectionDetail>;
    removeChat(name: string, chat: string): Promise<CollectionDetail>;
  };
  profiles: {
    list(): Promise<Profile[]>;
    create(input: ProfileInput): Promise<Profile>;
    delete(name: string): Promise<void>;
  };
  tokens: {
    list(profile?: string): Promise<TokenInfo[]>;
    create(input: { profile: string; label?: string }): Promise<CreatedToken>;
    revoke(id: string): Promise<TokenInfo>;
  };
  audit(params?: { profile?: string; limit?: number; cursor?: string }): Promise<Page<AuditEntry>>;
}

export interface WaClient {
  health(): Promise<Health>;
  status(): Promise<Status>;
  qr(): Promise<Qr>;
  /** Starts pairing; `relink` (admin only) replaces the linked device. */
  link(options?: { relink?: boolean }): Promise<Qr>;
  chats(params?: ChatsParams): Promise<Page<Chat>>;
  /** A chat by jid, phone number or unique name. */
  chat(ref: string): Promise<ChatDetail>;
  messages(chat: string, params?: MessagesParams): Promise<MessagePage>;
  message(chat: string, id: string, params?: { context?: number }): Promise<MessageContext>;
  search(params: SearchParams): Promise<Page<SearchHit>>;
  media(chat: string, id: string): Promise<MediaInfo>;
  downloadMedia(chat: string, id: string): Promise<MediaDownload>;
  recipients(params?: { q?: string; limit?: number }): Promise<Recipient[]>;
  /** `to` is "self", a jid, a phone number or a unique chat name. */
  send(input: { to: string; text: string }): Promise<SendResult>;
  sendFile(input: SendFileInput): Promise<SendResult>;
  outbox(id: string): Promise<OutboxEntry>;
  admin: WaAdminClient;
}

type Query = Record<string, string | number | boolean | undefined>;

interface RequestOptions {
  method?: string;
  query?: Query;
  json?: unknown;
  form?: FormData;
  /** Streams the body instead of parsing JSON, without the JSON timeout. */
  raw?: boolean;
}

export function createWaClient(options: WaClientOptions = {}): WaClient {
  const baseUrl = (options.baseUrl ?? `http://127.0.0.1:${DEFAULT_PORT}`).replace(/\/+$/, "");
  const fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? 10_000;

  async function send(path: string, request: RequestOptions): Promise<Response> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    let body: RequestInit["body"];
    if (request.json !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(request.json);
    } else if (request.form) {
      body = request.form;
    }
    const response = await fetchImpl(`${baseUrl}${path}${queryString(request.query)}`, {
      method: request.method ?? "GET",
      headers,
      body,
      signal: request.raw ? undefined : AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw toApiError(response.status, await response.json().catch(() => null));
    return response;
  }

  async function call<T>(path: string, request: RequestOptions = {}): Promise<T> {
    return (await (await send(path, request)).json()) as T;
  }

  const enc = encodeURIComponent;
  const items = async <T>(promise: Promise<{ items: T[] }>) => (await promise).items;

  const admin: WaAdminClient = {
    collections: {
      list: () => items(call("/v1/admin/collections")),
      create: (input) => call("/v1/admin/collections", { method: "POST", json: input }),
      get: (name) => call(`/v1/admin/collections/${enc(name)}`),
      delete: async (name) => {
        await call(`/v1/admin/collections/${enc(name)}`, { method: "DELETE" });
      },
      addChats: (name, chats) =>
        call(`/v1/admin/collections/${enc(name)}/chats`, { method: "POST", json: { chats } }),
      removeChat: (name, chat) =>
        call(`/v1/admin/collections/${enc(name)}/chats/${enc(chat)}`, { method: "DELETE" }),
    },
    profiles: {
      list: () => items(call("/v1/admin/profiles")),
      create: (input) => call("/v1/admin/profiles", { method: "POST", json: input }),
      delete: async (name) => {
        await call(`/v1/admin/profiles/${enc(name)}`, { method: "DELETE" });
      },
    },
    tokens: {
      list: (profile) => items(call("/v1/admin/tokens", { query: { profile } })),
      create: (input) => call("/v1/admin/tokens", { method: "POST", json: input }),
      revoke: (id) => call(`/v1/admin/tokens/${enc(id)}`, { method: "DELETE" }),
    },
    audit: (params = {}) => call("/v1/admin/audit", { query: { ...params } }),
  };

  return {
    health: () => call("/v1/health"),
    status: () => call("/v1/status"),
    qr: () => call("/v1/qr"),
    link: (input = {}) => call("/v1/link", { method: "POST", json: input }),
    chats: (params = {}) => call("/v1/chats", { query: { ...params } }),
    chat: (ref) => call(`/v1/chats/${enc(ref)}`),
    messages: (chat, params = {}) =>
      call(`/v1/chats/${enc(chat)}/messages`, { query: { ...params } }),
    message: (chat, id, params = {}) =>
      call(`/v1/messages/${enc(chat)}/${enc(id)}`, { query: { ...params } }),
    search: (params) => call("/v1/search", { query: { ...params } }),
    media: (chat, id) => call(`/v1/media/${enc(chat)}/${enc(id)}`),
    downloadMedia: async (chat, id) => {
      const response = await send(`/v1/media/${enc(chat)}/${enc(id)}`, {
        query: { download: 1 },
        raw: true,
      });
      const size = response.headers.get("content-length");
      return {
        response,
        mimetype: response.headers.get("content-type"),
        fileName: fileNameOf(response.headers.get("content-disposition")),
        size: size ? Number(size) : null,
      };
    },
    recipients: (params = {}) => items(call("/v1/recipients", { query: { ...params } })),
    send: (input) => call("/v1/send", { method: "POST", json: input }),
    sendFile: async (input) => {
      if (input.file.size > MAX_UPLOAD_BYTES) {
        throw new WaApiError(413, "too_large", "WhatsApp only takes files up to 2 GB");
      }
      const form = new FormData();
      form.set("to", input.to);
      if (input.caption) form.set("caption", input.caption);
      form.set("file", input.file, input.fileName);
      return call("/v1/send", { method: "POST", form });
    },
    outbox: (id) => call(`/v1/outbox/${enc(id)}`),
    admin,
  };
}

function queryString(query: Query | undefined): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

function fileNameOf(disposition: string | null): string | null {
  const encoded = disposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) return decodeURIComponent(encoded);
  return disposition?.match(/filename="([^"]*)"/i)?.[1] ?? null;
}

function toApiError(status: number, body: unknown): WaApiError {
  const error = (body as Partial<ApiErrorBody> | null)?.error;
  return new WaApiError(
    status,
    error?.code ?? "http_error",
    error?.message ?? `request failed with status ${status}`,
    error?.candidates ?? [],
  );
}
