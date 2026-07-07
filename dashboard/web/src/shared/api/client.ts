import type {
  AccountRef,
  Balances,
  Category,
  Meta,
  NetWorthHistory,
  Settings,
  Summary,
  TransactionsResponse,
} from './types';

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const fetchSummary = (from: string, to: string, base = 'PLN') =>
  get<Summary>(`/api/summary?from=${from}&to=${to}&base=${base}`);

export const fetchMeta = () => get<Meta>('/api/meta');

export const fetchTransactions = (
  from: string,
  to: string,
  base = 'PLN',
  opts: { account?: string; limit?: number } = {},
) => {
  const q = new URLSearchParams({ from, to, base });
  if (opts.account) q.set('account', opts.account);
  if (opts.limit) q.set('limit', String(opts.limit));
  return get<TransactionsResponse>(`/api/transactions?${q.toString()}`);
};

export const fetchCategories = () => get<Category[]>('/api/categories');

export const fetchBalances = (base = 'PLN') => get<Balances>(`/api/balances?base=${base}`);

export const fetchNetWorthHistory = (base = 'PLN') =>
  get<NetWorthHistory>(`/api/networth-history?base=${base}`);

export const fetchAccounts = () => get<AccountRef[]>('/api/accounts');

export const fetchSettings = () => get<Settings>('/api/settings');

export const saveSettings = (patch: Partial<Settings>) => post<Settings>('/api/settings', patch);

export const excludeTransaction = (txId: string) => post<{ ok: boolean }>('/api/exclude', { txId });

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const addOperation = (b: {
  accountId: string;
  date: string;
  amount: number;
  notes?: string;
  categoryId?: string | null;
}) => post<{ ok: boolean }>('/api/operation', b);

export const addTransfer = (b: {
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  date: string;
}) => post<{ ok: boolean }>('/api/transfer', b);

export interface SyncStatus {
  lastBankSyncAt: string | null;
  syncing: boolean;
}

export const fetchSyncStatus = () => get<SyncStatus>('/api/sync-status');

export async function triggerBankSync(): Promise<{ lastBankSyncAt: string | null }> {
  const res = await fetch('/api/bank-sync', { method: 'POST' });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

/** Событие «данные обновились» — страницы перечитывают себя. */
export const REFRESH_EVENT = 'cashflow:refresh';
export const emitRefresh = () => window.dispatchEvent(new Event(REFRESH_EVENT));

export type CategorizePayload =
  | { categoryId: string; txId: string }
  | { categoryId: string; payee: string; from: string; to: string }
  | { categoryId: string; payee: string; allTime: true; rule: boolean };

export async function categorize(
  payload: CategorizePayload,
): Promise<{ updated: number; ruleCreated?: boolean }> {
  const res = await fetch('/api/categorize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}
