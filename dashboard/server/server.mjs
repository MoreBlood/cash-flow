import * as api from '@actual-app/api';
import Database from 'better-sqlite3';
import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, relative } from 'node:path';

// dev-фолбэк: подтянуть недостающие переменные из .env в корне репозитория
if (!process.env.ACTUAL_PASSWORD) {
  const envPath = new URL('../../.env', import.meta.url).pathname;
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      if (!line || line.startsWith('#') || !line.includes('=')) continue;
      const k = line.slice(0, line.indexOf('=')).trim();
      const v = line.slice(line.indexOf('=') + 1).trim();
      if (!process.env[k]) process.env[k] = v;
    }
    process.env.ACTUAL_SERVER_URL ||= 'http://localhost:5006';
    process.env.DATA_DIR ||= new URL('./data-cache', import.meta.url).pathname;
  }
}

const PORT = Number(process.env.PORT || 5055);
const STATIC_DIR = process.env.STATIC_DIR || './public';

// --- Actual session -------------------------------------------------------
let lastSync = 0;
async function ensureBudget() {
  if (Date.now() - lastSync < 60_000) return;
  await api.sync();
  lastSync = Date.now();
}

// --- Bank sync state (persisted) ------------------------------------------
const SYNC_STATE = join(process.env.DATA_DIR || '/data', 'last-bank-sync.json');
let bankSyncing = false;
function readSyncState() {
  try {
    return JSON.parse(readFileSync(SYNC_STATE, 'utf8'));
  } catch {
    return { lastBankSyncAt: null };
  }
}
// --- Бэкап в iCloud после успешного синка ---------------------------------
const BACKUP_SRC = process.env.BACKUP_SRC; // /actual (bind-mount data/actual)
const BACKUP_DIR = process.env.BACKUP_DIR; // /backup (bind-mount iCloud)
const BACKUP_KEEP = Number(process.env.BACKUP_KEEP || 30);

function backupStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// Консистентный снапшот BACKUP_SRC → BACKUP_DIR/actual-<ts>.tgz (best-effort).
// sqlite копируем через online-backup (консистентно при живом actual-server), остальное — как есть.
async function backupToICloud() {
  if (!BACKUP_DIR || !BACKUP_SRC || !existsSync(BACKUP_SRC)) return null;
  const stage = join('/tmp', `bk-${Date.now()}`);
  const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
    );
  try {
    for (const f of walk(BACKUP_SRC)) {
      if (f.endsWith('.sqlite-wal') || f.endsWith('.sqlite-shm')) continue;
      const dest = join(stage, relative(BACKUP_SRC, f));
      mkdirSync(dirname(dest), { recursive: true });
      if (f.endsWith('.sqlite')) {
        const db = new Database(f);
        try {
          await db.backup(dest);
        } finally {
          db.close();
        }
      } else {
        copyFileSync(f, dest);
      }
    }
    const arc = join(BACKUP_DIR, `actual-${backupStamp()}.tgz`);
    await new Promise((res, rej) =>
      execFile('tar', ['czf', arc, '-C', stage, '.'], (e) => (e ? rej(e) : res())),
    );
    // ротация: оставить последние BACKUP_KEEP архивов
    const arcs = readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith('actual-') && f.endsWith('.tgz'))
      .sort()
      .reverse();
    for (const old of arcs.slice(BACKUP_KEEP)) rmSync(join(BACKUP_DIR, old), { force: true });
    return arc;
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

async function runBankSync() {
  if (bankSyncing) return { alreadyRunning: true, ...readSyncState() };
  bankSyncing = true;
  try {
    // @actual-app/api синкает ВСЕ счета, копит ошибки и бросает первую в самом конце —
    // уже после того, как транзакции импортированы. Поэтому ошибку запоминаем,
    // иначе один сбойный счёт молча отменяет и отметку времени, и бэкап в iCloud.
    let warning = null;
    try {
      await api.runBankSync();
    } catch (e) {
      warning = e?.message || String(e);
      console.error('[bank-sync] частичная ошибка (импорт мог пройти):', warning);
    }
    await api.sync();
    lastSync = Date.now();
    const state = { lastBankSyncAt: new Date().toISOString() };
    await writeFile(SYNC_STATE, JSON.stringify(state)).catch(() => {});
    if (warning) state.warning = warning;
    // копия в iCloud — не валим синк, если бэкап не удался
    const arc = await backupToICloud().catch((e) => {
      console.error('[backup] не удалось:', e?.message || e);
      return null;
    });
    if (arc) console.log('[backup] снапшот в iCloud:', arc);
    return state;
  } finally {
    bankSyncing = false;
  }
}

