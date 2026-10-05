import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { homedir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { backupDb } from './backup.mjs';
import { DEFAULT_DB_PATH, kvGet, kvSet, newId, openDb, tx } from './db.mjs';
import { eb, ebConfigured } from './eb.mjs';
import { BASES, converter, latestRates, nbpRange, rateAt, shiftDays, today } from './fx.mjs';
import { categoryFor, loadRules, ruleMatches, validateConditions } from './rules.mjs';
import { banksView, completeConnect, isSyncing, runBankSync, startConnect } from './sync.mjs';

// переменные из .env в корне репозитория (то, что не задано окружением)
const envPath = new URL('../../.env', import.meta.url).pathname;
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const k = line.slice(0, line.indexOf('=')).trim();
    const v = line
      .slice(line.indexOf('=') + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/, '$2')
      .replaceAll('$HOME', homedir());
    if (!process.env[k]) process.env[k] = v;
  }
}
process.env.BACKUP_DIR ||= process.env.ICLOUD_BACKUP_DIR;

const PORT = Number(process.env.PORT || 5055);
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 5443); // для колбэка Enable Banking (нужен https)
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
const ROOT = new URL('../../', import.meta.url).pathname;
const STATIC_DIR = process.env.STATIC_DIR || new URL('../web/dist', import.meta.url).pathname;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const db = openDb();
console.log('db:', process.env.DB_PATH || DEFAULT_DB_PATH);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const bad = (msg) => new HttpError(400, msg);

// --- справочники ------------------------------------------------------------
const SETTINGS_DEFAULT = { excludedGroup: 'Переводы и обмены', transferCategoryId: null, excludeCategoryId: null };
const getSettings = () => ({ ...SETTINGS_DEFAULT, ...kvGet(db, 'settings', {}) });

function saveSettings(patch) {
  const next = getSettings();
  for (const k of Object.keys(SETTINGS_DEFAULT)) if (k in patch) next[k] = patch[k];
  kvSet(db, 'settings', next);
  return next;
}

const listCategories = () =>
  db
    .prepare(
      `SELECT c.id, c.name, c.group_id, g.name AS "group", c.is_income,
         (SELECT COUNT(*) FROM transactions t WHERE t.category_id = c.id) AS count
       FROM categories c JOIN category_groups g ON g.id = c.group_id ORDER BY g.sort, c.sort`,
    )
    .all()
    .map((c) => ({ id: c.id, name: c.name, group: c.group, groupId: c.group_id, isIncome: !!c.is_income, count: c.count }));

/** {catInfo: id → {name, group, isIncome}, excluded: Set<id> группы «исключить из аналитики»} */
function categoryIndex() {
  const { excludedGroup } = getSettings();
  const catInfo = {};
  const excluded = new Set();
  for (const c of listCategories()) {
    catInfo[c.id] = c;
    if (c.group === excludedGroup) excluded.add(c.id);
  }
  return { catInfo, excluded };
}

const openAccounts = () => db.prepare('SELECT * FROM accounts WHERE closed = 0 ORDER BY sort').all();

const accountsList = () =>
  openAccounts().map((a) => ({ id: a.id, name: a.name, currency: a.currency, offBudget: !!a.offbudget }));

/** Операции периода по открытым счетам (+ имя и валюта счёта). */
function txsBetween(from, to, { accountId, onBudgetOnly } = {}) {
  return db
    .prepare(
      `SELECT t.*, a.name AS account, a.currency FROM transactions t
       JOIN accounts a ON a.id = t.account_id AND a.closed = 0
       WHERE t.date BETWEEN ? AND ? AND (? IS NULL OR a.id = ?) AND (? = 0 OR a.offbudget = 0)
       ORDER BY t.date DESC, a.sort, t.rowid DESC`,
    )
    .all(from, to, accountId ?? null, accountId ?? null, onBudgetOnly ? 1 : 0);
}

