import { Card, Text } from '@radix-ui/themes';
import type { NetWorthPoint } from '@shared/api/types';
import { moneyExact, shortDate } from '@shared/lib/format';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export function NetWorthChart({ series }: { series: NetWorthPoint[] }) {
  if (series.length < 2) return null;
  return (
    <Card size="3">
      <Text size="2" color="gray">
        Изменение капитала
      </Text>
      <div style={{ height: 240, marginTop: 8 }}>
        <ResponsiveContainer>
          <AreaChart data={series} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
            <defs>
              <linearGradient id="nw" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--iris-9)" stopOpacity={0.5} />
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
              minTickGap={40}
            />
            <YAxis
              stroke="var(--gray-8)"
              fontSize={12}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => `${Math.round(v / 1000)}k`}
              width={44}
              domain={['auto', 'auto']}
            />
            <Tooltip
              wrapperStyle={{ zIndex: 10, outline: 'none' }}
              contentStyle={{
                background: 'var(--color-panel-solid)',
                border: '1px solid var(--gray-6)',
                borderRadius: 8,
                boxShadow: 'var(--shadow-4)',
                padding: '6px 10px',
              }}
              itemStyle={{ color: 'var(--gray-12)' }}
              labelStyle={{ color: 'var(--gray-11)' }}
              labelFormatter={shortDate}
              formatter={(v: number) => [moneyExact(v), 'капитал']}
            />
            <Area
              type="monotone"
              dataKey="totalPln"
              stroke="var(--iris-9)"
              strokeWidth={2}
              fill="url(#nw)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <Text size="1" color="gray" mt="1" as="div">
        Балансы на дату × курс НБП этого дня. Скачки в дни привязки счетов — это появление их
        стартовых остатков в данных, а не реальное изменение состояния.
      </Text>
    </Card>
  );
}