await api.init({
  dataDir: process.env.DATA_DIR || '/data',
  serverURL: process.env.ACTUAL_SERVER_URL,
  password: process.env.ACTUAL_PASSWORD,
});
await api.downloadBudget(process.env.ACTUAL_BUDGET_SYNC_ID);
lastSync = Date.now();
console.log('budget loaded');

// --- NBP rates (chunked, cached) ------------------------------------------
const ratesCache = new Map();
async function nbpRange(code, from, to) {
  // НБП отвечает 400 на будущие даты — зажимаем конец диапазона сегодняшним днём,
  // для будущих дат rateAt протягивает последний известный курс.
  const today = new Date().toISOString().slice(0, 10);
  if (to > today) to = today;
  if (from > to) from = to;
  const key = `${code}:${from}:${to}`;
  if (ratesCache.has(key)) return ratesCache.get(key);
  const out = [];
  let start = new Date(from);
  const end = new Date(to);
  while (start <= end) {
    const chunkEnd = new Date(Math.min(end, new Date(start.getTime() + 89 * 864e5)));
    const url = `https://api.nbp.pl/api/exchangerates/rates/a/${code}/${start.toISOString().slice(0, 10)}/${chunkEnd.toISOString().slice(0, 10)}/?format=json`;
    const r = await fetch(url);
    if (r.ok) out.push(...(await r.json()).rates.map((x) => ({ date: x.effectiveDate, mid: x.mid })));
    start = new Date(chunkEnd.getTime() + 864e5);
  }
  ratesCache.set(key, out);
  return out;
}
const rateAt = (rates, date) => {
  let best = rates.length ? rates[0].mid : 1;
  for (const r of rates) {
    if (r.date <= date) best = r.mid;
    else break;
  }
  return best;
};
const currencyOf = (name) =>
  name.includes('EUR') ? 'EUR' : name.includes('USD') ? 'USD' : name.includes('CHF') ? 'CHF' : 'PLN';

const BASES = new Set(['PLN', 'EUR', 'USD', 'CHF']);

// --- Пользовательские настройки (persist в DATA_DIR/settings.json) ---------
const SETTINGS_FILE = join(process.env.DATA_DIR || '/data', 'settings.json');
let settingsCache = null;
function getSettings() {
  if (settingsCache) return settingsCache;
  let s = {};
  try {
    s = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'));
  } catch {}
  settingsCache = {
    excludedGroup: s.excludedGroup || process.env.EXCLUDED_GROUP || 'Переводы и обмены',
    transferCategoryId: s.transferCategoryId || null,
    excludeCategoryId: s.excludeCategoryId || null,
    accountCurrencies: s.accountCurrencies || {}, // { [accountId]: 'USD' } — переопределение валюты счёта
  };
  return settingsCache;
}
async function saveSettings(patch) {
  const cur = getSettings();
  const next = {
    ...cur,
    ...patch,
    accountCurrencies: { ...cur.accountCurrencies, ...(patch.accountCurrencies || {}) },
  };
  // чистим пустые переопределения валют
  for (const k of Object.keys(next.accountCurrencies))
    if (!next.accountCurrencies[k]) delete next.accountCurrencies[k];
  await writeFile(SETTINGS_FILE, JSON.stringify(next, null, 2)).catch(() => {});
  settingsCache = next;
  return next;
}
// валюта счёта: переопределение из настроек, иначе по имени
const accountCurrency = (a) => getSettings().accountCurrencies[a.id] || currencyOf(a.name);

