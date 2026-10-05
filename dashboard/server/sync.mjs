// Банк-синк через Enable Banking: импорт операций, привязка счетов после переавторизации.
import { randomUUID } from 'node:crypto';
import { kvGet, kvSet, newId, tx } from './db.mjs';
import { eb, normalizeTx, pickBalance } from './eb.mjs';
import { shiftDays, today } from './fx.mjs';
import { categoryFor, loadRules } from './rules.mjs';

const OVERLAP_DAYS = 14; // перезапрашиваем хвост: банки задним числом проводят и правят операции
const MAX_DAYS = 89; // PSD2: дальше 90 дней без SCA банки обычно не отдают
const MAX_CONSENT_DAYS = 180;
const PENDING_MARGIN = 3; // pending банк фильтрует по дате авторизации, а она бывает раньше нашей даты
const nowIso = () => new Date().toISOString();

/** Имя получателя в регистре, принятом в истории («KIRILL ARTIHOVICH», а не «Kirill Artihovich»). */
function payeeCanon(db) {
  const m = new Map();
  for (const r of db.prepare('SELECT payee, COUNT(*) AS n FROM transactions GROUP BY payee ORDER BY n').all())
    m.set(r.payee.toLowerCase(), r.payee);
  return (name) => (name ? (m.get(name.toLowerCase()) ?? name) : '—');
}

