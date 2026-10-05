// Демо-данные для скриншотов: вымышленный человек в Варшаве, ~8 месяцев, PLN/EUR/USD.
// Детерминированно (свой PRNG) — повторный запуск даёт те же цифры.
//   node scripts/demo-data.ts > demo.json   → «Настройки → Перенос данных → Загрузить из файла» или POST /api/import
import { SEED_CATEGORIES, SEED_RULES } from '../src/db/seed.ts';

let seed = 20261005;
const rnd = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const between = (a: number, b: number) => a + rnd() * (b - a);
const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
const chance = (p: number) => rnd() < p;
const uuid = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(rnd() * 16);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
const cents = (v: number) => Math.round(v * 100);

const START = '2026-02-01';
const END = '2026-10-05';
const days: string[] = [];
for (let d = new Date(START); d <= new Date(END); d = new Date(d.getTime() + 864e5)) days.push(d.toISOString().slice(0, 10));
const now = new Date('2026-10-05T17:40:00Z');

// --- категории (стартовый набор + питомцы) --------------------------------------
const groups: { id: string; name: string; isIncome: boolean; sort: number }[] = [];
const categories: { id: string; groupId: string; name: string; isIncome: boolean; sort: number }[] = [];
const cat: Record<string, string> = {};
for (const [name, isIncome, cats] of [...SEED_CATEGORIES, ['Питомцы', false, ['Питомцы']] as [string, boolean, string[]]]) {
  const g = { id: uuid(), name, isIncome, sort: groups.length + 1 };
  groups.push(g);
  for (const c of cats) {
    cat[c] = uuid();
    categories.push({ id: cat[c], groupId: g.id, name: c, isIncome, sort: categories.length + 1 });
  }
}
const rules = Object.entries(SEED_RULES).map(([c, keys]) => ({
  id: uuid(),
  conditionsOp: (keys.length > 1 ? 'or' : 'and') as 'or' | 'and',
  conditions: keys.map((value) => ({ field: 'imported_payee' as const, op: 'contains' as const, value })),
  categoryId: cat[c],
  createdAt: START,
}));

// --- счета -----------------------------------------------------------------------
type Acc = { id: string; name: string; currency: string; bank: string | null; offbudget?: boolean; iban?: string };
const A = {
  revPln: { id: uuid(), name: 'Revolut PLN', currency: 'PLN', bank: 'Revolut', iban: 'LT603250000000000001' },
  revEur: { id: uuid(), name: 'Revolut EUR', currency: 'EUR', bank: 'Revolut', iban: 'LT603250000000000002' },
  revUsd: { id: uuid(), name: 'Revolut USD', currency: 'USD', bank: 'Revolut', iban: 'LT603250000000000002' },
  pkoPln: { id: uuid(), name: 'PKO PLN', currency: 'PLN', bank: 'PKO Bank Polski', iban: 'PL61102010260000000000000001' },
  pkoSav: { id: uuid(), name: 'PKO Oszczędności', currency: 'PLN', bank: 'PKO Bank Polski', iban: 'PL61102010260000000000000002' },
  cashEur: { id: uuid(), name: 'Наличные EUR', currency: 'EUR', bank: null },
  invest: { id: uuid(), name: 'Инвестиции USD', currency: 'USD', bank: null, offbudget: true },
} satisfies Record<string, Acc>;

type Tx = {
  id: string;
  accountId: string;
  date: string;
  amount: number;
  payee: string;
  importedPayee: string | null;
  notes: string;
  categoryId: string | null;
  importedId: string | null;
  startingBalance: boolean;
  cleared: boolean;
  createdAt: string;
  updatedAt: null;
};
const txs: Tx[] = [];
const add = (a: Acc, date: string, amount: number, payee: string, category: string | null, o: { notes?: string; pending?: boolean; start?: boolean } = {}) =>
  txs.push({
    id: uuid(),
    accountId: a.id,
    date,
    amount: cents(amount),
    payee,
    importedPayee: a.bank && !o.start ? payee : null,
    notes: o.notes ?? (a.bank ? payee : ''),
    categoryId: category ? cat[category] : null,
    importedId: a.bank && !o.start ? uuid() : null,
    startingBalance: !!o.start,
    cleared: !o.pending,
    createdAt: `${date}T12:00:00.000Z`,
    updatedAt: null,
  });
