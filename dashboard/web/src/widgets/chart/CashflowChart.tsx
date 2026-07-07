import { Card, Text } from '@radix-ui/themes';
import type { DailyPoint } from '@shared/api/types';
import { moneyExact, shortDate } from '@shared/lib/format';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export function CashflowChart({ daily }: { daily: DailyPoint[] }) {
  if (!daily.length) return null;
  const last = daily[daily.length - 1].cum;
  return (
    <Card size="3">
      <Text size="2" color="gray">
        Накопленный net за период
      </Text>
      <div style={{ height: 220, marginTop: 8 }}>
        <ResponsiveContainer>
          <AreaChart data={daily} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
            <defs>
              <linearGradient id="cum" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  stopColor={last >= 0 ? 'var(--grass-9)' : 'var(--red-9)'}
                  stopOpacity={0.5}
                />
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
            />
            <YAxis
              stroke="var(--gray-8)"
              fontSize={12}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => `${Math.round(v / 1000)}k`}
              width={40}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--color-panel-solid)',
                border: '1px solid var(--gray-5)',
                borderRadius: 8,
              }}
              labelFormatter={shortDate}
              formatter={(v: number, name: string) => [
                moneyExact(v),
                name === 'cum' ? 'накоплено' : 'за день',
              ]}
            />
            <ReferenceLine y={0} stroke="var(--gray-7)" strokeDasharray="4 4" />
            <Area
              type="monotone"
              dataKey="cum"
              stroke={last >= 0 ? 'var(--grass-9)' : 'var(--red-9)'}
              strokeWidth={2}
              fill="url(#cum)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
