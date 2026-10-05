// Клиент Enable Banking API (https://enablebanking.com/docs/api/reference/) — официального JS SDK нет.
// Нормализация операций перенесена из actual-server (MIT), чтобы id/суммы/получатели
// совпадали с историей, импортированной ещё через Actual.
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

const API = 'https://api.enablebanking.com';
const ROOT = new URL('../../', import.meta.url).pathname;

export type Psu = { ip?: string; userAgent?: string };

export class EbError extends Error {
  status: number;
  /** 401/403 и «session closed/expired» — согласие кончилось, нужна переавторизация */
  loginRequired: boolean;
  constructor(status: number, body: unknown) {
    const b = typeof body === 'object' && body ? (body as { message?: string; error?: string }) : undefined;
    const msg = b?.message || (b ? JSON.stringify(b) : String(body));
    super(`Enable Banking ${status}: ${msg}`);
    this.status = status;
    this.loginRequired =
      status === 401 ||
      status === 403 ||
      (status >= 400 && status < 500 && /session|expired|consent/i.test(`${b?.error} ${msg}`));
  }
}

// ключ: EB_PRIVATE_KEY (содержимое .pem — удобно в облаке) или EB_KEY_FILE (путь к .pem)
export const ebConfigured = () =>
  !!(process.env.EB_APP_ID && (process.env.EB_PRIVATE_KEY || process.env.EB_KEY_FILE));

let key: string | Buffer | undefined;
function privateKey() {
  if (process.env.EB_PRIVATE_KEY) return process.env.EB_PRIVATE_KEY.replace(/\\n/g, '\n');
  const file = process.env.EB_KEY_FILE as string;
  return readFileSync(isAbsolute(file) ? file : join(ROOT, file));
}

function jwt() {
  if (!ebConfigured()) throw new Error('Enable Banking не настроен: нужны EB_APP_ID и EB_PRIVATE_KEY (или EB_KEY_FILE)');
  key ??= privateKey();
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ typ: 'JWT', alg: 'RS256', kid: process.env.EB_APP_ID })}.${b64({
    iss: 'enablebanking.com',
    aud: 'api.enablebanking.com',
    iat: now,
    exp: now + 3600,
  })}`;
  return `${unsigned}.${createSign('RSA-SHA256').update(unsigned).sign(key, 'base64url')}`;
}

/** psu — когда синк запускает человек (PSD2: без PSU-заголовков ≤4 фоновых запросов в сутки). */
async function request<T>(method: string, path: string, opts: { body?: unknown; psu?: Psu } = {}): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${jwt()}`, 'Content-Type': 'application/json' };
  if (opts.psu?.ip) headers['Psu-Ip-Address'] = opts.psu.ip;
  if (opts.psu?.userAgent) headers['Psu-User-Agent'] = opts.psu.userAgent;
  const r = await fetch(API + path, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await r.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!r.ok) throw new EbError(r.status, data);
  return data as T;
}

// --- типы ответов (только используемые поля) ---------------------------------
export type EbParty = { name?: string | null } | null;
export type EbTransaction = {
  entry_reference?: string | null;
  transaction_id?: string | null;
  booking_date?: string | null;
  value_date?: string | null;
  transaction_date?: string | null;
  credit_debit_indicator?: 'CRDT' | 'DBIT' | string;
  transaction_amount?: { amount?: string; currency?: string };
  creditor?: EbParty;
  debtor?: EbParty;
  remittance_information?: string[] | null;
  status?: string;
};
export type EbBalance = { balance_type: string; balance_amount: { amount: string; currency: string } };
export type EbSessionAccount = {
  uid: string;
  identification_hash?: string;
  account_id?: { iban?: string };
  currency?: string;
  name?: string;
};
export type EbSession = {
  session_id: string;
  accounts?: EbSessionAccount[];
  aspsp?: { name: string; country: string };
  access?: { valid_until?: string };
};
export type EbAspsp = { name: string; country: string; maximum_consent_validity?: number };

const enc = encodeURIComponent;

export const eb = {
  aspsps: (country: string, psuType = 'personal') =>
    request<{ aspsps: EbAspsp[] }>('GET', `/aspsps?country=${enc(country)}&psu_type=${psuType}`),
  /** → {url}; validUntil — ISO, не больше maximum_consent_validity банка */
  startAuth: (o: { aspsp: string; country: string; psuType: string; redirectUrl: string; state: string; validUntil: string }) =>
    request<{ url: string }>('POST', '/auth', {
      body: {
        aspsp: { name: o.aspsp, country: o.country },
        redirect_url: o.redirectUrl,
        state: o.state,
        access: { valid_until: o.validUntil },
        psu_type: o.psuType,
      },
    }),
  /** code из колбэка банка → сессия со счетами */
  createSession: (code: string) => request<EbSession>('POST', '/sessions', { body: { code } }),
  accountDetails: (uid: string, psu?: Psu) =>
    request<EbSessionAccount>('GET', `/accounts/${enc(uid)}/details`, { psu }),
  balances: (uid: string, psu?: Psu) => request<{ balances?: EbBalance[] }>('GET', `/accounts/${enc(uid)}/balances`, { psu }),
  async transactions(uid: string, dateFrom: string, dateTo: string, psu?: Psu) {
    const out: EbTransaction[] = [];
    let ck: string | undefined;
    for (let i = 0; i < 100; i++) {
      const q = `date_from=${dateFrom}&date_to=${dateTo}${ck ? `&continuation_key=${enc(ck)}` : ''}`;
      const r = await request<{ transactions?: EbTransaction[]; continuation_key?: string }>(
        'GET',
        `/accounts/${enc(uid)}/transactions?${q}`,
        { psu },
      );
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
const cleanRemittance = (arr?: string[] | null) =>
  (arr || []).map((s) => s.replace(SEPA_PREFIX, '').trim()).filter(Boolean);

export type NormalizedTx = {
  importedId: string;
  date: string;
  /** минорные единицы */
  amount: number;
  payee: string;
  notes: string;
  booked: boolean;
};

/** Операция EB → нормализованная или null, если не импортируется. */
export function normalizeTx(tx: EbTransaction): NormalizedTx | null {
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
  const signed = tx.credit_debit_indicator === 'DBIT' ? `-${abs}` : tx.credit_debit_indicator === 'CRDT' ? abs : raw;
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

/** Баланс счёта (минорные ед.): CLAV, иначе первый из списка. */
export function pickBalance(balances: EbBalance[]) {
  const b = balances.find((x) => x.balance_type === 'CLAV') ?? balances[0];
  return b ? Math.round(Number(b.balance_amount.amount) * 100) : null;
}