const transfer = (from: Acc, to: Acc, date: string, amount: number, toAmount = amount, label = 'Переводы между счетами') => {
  add(from, date, -amount, from.currency === to.currency ? `Перевод на ${to.name}` : `Exchanged to ${to.currency}`, label);
  add(to, date, toAmount, from.currency === to.currency ? `Top-up by ${from.name}` : `Exchanged from ${from.currency}`, label);
};

// стартовые остатки
add(A.revPln, START, 6200, 'Starting Balance', null, { start: true });
add(A.revEur, START, 1850, 'Starting Balance', null, { start: true });
add(A.revUsd, START, 240, 'Starting Balance', null, { start: true });
add(A.pkoPln, START, 18400, 'Starting Balance', null, { start: true });
add(A.pkoSav, START, 52000, 'Starting Balance', null, { start: true });
add(A.cashEur, START, 900, 'Starting Balance', null, { start: true });
add(A.invest, START, 24000, 'Starting Balance', null, { start: true });

const grocery = ['Biedronka 4123', 'Zabka Z1287 K.1', 'Lidl Mokotow', 'Carrefour Express', 'Auchan Wola', 'Zabka Z0431 K.2', 'Kaufland Ursynow'];
const food = ['Wolt', 'Glovo', 'Starbucks Zlote Tarasy', 'Costa Coffee', 'Pizza Hut Arkadia', 'Bistro Mokotow', 'Sushi Kushi', 'Kebab King', 'Green Caffe Nero'];
const transport = ['Uber', 'Bolt.eu', 'Jakdojade.pl'];
const shops = ['Allegro', 'Zalando', 'Rossmann 214', 'Media Expert', 'Decathlon', 'H&M', 'Pepco'];

for (const d of days) {
  const day = Number(d.slice(8));
  const month = d.slice(0, 7);
  const wd = new Date(d).getUTCDay();
  const weekend = wd === 0 || wd === 6;

  // ежедневное
  if (chance(0.55)) add(A.revPln, d, -between(9, weekend ? 190 : 85), pick(grocery), 'Продукты');
  if (chance(weekend ? 0.6 : 0.35)) add(A.revPln, d, -between(16, 135), pick(food), 'Рестораны и доставка');
  if (chance(0.3)) {
    const t = pick(transport);
    add(A.revPln, d, -(t.startsWith('Jak') ? pick([3.4, 4.4, 6.8]) : between(14, 48)), t, 'Транспорт');
  }
  if (chance(0.12)) add(A.revPln, d, -between(25, 420), pick(shops), 'Покупки');
  if (chance(0.05)) add(A.revPln, d, -between(18, 140), pick(['Apteka Gemini', 'Super-Pharm', 'Apteka DOZ']), 'Здоровье');
  if (chance(0.05)) add(A.revPln, d, -between(38, 96), pick(['Cinema City', 'Teatr Polonia', 'Bilety Ticketmaster']), 'Развлечения');
  if (chance(0.06)) add(A.revPln, d, -between(30, 160), 'Anna Kowalska', 'Семья');
  if (chance(0.05)) add(A.revPln, d, pick([1, -1]) * between(20, 120), pick(['Tomasz Nowicki', 'Marta Zielinska', 'Piotr Wisniewski']), 'Друзья');

  // ежемесячное
  if (day === 1) add(A.pkoPln, d, -4200, 'WYNAJEM MIESZKANIA UL. PULAWSKA', 'Жильё');
  if (day === 3) add(A.revPln, d, -43, 'Netflix.com', 'Подписки');
  if (day === 4) add(A.revPln, d, -23.99, 'Spotify', 'Подписки');
  if (day === 7) add(A.revUsd, d, -20, 'OpenAI ChatGPT', 'Подписки');
  if (day === 9) add(A.revUsd, d, -4, 'GitHub, Inc.', 'Подписки');
  if (day === 10) add(A.pkoPln, d, 15600, 'ACME SOFTWARE SP. Z O.O.', 'Доход', { notes: `Wynagrodzenie ${month}` });
  if (day === 11) {
    transfer(A.pkoPln, A.revPln, d, 5200);
    transfer(A.pkoPln, A.pkoSav, d, 2000);
  }
  if (day === 12) add(A.pkoPln, d, -65, 'Orange Polska', 'Коммунальные и связь');
  if (day === 14) add(A.pkoPln, d, -79, 'UPC Polska', 'Коммунальные и связь');
  if (day === 15 && Number(month.slice(5)) % 2 === 0) add(A.pkoPln, d, -between(160, 230), 'PGE Obrot', 'Коммунальные и связь');
  if (day === 18) add(A.pkoPln, d, -1640.27, 'NBP ZUS SKŁADKI', 'Налоги и взносы');
  if (day === 20) add(A.pkoPln, d, -between(980, 1450), 'URZĄD SKARBOWY', 'Налоги и взносы');
  if (day === 21) add(A.revPln, d, -between(110, 160), 'Zooplus', 'Питомцы');
  if (day === 25) add(A.revPln, d, -149, 'Lux Med', 'Здоровье');
  if (day === 26) add(A.invest, d, 500, 'Пополнение брокерского счёта', 'Переводы между счетами', { notes: 'ETF' });
  if (day === 27) add(A.pkoPln, d, -10, 'OPŁATA MIESIĘCZNA ZA KARTĘ', 'Комиссии банка');
  if (day === 28 && chance(0.7)) {
    const pln = between(600, 1200);
    transfer(A.revPln, A.revUsd, d, pln, Number((pln / 3.95).toFixed(2)), 'Обмен валюты');
  }
}

