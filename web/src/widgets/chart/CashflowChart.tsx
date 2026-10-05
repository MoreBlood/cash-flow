import { Card, Dialog, Flex, SegmentedControl, Text } from '@radix-ui/themes';
import type { Category, DailyPoint } from '@shared/api/types';
import { moneyExact, shortDate } from '@shared/lib/format';
import { TransactionFeed } from '@widgets/feed/TransactionFeed';
import { useState } from 'react';
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const tooltipStyle = {
  background: 'var(--color-panel-solid)',
  border: '1px solid var(--gray-5)',
  borderRadius: 8,
};
const kFmt = (v: number) => `${Math.round(v / 1000)}k`;

type Mode = 'cum' | 'expense';

interface Props {
  daily: DailyPoint[];
  base: string;
  catalog: Category[];
  reloadKey: number;
  onChanged: () => void;
}

/** Подсказка для «Траты по дням»: сумма за день + разбивка на что потрачено. */
function ExpenseTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { payload: DailyPoint }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  if (!p.expense) return null;
  return (
    <div style={{ ...tooltipStyle, padding: 10, minWidth: 170 }}>
      <div style={{ color: 'var(--gray-11)', fontSize: 12 }}>{label ? shortDate(label) : ''}</div>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{moneyExact(p.expense)}</div>
      {p.byCat.map((c) => (
        <div
          key={c.name}
          style={{ display: 'flex', justifyContent: 'space-between', gap: 14, fontSize: 12 }}
        >
          <span style={{ color: 'var(--gray-11)' }}>{c.name}</span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{moneyExact(c.amount)}</span>
        </div>
      ))}
      <div style={{ color: 'var(--gray-9)', fontSize: 11, marginTop: 6 }}>
        клик — все операции дня
      </div>
    </div>
  );
}

export function CashflowChart({ daily, base, catalog, reloadKey, onChanged }: Props) {
  const [mode, setMode] = useState<Mode>('cum');
  const [day, setDay] = useState<string | null>(null);
  if (!daily.length) return null;
  const last = daily[daily.length - 1].cum;
  const cumColor = last >= 0 ? 'var(--grass-9)' : 'var(--red-9)';

  return (
    <Card size="3">
      <Flex justify="between" align="center" gap="2" wrap="wrap">
        <Text size="2" color="gray">
          {mode === 'cum' ? 'Накопленный net за период' : 'Траты по дням'}
        </Text>
        <SegmentedControl.Root size="1" value={mode} onValueChange={(v) => setMode(v as Mode)}>
          <SegmentedControl.Item value="cum">Накоплено</SegmentedControl.Item>
          <SegmentedControl.Item value="expense">Траты/день</SegmentedControl.Item>
        </SegmentedControl.Root>
      </Flex>
      <div style={{ height: 220, marginTop: 8 }}>
        <ResponsiveContainer>
          <ComposedChart
            data={daily}
            margin={{ top: 4, right: 8, bottom: 0, left: 8 }}
            onClick={(s: { activeLabel?: string }) => {
              if (mode === 'expense' && s?.activeLabel) setDay(String(s.activeLabel));
            }}
          >
            <defs>
              <linearGradient id="cum" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={cumColor} stopOpacity={0.5} />
                <stop offset="100%" stopColor="transparent" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--gray-4)" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={shortDate}
              stroke="var(--gray-8)"
              fontSize={12}
              tickLine={false}
              minTickGap={24}
            />
            <YAxis
              stroke="var(--gray-8)"
              fontSize={12}
              tickLine={false}
              axisLine={false}
              tickFormatter={kFmt}
              width={40}
            />
            {mode === 'cum' ? (
              <Tooltip
                contentStyle={tooltipStyle}
                labelFormatter={shortDate}
                formatter={(v: number) => [moneyExact(v), 'накоплено']}
              />
            ) : (
              <Tooltip
                cursor={{ fill: 'var(--gray-4)', opacity: 0.4 }}
                content={<ExpenseTooltip />}
              />
            )}
            {mode === 'cum' && <ReferenceLine y={0} stroke="var(--gray-7)" strokeDasharray="4 4" />}
            {mode === 'cum' && (
              <Area
                type="monotone"
                dataKey="cum"
                stroke={cumColor}
                strokeWidth={2}
                fill="url(#cum)"
              />
            )}
            {mode === 'expense' && (
              <Bar dataKey="expense" fill="var(--red-9)" radius={[3, 3, 0, 0]} cursor="pointer" />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <Dialog.Root open={!!day} onOpenChange={(o) => !o && setDay(null)}>
        <Dialog.Content maxWidth="560px">
          <Dialog.Title size="3">Операции за {day ? shortDate(day) : ''}</Dialog.Title>
          {day && (
            <TransactionFeed
              from={day}
              to={day}
              base={base}
              catalog={catalog}
              reloadKey={reloadKey}
              onChanged={onChanged}
              title="За день"
            />
          )}
        </Dialog.Content>
      </Dialog.Root>
    </Card>
  );
}
