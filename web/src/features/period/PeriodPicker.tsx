import { Button, Flex, TextField } from '@radix-ui/themes';
import { monthLabel } from '@shared/lib/format';
import { useEffect, useRef } from 'react';

export interface Period {
  from: string;
  to: string;
  key: string;
}

/** 'YYYY-MM' ± n месяцев — арифметикой, без Date: часовой пояс и переход на летнее время не сдвигают месяц */
const addMonths = (ym: string, n: number) => {
  const [y, m] = ym.split('-').map(Number);
  const t = y * 12 + m - 1 + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};

export function monthsBetween(first: string, last: string): string[] {
  const out: string[] = [];
  for (let m = first.slice(0, 7); m <= last.slice(0, 7); m = addMonths(m, 1)) out.push(m);
  return out;
}

export const monthPeriod = (ym: string): Period => {
  const [y, m] = ym.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return { from: `${ym}-01`, to: `${ym}-${String(lastDay).padStart(2, '0')}`, key: ym };
};

/** Период → пары для URLSearchParams (для сохранения фильтра в query). */
export function periodToParams(p: Period): [string, string][] {
  if (p.key === 'all') return [['period', 'all']];
  if (p.key === 'custom') {
    return [
      ['period', 'custom'],
      ['from', p.from],
      ['to', p.to],
    ];
  }
  return [['period', p.key]];
}

/** Прочитать период из query (или null, если нет/невалидно). */
export function periodFromParams(
  params: URLSearchParams,
  range: { from: string; to: string },
): Period | null {
  const p = params.get('period');
  if (!p) return null;
  if (p === 'all') return { ...range, key: 'all' };
  if (p === 'custom') {
    const from = params.get('from');
    const to = params.get('to');
    return from && to ? { from, to, key: 'custom' } : null;
  }
  if (/^\d{4}-\d{2}$/.test(p)) return monthPeriod(p);
  return null;
}

/** Предыдущий период той же длины (для месяца — предыдущий месяц). */
export const prevPeriod = (p: Period): Period => {
  if (/^\d{4}-\d{2}$/.test(p.key)) return monthPeriod(addMonths(p.key, -1));
  const from = new Date(p.from);
  const to = new Date(p.to);
  const days = Math.round((to.getTime() - from.getTime()) / 864e5) + 1;
  const prevTo = new Date(from.getTime() - 864e5);
  const prevFrom = new Date(prevTo.getTime() - (days - 1) * 864e5);
  return {
    from: prevFrom.toISOString().slice(0, 10),
    to: prevTo.toISOString().slice(0, 10),
    key: 'prev',
  };
};

interface Props {
  months: string[];
  allRange: { from: string; to: string };
  value: Period;
  onChange: (p: Period) => void;
}

/** «Сентябрь», для прошлых лет — «Декабрь 2025» */
const chipLabel = (ym: string, year?: string) => {
  const name = monthLabel(ym).split(' ')[0];
  const label = name[0].toUpperCase() + name.slice(1);
  return ym.startsWith(`${year}-`) ? label : `${label} ${ym.slice(0, 4)}`;
};

export function PeriodPicker({ months, allRange, value, onChange }: Props) {
  const isCustom = value.key === 'custom';
  const row = useRef<HTMLDivElement>(null);
  // выбранный период — в зону видимости: на телефоне лента длиннее экрана
  // biome-ignore lint/correctness/useExhaustiveDependencies: прокрутка при смене выбранного периода
  useEffect(() => {
    const box = row.current;
    const el = box?.querySelector<HTMLElement>('[data-active]');
    if (box && el) box.scrollLeft = el.offsetLeft - (box.clientWidth - el.offsetWidth) / 2;
  }, [value.key]);

  const year = months.at(-1)?.slice(0, 4);
  const chips: [string, string][] = [
    ...months.map((m): [string, string] => [m, chipLabel(m, year)]),
    ['all', 'Всё время'],
    ['custom', 'Период…'],
  ];
  const pick = (key: string) => {
    if (key === 'all') onChange({ ...allRange, key: 'all' });
    else if (key === 'custom') onChange({ ...value, key: 'custom' });
    else onChange(monthPeriod(key));
  };

  return (
    <Flex direction="column" gap="3" width="100%" minWidth="0">
      <Flex ref={row} gap="2" className="chips">
        {chips.map(([key, label]) => {
          const active = isCustom ? key === 'custom' : key === value.key;
          return (
            <Button
              key={key}
              size="2"
              radius="full"
              color="gray"
              variant={active ? 'solid' : 'soft'}
              highContrast={active}
              data-active={active || undefined}
              onClick={() => pick(key)}
              style={{ flexShrink: 0 }}
            >
              {label}
            </Button>
          );
        })}
      </Flex>
      {isCustom && (
        <Flex gap="2" align="center" wrap="wrap">
          <TextField.Root
            type="date"
            size="2"
            value={value.from}
            onChange={(e) => onChange({ ...value, from: e.target.value })}
          />
          <span style={{ color: 'var(--gray-9)' }}>—</span>
          <TextField.Root
            type="date"
            size="2"
            value={value.to}
            onChange={(e) => onChange({ ...value, to: e.target.value })}
          />
        </Flex>
      )}
    </Flex>
  );
}
