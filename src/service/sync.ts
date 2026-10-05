// Банк-синк через Enable Banking: импорт операций, привязка счетов после переавторизации.
// Состояние (блокировка синка, незавершённые привязки) — в kv: в облаке запросы идут в разные инстансы.
import { randomUUID } from 'node:crypto';
import { and, asc, count, eq, isNotNull, max, min, sum } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { kvDelete, kvGet, kvPrune, kvSet } from '../db/kv.ts';
import { accounts, categories, type Transaction, transactions } from '../db/schema.ts';
import { type EbTransaction, eb, ebConfigured, normalizeTx, type Psu, pickBalance } from '../lib/eb.ts';
import { shiftDays, today } from '../lib/fx.ts';
import { categoryFor } from '../lib/rules.ts';
import { loadRules } from './catalog.ts';

const OVERLAP_DAYS = 14; // перезапрашиваем хвост: банки задним числом проводят и правят операции
const MAX_DAYS = 89; // PSD2: дальше 90 дней без SCA банки обычно не отдают
const MAX_CONSENT_DAYS = 180;
const PENDING_MARGIN = 3; // pending банк фильтрует по дате авторизации, а она бывает раньше нашей даты
const LOCK_TTL = 6 * 60e3; // дольше функция на Vercel не живёт
const nowIso = () => new Date().toISOString();

export type SyncState = {
  lastBankSyncAt: string | null;
  lastAttemptAt?: string;
  failedAccounts?: string[];
  added?: number;
  updated?: number;
  removed?: number;
  alreadyRunning?: boolean;
};

/** Имя получателя в регистре, принятом в истории («ACME SP. Z O.O.», а не «Acme Sp. z o.o.»). */
async function payeeCanon(db: Db) {
  const m = new Map<string, string>();
  for (const r of await db
    .select({ payee: transactions.payee, n: count() })
    .from(transactions)
    .groupBy(transactions.payee)
    .orderBy(asc(count())))
    m.set(r.payee.toLowerCase(), r.payee);
  return (name: string) => (name ? (m.get(name.toLowerCase()) ?? name) : '—');
}