// --- summary ---------------------------------------------------------------
async function summary(from, to, base = 'PLN') {
  await ensureBudget();
  const ratesFrom = new Date(new Date(from).getTime() - 10 * 864e5).toISOString().slice(0, 10);
  const RATES = {};
  for (const c of ['EUR', 'USD', 'CHF']) RATES[c] = await nbpRange(c.toLowerCase(), ratesFrom, to);
  // пересчёт из PLN в базовую валюту по кросс-курсу на дату операции
  const toBase = (pln, date) => (base === 'PLN' ? pln : pln / rateAt(RATES[base], date));

  const groups = await api.getCategoryGroups();
  const excluded = new Set();
  const catInfo = {};
  for (const g of groups)
    for (const c of g.categories || []) {
      catInfo[c.id] = { name: c.name, group: g.name, isIncome: !!c.is_income };
      if (g.name === getSettings().excludedGroup) excluded.add(c.id);
    }

  // off-budget счета (инвестиции и т.п.) не участвуют в cash flow
  const accounts = (await api.getAccounts()).filter((a) => !a.closed && !a.offbudget);
  const payees = await api.getPayees();
  const pById = Object.fromEntries(payees.map((p) => [p.id, p.name]));

  let income = 0;
  let expense = 0;
  let excludedCount = 0;
  const cats = new Map();
  const accs = [];
  const daily = new Map();
  const uncategorized = [];

  for (const a of accounts) {
    const cur = accountCurrency(a);
    const txs = await api.getTransactions(a.id, from, to);
    let accNet = 0;
    let accCount = 0;
    for (const t of txs) {
      if (t.is_parent || t.transfer_id) continue;
      const pn = pById[t.payee] || t.imported_payee || '—';
      // стартовый остаток счёта (флаг Actual или его служебный payee) — не денежный поток
      if (t.starting_balance_flag || pn === 'Starting Balance') continue;
      if (t.category && excluded.has(t.category)) {
        excludedCount++;
        continue;
      }
      const pln = toBase((t.amount / 100) * (cur === 'PLN' ? 1 : rateAt(RATES[cur], t.date)), t.date);
      accNet += pln;
      accCount++;
      if (pln >= 0) income += pln;
      else expense += pln;

      const info = t.category ? catInfo[t.category] : null;
      const day = daily.get(t.date) || { net: 0, expense: 0, cats: new Map() };
      day.net += pln;
      if (pln < 0) {
        // трата за день (положительное число) + разбивка по категориям «на что»
        day.expense += -pln;
        const cn = info?.name ?? 'Без категории';
        day.cats.set(cn, (day.cats.get(cn) || 0) + -pln);
      }
      daily.set(t.date, day);
      // непроставленные разделяем по знаку: расход и доход — в свои секции
      const key = info
        ? `${info.group} / ${info.name}`
        : pln < 0
          ? '(без категории:расход)'
          : '(без категории:доход)';
      if (!cats.has(key))
        cats.set(key, {
          group: info?.group ?? '',
          name: info?.name ?? 'Без категории',
          isIncome: info ? info.isIncome : pln >= 0,
          total: 0,
          count: 0,
          payees: new Map(),
        });
      const c = cats.get(key);
      c.total += pln;
      c.count++;
      // мерчант в разной валюте не слипается — ключ (имя, валюта)
      const pkey = `${pn} ${cur}`;
      const pe = c.payees.get(pkey) || { name: pn, currency: cur, sum: 0, native: 0, count: 0 };
      pe.sum += pln;
      pe.native += t.amount / 100; // сумма в валюте счёта
      pe.count++;
      c.payees.set(pkey, pe);

      if (!t.category)
        uncategorized.push({ id: t.id, date: t.date, amount: pln, payee: pn, account: a.name });
    }
    if (accCount) accs.push({ name: a.name, currency: cur, net: accNet, count: accCount });
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
      .map((c) => ({
        ...c,
        payees: [...c.payees.values()]
          .map((v) => ({ name: v.name, currency: v.currency, sum: v.sum, native: v.native, count: v.count }))
          .sort((x, y) => x.sum - y.sum),
      }))
      .sort((x, y) => x.total - y.total),
    accounts: accs.sort((x, y) => x.net - y.net),
    daily: series,
    uncategorized: uncategorized.sort((x, y) => x.amount - y.amount).slice(0, 20),
  };
}

