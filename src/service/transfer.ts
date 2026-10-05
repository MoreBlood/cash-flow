// Перенос данных между установками (локальная ↔ облако): экспорт в JSON и импорт с полной заменой.
// Секреты (ключ Enable Banking, вход) не переносятся. Исходный JSON банка (raw) не экспортируется — он большой.
import { getTableColumns, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { Db } from '../db/index.ts';
import { kvGet, kvSet } from '../db/kv.ts';
import { accounts, categories, categoryGroups, kv, rules, transactions } from '../db/schema.ts';

const FORMAT = 'cashflow-export';
const VERSION = 1;

export async function exportData(db: Db) {
  const { raw: _raw, ...txColumns } = getTableColumns(transactions);
  return {
    format: FORMAT,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    accounts: await db.select().from(accounts),
    categoryGroups: await db.select().from(categoryGroups),
    categories: await db.select().from(categories),
    rules: await db.select().from(rules),
    transactions: await db.select(txColumns).from(transactions),
    settings: await kvGet(db, 'settings', null),
    bankSync: await kvGet(db, 'bankSync', null),
  };
}

type Export = Awaited<ReturnType<typeof exportData>>;
const chunks = <T>(rows: T[], n = 100) => Array.from({ length: Math.ceil(rows.length / n) }, (_, i) => rows.slice(i * n, i * n + n));

/** Полная замена данных содержимым экспорта — одним атомарным batch-ем. */
export async function importData(db: Db, data: Partial<Export>) {
  if (data?.format !== FORMAT || data.version !== VERSION) throw new HTTPException(400, { message: 'это не файл экспорта Cash Flow' });
  for (const k of ['accounts', 'categoryGroups', 'categories', 'rules', 'transactions'] as const)
    if (!Array.isArray(data[k])) throw new HTTPException(400, { message: `в файле нет ${k}` });
  const d = data as Export;
  const stmts = [
    db.delete(transactions),
    db.delete(rules),
    db.delete(categories),
    db.delete(categoryGroups),
    db.delete(accounts),
    db.delete(kv).where(sql`${kv.key} IN ('settings', 'bankSync')`),
    ...chunks(d.accounts).map((c) => db.insert(accounts).values(c)),
    ...chunks(d.categoryGroups).map((c) => db.insert(categoryGroups).values(c)),
    ...chunks(d.categories).map((c) => db.insert(categories).values(c)),
    ...chunks(d.rules).map((c) => db.insert(rules).values(c)),
    ...chunks(d.transactions).map((c) => db.insert(transactions).values(c)),
  ];
  // biome-ignore lint/suspicious/noExplicitAny: batch принимает кортеж запросов
  await db.batch(stmts as any);
  if (d.settings) await kvSet(db, 'settings', d.settings);
  if (d.bankSync) await kvSet(db, 'bankSync', d.bankSync);
  return {
    accounts: d.accounts.length,
    categories: d.categories.length,
    rules: d.rules.length,
    transactions: d.transactions.length,
  };
}