async function syncAccount(db: Db, a: typeof accounts.$inferSelect, psu?: Psu) {
  const uid = a.ebAccountId as string;
  // счёт, привязанный ещё через Actual: один раз дотягиваем стабильный hash и IBAN
  if (!a.ebHash) {
    const d = await eb.accountDetails(uid, psu);
    await db
      .update(accounts)
      .set({ ebHash: d.identification_hash ?? null, iban: d.account_id?.iban ?? a.iban })
      .where(eq(accounts.id, a.id));
  }
  const imported = and(eq(transactions.accountId, a.id), isNotNull(transactions.importedId));
  const stats = await db
    .select({ n: count() })
    .from(transactions)
    .where(eq(transactions.accountId, a.id))
    .get();
  const lastBooked = (
    await db.select({ d: max(transactions.date) }).from(transactions).where(and(imported, eq(transactions.cleared, true))).get()
  )?.d;
  const oldestPending = (
    await db.select({ d: min(transactions.date) }).from(transactions).where(and(imported, eq(transactions.cleared, false))).get()
  )?.d;
  const isNew = !stats?.n;
  const floor = shiftDays(today(), -MAX_DAYS);
  let from = lastBooked ? shiftDays(lastBooked, -OVERLAP_DAYS) : floor;
  if (oldestPending && shiftDays(oldestPending, -PENDING_MARGIN) < from) from = shiftDays(oldestPending, -PENDING_MARGIN);
  if (from < floor) from = floor;

  const raw: EbTransaction[] = await eb.transactions(uid, from, today(), psu);
  const bankBalance = pickBalance((await eb.balances(uid, psu)).balances || []);

  const ranked = await loadRules(db);
  const canon = await payeeCanon(db);
  const result = { added: 0, updated: 0, removed: 0 };

  await db.transaction(async (tx) => {
    const existing = new Map<string, Transaction>(
      (await tx.select().from(transactions).where(imported)).map((t) => [t.importedId as string, t]),
    );
    const seen = new Set<string>();
    for (const r of raw) {
      const n = normalizeTx(r);
      if (!n) continue;
      seen.add(n.importedId);
      const payee = canon(n.payee);
      const fields = { payee, importedPayee: n.payee || null, notes: n.notes };
      const cur = existing.get(n.importedId);
      if (!cur) {
        await tx.insert(transactions).values({
          id: randomUUID(),
          accountId: a.id,
          date: n.date,
          amount: n.amount,
          ...fields,
          categoryId: categoryFor(ranked, fields),
          importedId: n.importedId,
          raw: JSON.stringify(r),
          cleared: n.booked,
        });
        result.added++;
        continue;
      }
      if (cur.date === n.date && cur.amount === n.amount && cur.cleared === n.booked && cur.importedPayee === fields.importedPayee)
        continue;
      // pending → проведена: банк уточняет дату/сумму/имя. Правки пользователя (переименование,
      // категория, заметка) не трогаем.
      const renamed = cur.importedPayee && cur.payee.toLowerCase() !== cur.importedPayee.toLowerCase();
      await tx
        .update(transactions)
        .set({
          date: n.date,
          amount: n.amount,
          payee: renamed ? cur.payee : payee,
          importedPayee: fields.importedPayee,
          categoryId: cur.categoryId ?? categoryFor(ranked, fields),
          raw: JSON.stringify(r),
          cleared: n.booked,
          updatedAt: nowIso(),
        })
        .where(eq(transactions.id, cur.id));
      result.updated++;
    }
    // pending из окна запроса (с запасом от края), которых банк больше не отдаёт, — отменённые блокировки
    const safeFrom = shiftDays(from, PENDING_MARGIN);
    if (raw.length)
      for (const t of existing.values()) {
        if (t.cleared || t.date < safeFrom || seen.has(t.importedId as string)) continue;
        await tx.delete(transactions).where(eq(transactions.id, t.id));
        result.removed++;
      }
    // новый счёт: история только за 90 дней — добиваем стартовым остатком до баланса банка
    if (isNew && bankBalance != null) {
      const s = await tx
        .select({ s: sum(transactions.amount).mapWith(Number), d: min(transactions.date) })
        .from(transactions)
        .where(eq(transactions.accountId, a.id))
        .get();
      const cat = await tx.select({ id: categories.id }).from(categories).where(eq(categories.name, 'Starting Balances')).get();
      await tx.insert(transactions).values({
        id: randomUUID(),
        accountId: a.id,
        date: s?.d ?? today(),
        amount: bankBalance - (s?.s ?? 0),
        payee: 'Starting Balance',
        categoryId: cat?.id ?? null,
        startingBalance: true,
      });
    }
    await tx
      .update(accounts)
      .set({ bankBalance, syncedAt: nowIso(), syncError: null })
      .where(eq(accounts.id, a.id));
  });
  return result;
}

let running: Promise<SyncState> | null = null;
const lockFresh = (l: { at: number } | null) => !!l && Date.now() - l.at < LOCK_TTL;