// --- аналитика --------------------------------------------------------------
async function summary(from, to, base) {
  const conv = await converter(base, from, to);
  const { catInfo, excluded } = categoryIndex();

  let income = 0;
  let expense = 0;
  let excludedCount = 0;
  const cats = new Map();
  const accs = new Map();
  const daily = new Map();
  const uncategorized = [];

  // off-budget счета (инвестиции и т.п.) не участвуют в cash flow; стартовый остаток — не поток
  for (const t of txsBetween(from, to, { onBudgetOnly: true })) {
    if (t.starting_balance) continue;
    if (t.category_id && excluded.has(t.category_id)) {
      excludedCount++;
      continue;
    }
    const v = conv(t.amount / 100, t.currency, t.date);
    const acc = accs.get(t.account_id) || { name: t.account, currency: t.currency, net: 0, count: 0 };
    acc.net += v;
    acc.count++;
    accs.set(t.account_id, acc);
    if (v >= 0) income += v;
    else expense += v;

    const info = t.category_id ? catInfo[t.category_id] : null;
    const day = daily.get(t.date) || { net: 0, expense: 0, cats: new Map() };
    day.net += v;
    if (v < 0) {
      // трата за день (положительное число) + разбивка по категориям «на что»
      day.expense += -v;
      const cn = info?.name ?? 'Без категории';
      day.cats.set(cn, (day.cats.get(cn) || 0) + -v);
    }
    daily.set(t.date, day);
    // непроставленные разделяем по знаку: расход и доход — в свои секции
    const key = info ? `${info.group} / ${info.name}` : v < 0 ? '(без категории:расход)' : '(без категории:доход)';
    if (!cats.has(key))
      cats.set(key, {
        group: info?.group ?? '',
        name: info?.name ?? 'Без категории',
        isIncome: info ? info.isIncome : v >= 0,
        total: 0,
        count: 0,
        payees: new Map(),
      });
    const c = cats.get(key);
    c.total += v;
    c.count++;
    // мерчант в разной валюте не слипается — ключ (имя, валюта)
    const pkey = `${t.payee} ${t.currency}`;
    const pe = c.payees.get(pkey) || { name: t.payee, currency: t.currency, sum: 0, native: 0, count: 0 };
    pe.sum += v;
    pe.native += t.amount / 100;
    pe.count++;
    c.payees.set(pkey, pe);

    if (!t.category_id)
      uncategorized.push({ id: t.id, date: t.date, amount: v, payee: t.payee, account: t.account });
  }

  let cum = 0;
  const series = [...daily.entries()]
    .sort((x, y) => x[0].localeCompare(y[0]))
    .map(([date, d]) => ({
      date,
      net: d.net,
      expense: d.expense,
      cum: (cum += d.net),
      byCat: [...d.cats.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([name, amount]) => ({ name, amount })),
    }));

  return {
    from,
    to,
    base,
    income,
    expense,
    net: income + expense,
    savingsRate: income > 0 ? (income + expense) / income : null,
    excludedCount,
    categories: [...cats.values()]
      .map((c) => ({ ...c, payees: [...c.payees.values()].sort((x, y) => x.sum - y.sum) }))
      .sort((x, y) => x.total - y.total),
    accounts: [...accs.values()].sort((x, y) => x.net - y.net),
    daily: series,
    uncategorized: uncategorized.sort((x, y) => x.amount - y.amount).slice(0, 20),
  };
}

/** Плоская лента операций (feed + модалки). История счёта включает off-budget, общая лента — нет. */
async function transactions(from, to, base, { accountId, limit } = {}) {
  const conv = await converter(base, from, to);
  const { catInfo, excluded } = categoryIndex();
  const rows = txsBetween(from, to, { accountId, onBudgetOnly: !accountId });
  const out = (limit ? rows.slice(0, limit) : rows).map((t) => ({
    id: t.id,
    date: t.date,
    payee: t.payee,
    account: t.account,
    accountId: t.account_id,
    currency: t.currency,
    native: t.amount / 100,
    amount: conv(t.amount / 100, t.currency, t.date),
    categoryId: t.category_id,
    category: t.category_id ? (catInfo[t.category_id]?.name ?? null) : null,
    excluded: t.category_id ? excluded.has(t.category_id) : false,
    isTransfer: false,
    startingBalance: !!t.starting_balance,
    notes: t.notes,
    manual: !t.imported_id,
    pending: !t.cleared,
  }));
  return { from, to, base, transactions: out };
}