async function syncAccount(db, a, psu) {
  // счёт, привязанный ещё через Actual: один раз дотягиваем стабильный hash и IBAN
  if (!a.eb_hash) {
    const d = await eb.accountDetails(a.eb_account_id, psu);
    db.prepare('UPDATE accounts SET eb_hash = ?, iban = COALESCE(?, iban) WHERE id = ?').run(
      d.identification_hash ?? null,
      d.account_id?.iban ?? null,
      a.id,
    );
  }
  const q = (sql) => db.prepare(sql).get(a.id).d;
  const lastBooked = q('SELECT MAX(date) AS d FROM transactions WHERE account_id = ? AND imported_id IS NOT NULL AND cleared = 1');
  const oldestPending = q('SELECT MIN(date) AS d FROM transactions WHERE account_id = ? AND imported_id IS NOT NULL AND cleared = 0');
  const isNew = !q('SELECT COUNT(*) AS d FROM transactions WHERE account_id = ?');
  const floor = shiftDays(today(), -MAX_DAYS);
  let from = lastBooked ? shiftDays(lastBooked, -OVERLAP_DAYS) : floor;
  if (oldestPending && shiftDays(oldestPending, -PENDING_MARGIN) < from) from = shiftDays(oldestPending, -PENDING_MARGIN);
  if (from < floor) from = floor;

  const raw = await eb.transactions(a.eb_account_id, from, today(), psu);
  const bankBalance = pickBalance((await eb.balances(a.eb_account_id, psu)).balances || []);

  const rules = loadRules(db);
  const canon = payeeCanon(db);
  const byImported = db.prepare('SELECT * FROM transactions WHERE account_id = ? AND imported_id = ?');
  const insert = db.prepare(
    `INSERT INTO transactions (id, account_id, date, amount, payee, imported_payee, notes, category_id,
       imported_id, raw, cleared, starting_balance) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const update = db.prepare(
    `UPDATE transactions SET date = ?, amount = ?, payee = ?, imported_payee = ?, category_id = ?, raw = ?,
       cleared = ?, updated_at = ? WHERE id = ?`,
  );
  const stats = { added: 0, updated: 0, removed: 0 };

  tx(db, () => {
    const seen = new Set();
    for (const r of raw) {
      const n = normalizeTx(r);
      if (!n) continue;
      seen.add(n.importedId);
      const payee = canon(n.payee);
      const fields = { payee, imported_payee: n.payee || null, notes: n.notes };
      const cur = byImported.get(a.id, n.importedId);
      if (!cur) {
        insert.run(newId(), a.id, n.date, n.amount, payee, n.payee || null, n.notes, categoryFor(rules, fields),
          n.importedId, JSON.stringify(r), n.booked ? 1 : 0, 0);
        stats.added++;
        continue;
      }
      const cleared = n.booked ? 1 : 0;
      if (cur.date === n.date && cur.amount === n.amount && cur.cleared === cleared && cur.imported_payee === (n.payee || null))
        continue;
      // pending → проведена: банк уточняет дату/сумму/имя. Правки пользователя (переименование,
      // категория, заметка) не трогаем.
      const renamed = cur.imported_payee && cur.payee.toLowerCase() !== cur.imported_payee.toLowerCase();
      update.run(n.date, n.amount, renamed ? cur.payee : payee, n.payee || null,
        cur.category_id ?? categoryFor(rules, fields), JSON.stringify(r), cleared, nowIso(), cur.id);
      stats.updated++;
    }
    // pending из окна запроса (с запасом от края), которых банк больше не отдаёт, — отменённые блокировки
    const safeFrom = shiftDays(from, PENDING_MARGIN);
    if (raw.length)
      for (const t of db
        .prepare('SELECT id, imported_id FROM transactions WHERE account_id = ? AND cleared = 0 AND imported_id IS NOT NULL AND date >= ?')
        .all(a.id, safeFrom)) {
        if (seen.has(t.imported_id)) continue;
        db.prepare('DELETE FROM transactions WHERE id = ?').run(t.id);
        stats.removed++;
      }
    // новый счёт: история только за 90 дней — добиваем стартовым остатком до баланса банка
    if (isNew && bankBalance != null) {
      const { s, d } = db.prepare('SELECT COALESCE(SUM(amount), 0) AS s, MIN(date) AS d FROM transactions WHERE account_id = ?').get(a.id);
      const cat = db.prepare("SELECT id FROM categories WHERE name = 'Starting Balances'").get()?.id ?? null;
      insert.run(newId(), a.id, d ?? today(), bankBalance - s, 'Starting Balance', null, '', cat, null, null, 1, 1);
    }
    db.prepare('UPDATE accounts SET bank_balance = ?, synced_at = ?, sync_error = NULL WHERE id = ?').run(bankBalance, nowIso(), a.id);
  });
  return stats;
}

let running = null;

/**
 * Синк всех привязанных счетов. psu — {ip, userAgent}, когда запускает человек из дашборда.
 * → {lastBankSyncAt, lastAttemptAt, failedAccounts, added, updated, removed}
 */
export function runBankSync(db, { psu, accountIds, onDone } = {}) {
  running ??= (async () => {
    const accounts = db
      .prepare('SELECT * FROM accounts WHERE closed = 0 AND eb_account_id IS NOT NULL ORDER BY sort')
      .all()
      .filter((a) => !accountIds || accountIds.includes(a.id));
    const failedAccounts = [];
    const total = { added: 0, updated: 0, removed: 0 };
    for (const a of accounts) {
      try {
        const s = await syncAccount(db, a, psu);
        for (const k of Object.keys(total)) total[k] += s[k];
      } catch (e) {
        failedAccounts.push(a.name);
        const err = e.loginRequired ? 'login_required' : String(e.message || e).slice(0, 300);
        db.prepare('UPDATE accounts SET sync_error = ? WHERE id = ?').run(err, a.id);
        console.error(`[bank-sync] ${a.name}:`, e.message || e);
      }
    }
    const now = nowIso();
    // «обновлено» — только когда синкнулось всё; при сбое прошлую отметку не трогаем
    const state = {
      lastBankSyncAt: failedAccounts.length ? (kvGet(db, 'bankSync', {}).lastBankSyncAt ?? null) : now,
      lastAttemptAt: now,
      failedAccounts,
      ...total,
    };
    if (!accountIds) kvSet(db, 'bankSync', state);
    console.log(`[bank-sync] +${total.added} ~${total.updated} -${total.removed}, сбоев: ${failedAccounts.length}`);
    await onDone?.(state);
    return state;
  })().finally(() => {
    running = null;
  });
  return running;
}

export const isSyncing = () => !!running;

// --- привязка банка ------------------------------------------------------------
const pendingAuth = new Map(); // state → {aspsp, country, psuType, at}

export const REDIRECT_URL = () => process.env.EB_REDIRECT_URL || 'https://localhost:5443/enablebanking/auth_callback';

/** Старт авторизации в банке → URL, куда отправить пользователя. Согласие — максимум, что даёт банк (≤180 дней). */
export async function startConnect({ aspsp, country = 'PL', psuType = 'personal' }) {
  const bank = (await eb.aspsps(country, psuType)).aspsps.find((b) => b.name === aspsp);
  if (!bank) throw new Error(`банк «${aspsp}» не найден в Enable Banking (${country})`);
  const days = Math.min(MAX_CONSENT_DAYS, Math.floor((bank.maximum_consent_validity || 90 * 86400) / 86400));
  const validUntil = new Date(Date.now() + days * 864e5 - 3600e3).toISOString(); // час запаса на часы банка
  const state = randomUUID();
  for (const [k, v] of pendingAuth) if (Date.now() - v.at > 3600e3) pendingAuth.delete(k);
  pendingAuth.set(state, { aspsp, country, psuType, at: Date.now() });
  const r = await eb.startAuth({ aspsp, country, psuType, redirectUrl: REDIRECT_URL(), state, validUntil });
  return { url: r.url, days };
}

/**
 * Колбэк банка: создаём сессию и сами раскладываем её счета по нашим —
 * по identification_hash, затем по IBAN+валюте. Незнакомые счета заводим новыми.
 */
export async function completeConnect(db, { code, state }) {
  const p = pendingAuth.get(state);
  if (!p) throw new Error('сессия привязки не найдена или устарела — начните заново');
  pendingAuth.delete(state);
  const s = await eb.createSession(code);
  const validUntil = s.access?.valid_until ?? null;
  const bankName = s.aspsp?.name ?? p.aspsp;
  const linked = [];
  const created = [];
  const ids = [];
  tx(db, () => {
    const ours = db.prepare('SELECT * FROM accounts WHERE closed = 0').all();
    let sort = db.prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM accounts').get().m;
    for (const x of s.accounts || []) {
      const iban = x.account_id?.iban ?? null;
      const match =
        ours.find((a) => a.eb_hash && a.eb_hash === x.identification_hash) ??
        ours.find((a) => iban && a.iban === iban && a.currency === x.currency);
      if (match) {
        db.prepare(
          `UPDATE accounts SET eb_account_id = ?, eb_hash = ?, iban = COALESCE(?, iban), currency = COALESCE(?, currency),
             eb_session_id = ?, consent_until = ?, bank = ?, sync_error = NULL WHERE id = ?`,
        ).run(x.uid, x.identification_hash ?? null, iban, x.currency ?? null, s.session_id, validUntil, bankName, match.id);
        linked.push(match.name);
        ids.push(match.id);
      } else {
        const short = bankName.replace(/ Bank Polski$/, '');
        let name = `${short} ${x.currency}`;
        for (let i = 2; ours.some((a) => a.name === name); i++) name = `${short} ${x.currency} ${i}`;
        const id = newId();
        db.prepare(
          `INSERT INTO accounts (id, name, currency, sort, bank, iban, eb_account_id, eb_hash, eb_session_id, consent_until)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(id, name, x.currency, ++sort, bankName, iban, x.uid, x.identification_hash ?? null, s.session_id, validUntil);
        ours.push({ id, name, iban, currency: x.currency, eb_hash: x.identification_hash });
        created.push(name);
        ids.push(id);
      }
    }
  });
  return { bank: bankName, validUntil, linked, created, accountIds: ids };
}

/** Банки и их счета для страницы «Банки». */
export function banksView(db) {
  const accounts = db
    .prepare('SELECT * FROM accounts WHERE closed = 0 AND bank IS NOT NULL ORDER BY sort')
    .all();
  const banks = new Map();
  for (const a of accounts) {
    // без id сессии срок согласия известен лишь примерно (привязка была через Actual)
    const b = banks.get(a.bank) || { name: a.bank, consentUntil: a.consent_until, estimated: false, accounts: [] };
    if (!a.eb_session_id) b.estimated = true;
    if (a.consent_until && (!b.consentUntil || a.consent_until < b.consentUntil)) b.consentUntil = a.consent_until;
    b.accounts.push({
      id: a.id,
      name: a.name,
      currency: a.currency,
      iban: a.iban,
      bankBalance: a.bank_balance == null ? null : a.bank_balance / 100,
      syncedAt: a.synced_at,
      error: a.sync_error,
    });
    banks.set(a.bank, b);
  }
  return [...banks.values()];
}