/** Синк всех привязанных счетов. psu — когда запускает человек из дашборда. */
export function runBankSync(
  db: Db,
  o: { psu?: Psu; accountIds?: string[]; onDone?: (s: SyncState) => unknown } = {},
): Promise<SyncState> {
  running ??= (async () => {
    if (lockFresh(await kvGet(db, 'syncLock', null)))
      return { ...(await kvGet<SyncState>(db, 'bankSync', { lastBankSyncAt: null })), alreadyRunning: true };
    await kvSet(db, 'syncLock', { at: Date.now() });
    try {
      const list = (
        await db
          .select()
          .from(accounts)
          .where(and(eq(accounts.closed, false), isNotNull(accounts.ebAccountId)))
          .orderBy(asc(accounts.sort))
      ).filter((a) => !o.accountIds || o.accountIds.includes(a.id));
      const failedAccounts: string[] = [];
      const total = { added: 0, updated: 0, removed: 0 };
      for (const a of list) {
        try {
          const s = await syncAccount(db, a, o.psu);
          total.added += s.added;
          total.updated += s.updated;
          total.removed += s.removed;
        } catch (e) {
          failedAccounts.push(a.name);
          const err = e as Error & { loginRequired?: boolean };
          await db
            .update(accounts)
            .set({ syncError: err.loginRequired ? 'login_required' : String(err.message || err).slice(0, 300) })
            .where(eq(accounts.id, a.id));
          console.error(`[bank-sync] ${a.name}:`, err.message || err);
        }
      }
      const now = nowIso();
      // «обновлено» — только когда синкнулось всё; при сбое прошлую отметку не трогаем
      const prev = await kvGet<SyncState>(db, 'bankSync', { lastBankSyncAt: null });
      const state: SyncState = {
        lastBankSyncAt: failedAccounts.length ? prev.lastBankSyncAt : now,
        lastAttemptAt: now,
        failedAccounts,
        ...total,
      };
      if (!o.accountIds) await kvSet(db, 'bankSync', state);
      console.log(`[bank-sync] +${total.added} ~${total.updated} -${total.removed}, сбоев: ${failedAccounts.length}`);
      await o.onDone?.(state);
      return state;
    } finally {
      await kvDelete(db, 'syncLock');
    }
  })().finally(() => {
    running = null;
  });
  return running;
}

export const isSyncing = async (db: Db) => !!running || lockFresh(await kvGet(db, 'syncLock', null));
export const syncState = (db: Db) => kvGet<SyncState>(db, 'bankSync', { lastBankSyncAt: null });

/** Автосинк по расписанию: не чаще раза в 12 часов, сколько бы раз его ни дёрнули. */
export async function scheduledSync(db: Db, onDone?: (s: SyncState) => unknown) {
  if (!ebConfigured()) return { skipped: 'Enable Banking не настроен' };
  if (await isSyncing(db)) return { skipped: 'синк уже идёт' };
  const last = (await syncState(db)).lastAttemptAt;
  if (last && Date.now() - new Date(last).getTime() < 12 * 3600e3) return { skipped: 'недавно синкались', last };
  return runBankSync(db, { onDone });
}

// --- привязка банка ------------------------------------------------------------
/** Старт авторизации в банке → URL, куда отправить пользователя. Согласие — максимум, что даёт банк (≤180 дней). */
export async function startConnect(
  db: Db,
  b: { aspsp: string; country?: string; psuType?: string; redirectUrl: string },
) {
  const country = b.country || 'PL';
  const psuType = b.psuType || 'personal';
  const bank = (await eb.aspsps(country, psuType)).aspsps.find((x) => x.name === b.aspsp);
  if (!bank) throw new Error(`банк «${b.aspsp}» не найден в Enable Banking (${country})`);
  const days = Math.min(MAX_CONSENT_DAYS, Math.floor((bank.maximum_consent_validity || 90 * 86400) / 86400));
  const validUntil = new Date(Date.now() + days * 864e5 - 3600e3).toISOString(); // час запаса на часы банка
  const state = randomUUID();
  await kvPrune(db, 'auth:', 'at', Date.now() - 3600e3);
  await kvSet(db, `auth:${state}`, { aspsp: b.aspsp, country, psuType, at: Date.now() });
  const r = await eb.startAuth({ aspsp: b.aspsp, country, psuType, redirectUrl: b.redirectUrl, state, validUntil });
  return { url: r.url, days };
}

/**
 * Колбэк банка: создаём сессию и сами раскладываем её счета по нашим —
 * по identification_hash, затем по IBAN+валюте. Незнакомые счета заводим новыми.
 */
