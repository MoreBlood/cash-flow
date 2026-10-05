import { Card, Flex, Text } from '@radix-ui/themes';
import type { Balances } from '@shared/api/types';
import { money, moneyExact } from '@shared/lib/format';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

const PALETTE = [
  'var(--iris-9)',
  'var(--orange-9)',
  'var(--grass-9)',
  'var(--blue-9)',
  'var(--pink-9)',
  'var(--amber-9)',
  'var(--teal-9)',
  'var(--violet-9)',
  'var(--red-9)',
  'var(--cyan-9)',
  'var(--lime-9)',
  'var(--crimson-9)',
  'var(--gray-9)',
];

export function AccountsDonut({ data }: { data: Balances }) {
  const slices = data.accounts
    .filter((a) => a.balancePln > 0)
    .map((a, i) => ({ name: a.name, value: a.balancePln, color: PALETTE[i % PALETTE.length] }));
  return (
    <Card size="3">
      <Text size="2" color="gray">
        Структура по счетам
      </Text>
      <Flex align="center" justify="center" style={{ position: 'relative' }}>
        <div style={{ height: 220, width: '100%' }}>
          <ResponsiveContainer>
            <PieChart>
              <Pie
                data={slices}
                dataKey="value"
                innerRadius={66}
                outerRadius={95}
                paddingAngle={2}
                strokeWidth={0}
              >
                {slices.map((d) => (
                  <Cell key={d.name} fill={d.color} />
                ))}
              </Pie>
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
                formatter={(v: number, name: string) => [moneyExact(v), name]}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <Flex
          direction="column"
          align="center"
          style={{ position: 'absolute', pointerEvents: 'none', zIndex: 1 }}
        >
          <Text size="1" color="gray">
            всего
          </Text>
          <Text size="4" weight="bold" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {money(data.totalPln)}
          </Text>
        </Flex>
      </Flex>
      <Flex direction="column" gap="1" mt="2">
        {slices.slice(0, 6).map((s) => (
          <Flex key={s.name} justify="between" align="center">
            <Flex gap="2" align="center" minWidth="0">
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  background: s.color,
                  flexShrink: 0,
                }}
              />
              <Text size="2" truncate>
                {s.name}
              </Text>
            </Flex>
            <Text size="2" style={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
              {((s.value / data.totalPln) * 100).toFixed(1)}%
            </Text>
          </Flex>
        ))}
        {slices.length > 6 && (
          <Text size="1" color="gray">
            + ещё {slices.length - 6} — наведите на сектор
          </Text>
        )}
      </Flex>
    </Card>
  );
}
