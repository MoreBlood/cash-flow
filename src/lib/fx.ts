// Курсы НБП (таблица A): диапазонами по 89 дней, кэш в памяти на 6 часов.
export const BASES = ['PLN', 'EUR', 'USD', 'CHF'] as const;
export type Currency = (typeof BASES)[number];
export const FOREIGN = ['EUR', 'USD', 'CHF'] as const;

type Rate = { date: string; mid: number };
const TTL = 6 * 3600e3;
const cache = new Map<string, { at: number; rates: Rate[] }>();

const iso = (d: Date) => d.toISOString().slice(0, 10);
// локальная дата ('sv-SE' = YYYY-MM-DD): после полуночи по Варшаве в UTC ещё вчера
export const today = () => new Date().toLocaleDateString('sv-SE');
export const shiftDays = (date: string, n: number) => iso(new Date(new Date(date).getTime() + n * 864e5));

export async function nbpRange(code: string, from: string, to: string): Promise<Rate[]> {
  // НБП отвечает 400 на будущие даты — зажимаем конец диапазона сегодняшним днём,
  // для будущих дат rateAt протягивает последний известный курс.
  if (to > today()) to = today();
  if (from > to) from = to;
  const key = `${code}:${from}:${to}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.rates;
  const rates: Rate[] = [];
  for (let start = from; start <= to; start = shiftDays(start, 90)) {
    const end = shiftDays(start, 89) < to ? shiftDays(start, 89) : to;
    const r = await fetch(`https://api.nbp.pl/api/exchangerates/rates/a/${code}/${start}/${end}/?format=json`);
    if (r.status === 404) continue; // в коротком хвосте (выходные) курсов может не быть
    if (!r.ok) throw new Error(`НБП ${code}: HTTP ${r.status}`);
    const body = (await r.json()) as { rates: { effectiveDate: string; mid: number }[] };
    rates.push(...body.rates.map((x) => ({ date: x.effectiveDate, mid: x.mid })));
  }
  cache.set(key, { at: Date.now(), rates });
  return rates;
}

export function rateAt(rates: Rate[], date: string) {
  let best = rates.length ? rates[0].mid : 1;
  for (const r of rates) {
    if (r.date <= date) best = r.mid;
    else break;
  }
  return best;
}

/** Курсы иностранных валют к PLN за период (с запасом 10 дней на выходные). */
export async function ratesFor(from: string, to: string) {
  const R = {} as Record<(typeof FOREIGN)[number], Rate[]>;
  for (const c of FOREIGN) R[c] = await nbpRange(c.toLowerCase(), shiftDays(from, -10), to);
  return R;
}

/** Конвертер «сумма в валюте счёта на дату → базовая валюта» через PLN по курсу НБП на дату. */
export async function converter(base: Currency, from: string, to: string) {
  const R = await ratesFor(from, to);
  return (value: number, cur: string, date: string) => {
    const pln = cur === 'PLN' ? value : value * rateAt(R[cur as keyof typeof R] ?? [], date);
    return base === 'PLN' ? pln : pln / rateAt(R[base], date);
  };
}

/** Последние известные курсы к PLN. */
export async function latestRates() {
  const R = await ratesFor(shiftDays(today(), -4), today());
  return Object.fromEntries(FOREIGN.map((c) => [c, R[c].length ? R[c][R[c].length - 1].mid : 1])) as Record<
    (typeof FOREIGN)[number],
    number
  >;
}