// поездка в Лиссабон (июль) — евро
transfer(A.revPln, A.revEur, '2026-07-02', 3400, 790, 'Обмен валюты');
for (const [d, amount, payee, c] of [
  ['2026-07-08', -540, 'Booking.com Lisboa', 'Развлечения'],
  ['2026-07-09', -38.5, 'Time Out Market', 'Рестораны и доставка'],
  ['2026-07-09', -12.4, 'Uber Lisboa', 'Транспорт'],
  ['2026-07-10', -64, 'Cervejaria Ramiro', 'Рестораны и доставка'],
  ['2026-07-10', -22, 'Museu Gulbenkian', 'Развлечения'],
  ['2026-07-11', -89.9, 'Zara Chiado', 'Покупки'],
  ['2026-07-12', -16.2, 'Pastéis de Belém', 'Рестораны и доставка'],
] as const)
  add(A.revEur, d, amount, payee, c);
add(A.cashEur, '2026-07-11', -120, 'Наличные в поездке', 'Развлечения');

// инвестиции растут
add(A.invest, '2026-06-30', 1180, 'Переоценка портфеля', 'Переводы между счетами');
add(A.invest, '2026-09-30', 1420, 'Переоценка портфеля', 'Переводы между счетами');

// свежие операции: одна ещё «в обработке», пара без категории — так видно, что их надо разобрать
add(A.revPln, '2026-10-05', -27.5, 'Bolt.eu', 'Транспорт', { pending: true });
add(A.revPln, '2026-10-04', -186.4, 'Ikea Janki', null);
add(A.revPln, '2026-10-03', -54, 'Pan Kanapka Sp. z o.o.', null);

// --- банковские поля счетов --------------------------------------------------------
const consent: Record<string, string> = { Revolut: '2027-03-21T09:00:00.000Z', 'PKO Bank Polski': '2026-11-02T09:00:00.000Z' };
const session: Record<string, string> = { Revolut: uuid(), 'PKO Bank Polski': uuid() };
const accounts = (Object.values(A) as Acc[]).map((a, i) => {
  const balance = txs.filter((t) => t.accountId === a.id).reduce((s, t) => s + t.amount, 0);
  return {
    id: a.id,
    name: a.name,
    currency: a.currency,
    offbudget: !!a.offbudget,
    closed: false,
    sort: i + 1,
    bank: a.bank,
    iban: a.iban ?? null,
    ebAccountId: a.bank ? uuid() : null,
    ebHash: a.bank ? uuid() : null,
    ebSessionId: a.bank ? session[a.bank] : null,
    consentUntil: a.bank ? consent[a.bank] : null,
    bankBalance: a.bank ? balance : null,
    syncedAt: a.bank ? new Date(now.getTime() - 22 * 60e3).toISOString() : null,
    syncError: null,
  };
});

const lastSync = new Date(now.getTime() - 22 * 60e3).toISOString();
process.stdout.write(
  JSON.stringify({
    format: 'cashflow-export',
    version: 1,
    exportedAt: now.toISOString(),
    accounts,
    categoryGroups: groups,
    categories,
    rules,
    transactions: txs,
    settings: {
      excludedGroup: 'Переводы и обмены',
      transferCategoryId: cat['Переводы между счетами'],
      excludeCategoryId: cat['Исключено'],
    },
    bankSync: { lastBankSyncAt: lastSync, lastAttemptAt: lastSync, failedAccounts: [], added: 4, updated: 1, removed: 0 },
  }),
);
