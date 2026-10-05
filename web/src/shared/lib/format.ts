let currency = 'PLN';
const cache = new Map<string, { short: Intl.NumberFormat; exact: Intl.NumberFormat }>();

function fmts() {
  let f = cache.get(currency);
  if (!f) {
    f = {
      short: new Intl.NumberFormat('pl-PL', {
        style: 'currency',
        currency,
        maximumFractionDigits: 0,
      }),
      exact: new Intl.NumberFormat('pl-PL', {
        style: 'currency',
        currency,
        minimumFractionDigits: 2,
      }),
    };
    cache.set(currency, f);
  }
  return f;
}

/** Базовая валюта отображения (меняется селектором в навбаре). */
export const setDisplayCurrency = (c: string) => {
  currency = c;
};

/** Текущая базовая валюта отображения (валюта расчётов). */
export const getDisplayCurrency = () => currency;

const inCache = new Map<string, Intl.NumberFormat>();
/** Форматирует сумму в заданной валюте (для нативной суммы счёта). */
export const moneyIn = (v: number, cur: string) => {
  let f = inCache.get(cur);
  if (!f) {
    f = new Intl.NumberFormat('pl-PL', {
      style: 'currency',
      currency: cur,
      maximumFractionDigits: 0,
    });
    inCache.set(cur, f);
  }
  return f.format(v);
};

// без «-0 zł»: округлённый до нуля минус не показываем
const z = (v: number) => (Math.abs(v) < 0.005 ? 0 : v);
export const money = (v: number) => fmts().short.format(z(v));
export const moneyExact = (v: number) => fmts().exact.format(z(v));
export const signed = (v: number) =>
  z(v) > 0 ? `+${fmts().short.format(v)}` : fmts().short.format(z(v));

export const monthLabel = (ym: string) =>
  new Date(`${ym}-01`).toLocaleDateString('ru', { month: 'long', year: 'numeric' });

export const shortDate = (d: string) =>
  new Date(d).toLocaleDateString('ru', { day: 'numeric', month: 'short' });

export function relativeTime(iso: string | null): string {
  if (!iso) return 'ещё не обновлялось';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин назад`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} ч назад`;
  const d = Math.round(h / 24);
  return d === 1 ? 'вчера' : `${d} дн назад`;
}
