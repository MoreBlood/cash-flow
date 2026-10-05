// Клиент Enable Banking API (https://enablebanking.com/docs/api/reference/).
// Нормализация операций перенесена из actual-server (MIT), чтобы id/суммы/получатели
// совпадали с уже импортированной историей.
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

const API = 'https://api.enablebanking.com';
const ROOT = new URL('../../', import.meta.url).pathname;

export class EbError extends Error {
  constructor(status, body) {
    const msg = typeof body === 'object' ? body?.message || JSON.stringify(body) : String(body);
    super(`Enable Banking ${status}: ${msg}`);
    this.status = status;
    this.code = typeof body === 'object' ? body?.error : undefined;
    // 401/403 и «session closed/expired» — согласие кончилось, нужна переавторизация
    this.loginRequired =
      status === 401 ||
      status === 403 ||
      (status >= 400 && status < 500 && /session|expired|consent/i.test(`${this.code} ${msg}`));
  }
}

export const ebConfigured = () => !!(process.env.EB_APP_ID && process.env.EB_KEY_FILE);

let key;
function jwt() {
  const app = process.env.EB_APP_ID;
  if (!ebConfigured()) throw new Error('EB_APP_ID / EB_KEY_FILE не заданы в .env');
  const file = process.env.EB_KEY_FILE;
  key ??= readFileSync(isAbsolute(file) ? file : join(ROOT, file));
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ typ: 'JWT', alg: 'RS256', kid: app })}.${b64({
    iss: 'enablebanking.com',
    aud: 'api.enablebanking.com',
    iat: now,
    exp: now + 3600,
  })}`;
  return `${unsigned}.${createSign('RSA-SHA256').update(unsigned).sign(key, 'base64url')}`;
}

/** psu: {ip, userAgent} — когда синк запускает человек (PSD2: без них ≤4 фоновых запросов в сутки). */
async function request(method, path, { body, psu } = {}) {
  const headers = { Authorization: `Bearer ${jwt()}`, 'Content-Type': 'application/json' };
  if (psu?.ip) headers['Psu-Ip-Address'] = psu.ip;
  if (psu?.userAgent) headers['Psu-User-Agent'] = psu.userAgent;
  const r = await fetch(API + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await r.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!r.ok) throw new EbError(r.status, data);
  return data;
}

const enc = encodeURIComponent;

export const eb = {
  aspsps: (country, psuType = 'personal') => request('GET', `/aspsps?country=${enc(country)}&psu_type=${psuType}`),
  /** → {url, authorization_id}; validUntil — ISO, не больше maximum_consent_validity банка */
  startAuth: ({ aspsp, country, psuType = 'personal', redirectUrl, state, validUntil }) =>
    request('POST', '/auth', {
      body: {
        aspsp: { name: aspsp, country },
        redirect_url: redirectUrl,
        state,
        access: { valid_until: validUntil },
        psu_type: psuType,
      },
    }),
  /** code из колбэка → сессия {session_id, accounts: [...], aspsp, access: {valid_until}} */
  createSession: (code) => request('POST', '/sessions', { body: { code } }),
  session: (id) => request('GET', `/sessions/${enc(id)}`),
  deleteSession: (id) => request('DELETE', `/sessions/${enc(id)}`),
  accountDetails: (uid, psu) => request('GET', `/accounts/${enc(uid)}/details`, { psu }),
  balances: (uid, psu) => request('GET', `/accounts/${enc(uid)}/balances`, { psu }),
  async transactions(uid, dateFrom, dateTo, psu) {
    const out = [];
    let ck;
    for (let i = 0; i < 100; i++) {
      const q = `date_from=${dateFrom}&date_to=${dateTo}${ck ? `&continuation_key=${enc(ck)}` : ''}`;
      const r = await request('GET', `/accounts/${enc(uid)}/transactions?${q}`, { psu });
      out.push(...(r.transactions || []));
      if (!r.continuation_key || r.continuation_key === ck) break;
      ck = r.continuation_key;
    }
    return out;
  },
};

// --- нормализация -------------------------------------------------------------
const SEPA_PREFIX =
  /^(?:EREF|KREF|MREF|CRED|DBTR|CDTR|SVWZ|SVCL|PURP|RTRN|REJT|REFE|SDVA|INDA|NTAV|ULTC|ULTD|ULTB|ABWA|ABWE|IBAN|BIC|COAM|OAMT|REMI|SQTP|ROC)\+/;
const cleanRemittance = (arr) => (arr || []).map((s) => s.replace(SEPA_PREFIX, '').trim()).filter(Boolean);

/** Операция EB → {importedId, date, amount (минорные ед.), payee, notes, booked} или null, если не импортируется. */
export function normalizeTx(tx) {
  const importedId = tx.entry_reference || tx.transaction_id || '';
  const date = tx.booking_date || tx.value_date || tx.transaction_date || '';
  let payee = '';
  if (tx.credit_debit_indicator === 'CRDT' && tx.debtor?.name) payee = tx.debtor.name;
  else if (tx.credit_debit_indicator === 'DBIT' && tx.creditor?.name) payee = tx.creditor.name;
  else if (tx.creditor?.name) payee = tx.creditor.name;
  else if (tx.debtor?.name) payee = tx.debtor.name;
  else payee = cleanRemittance(tx.remittance_information)[0] || '';
  const raw = String(tx.transaction_amount?.amount ?? '').trim();
  const abs = raw.replace(/^[+-]/, '');
  const signed =
    tx.credit_debit_indicator === 'DBIT' ? `-${abs}` : tx.credit_debit_indicator === 'CRDT' ? abs : raw;
  const amount = Math.round(Number(signed) * 100);
  if (!importedId || !/^\d{4}-\d{2}-\d{2}$/.test(date) || signed === '' || !Number.isFinite(amount)) return null;
  return {
    importedId,
    date,
    amount,
    payee: payee.trim(),
    notes: cleanRemittance(tx.remittance_information).join(' '),
    booked: tx.status !== 'PDNG',
  };
}

/** Баланс счёта (минорные ед.): как в Actual — CLAV, иначе первый из списка. */
export function pickBalance(balances) {
  const b = balances.find((x) => x.balance_type === 'CLAV') ?? balances[0];
  return b ? Math.round(Number(b.balance_amount.amount) * 100) : null;
}
