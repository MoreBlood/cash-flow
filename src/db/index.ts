// База: локально — файл SQLite через libSQL, в облаке — Turso (тот же libSQL по HTTP).
// Драйвер выбирает точка входа: drizzle-orm/libsql/node (local.ts) или /web (index.ts, без нативных модулей).
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import * as authSchema from './auth-schema.ts';
import * as appSchema from './schema.ts';

export const schema = { ...appSchema, ...authSchema };
export type Db = LibSQLDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** запрос можно выполнить и в базе, и внутри транзакции */
export type Q = Db | Tx;

export const DEFAULT_DB_PATH = new URL('../../data/cashflow.sqlite', import.meta.url).pathname;

/** Переменная Turso: интеграция Vercel может добавить префикс (FOO_TURSO_DATABASE_URL). */
export const envBySuffix = (suffix: string) =>
  process.env[suffix] ?? Object.entries(process.env).find(([k]) => k.endsWith(`_${suffix}`))?.[1];

export function connection() {
  const url = envBySuffix('TURSO_DATABASE_URL');
  return url
    ? { url, authToken: envBySuffix('TURSO_AUTH_TOKEN'), local: false }
    : { url: `file:${process.env.DB_PATH || DEFAULT_DB_PATH}`, authToken: undefined, local: true };
}

export const dbConfig = { schema, casing: 'snake_case' } as const;
