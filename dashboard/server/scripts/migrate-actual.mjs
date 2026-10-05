// Разовый перенос данных из Actual Budget в data/cashflow.sqlite + сверка балансов.
//   node --disable-warning=ExperimentalWarning scripts/migrate-actual.mjs [--force] [path/to/actual/db.sqlite]
// Источник — материализованный клиентский бюджет Actual (data/dashboard/<budget>/db.sqlite).
// ID счетов, категорий и операций сохраняются. Без --force существующую базу не трогает.
import { existsSync, readdirSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { currencyOf, DEFAULT_DB_PATH, kvSet, openDb, tx } from '../db.mjs';
import { validateConditions } from '../rules.mjs';

const ROOT = new URL('../../../', import.meta.url).pathname;
const args = process.argv.slice(2);
const force = args.includes('--force');
const dashData = join(ROOT, 'data/dashboard');
const srcPath =
  args.find((a) => !a.startsWith('--')) ||
  readdirSync(dashData)
    .map((d) => join(dashData, d, 'db.sqlite'))
    .find((p) => existsSync(p));
const dstPath = process.env.DB_PATH || DEFAULT_DB_PATH;

if (!srcPath || !existsSync(srcPath)) throw new Error('не найден бюджет Actual (data/dashboard/*/db.sqlite)');
if (existsSync(dstPath)) {
  if (!force) throw new Error(`${dstPath} уже есть — запустите с --force, чтобы пересоздать`);
  for (const ext of ['', '-wal', '-shm'])
    if (existsSync(dstPath + ext)) renameSync(dstPath + ext, `${dstPath}.prev${ext}`);
}

const src = new DatabaseSync(srcPath, { readOnly: true });
const db = openDb(dstPath);
const readJson = (p, fb) => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return fb;
  }
};
const settings = readJson(join(dashData, 'settings.json'), {});
const syncState = readJson(join(dashData, 'last-bank-sync.json'), null);
const dateStr = (n) => `${String(n).slice(0, 4)}-${String(n).slice(4, 6)}-${String(n).slice(6, 8)}`;
const IBAN = /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/;

tx(db, () => {
  const groups = src
    .prepare('SELECT id, name, is_income FROM category_groups WHERE tombstone = 0 ORDER BY sort_order, name')
    .all();
  const insGroup = db.prepare('INSERT INTO category_groups (id, name, is_income, sort) VALUES (?, ?, ?, ?)');
  groups.forEach((g, i) => insGroup.run(g.id, g.name, g.is_income ? 1 : 0, i));

  const cats = src
    .prepare(
      `SELECT c.id, c.cat_group, c.name, c.is_income FROM categories c
       JOIN category_groups g ON g.id = c.cat_group AND g.tombstone = 0
       WHERE c.tombstone = 0 ORDER BY c.sort_order, c.name`,
    )
    .all();
  const insCat = db.prepare('INSERT INTO categories (id, group_id, name, is_income, sort) VALUES (?, ?, ?, ?, ?)');
  cats.forEach((c, i) => insCat.run(c.id, c.cat_group, c.name, c.is_income ? 1 : 0, i));

  // порядок как у api.getAccounts(): sort_order, name (NULL первыми)
  const accounts = src
    .prepare(
      `SELECT a.*, b.name AS bank_name FROM accounts a LEFT JOIN banks b ON b.id = a.bank AND b.tombstone = 0
       WHERE a.tombstone = 0 ORDER BY a.sort_order, a.name`,
    )
    .all();
  const insAcc = db.prepare(
    `INSERT INTO accounts (id, name, currency, offbudget, closed, sort, bank, iban, eb_account_id, bank_balance)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  accounts.forEach((a, i) =>
    insAcc.run(
      a.id,
      a.name,
      settings.accountCurrencies?.[a.id] || currencyOf(a.name),
      a.offbudget ? 1 : 0,
      a.closed ? 1 : 0,
      i,
      a.account_id ? a.bank_name : null,
      IBAN.test(a.official_name || '') ? a.official_name : null,
      a.account_id || null,
      a.account_id ? a.balance_current : null,
    ),
  );

  const txs = src
    .prepare(
      `SELECT t.*, p.name AS payee_name FROM transactions t LEFT JOIN payees p ON p.id = t.description
       WHERE t.tombstone = 0 AND t.isParent = 0 ORDER BY t.date, t.sort_order`,
    )
    .all();
  const insTx = db.prepare(
    `INSERT INTO transactions (id, account_id, date, amount, payee, imported_payee, notes, category_id,
       imported_id, raw, starting_balance, cleared)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const t of txs) {
    const payee = t.payee_name || t.imported_description || '—';
    insTx.run(
      t.id,
      t.acct,
      dateStr(t.date),
      t.amount,
      payee,
      t.imported_description || null,
      t.notes || '',
      t.category || null,
      t.financial_id || null,
      t.raw_synced_data || null,
      t.starting_balance_flag || payee === 'Starting Balance' ? 1 : 0,
      t.cleared ? 1 : 0,
    );
  }

  // правила: payee в Actual — ссылка на id получателя → переводим в имя
  const payeeName = new Map(src.prepare('SELECT id, name FROM payees').all().map((p) => [p.id, p.name]));
  const FIELD = { description: 'payee', imported_description: 'imported_payee', notes: 'notes' };
  const insRule = db.prepare('INSERT INTO rules (id, conditions_op, conditions, category_id) VALUES (?, ?, ?, ?)');
  for (const r of src.prepare('SELECT * FROM rules WHERE tombstone = 0').all()) {
    const actions = JSON.parse(r.actions);
    if (actions.length !== 1 || actions[0].op !== 'set' || actions[0].field !== 'category')
      throw new Error(`правило ${r.id}: поддерживается только «установить категорию»`);
    const conditions = JSON.parse(r.conditions).map((c) => {
      const field = FIELD[c.field];
      if (!field) throw new Error(`правило ${r.id}: поле ${c.field}`);
      if (c.field !== 'description') return { field, op: c.op, value: c.value };
      const names = [...new Set((Array.isArray(c.value) ? c.value : [c.value]).map((id) => payeeName.get(id)))];
      if (names.some((n) => !n)) throw new Error(`правило ${r.id}: неизвестный payee`);
      return c.op === 'oneOf' && names.length === 1
        ? { field, op: 'is', value: names[0] }
        : { field, op: c.op, value: c.op === 'oneOf' ? names : names[0] };
    });
    insRule.run(r.id, r.conditions_op || 'and', JSON.stringify(validateConditions(conditions)), actions[0].value);
  }

  kvSet(db, 'settings', {
    excludedGroup: settings.excludedGroup || 'Переводы и обмены',
    transferCategoryId: settings.transferCategoryId || null,
    excludeCategoryId: settings.excludeCategoryId || null,
  });
  if (syncState) kvSet(db, 'bankSync', syncState);
});

