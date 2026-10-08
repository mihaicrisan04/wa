import { INIT } from "./001-init";
import { CLEAR_MASKED_NAMES } from "./002-masked-names";

export interface Migration {
  version: number;
  sql: string;
}

/** Append only: a shipped migration is never edited. */
export const MIGRATIONS: Migration[] = [
  { version: 1, sql: INIT },
  { version: 2, sql: CLEAR_MASKED_NAMES },
];
