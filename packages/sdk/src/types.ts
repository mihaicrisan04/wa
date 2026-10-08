export interface Health {
  ok: boolean;
  version: string;
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}
