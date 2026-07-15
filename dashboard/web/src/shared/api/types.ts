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
  isIncome: boolean;
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
  accountCurrencies: Record<string, string>;
}

export interface NetWorthPoint {
  date: string;
  totalPln: number;
}

export interface NetWorthHistory {
  series: NetWorthPoint[];
}