/** Плоская лента операций за период (для feed + модалки). opts: {accountId, limit} */
async function transactions(from, to, base = 'PLN', opts = {}) {
  await ensureBudget();
  const ratesFrom = new Date(new Date(from).getTime() - 10 * 864e5).toISOString().slice(0, 10);
  const RATES = {};
  for (const c of ['EUR', 'USD', 'CHF']) RATES[c] = await nbpRange(c.toLowerCase(), ratesFrom, to);
  const toBase = (pln, date) => (base === 'PLN' ? pln : pln / rateAt(RATES[base], date));

  const groups = await api.getCategoryGroups();
  const catInfo = {};
  const excluded = new Set();
  for (const g of groups)
    for (const c of g.categories || []) {
      catInfo[c.id] = { name: c.name, group: g.name };
      if (g.name === getSettings().excludedGroup) excluded.add(c.id);
    }
  // история счёта показывает и off-budget (инвестиции); общая лента — только on-budget
  let accounts = (await api.getAccounts()).filter((a) => !a.closed);
  if (opts.accountId) accounts = accounts.filter((a) => a.id === opts.accountId);
  else accounts = accounts.filter((a) => !a.offbudget);
  const payees = await api.getPayees();
  const pById = Object.fromEntries(payees.map((p) => [p.id, p.name]));

  const out = [];
  for (const a of accounts) {
    const cur = accountCurrency(a);
    for (const t of await api.getTransactions(a.id, from, to)) {
      if (t.is_parent) continue;
      const native = t.amount / 100;
      const amount = toBase(native * (cur === 'PLN' ? 1 : rateAt(RATES[cur], t.date)), t.date);
      const pn = pById[t.payee] || t.imported_payee || '—';
      out.push({
        id: t.id,
        date: t.date,
        payee: pn,
        account: a.name,
        accountId: a.id,
        currency: cur,
        native,
        amount,
        categoryId: t.category || null,
        category: t.category ? catInfo[t.category]?.name : null,
        excluded: t.category ? excluded.has(t.category) : false,
        isTransfer: !!t.transfer_id,
        startingBalance: !!t.starting_balance_flag || pn === 'Starting Balance',
        notes: t.notes || '',
      });
    }
  }
  out.sort((x, y) => (y.date === x.date ? 0 : y.date < x.date ? -1 : 1));
  const limited = opts.limit ? out.slice(0, opts.limit) : out;
  return { from, to, base, transactions: limited };
}

async function meta() {
  await ensureBudget();
  const accounts = (await api.getAccounts()).filter((a) => !a.closed);
  let min = '9999-12-31';
  let max = '0000-01-01';
  for (const a of accounts) {
    for (const t of await api.getTransactions(a.id, '2000-01-01', '2100-01-01')) {
      if (t.starting_balance_flag) continue;
      if (t.date < min) min = t.date;
      if (t.date > max) max = t.date;
    }
  }
  return { firstDate: min, lastDate: max };
}

async function listCategories() {
  await ensureBudget();
  const groups = await api.getCategoryGroups();
  const out = [];
  for (const g of groups)
    for (const c of g.categories || [])
      out.push({ id: c.id, name: c.name, group: g.name, isIncome: !!c.is_income });
  return out;
}

async function updateByPayee(payeeName, from, to, categoryId) {
  const accounts = (await api.getAccounts()).filter((a) => !a.closed);
  const payees = await api.getPayees();
  const pById = Object.fromEntries(payees.map((p) => [p.id, p.name]));
  let updated = 0;
  for (const a of accounts) {
    for (const t of await api.getTransactions(a.id, from, to)) {
      if (t.is_parent || t.starting_balance_flag || t.transfer_id) continue;
      const pn = pById[t.payee] || t.imported_payee || '—';
      if (pn !== payeeName) continue;
      await api.updateTransaction(t.id, { category: categoryId });
      updated++;
    }
  }
  return updated;
}

