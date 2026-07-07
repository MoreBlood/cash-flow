import { Card, Flex, Text } from '@radix-ui/themes';
import type { CategorySummary } from '@shared/api/types';
import { categoryStyle } from '@shared/config/categories';
import { money, moneyExact } from '@shared/lib/format';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

export function DonutChart({ categories }: { categories: CategorySummary[] }) {
  const expenses = categories.filter((c) => c.total < 0);
  if (!expenses.length) return null;
  const total = expenses.reduce((s, c) => s - c.total, 0);
  const data = expenses.map((c) => ({
    name: c.name,
    value: -c.total,
    color: categoryStyle(c.name).color,
  }));
  return (
    <Card size="3">
      <Text size="2" color="gray">
        Структура расходов
      </Text>
      <Flex align="center" justify="center" style={{ position: 'relative' }}>
        <div style={{ height: 200, width: '100%' }}>
          <ResponsiveContainer>
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                innerRadius={62}
                outerRadius={88}
                paddingAngle={2}
                strokeWidth={0}
              >
                {data.map((d) => (
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
            {money(total)}
          </Text>
        </Flex>
      </Flex>
    </Card>
  );
}