function meta() {
  const r = db
    .prepare(
      `SELECT MIN(t.date) AS firstDate, MAX(t.date) AS lastDate FROM transactions t
       JOIN accounts a ON a.id = t.account_id AND a.closed = 0 WHERE t.starting_balance = 0`,
    )
    .get();
  return { firstDate: r.firstDate ?? '9999-12-31', lastDate: r.lastDate ?? '0000-01-01' };
}

/** Балансы всех открытых счетов (включая off-budget) в базовой валюте по свежему курсу. */
async function balances(base) {
  const rates = await latestRates();
  const toPln = (v, cur) => (cur === 'PLN' ? v : v * rates[cur]);
  const sums = db.prepare('SELECT account_id, SUM(amount) AS s FROM transactions GROUP BY account_id').all();
  const sumBy = new Map(sums.map((r) => [r.account_id, r.s]));
  let totalPln = 0;
  const out = openAccounts().map((a) => {
    const balance = (sumBy.get(a.id) || 0) / 100;
    const pln = toPln(balance, a.currency);
    const balancePln = base === 'PLN' ? pln : pln / rates[base];
    totalPln += balancePln;
    return { id: a.id, name: a.name, currency: a.currency, balance, balancePln, offBudget: !!a.offbudget };
  });
  out.sort((x, y) => y.balancePln - x.balancePln);
  return { accounts: out, totalPln, rates, base };
}

/** История капитала: суммарный баланс открытых счетов по дням, курс НБП на каждую дату. */
async function networthHistory(base) {
  const rows = db
    .prepare(
      `SELECT t.date, a.currency, SUM(t.amount) AS amount FROM transactions t
       JOIN accounts a ON a.id = t.account_id AND a.closed = 0 GROUP BY t.date, a.currency ORDER BY t.date`,
    )
    .all();
  const end = today();
  const start = rows.length && rows[0].date < end ? rows[0].date : end;
  const R = {};
  for (const c of ['EUR', 'USD', 'CHF']) R[c] = await nbpRange(c.toLowerCase(), shiftDays(start, -10), end);
  const bal = { PLN: 0, EUR: 0, USD: 0, CHF: 0 };
  const series = [];
  let i = 0;
  for (let ds = start; ; ds = shiftDays(ds, 1)) {
    while (i < rows.length && rows[i].date <= ds) bal[rows[i].currency] += rows[i++].amount;
    let total = bal.PLN / 100;
    for (const c of ['EUR', 'USD', 'CHF']) total += (bal[c] / 100) * rateAt(R[c], ds);
    if (base !== 'PLN') total /= rateAt(R[base], ds);
    series.push({ date: ds, totalPln: total });
    if (ds >= end) break;
  }
  return { series, base };
}

// --- запись ------------------------------------------------------------------
const touch = "updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

function requireCategory(id) {
  if (!db.prepare('SELECT 1 FROM categories WHERE id = ?').get(id)) throw bad('unknown categoryId');
}

