import { Card, Flex, Grid, Text } from '@radix-ui/themes';
import type { Summary } from '@shared/api/types';
import { money, signed } from '@shared/lib/format';

interface DeltaInfo {
  pct: number;
  abs: number;
  goodWhenUp: boolean;
}

interface KpiProps {
  label: string;
  value: string;
  sub?: string;
  tone?: 'up' | 'down';
  delta?: DeltaInfo | null;
}

function Delta({ pct, abs, goodWhenUp }: DeltaInfo) {
  if (Math.abs(pct) < 0.005) return null; // микро-изменение — не показываем
  const up = pct >= 0;
  const good = up === goodWhenUp;
  // при переходе через ноль / малой базе проценты бессмысленны — показываем абсолют
  const label = Math.abs(pct) > 3 ? money(Math.abs(abs)) : `${Math.abs(Math.round(pct * 100))}%`;
  return (
    <Text size="1" weight="medium" style={{ color: good ? 'var(--grass-11)' : 'var(--red-11)' }}>
      {up ? '↑' : '↓'} {label} к пред. периоду
    </Text>
  );
}

function Kpi({ label, value, sub, tone, delta }: KpiProps) {
  const color = tone === 'up' ? 'var(--grass-11)' : tone === 'down' ? 'var(--red-11)' : undefined;
  return (
    <Card size="3">
      <Flex direction="column" gap="1">
        <Text size="2" color="gray">
          {label}
        </Text>
        <Text
          size={{ initial: '5', sm: '7' }}
          weight="bold"
          style={{ color, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
        >
          {value}
        </Text>
        {delta ? (
          <Delta {...delta} />
        ) : sub ? (
          <Text size="1" color="gray">
            {sub}
          </Text>
        ) : null}
      </Flex>
    </Card>
  );
}

const pctChange = (cur: number, prev: number): number | null =>
  Math.abs(prev) < 1 ? null : (cur - prev) / Math.abs(prev);

export function KpiCards({ data, prev }: { data: Summary; prev: Summary | null }) {
  const end = Math.min(new Date(data.to).getTime(), Date.now());
  const days = Math.max(1, Math.round((end - new Date(data.from).getTime()) / 864e5) + 1);
  const mkDelta = (cur: number, prevV: number, goodWhenUp: boolean): DeltaInfo | null => {
    const pct = prev ? pctChange(cur, prevV) : null;
    return pct === null ? null : { pct, abs: cur - prevV, goodWhenUp };
  };
  return (
    <Grid columns={{ initial: '2', sm: '4' }} gap="3">
      <Kpi
        label="Доход"
        value={money(data.income)}
        tone="up"
        delta={mkDelta(data.income, prev?.income ?? 0, true)}
      />
      <Kpi
        label="Расход"
        value={money(-data.expense)}
        tone="down"
        sub={`≈ ${money(-data.expense / days)} в день`}
        delta={mkDelta(-data.expense, -(prev?.expense ?? 0), false)}
      />
      <Kpi
        label="Net"
        value={signed(data.net)}
        tone={data.net >= 0 ? 'up' : 'down'}
        delta={mkDelta(data.net, prev?.net ?? 0, true)}
      />
      <Kpi
        label="Норма сбережений"
        value={data.savingsRate === null ? '—' : `${Math.round(data.savingsRate * 100)}%`}
        sub={prev?.savingsRate != null ? `было ${Math.round(prev.savingsRate * 100)}%` : undefined}
      />
    </Grid>
  );
}