/**
 * Смена категории:
 *  {txId}                — одна транзакция
 *  {payee, from, to}     — операции мерчанта за период
 *  {payee, allTime,rule} — вся история мерчанта + правило Actual на будущие
 */
async function categorize(body) {
  await ensureBudget();
  const valid = new Set((await listCategories()).map((c) => c.id));
  if (!valid.has(body.categoryId)) throw new Error('unknown categoryId');

  let updated = 0;
  let ruleCreated = false;
  if (body.txId) {
    await api.updateTransaction(body.txId, { category: body.categoryId });
    updated = 1;
  } else if (body.payee && body.allTime) {
    updated = await updateByPayee(body.payee, '2000-01-01', '2100-01-01', body.categoryId);
    if (body.rule) {
      const payees = await api.getPayees();
      const ids = payees.filter((p) => p.name === body.payee && !p.transfer_acct).map((p) => p.id);
      const condition = ids.length
        ? { field: 'payee', op: 'oneOf', value: ids }
        : { field: 'imported_payee', op: 'contains', value: body.payee };
      // upsert: если правило на этого мерчанта уже есть — обновляем, не плодим дубли
      const idSet = new Set(ids);
      const existing = (await api.getRules()).find(
        (r) =>
          (r.actions || []).some((x) => x.op === 'set' && x.field === 'category') &&
          (r.conditions || []).some(
            (c) =>
              (c.field === 'payee' &&
                (Array.isArray(c.value) ? c.value.some((v) => idSet.has(v)) : idSet.has(c.value))) ||
              (c.field === 'imported_payee' && c.value === body.payee),
          ),
      );
      if (existing) {
        await api.updateRule({
          ...existing,
          conditions: [condition],
          actions: [{ op: 'set', field: 'category', value: body.categoryId }],
        });
      } else {
        await api.createRule({
          stage: null,
          conditionsOp: 'and',
          conditions: [condition],
          actions: [{ op: 'set', field: 'category', value: body.categoryId }],
        });
      }
      ruleCreated = true;
    }
  } else if (body.payee && DATE.test(body.from || '') && DATE.test(body.to || '')) {
    updated = await updateByPayee(body.payee, body.from, body.to, body.categoryId);
  } else {
    throw new Error('need txId, payee+allTime or payee+from+to');
  }
  await api.sync();
  return { updated, ruleCreated };
}

async function accountsList() {
  await ensureBudget();
  return (await api.getAccounts())
    .filter((a) => !a.closed)
    .map((a) => ({
      id: a.id,
      name: a.name,
      currency: accountCurrency(a),
      offBudget: !!a.offbudget,
    }));
}

/** Ручная операция: одна транзакция на счёт (сумма в валюте счёта, знак — направление). */
async function addOperation(b) {
  await ensureBudget();
  if (!b.accountId || !DATE.test(b.date || '') || !Number.isFinite(Number(b.amount)))
    throw new Error('need accountId, date (YYYY-MM-DD), amount');
  const cents = Math.round(Number(b.amount) * 100);
  await api.addTransactions(b.accountId, [
    {
      date: b.date,
      amount: cents,
      payee_name: (b.payee || b.notes || 'Операция').slice(0, 100),
      notes: (b.notes || '').slice(0, 200),
      category: b.categoryId || null,
      cleared: true,
    },
  ]);
  await api.sync();
  lastSync = Date.now();
  return { ok: true };
}

