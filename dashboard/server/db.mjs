// Своё хранилище: один файл SQLite (встроенный node:sqlite, без нативных зависимостей).
// Суммы — целые минорные единицы (центы/гроши), даты — 'YYYY-MM-DD'.
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const DEFAULT_DB_PATH = new URL('../../data/cashflow.sqlite', import.meta.url).pathname;

// Миграции схемы: индекс+1 = PRAGMA user_version. Только дописывать в конец.
const MIGRATIONS = [
  `
  CREATE TABLE accounts (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    currency      TEXT NOT NULL,
    offbudget     INTEGER NOT NULL DEFAULT 0,  -- инвестиции и т.п.: в капитале, но не в cash flow
    closed        INTEGER NOT NULL DEFAULT 0,
    sort          INTEGER NOT NULL DEFAULT 0,
    bank          TEXT,                        -- ASPSP в Enable Banking; NULL — ручной счёт
    iban          TEXT,
    eb_account_id TEXT,                        -- uid счёта в текущей сессии EB (меняется при переподключении)
    eb_hash       TEXT,                        -- identification_hash: стабилен между сессиями
    eb_session_id TEXT,
    consent_until TEXT,                        -- до какого момента действует согласие PSD2 (ISO)
    bank_balance  INTEGER,                     -- последний баланс по данным банка
    synced_at     TEXT,
    sync_error    TEXT
  );
  CREATE TABLE category_groups (
    id        TEXT PRIMARY KEY,
    name      TEXT NOT NULL UNIQUE,
    is_income INTEGER NOT NULL DEFAULT 0,
    sort      INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE categories (
    id        TEXT PRIMARY KEY,
    group_id  TEXT NOT NULL REFERENCES category_groups(id),
    name      TEXT NOT NULL,
    is_income INTEGER NOT NULL DEFAULT 0,
    sort      INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE transactions (
    id               TEXT PRIMARY KEY,
    account_id       TEXT NOT NULL REFERENCES accounts(id),
    date             TEXT NOT NULL,
    amount           INTEGER NOT NULL,
    payee            TEXT NOT NULL,
    imported_payee   TEXT,
    notes            TEXT NOT NULL DEFAULT '',
    category_id      TEXT REFERENCES categories(id),
    imported_id      TEXT,                     -- id операции в банке (дедупликация синка)
    raw              TEXT,                     -- исходный JSON от банка
    starting_balance INTEGER NOT NULL DEFAULT 0,
    cleared          INTEGER NOT NULL DEFAULT 1,
    created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at       TEXT
  );
  CREATE UNIQUE INDEX transactions_imported ON transactions(account_id, imported_id)
    WHERE imported_id IS NOT NULL;
  CREATE INDEX transactions_date ON transactions(date);
  CREATE INDEX transactions_account ON transactions(account_id, date);
  -- правило: условия (JSON [{field: payee|imported_payee|notes, op: is|contains|oneOf, value}]) → категория
  CREATE TABLE rules (
    id            TEXT PRIMARY KEY,
    conditions_op TEXT NOT NULL DEFAULT 'and' CHECK (conditions_op IN ('and', 'or')),
    conditions    TEXT NOT NULL,
    category_id   TEXT NOT NULL REFERENCES categories(id),
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  -- настройки и служебное состояние (JSON-значения)
  CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `,
];

export function openDb(path = process.env.DB_PATH || DEFAULT_DB_PATH) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const { user_version: v } = db.prepare('PRAGMA user_version').get();
  for (let i = v; i < MIGRATIONS.length; i++) {
    tx(db, () => {
      db.exec(MIGRATIONS[i]);
      db.exec(`PRAGMA user_version = ${i + 1}`);
    });
  }
  return db;
}

/** Выполнить fn в транзакции (node:sqlite не даёт своего хелпера). */
export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export const newId = () => randomUUID();

export function kvGet(db, key, fallback = null) {
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : fallback;
}

export function kvSet(db, key, value) {
  db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    JSON.stringify(value),
  );
}

export const currencyOf = (name) =>
  name.includes('EUR') ? 'EUR' : name.includes('USD') ? 'USD' : name.includes('CHF') ? 'CHF' : 'PLN';