/** Upsert правила «payee → категория»: одно правило на мерчанта, без дублей. */
function upsertPayeeRule(payee, categoryId) {
  const name = payee.toLowerCase();
  const existing = db
    .prepare('SELECT id, conditions FROM rules')
    .all()
    .find((r) =>
      JSON.parse(r.conditions).some(
        (c) =>
          (c.field === 'payee' &&
            (Array.isArray(c.value) ? c.value : [c.value]).some((v) => v.toLowerCase() === name)) ||
          (c.field === 'imported_payee' && c.value.toLowerCase() === name),
      ),
    );
  const conditions = JSON.stringify([{ field: 'payee', op: 'is', value: payee }]);
  if (existing)
    db.prepare("UPDATE rules SET conditions = ?, conditions_op = 'and', category_id = ? WHERE id = ?").run(
      conditions,
      categoryId,
      existing.id,
    );
  else
    db.prepare('INSERT INTO rules (id, conditions, category_id) VALUES (?, ?, ?)').run(newId(), conditions, categoryId);
}

/**
 * Смена категории:
 *  {txId}                — одна транзакция
 *  {payee, from, to}     — операции мерчанта за период
 *  {payee, allTime,rule} — вся история мерчанта + правило на будущие синки
 */
function categorize(b) {
  requireCategory(b.categoryId);
  const byPayee = db.prepare(
    `UPDATE transactions SET category_id = ?, ${touch}
     WHERE payee = ? AND starting_balance = 0 AND date BETWEEN ? AND ?`,
  );
  return tx(db, () => {
    if (b.txId) {
      const r = db.prepare(`UPDATE transactions SET category_id = ?, ${touch} WHERE id = ?`).run(b.categoryId, b.txId);
      if (!r.changes) throw new HttpError(404, 'transaction not found');
      return { updated: 1, ruleCreated: false };
    }
    if (b.payee && b.allTime) {
      const { changes } = byPayee.run(b.categoryId, b.payee, '0000-01-01', '9999-12-31');
      if (b.rule) upsertPayeeRule(b.payee, b.categoryId);
      return { updated: changes, ruleCreated: !!b.rule };
    }
    if (b.payee && DATE.test(b.from || '') && DATE.test(b.to || '')) {
      const { changes } = byPayee.run(b.categoryId, b.payee, b.from, b.to);
      return { updated: changes, ruleCreated: false };
    }
    throw bad('need txId, payee+allTime or payee+from+to');
  });
}

