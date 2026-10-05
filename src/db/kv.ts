// Настройки и служебное состояние в таблице kv (JSON-значения).
import { eq, sql } from 'drizzle-orm';
import type { Q } from './index.ts';
import { kv } from './schema.ts';

export async function kvGet<T>(db: Q, key: string, fallback: T): Promise<T> {
  const row = await db.select({ value: kv.value }).from(kv).where(eq(kv.key, key)).get();
  return row ? (row.value as T) : fallback;
}

export async function kvSet(db: Q, key: string, value: unknown) {
  await db.insert(kv).values({ key, value }).onConflictDoUpdate({ target: kv.key, set: { value } });
}

export async function kvDelete(db: Q, key: string) {
  await db.delete(kv).where(eq(kv.key, key));
}

/** Удалить записи с префиксом, у которых поле field в JSON меньше limit (протухшие). */
export async function kvPrune(db: Q, prefix: string, field: string, limit: number) {
  await db.delete(kv).where(sql`${kv.key} LIKE ${`${prefix}%`} AND json_extract(${kv.value}, ${`$.${field}`}) < ${limit}`);
}