export async function completeConnect(db: Db, q: { code?: string | null; state?: string | null }) {
  const p = q.state ? await kvGet<{ aspsp: string } | null>(db, `auth:${q.state}`, null) : null;
  if (!p || !q.code) throw new Error('сессия привязки не найдена или устарела — начните заново');
  await kvDelete(db, `auth:${q.state}`);
  const s = await eb.createSession(q.code);
  const validUntil = s.access?.valid_until ?? null;
  const bankName = s.aspsp?.name ?? p.aspsp;
  const linked: string[] = [];
  const created: string[] = [];
  const ids: string[] = [];
  await db.transaction(async (tx) => {
    const ours = await tx.select().from(accounts).where(eq(accounts.closed, false));
    let sort = (await tx.select({ m: max(accounts.sort) }).from(accounts).get())?.m ?? 0;
    for (const x of s.accounts || []) {
      const iban = x.account_id?.iban ?? null;
      const match =
        ours.find((a) => a.ebHash && a.ebHash === x.identification_hash) ??
        ours.find((a) => iban && a.iban === iban && a.currency === x.currency);
      const link = {
        ebAccountId: x.uid,
        ebHash: x.identification_hash ?? null,
        ebSessionId: s.session_id,
        consentUntil: validUntil,
        bank: bankName,
        syncError: null,
      };
      if (match) {
        await tx
          .update(accounts)
          .set({ ...link, iban: iban ?? match.iban, currency: x.currency ?? match.currency })
          .where(eq(accounts.id, match.id));
        linked.push(match.name);
        ids.push(match.id);
      } else {
        const short = bankName.replace(/ Bank Polski$/, '');
        let name = `${short} ${x.currency}`;
        for (let i = 2; ours.some((a) => a.name === name); i++) name = `${short} ${x.currency} ${i}`;
        const row = { id: randomUUID(), name, currency: x.currency ?? 'PLN', sort: ++sort, iban, ...link };
        await tx.insert(accounts).values(row);
        ours.push({ ...row, offbudget: false, closed: false, bankBalance: null, syncedAt: null });
        created.push(name);
        ids.push(row.id);
      }
    }
  });
  return { bank: bankName, validUntil, linked, created, accountIds: ids };
}

/** Банки и их счета для страницы «Банки». */
export async function banksView(db: Db) {
  const list = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.closed, false), isNotNull(accounts.bank)))
    .orderBy(asc(accounts.sort));
  type Bank = {
    name: string;
    consentUntil: string | null;
    estimated: boolean;
    accounts: { id: string; name: string; currency: string; iban: string | null; bankBalance: number | null; syncedAt: string | null; error: string | null }[];
  };
  const banks = new Map<string, Bank>();
  for (const a of list) {
    const b = banks.get(a.bank as string) || { name: a.bank as string, consentUntil: a.consentUntil, estimated: false, accounts: [] };
    // без id сессии срок согласия известен лишь примерно (привязка была через Actual)
    if (!a.ebSessionId) b.estimated = true;
    if (a.consentUntil && (!b.consentUntil || a.consentUntil < b.consentUntil)) b.consentUntil = a.consentUntil;
    b.accounts.push({
      id: a.id,
      name: a.name,
      currency: a.currency,
      iban: a.iban,
      bankBalance: a.bankBalance == null ? null : a.bankBalance / 100,
      syncedAt: a.syncedAt,
      error: a.syncError,
    });
    banks.set(a.bank as string, b);
  }
  return [...banks.values()];
}

/** Согласия, которые кончились или кончатся в ближайшие 14 дней. */
export const expiringConsents = async (db: Db) =>
  (await banksView(db))
    .filter((b) => b.consentUntil && new Date(b.consentUntil).getTime() - Date.now() < 14 * 864e5)
    .map((b) => ({ bank: b.name, consentUntil: b.consentUntil as string }));
