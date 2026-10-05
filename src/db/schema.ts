// Схема данных (Drizzle). Суммы — целые минорные единицы (центы/гроши), даты — 'YYYY-MM-DD'.
// Имена колонок — snake_case (casing в drizzle.config.ts и при создании клиента).
import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export const accounts = sqliteTable('accounts', {
  id: text().primaryKey(),
  name: text().notNull(),
  currency: text().notNull(),
  /** инвестиции и т.п.: в капитале, но не в cash flow */
  offbudget: integer({ mode: 'boolean' }).notNull().default(false),
  closed: integer({ mode: 'boolean' }).notNull().default(false),
  sort: integer().notNull().default(0),
  /** ASPSP в Enable Banking; null — ручной счёт */
  bank: text(),
  iban: text(),
  /** uid счёта в текущей сессии EB (меняется при переподключении) */
  ebAccountId: text(),
  /** identification_hash: стабилен между сессиями — по нему автопривязка */
  ebHash: text(),
  ebSessionId: text(),
  /** до какого момента действует согласие PSD2 (ISO) */
  consentUntil: text(),
  /** последний баланс по данным банка */
  bankBalance: integer(),
  syncedAt: text(),
  syncError: text(),
});

export const categoryGroups = sqliteTable('category_groups', {
  id: text().primaryKey(),
  name: text().notNull().unique(),
  isIncome: integer({ mode: 'boolean' }).notNull().default(false),
  sort: integer().notNull().default(0),
});

export const categories = sqliteTable('categories', {
  id: text().primaryKey(),
  groupId: text()
    .notNull()
    .references(() => categoryGroups.id),
  name: text().notNull(),
  isIncome: integer({ mode: 'boolean' }).notNull().default(false),
  sort: integer().notNull().default(0),
});

export const transactions = sqliteTable(
  'transactions',
  {
    id: text().primaryKey(),
    accountId: text()
      .notNull()
      .references(() => accounts.id),
    date: text().notNull(),
    amount: integer().notNull(),
    payee: text().notNull(),
    importedPayee: text(),
    notes: text().notNull().default(''),
    categoryId: text().references(() => categories.id),
    /** id операции в банке (дедупликация синка) */
    importedId: text(),
    /** исходный JSON от банка */
    raw: text(),
    startingBalance: integer({ mode: 'boolean' }).notNull().default(false),
    /** false — банк ещё не провёл (pending) */
    cleared: integer({ mode: 'boolean' }).notNull().default(true),
    createdAt: text().notNull().default(now),
    updatedAt: text(),
  },
  (t) => [
    uniqueIndex('transactions_imported')
      .on(t.accountId, t.importedId)
      .where(sql`${t.importedId} IS NOT NULL`),
    index('transactions_date').on(t.date),
    index('transactions_account').on(t.accountId, t.date),
  ],
);

export type RuleCondition = {
  field: 'payee' | 'imported_payee' | 'notes';
  op: 'is' | 'contains' | 'oneOf';
  value: string | string[];
};

/** Правило: условия → категория (для новых операций из банка). */
export const rules = sqliteTable(
  'rules',
  {
    id: text().primaryKey(),
    conditionsOp: text({ enum: ['and', 'or'] })
      .notNull()
      .default('and'),
    conditions: text({ mode: 'json' }).$type<RuleCondition[]>().notNull(),
    categoryId: text()
      .notNull()
      .references(() => categories.id),
    createdAt: text().notNull().default(now),
  },
  (t) => [check('rules_conditions_op', sql`${t.conditionsOp} IN ('and', 'or')`)],
);

/** Настройки и служебное состояние (JSON-значения). */
export const kv = sqliteTable('kv', {
  key: text().primaryKey(),
  value: text({ mode: 'json' }).notNull(),
});

export type Account = typeof accounts.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
