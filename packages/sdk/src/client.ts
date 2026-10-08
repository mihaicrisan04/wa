import type { ApiErrorBody, Health } from "./types";

export const DEFAULT_PORT = 7373;

export interface WaClientOptions {
  /** Defaults to the local engine on the default port. */
  baseUrl?: string;
  token?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export class WaApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "WaApiError";
  }
}

export interface WaClient {
  health(): Promise<Health>;
}

export function createWaClient(options: WaClientOptions = {}): WaClient {
  const baseUrl = (options.baseUrl ?? `http://127.0.0.1:${DEFAULT_PORT}`).replace(/\/+$/, "");
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;

  async function request<T>(path: string): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    const response = await fetchImpl(`${baseUrl}${path}`, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) throw toApiError(response.status, body);
    return body as T;
  }

  return {
    health: () => request<Health>("/v1/health"),
  };
}

function toApiError(status: number, body: unknown): WaApiError {
  const error = (body as Partial<ApiErrorBody> | null)?.error;
  return new WaApiError(
    status,
    error?.code ?? "http_error",
    error?.message ?? `request failed with status ${status}`,
  );
}
