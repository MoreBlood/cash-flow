// Операции: аналитика (сводка, лента, балансы, капитал) и правка.
import { randomUUID } from 'node:crypto';
import { and, asc, between, desc, eq, getTableColumns, max, min, sql, sum } from 'drizzle-orm';
import type { Q } from '../db/index.ts';
import { accounts, categories, categoryGroups, transactions } from '../db/schema.ts';
import { type Currency, converter, FOREIGN, latestRates, rateAt, ratesFor, shiftDays, today } from '../lib/fx.ts';
import {
  bad,
  categoryIndex,
  getSettings,
  notFound,
  openAccounts,
  requireCategory,
  touch,
  upsertPayeeRule,
} from './catalog.ts';

export const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Операции периода по открытым счетам (+ имя и валюта счёта). */
const txsBetween = (db: Q, from: string, to: string, o: { accountId?: string; onBudgetOnly?: boolean } = {}) =>
  db
    .select({ ...getTableColumns(transactions), account: accounts.name, currency: accounts.currency })
    .from(transactions)
    .innerJoin(accounts, and(eq(accounts.id, transactions.accountId), eq(accounts.closed, false)))
    .where(
      and(
        between(transactions.date, from, to),
        o.accountId ? eq(accounts.id, o.accountId) : undefined,
        o.onBudgetOnly ? eq(accounts.offbudget, false) : undefined,
      ),
    )
    .orderBy(desc(transactions.date), asc(accounts.sort), sql`${transactions}.rowid desc`);