const insertTx = db.prepare(
  `INSERT INTO transactions (id, account_id, date, amount, payee, notes, category_id, cleared)
   VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
);
const accountById = (id) => db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);

/** Ручная операция: одна транзакция на счёт (сумма в валюте счёта, знак — направление). */
function addOperation(b) {
  if (!b.accountId || !DATE.test(b.date || '') || !Number.isFinite(Number(b.amount)))
    throw bad('need accountId, date (YYYY-MM-DD), amount');
  if (!accountById(b.accountId)) throw bad('account not found');
  if (b.categoryId) requireCategory(b.categoryId);
  insertTx.run(
    newId(),
    b.accountId,
    b.date,
    Math.round(Number(b.amount) * 100),
    (b.payee || b.notes || 'Операция').slice(0, 100),
    (b.notes || '').slice(0, 200),
    b.categoryId || null,
  );
  return { ok: true };
}

/** Перевод между счетами (одна валюта): две транзакции в категории «Переводы между счетами». */
function addTransfer(b) {
  if (!b.fromAccountId || !b.toAccountId || b.fromAccountId === b.toAccountId)
    throw bad('need distinct fromAccountId/toAccountId');
  if (!DATE.test(b.date || '') || !(Number(b.amount) > 0)) throw bad('need date and positive amount');
  const from = accountById(b.fromAccountId);
  const to = accountById(b.toAccountId);
  if (!from || !to) throw bad('account not found');
  if (from.currency !== to.currency) throw bad('перевод только между счетами одной валюты');
  const cat =
    getSettings().transferCategoryId ??
    db.prepare("SELECT id FROM categories WHERE name = 'Переводы между счетами'").get()?.id ??
    null;
  const cents = Math.round(Number(b.amount) * 100);
  tx(db, () => {
    insertTx.run(newId(), from.id, b.date, -cents, `→ ${to.name}`.slice(0, 100), `Перевод на ${to.name}`, cat);
    insertTx.run(newId(), to.id, b.date, cents, `← ${from.name}`.slice(0, 100), `Перевод с ${from.name}`, cat);
  });
  return { ok: true };
}

/** Исключить транзакцию из аналитики — категория из настроек, иначе из группы исключений. */
function excludeTx(txId) {
  const s = getSettings();
  const catId =
    s.excludeCategoryId ??
    db
      .prepare(
        `SELECT c.id FROM categories c JOIN category_groups g ON g.id = c.group_id
         WHERE g.name = ? ORDER BY c.name = 'Исключено' DESC, c.sort LIMIT 1`,
      )
      .get(s.excludedGroup)?.id;
  if (!catId) throw bad('нет категории для исключения — задайте её в Настройках');
  const r = db.prepare(`UPDATE transactions SET category_id = ?, ${touch} WHERE id = ?`).run(catId, txId);
  if (!r.changes) throw new HttpError(404, 'transaction not found');
  return { ok: true };
}

// --- операции, категории, правила ----------------------------------------------
const txById = (id) => {
  const t = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
  if (!t) throw new HttpError(404, 'transaction not found');
  return t;
};

/** Правка операции: получатель и заметка — у любой; дата и сумма — только у ручной (у банковской их задаёт банк). */
function updateTransaction(b) {
  const t = txById(b.id);
  const next = { payee: t.payee, notes: t.notes, date: t.date, amount: t.amount };
  if (b.payee !== undefined) {
    next.payee = String(b.payee).trim().slice(0, 100);
    if (!next.payee) throw bad('пустой получатель');
  }
  if (b.notes !== undefined) next.notes = String(b.notes).trim().slice(0, 500);
  if (b.date !== undefined || b.amount !== undefined) {
    if (t.imported_id) throw bad('дату и сумму банковской операции задаёт банк');
    if (b.date !== undefined) {
      if (!DATE.test(b.date)) throw bad('date must be YYYY-MM-DD');
      next.date = b.date;
    }
    if (b.amount !== undefined) {
      if (!Number.isFinite(Number(b.amount))) throw bad('bad amount');
      next.amount = Math.round(Number(b.amount) * 100);
    }
  }
  db.prepare(`UPDATE transactions SET payee = ?, notes = ?, date = ?, amount = ?, ${touch} WHERE id = ?`).run(
    next.payee,
    next.notes,
    next.date,
    next.amount,
    t.id,
  );
  return { ok: true };
}

function deleteTransaction(id) {
  const t = txById(id);
  // иначе следующий синк вернёт её обратно
  if (t.imported_id) throw bad('банковскую операцию удалить нельзя — исключите её из аналитики');
  db.prepare('DELETE FROM transactions WHERE id = ?').run(id);
  return { ok: true };
}

const nextSort = (table) => db.prepare(`SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM ${table}`).get().n;

/** Новая категория в существующей группе (groupId) или в новой/найденной по имени (groupName). */
function createCategory(b) {
  const name = String(b.name || '').trim();
  if (!name) throw bad('need name');
  return tx(db, () => {
    let gid = b.groupId;
    if (gid) {
      if (!db.prepare('SELECT 1 FROM category_groups WHERE id = ?').get(gid)) throw bad('unknown groupId');
    } else {
      const gname = String(b.groupName || '').trim();
      if (!gname) throw bad('need groupId or groupName');
      gid = db.prepare('SELECT id FROM category_groups WHERE name = ?').get(gname)?.id;
      if (!gid) {
        gid = newId();
        db.prepare('INSERT INTO category_groups (id, name, is_income, sort) VALUES (?, ?, ?, ?)').run(
          gid,
          gname,
          b.isIncome ? 1 : 0,
          nextSort('category_groups'),
        );
      }
    }
    if (db.prepare('SELECT 1 FROM categories WHERE group_id = ? AND name = ?').get(gid, name))
      throw bad('такая категория уже есть');
    const id = newId();
    db.prepare(
      'INSERT INTO categories (id, group_id, name, is_income, sort) SELECT ?, id, ?, is_income, ? FROM category_groups WHERE id = ?',
    ).run(id, name, nextSort('categories'), gid);
    return listCategories().find((c) => c.id === id);
  });
}

function renameCategory(b) {
  requireCategory(b.id);
  const name = String(b.name || '').trim();
  if (!name) throw bad('need name');
  db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(name, b.id);
  return { ok: true };
}

/** Удаление категории: операции и правила переезжают в replaceWith (или операции остаются без категории). */
function deleteCategory(b) {
  requireCategory(b.id);
  if (b.replaceWith) requireCategory(b.replaceWith);
  if (b.replaceWith === b.id) throw bad('replaceWith = id');
  return tx(db, () => {
    const to = b.replaceWith || null;
    const moved = db.prepare(`UPDATE transactions SET category_id = ?, ${touch} WHERE category_id = ?`).run(to, b.id).changes;
    if (to) db.prepare('UPDATE rules SET category_id = ? WHERE category_id = ?').run(to, b.id);
    else db.prepare('DELETE FROM rules WHERE category_id = ?').run(b.id);
    const s = getSettings();
    for (const k of ['transferCategoryId', 'excludeCategoryId']) if (s[k] === b.id) s[k] = to;
    kvSet(db, 'settings', s);
    const { group_id } = db.prepare('SELECT group_id FROM categories WHERE id = ?').get(b.id);
    db.prepare('DELETE FROM categories WHERE id = ?').run(b.id);
    // пустую группу убираем (кроме группы исключений из настроек)
    db.prepare(
      'DELETE FROM category_groups WHERE id = ? AND name <> ? AND NOT EXISTS (SELECT 1 FROM categories WHERE group_id = ?)',
    ).run(group_id, s.excludedGroup, group_id);
    return { moved };
  });
}

/** Правила + сколько операций из истории под них попадает. */
function listRules() {
  const { catInfo } = categoryIndex();
  const txs = db.prepare('SELECT payee, imported_payee, notes FROM transactions WHERE starting_balance = 0').all();
  return loadRules(db).map((r) => ({
    id: r.id,
    conditionsOp: r.conditions_op,
    conditions: r.conditions,
    categoryId: r.category_id,
    category: catInfo[r.category_id]?.name ?? null,
    matches: txs.filter((t) => ruleMatches(r, t)).length,
  }));
}

function saveRule(b) {
  requireCategory(b.categoryId);
  const conditions = JSON.stringify(validateConditions(b.conditions));
  const op = b.conditionsOp === 'or' ? 'or' : 'and';
  if (b.id) {
    const r = db.prepare('UPDATE rules SET conditions = ?, conditions_op = ?, category_id = ? WHERE id = ?').run(
      conditions,
      op,
      b.categoryId,
      b.id,
    );
    if (!r.changes) throw new HttpError(404, 'rule not found');
    return { id: b.id };
  }
  const id = newId();
  db.prepare('INSERT INTO rules (id, conditions_op, conditions, category_id) VALUES (?, ?, ?, ?)').run(id, op, conditions, b.categoryId);
  return { id };
}

function deleteRule(id) {
  if (!db.prepare('DELETE FROM rules WHERE id = ?').run(id).changes) throw new HttpError(404, 'rule not found');
  return { ok: true };
}

/** Прогнать правила по операциям без категории. */
function applyRules() {
  const rules = loadRules(db);
  const set = db.prepare(`UPDATE transactions SET category_id = ?, ${touch} WHERE id = ?`);
  return tx(db, () => {
    let updated = 0;
    for (const t of db.prepare('SELECT * FROM transactions WHERE category_id IS NULL AND starting_balance = 0').all()) {
      const c = categoryFor(rules, t);
      if (c) updated += set.run(c, t.id).changes;
    }
    return { updated };
  });
}

// --- банк-синк ----------------------------------------------------------------
const syncState = () => kvGet(db, 'bankSync', { lastBankSyncAt: null });

// копия в iCloud после каждого синка — не валим синк, если бэкап не удался
async function backupAfterSync() {
  const arc = await backupDb(db).catch((e) => console.error('[backup] не удалось:', e?.message || e));
  if (arc) console.log('[backup] снапшот:', arc);
}

const bankSync = (psu, accountIds) => runBankSync(db, { psu, accountIds, onDone: backupAfterSync });

/** PSU-заголовки: синк запустил человек → банк не считает запрос фоновым (лимит PSD2 4/сутки). */
const psuOf = (req) => ({
  ip: (req.socket.remoteAddress || '').replace(/^::ffff:/, ''),
  userAgent: req.headers['user-agent'],
});

/** Согласия, которые кончились или кончатся в ближайшие 14 дней. */
const expiringConsents = () =>
  banksView(db)
    .filter((b) => b.consentUntil && new Date(b.consentUntil) - Date.now() < 14 * 864e5)
    .map((b) => ({ bank: b.name, consentUntil: b.consentUntil }));

// автосинк по расписанию (локальное время), с догоном после сна/выключения
const AUTO_SYNC_TIMES = (process.env.AUTO_SYNC_TIMES ?? '07:30').split(',').map((x) => x.trim()).filter(Boolean);
function lastScheduledBefore(now) {
  let best = null;
  for (const hm of AUTO_SYNC_TIMES) {
    const [h, m] = hm.split(':').map(Number);
    for (const back of [0, 1]) {
      const d = new Date(now);
      d.setDate(d.getDate() - back);
      d.setHours(h, m, 0, 0);
      if (d <= now && (!best || d > best)) best = d;
    }
  }
  return best;
}
function autoSyncTick() {
  if (!ebConfigured() || isSyncing()) return;
  const due = lastScheduledBefore(new Date());
  const last = syncState().lastAttemptAt;
  if (due && (!last || new Date(last) < due)) bankSync().catch((e) => console.error('[auto-sync]', e));
}

/** Колбэк банка после авторизации → привязка счетов → синк → назад на страницу «Банки». */
async function authCallback(q, req, res) {
  const back = (params) => {
    res.writeHead(302, { Location: `${PUBLIC_URL}/banks?${new URLSearchParams(params)}` });
    res.end();
  };
  if (q.get('error')) return back({ error: q.get('error_description') || q.get('error') });
  try {
    const r = await completeConnect(db, { code: q.get('code'), state: q.get('state') });
    await bankSync(psuOf(req), r.accountIds).catch(() => {});
    back({ linked: [...r.linked, ...r.created].join(', '), until: r.validUntil ?? '' });
  } catch (e) {
    console.error('[connect]', e);
    back({ error: String(e.message || e) });
  }
}

// --- http -------------------------------------------------------------------
const readBody = (req) =>
  new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (c) => {
      s += c;
      if (s.length > 65536) reject(bad('body too large'));
    });
    req.on('end', () => {
      try {
        resolve(s ? JSON.parse(s) : {});
      } catch {
        reject(bad('invalid JSON'));
      }
    });
    req.on('error', reject);
  });

function period(q) {
  const from = q.get('from');
  const to = q.get('to');
  if (!DATE.test(from || '') || !DATE.test(to || '')) throw bad('from/to must be YYYY-MM-DD');
  return [from, to];
}

const routes = {
  'GET /api/summary': ({ q, base }) => summary(...period(q), base),
  'GET /api/transactions': ({ q, base }) => {
    const limit = Number(q.get('limit'));
    return transactions(...period(q), base, {
      accountId: q.get('account') || undefined,
      limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 1000) : undefined,
    });
  },
  'GET /api/meta': meta,
  'GET /api/sync-status': () => ({ ...syncState(), syncing: isSyncing(), expiring: expiringConsents() }),
  'POST /api/bank-sync': ({ req }) => bankSync(psuOf(req)),
  'GET /api/banks': () => banksView(db),
  'GET /api/banks/aspsps': async ({ q }) =>
    (await eb.aspsps(q.get('country') || 'PL')).aspsps.map((b) => ({
      name: b.name,
      country: b.country,
      maxConsentDays: Math.floor((b.maximum_consent_validity || 0) / 86400),
    })),
  'POST /api/banks/connect': ({ body }) => {
    if (!body.aspsp) throw bad('need aspsp');
    return startConnect(body);
  },
  'GET /api/categories': listCategories,
  'GET /api/balances': ({ base }) => balances(base),
  'GET /api/accounts': accountsList,
  'GET /api/settings': getSettings,
  'POST /api/settings': ({ body }) => saveSettings(body),
  'POST /api/exclude': ({ body }) => excludeTx(body.txId),
  'POST /api/operation': ({ body }) => addOperation(body),
  'POST /api/transfer': ({ body }) => addTransfer(body),
  'GET /api/networth-history': ({ base }) => networthHistory(base),
  'POST /api/categorize': ({ body }) => categorize(body),
  'POST /api/transaction/update': ({ body }) => updateTransaction(body),
  'POST /api/transaction/delete': ({ body }) => deleteTransaction(body.id),
  'POST /api/categories': ({ body }) => createCategory(body),
  'POST /api/categories/rename': ({ body }) => renameCategory(body),
  'POST /api/categories/delete': ({ body }) => deleteCategory(body),
  'GET /api/rules': listRules,
  'POST /api/rules': ({ body }) => saveRule(body),
  'POST /api/rules/delete': ({ body }) => deleteRule(body.id),
  'POST /api/rules/apply': applyRules,
  'POST /api/backup': async () => ({ archive: await backupDb(db) }),
};

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

async function serveStatic(pathname, res) {
  const file = normalize(join(STATIC_DIR, pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(normalize(STATIC_DIR))) throw new HttpError(403, 'path');
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    return res.end(body);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    // SPA fallback
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(await readFile(join(STATIC_DIR, 'index.html')));
  }
}

const json = (res, status, data) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
};

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/enablebanking/auth_callback') return await authCallback(url.searchParams, req, res);
    const handler = routes[`${req.method} ${url.pathname}`];
    if (!handler) {
      if (url.pathname.startsWith('/api/')) throw new HttpError(404, 'not found');
      return await serveStatic(url.pathname, res);
    }
    const base = (url.searchParams.get('base') || 'PLN').toUpperCase();
    if (!BASES.has(base)) throw bad('base must be PLN|EUR|USD|CHF');
    const body = req.method === 'POST' ? await readBody(req) : undefined;
    json(res, 200, await handler({ q: url.searchParams, base, body, req }));
  } catch (e) {
    if (!e.status) console.error(e);
    json(res, e.status || 500, { error: String(e.message || e) });
  }
}

createServer(handle).listen(PORT, '127.0.0.1', () => console.log(`dashboard on ${PUBLIC_URL}`));

// https-вход только ради redirect URL Enable Banking: самоподписанный сертификат на localhost
if (HTTPS_PORT) {
  const dir = join(ROOT, 'data/tls');
  const key = join(dir, 'localhost-key.pem');
  const cert = join(dir, 'localhost.pem');
  if (!existsSync(cert)) {
    mkdirSync(dir, { recursive: true });
    execFileSync('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '3650',
      '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
      '-keyout', key, '-out', cert], { stdio: 'ignore' });
  }
  createHttpsServer({ key: readFileSync(key), cert: readFileSync(cert) }, handle).listen(HTTPS_PORT, '127.0.0.1', () =>
    console.log(`https on :${HTTPS_PORT}`),
  );
}

if (AUTO_SYNC_TIMES.length && process.env.AUTO_SYNC !== 'off') {
  setTimeout(autoSyncTick, 30_000);
  setInterval(autoSyncTick, 5 * 60_000);
}
