// Курсы НБП (таблица A): диапазонами по 89 дней, кэш в памяти на 6 часов.
const TTL = 6 * 3600e3;
const cache = new Map();
const iso = (d) => d.toISOString().slice(0, 10);
// локальная дата ('sv-SE' = YYYY-MM-DD): после полуночи по Варшаве в UTC ещё вчера
export const today = () => new Date().toLocaleDateString('sv-SE');
export const shiftDays = (date, n) => iso(new Date(new Date(date).getTime() + n * 864e5));

export async function nbpRange(code, from, to) {
  // НБП отвечает 400 на будущие даты — зажимаем конец диапазона сегодняшним днём,
  // для будущих дат rateAt протягивает последний известный курс.
  if (to > today()) to = today();
  if (from > to) from = to;
  const key = `${code}:${from}:${to}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.rates;
  const rates = [];
  for (let start = from; start <= to; start = shiftDays(start, 90)) {
    const end = shiftDays(start, 89) < to ? shiftDays(start, 89) : to;
    const r = await fetch(`https://api.nbp.pl/api/exchangerates/rates/a/${code}/${start}/${end}/?format=json`);
    if (r.status === 404) continue; // в коротком хвосте (выходные) курсов может не быть
    if (!r.ok) throw new Error(`НБП ${code}: HTTP ${r.status}`);
    rates.push(...(await r.json()).rates.map((x) => ({ date: x.effectiveDate, mid: x.mid })));
  }
  cache.set(key, { at: Date.now(), rates });
  return rates;
}

export const rateAt = (rates, date) => {
  let best = rates.length ? rates[0].mid : 1;
  for (const r of rates) {
    if (r.date <= date) best = r.mid;
    else break;
  }
  return best;
};

export const FOREIGN = ['EUR', 'USD', 'CHF'];
export const BASES = new Set(['PLN', ...FOREIGN]);

/** Конвертер «сумма в валюте счёта на дату → базовая валюта» через PLN по курсу НБП на дату. */
export async function converter(base, from, to) {
  const R = {};
  for (const c of FOREIGN) R[c] = await nbpRange(c.toLowerCase(), shiftDays(from, -10), to);
  return (value, cur, date) => {
    const pln = cur === 'PLN' ? value : value * rateAt(R[cur], date);
    return base === 'PLN' ? pln : pln / rateAt(R[base], date);
  };
}

/** Последние известные курсы к PLN. */
export async function latestRates() {
  const out = {};
  for (const c of FOREIGN) {
    const rs = await nbpRange(c.toLowerCase(), shiftDays(today(), -14), today());
    out[c] = rs.length ? rs[rs.length - 1].mid : 1;
  }
  return out;
}
