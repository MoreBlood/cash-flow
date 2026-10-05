export interface PayeeSum {
  name: string;
  currency: 'PLN' | 'EUR' | 'USD' | 'CHF';
  sum: number;
  native: number;
  count: number;
}

export interface Category {
  id: string;
  name: string;
  group: string;
  groupId: string;
  isIncome: boolean;
  /** операций в категории */
  count: number;
}

export interface FeedTx {
  id: string;
  date: string;
  payee: string;
  account: string;
  accountId: string;
  currency: 'PLN' | 'EUR' | 'USD' | 'CHF';
  native: number;
  amount: number;
  categoryId: string | null;
  category: string | null;
  excluded: boolean;
  isTransfer: boolean;
  startingBalance?: boolean;
  notes: string;
  /** заведена вручную (не из банка): можно менять дату/сумму и удалять */
  manual: boolean;
  /** банк ещё не провёл */
  pending: boolean;
}

export interface TransactionsResponse {
  from: string;
  to: string;
  base: string;
  transactions: FeedTx[];
}

export interface CategorySummary {
  group: string;
  name: string;
  isIncome: boolean;
  total: number;
  count: number;
  payees: PayeeSum[];
}

export interface AccountSummary {
  name: string;
  currency: 'PLN' | 'EUR' | 'USD' | 'CHF';
  net: number;
  count: number;
}

export interface DailyPoint {
  date: string;
  net: number;
  expense: number;
  cum: number;
  byCat: { name: string; amount: number }[];
}

export interface UncategorizedTx {
  id: string;
  date: string;
  amount: number;
  payee: string;
  account: string;
}

export interface Summary {
  from: string;
  to: string;
  income: number;
  expense: number;
  net: number;
  savingsRate: number | null;
  excludedCount: number;
  categories: CategorySummary[];
  accounts: AccountSummary[];
  daily: DailyPoint[];
  uncategorized: UncategorizedTx[];
}

export interface Meta {
  firstDate: string;
  lastDate: string;
}

export interface AccountBalance {
  id: string;
  name: string;
  currency: 'PLN' | 'EUR' | 'USD' | 'CHF';
  balance: number;
  balancePln: number;
  offBudget: boolean;
}

export interface Balances {
  accounts: AccountBalance[];
  totalPln: number;
  rates: Record<string, number>;
  base?: string;
}

export interface AccountRef {
  id: string;
  name: string;
  currency: 'PLN' | 'EUR' | 'USD' | 'CHF';
  offBudget: boolean;
}

export interface Settings {
  excludedGroup: string;
  transferCategoryId: string | null;
  excludeCategoryId: string | null;
}

export interface BankAccount {
  id: string;
  name: string;
  currency: string;
  iban: string | null;
  bankBalance: number | null;
  syncedAt: string | null;
  /** 'login_required' — согласие кончилось; иначе текст ошибки */
  error: string | null;
}

export interface Bank {
  name: string;
  consentUntil: string | null;
  /** срок известен примерно (привязка была через Actual) */
  estimated: boolean;
  accounts: BankAccount[];
}

export interface Aspsp {
  name: string;
  country: string;
  maxConsentDays: number;
}

export type RuleField = 'payee' | 'imported_payee' | 'notes';
export type RuleOp = 'is' | 'contains' | 'oneOf';

export interface RuleCondition {
  field: RuleField;
  op: RuleOp;
  value: string | string[];
}

export interface Rule {
  id: string;
  conditionsOp: 'and' | 'or';
  conditions: RuleCondition[];
  categoryId: string;
  category: string | null;
  /** сколько операций из истории подпадает */
  matches: number;
}

export interface NetWorthPoint {
  date: string;
  totalPln: number;
}

export interface NetWorthHistory {
  series: NetWorthPoint[];
}
