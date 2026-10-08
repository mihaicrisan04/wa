import { INIT } from "./001-init";

export interface Migration {
  version: number;
  sql: string;
}

/** Append only: a shipped migration is never edited. */
export const MIGRATIONS: Migration[] = [{ version: 1, sql: INIT }];
