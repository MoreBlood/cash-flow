import type {
  AccountRef,
  Aspsp,
  Balances,
  Bank,
  Category,
  Meta,
  NetWorthHistory,
  Rule,
  RuleCondition,
  Settings,
  Summary,
  TransactionsResponse,
} from './types';

/** Облачная установка без сессии → на вход, затем обратно на эту страницу. */
function signInIfNeeded(res: Response) {
  if (res.status !== 401) return;
  const back = window.location.pathname + window.location.search;
  window.location.href = `/sign-in?callbackURL=${encodeURIComponent(back)}`;
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  signInIfNeeded(res);
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

export interface Setup {
  /** облачная установка: вход через GitHub */
  auth: boolean;
  /** заданы GITHUB_CLIENT_ID / SECRET / ALLOWED_GITHUB_USERS (или вход не нужен) */
  authConfigured: boolean;
  baseUrl: string;
  /** callback для OAuth App на GitHub */
  githubCallbackUrl: string;
  login: string | null;
  /** Enable Banking настроен (EB_APP_ID + ключ) */
  eb: boolean;
  /** redirect URL для приложения Enable Banking */
  redirectUrl: string;
  /** адрес MCP-сервера для Claude / ChatGPT */
  mcpUrl: string;
}
export const fetchSetup = () => get<Setup>('/api/setup');

export const saveSettings = (patch: Partial<Settings>) => post<Settings>('/api/settings', patch);

export const excludeTransaction = (txId: string) => post<{ ok: boolean }>('/api/exclude', { txId });

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  signInIfNeeded(res);
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
  /** последний синк, в котором прошли все счета */
  lastBankSyncAt: string | null;
  lastAttemptAt?: string | null;
  /** счета, не синкнувшиеся в последней попытке (напр. истекло согласие банка) */
  failedAccounts?: string[];
  /** согласия банков, которые кончились или кончатся в ближайшие 14 дней */
  expiring?: { bank: string; consentUntil: string }[];
  syncing: boolean;
}

export const fetchSyncStatus = () => get<SyncStatus>('/api/sync-status');

export async function triggerBankSync(): Promise<Omit<SyncStatus, 'syncing' | 'expiring'>> {
  const res = await fetch('/api/bank-sync', { method: 'POST' });
  signInIfNeeded(res);
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
  signInIfNeeded(res);
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

// --- операции ---
export const updateTransaction = (b: {
  id: string;
  payee?: string;
  notes?: string;
  date?: string;
  amount?: number;
}) => post<{ ok: boolean }>('/api/transaction/update', b);

export const deleteTransaction = (id: string) =>
  post<{ ok: boolean }>('/api/transaction/delete', { id });

// --- категории ---
export const createCategory = (b: { name: string; groupId?: string; groupName?: string }) =>
  post<Category>('/api/categories', b);

export const renameCategory = (id: string, name: string) =>
  post<{ ok: boolean }>('/api/categories/rename', { id, name });

export const deleteCategory = (id: string, replaceWith: string | null) =>
  post<{ moved: number }>('/api/categories/delete', { id, replaceWith });

// --- правила ---
export const fetchRules = () => get<Rule[]>('/api/rules');

export const saveRule = (b: {
  id?: string;
  conditionsOp: 'and' | 'or';
  conditions: RuleCondition[];
  categoryId: string;
}) => post<{ id: string }>('/api/rules', b);

export const deleteRule = (id: string) => post<{ ok: boolean }>('/api/rules/delete', { id });

export const applyRules = () => post<{ updated: number }>('/api/rules/apply', {});

// --- банки ---
export const fetchBanks = () => get<Bank[]>('/api/banks');

export const fetchAspsps = (country = 'PL') => get<Aspsp[]>(`/api/banks/aspsps?country=${country}`);

/** → URL авторизации в банке (согласие на максимальный срок, до 180 дней) */
export const connectBank = (aspsp: string, country = 'PL') =>
  post<{ url: string; days: number }>('/api/banks/connect', { aspsp, country });

// --- Enable Banking (ключ приложения через UI) ---
export interface EbStatus {
  configured: boolean;
  /** env — переменные окружения, ui — сохранён на странице «Банки» */
  source: 'env' | 'ui' | null;
  redirectUrl: string;
  app?: { name: string | null; environment: string | null; active: boolean | null };
  /** зарегистрирован ли redirect URL в приложении EB (null — EB не сообщил) */
  redirectRegistered?: boolean | null;
  error?: string;
}
export const fetchEbStatus = () => get<EbStatus>('/api/eb');
export const saveEb = (appId: string, privateKey: string) =>
  post<EbStatus>('/api/eb', { appId, privateKey });
export const deleteEb = () => post<EbStatus>('/api/eb/delete', {});

// --- перенос данных между установками ---
export const importData = (data: unknown) =>
  post<{ accounts: number; categories: number; rules: number; transactions: number }>(
    '/api/import',
    data,
  );