// --- аналитика --------------------------------------------------------------
export async function summary(db: Q, from: string, to: string, base: Currency) {
  const conv = await converter(base, from, to);
  const { catInfo, excluded } = await categoryIndex(db);

  let income = 0;
  let expense = 0;
  let excludedCount = 0;
  type Payee = { name: string; currency: string; sum: number; native: number; count: number };
  type Cat = { group: string; name: string; isIncome: boolean; total: number; count: number; payees: Map<string, Payee> };
  const cats = new Map<string, Cat>();
  const accs = new Map<string, { name: string; currency: string; net: number; count: number }>();
  const daily = new Map<string, { net: number; expense: number; cats: Map<string, number> }>();
  const uncategorized: { id: string; date: string; amount: number; payee: string; account: string }[] = [];

  // off-budget счета (инвестиции и т.п.) не участвуют в cash flow; стартовый остаток — не поток
  for (const t of await txsBetween(db, from, to, { onBudgetOnly: true })) {
    if (t.startingBalance) continue;
    if (t.categoryId && excluded.has(t.categoryId)) {
      excludedCount++;
      continue;
    }
    const v = conv(t.amount / 100, t.currency, t.date);
    const acc = accs.get(t.accountId) || { name: t.account, currency: t.currency, net: 0, count: 0 };
    acc.net += v;
    acc.count++;
    accs.set(t.accountId, acc);
    if (v >= 0) income += v;
    else expense += v;

    const info = t.categoryId ? catInfo[t.categoryId] : null;
    const day = daily.get(t.date) || { net: 0, expense: 0, cats: new Map<string, number>() };
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
    const c = cats.get(key)!;
    c.total += v;
    c.count++;
    // мерчант в разной валюте не слипается — ключ (имя, валюта)
    const pkey = `${t.payee} ${t.currency}`;
    const pe = c.payees.get(pkey) || { name: t.payee, currency: t.currency, sum: 0, native: 0, count: 0 };
    pe.sum += v;
    pe.native += t.amount / 100;
    pe.count++;
    c.payees.set(pkey, pe);

    if (!t.categoryId) uncategorized.push({ id: t.id, date: t.date, amount: v, payee: t.payee, account: t.account });
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
export async function transactionsFeed(
  db: Q,
  from: string,
  to: string,
  base: Currency,
  o: { accountId?: string; limit?: number } = {},
) {
  const conv = await converter(base, from, to);
  const { catInfo, excluded } = await categoryIndex(db);
  const rows = await txsBetween(db, from, to, { accountId: o.accountId, onBudgetOnly: !o.accountId });
  const out = (o.limit ? rows.slice(0, o.limit) : rows).map((t) => ({
    id: t.id,
    date: t.date,
    payee: t.payee,
    account: t.account,
    accountId: t.accountId,
    currency: t.currency,
    native: t.amount / 100,
    amount: conv(t.amount / 100, t.currency, t.date),
    categoryId: t.categoryId,
    category: t.categoryId ? (catInfo[t.categoryId]?.name ?? null) : null,
    excluded: t.categoryId ? excluded.has(t.categoryId) : false,
    isTransfer: false,
    startingBalance: t.startingBalance,
    notes: t.notes,
    manual: !t.importedId,
    pending: !t.cleared,
  }));
  return { from, to, base, transactions: out };
}

export async function meta(db: Q) {
  const r = await db
    .select({ firstDate: min(transactions.date), lastDate: max(transactions.date) })
    .from(transactions)
    .innerJoin(accounts, and(eq(accounts.id, transactions.accountId), eq(accounts.closed, false)))
    .where(eq(transactions.startingBalance, false))
    .get();
  // пустая база (новая установка) — период «сегодня»
  return { firstDate: r?.firstDate ?? today(), lastDate: r?.lastDate ?? today() };
}

/** Балансы всех открытых счетов (включая off-budget) в базовой валюте по свежему курсу. */
export async function balances(db: Q, base: Currency) {
  const rates = await latestRates();
  const toPln = (v: number, cur: string) => (cur === 'PLN' ? v : v * (rates[cur as keyof typeof rates] ?? 1));
  const sums = await db
    .select({ accountId: transactions.accountId, s: sum(transactions.amount).mapWith(Number) })
    .from(transactions)
    .groupBy(transactions.accountId);
  const sumBy = new Map(sums.map((r) => [r.accountId, r.s]));
  let totalPln = 0;
  const out = (await openAccounts(db)).map((a) => {
    const balance = (sumBy.get(a.id) || 0) / 100;
    const pln = toPln(balance, a.currency);
    const balancePln = base === 'PLN' ? pln : pln / rates[base];
    totalPln += balancePln;
    return { id: a.id, name: a.name, currency: a.currency, balance, balancePln, offBudget: a.offbudget };
  });
  out.sort((x, y) => y.balancePln - x.balancePln);
  return { accounts: out, totalPln, rates, base };
}

/** История капитала: суммарный баланс открытых счетов по дням, курс НБП на каждую дату. */
export async function networthHistory(db: Q, base: Currency) {
  const rows = await db
    .select({ date: transactions.date, currency: accounts.currency, amount: sum(transactions.amount).mapWith(Number) })
    .from(transactions)
    .innerJoin(accounts, and(eq(accounts.id, transactions.accountId), eq(accounts.closed, false)))
    .groupBy(transactions.date, accounts.currency)
    .orderBy(asc(transactions.date));
  const end = today();
  const start = rows.length && rows[0].date < end ? rows[0].date : end;
  const R = await ratesFor(start, end);
  const bal: Record<string, number> = { PLN: 0, EUR: 0, USD: 0, CHF: 0 };
  const series: { date: string; totalPln: number }[] = [];
  let i = 0;
  for (let ds = start; ; ds = shiftDays(ds, 1)) {
    while (i < rows.length && rows[i].date <= ds) bal[rows[i].currency] = (bal[rows[i].currency] ?? 0) + rows[i++].amount;
    let total = bal.PLN / 100;
    for (const c of FOREIGN) total += (bal[c] / 100) * rateAt(R[c], ds);
    if (base !== 'PLN') total /= rateAt(R[base], ds);
    series.push({ date: ds, totalPln: total });
    if (ds >= end) break;
  }
  return { series, base };
}

// --- правка -------------------------------------------------------------------
export type CategorizeInput = {
  categoryId?: string;
  txId?: string;
  payee?: string;
  allTime?: boolean;
  rule?: boolean;
  from?: string;
  to?: string;
};

/**
 * Смена категории:
 *  {txId}                — одна транзакция
 *  {payee, from, to}     — операции мерчанта за период
 *  {payee, allTime,rule} — вся история мерчанта + правило на будущие синки
 */
export async function categorize(db: Q, b: CategorizeInput) {
  await requireCategory(db, b.categoryId);
  const categoryId = b.categoryId as string;
  const byPayee = async (from: string, to: string) =>
    (
      await db
        .update(transactions)
        .set({ categoryId, ...touch })
        .where(
          and(
            eq(transactions.payee, b.payee as string),
            eq(transactions.startingBalance, false),
            between(transactions.date, from, to),
          ),
        )
    ).rowsAffected;
  if (b.txId) {
    const r = await db.update(transactions).set({ categoryId, ...touch }).where(eq(transactions.id, b.txId));
    if (!r.rowsAffected) throw notFound('transaction not found');
    return { updated: 1, ruleCreated: false };
  }
  if (b.payee && b.allTime) {
    const updated = await byPayee('0000-01-01', '9999-12-31');
    if (b.rule) await upsertPayeeRule(db, b.payee, categoryId);
    return { updated, ruleCreated: !!b.rule };
  }
  if (b.payee && DATE.test(b.from || '') && DATE.test(b.to || ''))
    return { updated: await byPayee(b.from as string, b.to as string), ruleCreated: false };
  throw bad('need txId, payee+allTime or payee+from+to');
}

const accountById = async (db: Q, id?: string) =>
  id ? db.select().from(accounts).where(eq(accounts.id, id)).get() : undefined;

/** Ручная операция: одна транзакция на счёт (сумма в валюте счёта, знак — направление). */
export async function addOperation(
  db: Q,
  b: { accountId?: string; date?: string; amount?: number | string; payee?: string; notes?: string; categoryId?: string | null },
) {
  if (!b.accountId || !DATE.test(b.date || '') || !Number.isFinite(Number(b.amount)))
    throw bad('need accountId, date (YYYY-MM-DD), amount');
  if (!(await accountById(db, b.accountId))) throw bad('account not found');
  if (b.categoryId) await requireCategory(db, b.categoryId);
  const id = randomUUID();
  await db.insert(transactions).values({
    id,
    accountId: b.accountId,
    date: b.date as string,
    amount: Math.round(Number(b.amount) * 100),
    payee: (b.payee || b.notes || 'Операция').slice(0, 100),
    notes: (b.notes || '').slice(0, 200),
    categoryId: b.categoryId || null,
  });
  return { ok: true, id };
}

/** Перевод между счетами (одна валюта): две транзакции в категории «Переводы между счетами». */
export async function addTransfer(
  db: Q,
  b: { fromAccountId?: string; toAccountId?: string; amount?: number | string; date?: string },
) {
  if (!b.fromAccountId || !b.toAccountId || b.fromAccountId === b.toAccountId)
    throw bad('need distinct fromAccountId/toAccountId');
  if (!DATE.test(b.date || '') || !(Number(b.amount) > 0)) throw bad('need date and positive amount');
  const from = await accountById(db, b.fromAccountId);
  const to = await accountById(db, b.toAccountId);
  if (!from || !to) throw bad('account not found');
  if (from.currency !== to.currency) throw bad('перевод только между счетами одной валюты');
  const categoryId =
    (await getSettings(db)).transferCategoryId ??
    (await db.select({ id: categories.id }).from(categories).where(eq(categories.name, 'Переводы между счетами')).get())?.id ??
    null;
  const cents = Math.round(Number(b.amount) * 100);
  const date = b.date as string;
  await db.insert(transactions).values([
    { id: randomUUID(), accountId: from.id, date, amount: -cents, payee: `→ ${to.name}`.slice(0, 100), notes: `Перевод на ${to.name}`, categoryId },
    { id: randomUUID(), accountId: to.id, date, amount: cents, payee: `← ${from.name}`.slice(0, 100), notes: `Перевод с ${from.name}`, categoryId },
  ]);
  return { ok: true };
}

/** Исключить транзакцию из аналитики — категория из настроек, иначе из группы исключений. */
export async function excludeTx(db: Q, txId?: string) {
  const s = await getSettings(db);
  const categoryId =
    s.excludeCategoryId ??
    (
      await db
        .select({ id: categories.id })
        .from(categories)
        .innerJoin(categoryGroups, eq(categoryGroups.id, categories.groupId))
        .where(eq(categoryGroups.name, s.excludedGroup))
        .orderBy(desc(sql`${categories.name} = 'Исключено'`), asc(categories.sort))
        .get()
    )?.id;
  if (!categoryId) throw bad('нет категории для исключения — задайте её в Настройках');
  if (!txId || !(await db.update(transactions).set({ categoryId, ...touch }).where(eq(transactions.id, txId))).rowsAffected)
    throw notFound('transaction not found');
  return { ok: true };
}

const txById = async (db: Q, id?: string) => {
  const t = id ? await db.select().from(transactions).where(eq(transactions.id, id)).get() : undefined;
  if (!t) throw notFound('transaction not found');
  return t;
};

/** Правка операции: получатель и заметка — у любой; дата и сумма — только у ручной (у банковской их задаёт банк). */
export async function updateTransaction(
  db: Q,
  b: { id?: string; payee?: string; notes?: string; date?: string; amount?: number | string },
) {
  const t = await txById(db, b.id);
  const next = { payee: t.payee, notes: t.notes, date: t.date, amount: t.amount };
  if (b.payee !== undefined) {
    next.payee = String(b.payee).trim().slice(0, 100);
    if (!next.payee) throw bad('пустой получатель');
  }
  if (b.notes !== undefined) next.notes = String(b.notes).trim().slice(0, 500);
  if (b.date !== undefined || b.amount !== undefined) {
    if (t.importedId) throw bad('дату и сумму банковской операции задаёт банк');
    if (b.date !== undefined) {
      if (!DATE.test(b.date)) throw bad('date must be YYYY-MM-DD');
      next.date = b.date;
    }
    if (b.amount !== undefined) {
      if (!Number.isFinite(Number(b.amount))) throw bad('bad amount');
      next.amount = Math.round(Number(b.amount) * 100);
    }
  }
  await db.update(transactions).set({ ...next, ...touch }).where(eq(transactions.id, t.id));
  return { ok: true };
}

export async function deleteTransaction(db: Q, id?: string) {
  const t = await txById(db, id);
  // иначе следующий синк вернёт её обратно
  if (t.importedId) throw bad('банковскую операцию удалить нельзя — исключите её из аналитики');
  await db.delete(transactions).where(eq(transactions.id, t.id));
  return { ok: true };
}