// --- сверка ---------------------------------------------------------------
const fmt = (c) => (c / 100).toFixed(2);
let bad = 0;
const srcBal = src.prepare('SELECT COALESCE(SUM(amount), 0) s, COUNT(*) n FROM transactions WHERE acct = ? AND tombstone = 0 AND isParent = 0');
const dstBal = db.prepare('SELECT COALESCE(SUM(amount), 0) s, COUNT(*) n FROM transactions WHERE account_id = ?');
console.log('счёт'.padEnd(22), 'Actual'.padStart(12), 'новая'.padStart(12), 'банк'.padStart(12), ' операций');
for (const a of db.prepare('SELECT * FROM accounts ORDER BY sort').all()) {
  const s = srcBal.get(a.id);
  const d = dstBal.get(a.id);
  const ok = s.s === d.s && s.n === d.n && (a.bank_balance == null || a.bank_balance === d.s);
  if (!ok) bad++;
  console.log(
    `${ok ? '✓' : '✗'} ${a.name.padEnd(20)}`,
    fmt(s.s).padStart(12),
    fmt(d.s).padStart(12),
    (a.bank_balance == null ? '—' : fmt(a.bank_balance)).padStart(12),
    ` ${d.n}${s.n !== d.n ? ` (Actual ${s.n})` : ''} ${a.currency}${a.closed ? ' закрыт' : ''}`,
  );
}
const count = (d, sql) => d.prepare(sql).get().n;
const checks = [
  ['операций', count(src, 'SELECT COUNT(*) n FROM transactions WHERE tombstone = 0 AND isParent = 0'), count(db, 'SELECT COUNT(*) n FROM transactions')],
  ['с категорией', count(src, 'SELECT COUNT(*) n FROM transactions WHERE tombstone = 0 AND isParent = 0 AND category IS NOT NULL'), count(db, 'SELECT COUNT(*) n FROM transactions WHERE category_id IS NOT NULL')],
  ['категорий', count(src, 'SELECT COUNT(*) n FROM categories WHERE tombstone = 0'), count(db, 'SELECT COUNT(*) n FROM categories')],
  ['правил', count(src, 'SELECT COUNT(*) n FROM rules WHERE tombstone = 0'), count(db, 'SELECT COUNT(*) n FROM rules')],
];
for (const [name, a, b] of checks) {
  if (a !== b) bad++;
  console.log(`${a === b ? '✓' : '✗'} ${name}: Actual ${a}, новая ${b}`);
}
console.log(bad ? `\n✗ расхождений: ${bad}` : `\n✓ всё сошлось → ${dstPath}`);
process.exit(bad ? 1 : 0);
