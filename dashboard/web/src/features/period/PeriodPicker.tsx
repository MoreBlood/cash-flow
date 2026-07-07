import { Box, Button, Flex, SegmentedControl, TextField } from '@radix-ui/themes';
import { monthLabel } from '@shared/lib/format';

export interface Period {
  from: string;
  to: string;
  key: string;
}

export function monthsBetween(first: string, last: string): string[] {
  const out: string[] = [];
  const d = new Date(`${first.slice(0, 7)}-01`);
  const end = new Date(`${last.slice(0, 7)}-01`);
  while (d <= end) {
    out.push(d.toISOString().slice(0, 7));
    d.setMonth(d.getMonth() + 1);
  }
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
  if (/^\d{4}-\d{2}$/.test(p.key)) {
    const d = new Date(`${p.key}-01`);
    d.setMonth(d.getMonth() - 1);
    return monthPeriod(d.toISOString().slice(0, 7));
  }
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

export function PeriodPicker({ months, allRange, value, onChange }: Props) {
  const isCustom = value.key === 'custom';
  return (
    <Flex gap="3" align="center" wrap="wrap" width="100%">
      {/* на узком экране список месяцев скроллится по горизонтали */}
      <Box maxWidth="100%" style={{ overflowX: 'auto' }}>
        <SegmentedControl.Root
          value={isCustom ? 'custom' : value.key}
          onValueChange={(key) => {
            if (key === 'all') onChange({ ...allRange, key: 'all' });
            else if (key === 'custom') onChange({ ...value, key: 'custom' });
            else onChange(monthPeriod(key));
          }}
          size="2"
        >
          {months.map((m) => (
            <SegmentedControl.Item key={m} value={m}>
              {monthLabel(m).replace(/ г\./, '').split(' ')[0]}
            </SegmentedControl.Item>
          ))}
          <SegmentedControl.Item value="all">Всё время</SegmentedControl.Item>
          <SegmentedControl.Item value="custom">Период…</SegmentedControl.Item>
        </SegmentedControl.Root>
      </Box>
      {isCustom && (
        <Flex gap="2" align="center">
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
          <Button size="2" variant="soft" onClick={() => onChange({ ...value, key: 'custom' })}>
            Ок
          </Button>
        </Flex>
      )}
    </Flex>
  );
}