/** Перевод между счетами (одна валюта): две транзакции в категории «Переводы между счетами». */
async function addTransfer(b) {
  await ensureBudget();
  if (!b.fromAccountId || !b.toAccountId || b.fromAccountId === b.toAccountId)
    throw new Error('need distinct fromAccountId/toAccountId');
  if (!DATE.test(b.date || '') || !(Number(b.amount) > 0))
    throw new Error('need date and positive amount');
  const cents = Math.round(Number(b.amount) * 100);
  const accounts = await api.getAccounts();
  const from = accounts.find((a) => a.id === b.fromAccountId);
  const to = accounts.find((a) => a.id === b.toAccountId);
  if (!from || !to) throw new Error('account not found');
  if (accountCurrency(from) !== accountCurrency(to))
    throw new Error('перевод только между счетами одной валюты');
  const groups = await api.getCategoryGroups();
  let transferCat = getSettings().transferCategoryId;
  if (!transferCat)
    for (const g of groups)
      for (const c of g.categories || []) if (c.name === 'Переводы между счетами') transferCat = c.id;
  await api.addTransactions(b.fromAccountId, [
    {
      date: b.date,
      amount: -cents,
      payee_name: `→ ${to.name}`.slice(0, 100),
      notes: `Перевод на ${to.name}`,
      category: transferCat,
      cleared: true,
    },
  ]);
  await api.addTransactions(b.toAccountId, [
    {
      date: b.date,
      amount: cents,
      payee_name: `← ${from.name}`.slice(0, 100),
      notes: `Перевод с ${from.name}`,
      category: transferCat,
      cleared: true,
    },
  ]);
  await api.sync();
  lastSync = Date.now();
  return { ok: true };
}

/** Исключить транзакцию из аналитики — категория из настроек, иначе из группы исключений. */
async function excludeTx(txId) {
  await ensureBudget();
  const s = getSettings();
  let catId = s.excludeCategoryId;
  if (!catId) {
    const groups = await api.getCategoryGroups();
    const grp = groups.find((g) => g.name === s.excludedGroup);
    const cats = grp?.categories || [];
    catId = (cats.find((c) => c.name === 'Исключено') || cats[0])?.id;
  }
  if (!catId) throw new Error('нет категории для исключения — задайте её в Настройках');
  await api.updateTransaction(txId, { category: catId });
  await api.sync();
  lastSync = Date.now();
  return { ok: true };
}

/** Балансы всех счетов (включая off-budget) в базовой валюте по свежему курсу. */
async function balances(base = 'PLN') {
  await ensureBudget();
  const today = new Date().toISOString().slice(0, 10);
  const ratesFrom = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
  const RATES = {};
  for (const c of ['EUR', 'USD', 'CHF']) {
    const rs = await nbpRange(c.toLowerCase(), ratesFrom, today);
    RATES[c] = rs.length ? rs[rs.length - 1].mid : 1;
  }
  const toBase = (pln) => (base === 'PLN' ? pln : pln / RATES[base]);
  const out = [];
  let totalPln = 0;
  for (const a of (await api.getAccounts()).filter((x) => !x.closed)) {
    const cur = accountCurrency(a);
    let cents = 0;
    for (const t of await api.getTransactions(a.id, '2000-01-01', '2100-01-01')) {
      if (t.is_parent) continue;
      cents += t.amount;
    }
    const balance = cents / 100;
    const balancePln = toBase(balance * (cur === 'PLN' ? 1 : RATES[cur]));
    totalPln += balancePln;
    out.push({ id: a.id, name: a.name, currency: cur, balance, balancePln, offBudget: !!a.offbudget });
  }
  out.sort((x, y) => y.balancePln - x.balancePln);
  return { accounts: out, totalPln, rates: RATES, base };
}

/** История капитала: суммарный баланс всех счетов по дням, курс НБП на каждую дату. */
async function networthHistory(base = 'PLN') {
  await ensureBudget();
  const accounts = (await api.getAccounts()).filter((a) => !a.closed);
  const today = new Date().toISOString().slice(0, 10);
  const byCur = { PLN: [], EUR: [], USD: [], CHF: [] };
  let minDate = today;
  for (const a of accounts) {
    const cur = accountCurrency(a);
    for (const t of await api.getTransactions(a.id, '2000-01-01', '2100-01-01')) {
      if (t.is_parent) continue;
      byCur[cur].push({ date: t.date, amount: t.amount });
      if (t.date < minDate) minDate = t.date;
    }
  }
  for (const c of Object.keys(byCur)) byCur[c].sort((x, y) => x.date.localeCompare(y.date));

  const ratesFrom = new Date(new Date(minDate).getTime() - 10 * 864e5).toISOString().slice(0, 10);
  const RATES = {};
  for (const c of ['EUR', 'USD', 'CHF']) RATES[c] = await nbpRange(c.toLowerCase(), ratesFrom, today);

  const series = [];
  const idx = { PLN: 0, EUR: 0, USD: 0, CHF: 0 };
  const bal = { PLN: 0, EUR: 0, USD: 0, CHF: 0 };
  for (let d = new Date(minDate); ; d = new Date(d.getTime() + 864e5)) {
    const ds = d.toISOString().slice(0, 10);
    for (const c of Object.keys(byCur)) {
      const list = byCur[c];
      while (idx[c] < list.length && list[idx[c]].date <= ds) {
        bal[c] += list[idx[c]].amount;
        idx[c]++;
      }
    }
    let total = bal.PLN / 100;
    for (const c of ['EUR', 'USD', 'CHF']) total += (bal[c] / 100) * rateAt(RATES[c], ds);
    if (base !== 'PLN') total /= rateAt(RATES[base], ds);
    series.push({ date: ds, totalPln: total });
    if (ds >= today) break;
  }
  return { series, base };
}

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (c) => {
      s += c;
      if (s.length > 65536) reject(new Error('body too large'));
    });
    req.on('end', () => resolve(s));
    req.on('error', reject);
  });

// --- http -------------------------------------------------------------------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const DATE = /^\d{4}-\d{2}-\d{2}$/;

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    const base = (url.searchParams.get('base') || 'PLN').toUpperCase();
    if (!BASES.has(base)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'base must be PLN|EUR|USD|CHF' }));
    }
    if (url.pathname === '/api/summary') {
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      if (!DATE.test(from || '') || !DATE.test(to || '')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'from/to must be YYYY-MM-DD' }));
      }
      const data = await summary(from, to, base);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(data));
    }
    if (url.pathname === '/api/transactions') {
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      if (!DATE.test(from || '') || !DATE.test(to || '')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'from/to must be YYYY-MM-DD' }));
      }
      const accountId = url.searchParams.get('account') || undefined;
      const limitRaw = Number(url.searchParams.get('limit'));
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 1000) : undefined;
      const data = await transactions(from, to, base, { accountId, limit });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(data));
    }
    if (url.pathname === '/api/meta') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(await meta()));
    }
    if (url.pathname === '/api/sync-status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ...readSyncState(), syncing: bankSyncing }));
    }
    if (url.pathname === '/api/bank-sync' && req.method === 'POST') {
      const result = await runBankSync();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(result));
    }
    if (url.pathname === '/api/categories') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(await listCategories()));
    }
    if (url.pathname === '/api/balances') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(await balances(base)));
    }
    if (url.pathname === '/api/accounts') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(await accountsList()));
    }
    if (url.pathname === '/api/settings' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(getSettings()));
    }
    if (url.pathname === '/api/settings' && req.method === 'POST') {
      const saved = await saveSettings(JSON.parse(await readBody(req)));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(saved));
    }
    if (url.pathname === '/api/exclude' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req));
      const result = await excludeTx(body.txId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(result));
    }
    if (url.pathname === '/api/operation' && req.method === 'POST') {
      const result = await addOperation(JSON.parse(await readBody(req)));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(result));
    }
    if (url.pathname === '/api/transfer' && req.method === 'POST') {
      const result = await addTransfer(JSON.parse(await readBody(req)));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(result));
    }
    if (url.pathname === '/api/networth-history') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(await networthHistory(base)));
    }
    if (url.pathname === '/api/categorize' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req));
      const result = await categorize(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(result));
    }
    // static
    const p = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = normalize(join(STATIC_DIR, p));
    if (!file.startsWith(normalize(STATIC_DIR))) throw new Error('path');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) {
    if (e.code === 'ENOENT') {
      // SPA fallback
      try {
        const body = await readFile(join(STATIC_DIR, 'index.html'));
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end(body);
      } catch {}
    }
    console.error(e);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(e.message || e) }));
  }
}).listen(PORT, () => console.log(`dashboard on :${PORT}`));
