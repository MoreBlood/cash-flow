import { CategorySelect } from '@features/categorize/CategorySelect';
import { Badge, Box, Card, Flex, SegmentedControl, Text } from '@radix-ui/themes';
import type { Category, CategorySummary } from '@shared/api/types';
import { categoryStyle } from '@shared/config/categories';
import { money, moneyExact } from '@shared/lib/format';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

interface CommonProps {
  catalog: Category[];
  period: { from: string; to: string };
  onChanged: () => void;
}

function IconCircle({ name }: { name: string }) {
  const { icon, color } = categoryStyle(name);
  return (
    <Flex
      align="center"
      justify="center"
      style={{
        width: 40,
        height: 40,
        borderRadius: '50%',
        background: `color-mix(in srgb, ${color} 22%, transparent)`,
        fontSize: 20,
        flexShrink: 0,
      }}
    >
      {icon}
    </Flex>
  );
}

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <Box
      flexGrow="1"
      height="6px"
      style={{ background: 'var(--gray-4)', borderRadius: 3, overflow: 'hidden' }}
    >
      <Box
        height="6px"
        style={{
          width: `${Math.max(2, (value / max) * 100)}%`,
          background: color,
          borderRadius: 3,
        }}
      />
    </Box>
  );
}

function CategoryRow({
  cat,
  max,
  income = false,
  catalog,
  period,
  onChanged,
}: { cat: CategorySummary; max: number; income?: boolean } & CommonProps) {
  const [open, setOpen] = useState(false);
  const { color } = categoryStyle(cat.name);
  const sign = (v: number) => (income ? v : -v);
  return (
    <Box>
      <Flex
        gap="3"
        align="center"
        py="2"
        style={{ cursor: 'pointer' }}
        onClick={() => setOpen(!open)}
      >
        <IconCircle name={cat.name} />
        <Box flexGrow="1" minWidth="0">
          <Flex justify="between" gap="2">
            <Text size="3" weight="medium" truncate>
              {cat.name}
            </Text>
            <Text
              size="3"
              weight="bold"
              style={{
                fontVariantNumeric: 'tabular-nums',
                color: income ? 'var(--grass-11)' : undefined,
              }}
            >
              {income ? `+${money(cat.total)}` : money(-cat.total)}
            </Text>
          </Flex>
          <Flex align="center" gap="2" mt="1">
            <Bar value={Math.abs(cat.total)} max={max} color={color} />
            <Text size="1" color="gray">
              {cat.count}
            </Text>
          </Flex>
        </Box>
      </Flex>
      {open && (
        <Box pl="8" pb="2">
          {cat.payees.slice(0, 8).map((p) => (
            <Flex key={p.name} justify="between" align="center" gap="2" py="1">
              <Text size="2" color="gray" truncate style={{ flexGrow: 1 }}>
                {p.name}
              </Text>
              <Text size="2" style={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                {moneyExact(sign(p.sum))}
              </Text>
              <CategorySelect catalog={catalog} payee={p.name} period={period} onDone={onChanged} />
            </Flex>
          ))}
        </Box>
      )}
    </Box>
  );
}

interface MerchantAgg {
  name: string;
  total: number;
  count: number;
  category: string;
}

function MerchantRow({
  m,
  max,
  catalog,
  period,
  onChanged,
}: { m: MerchantAgg; max: number } & CommonProps) {
  const [open, setOpen] = useState(false);
  const { color } = categoryStyle(m.category);
  return (
    <Box>
      <Flex
        gap="3"
        align="center"
        py="2"
        style={{ cursor: 'pointer' }}
        onClick={() => setOpen(!open)}
      >
        <IconCircle name={m.category} />
        <Box flexGrow="1" minWidth="0">
          <Flex justify="between" gap="2">
            <Text size="3" weight="medium" truncate>
              {m.name}
            </Text>
            <Text size="3" weight="bold" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {money(m.total)}
            </Text>
          </Flex>
          <Flex align="center" gap="2" mt="1">
            <Bar value={m.total} max={max} color={color} />
            <Text size="1" color="gray">
              {m.count}
            </Text>
          </Flex>
        </Box>
      </Flex>
      {open && (
        <Flex pl="8" pb="2" gap="2" align="center" wrap="wrap">
          <Badge variant="soft" color="gray">
            {m.category}
          </Badge>
          <Text size="1" color="gray">
            → сменить для всех {m.count} операций:
          </Text>
          <CategorySelect catalog={catalog} payee={m.name} period={period} onDone={onChanged} />
        </Flex>
      )}
    </Box>
  );
}

export function CategoryList({
  categories,
  catalog,
  period,
  onChanged,
}: { categories: CategorySummary[] } & CommonProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const view = searchParams.get('view') === 'merchants' ? 'merchants' : 'categories';
  const setView = (v: 'categories' | 'merchants') =>
    setSearchParams(
      (prev) => {
        const np = new URLSearchParams(prev);
        if (v === 'merchants') np.set('view', 'merchants');
        else np.delete('view');
        return np;
      },
      { replace: true },
    );
  const expenses = categories.filter((c) => c.total < 0);
  const incomes = categories.filter((c) => c.total >= 0);
  const maxCat = Math.max(...expenses.map((c) => Math.abs(c.total)), 1);
  const maxIncome = Math.max(...incomes.map((c) => c.total), 1);

  const merchants = useMemo(() => {
    const m = new Map<string, MerchantAgg & { best: number }>();
    for (const c of expenses) {
      for (const p of c.payees) {
        if (p.sum >= 0) continue;
        const cur = m.get(p.name) ?? {
          name: p.name,
          total: 0,
          count: 0,
          category: c.name,
          best: 0,
        };
        const spent = -p.sum;
        if (spent > cur.best) {
          cur.best = spent;
          cur.category = c.name; // категория с наибольшей долей мерчанта
        }
        cur.total += spent;
        cur.count += p.count;
        m.set(p.name, cur);
      }
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  }, [expenses]);
  const maxMerchant = Math.max(...merchants.map((m) => m.total), 1);

  return (
    <Card size="3">
      <Flex justify="between" align="center" mb="2" gap="2" wrap="wrap">
        <Text size="4" weight="bold">
          Расходы
        </Text>
        <Flex gap="2" align="center">
          <Badge color="gray" variant="soft">
            {view === 'categories'
              ? `${expenses.length} категорий`
              : `${merchants.length} мерчантов`}
          </Badge>
          <SegmentedControl.Root
            size="1"
            value={view}
            onValueChange={(v) => setView(v as typeof view)}
          >
            <SegmentedControl.Item value="categories">Категории</SegmentedControl.Item>
            <SegmentedControl.Item value="merchants">Мерчанты</SegmentedControl.Item>
          </SegmentedControl.Root>
        </Flex>
      </Flex>

      {view === 'categories' &&
        expenses.map((c) => (
          <CategoryRow
            key={`${c.group}/${c.name}`}
            cat={c}
            max={maxCat}
            catalog={catalog}
            period={period}
            onChanged={onChanged}
          />
        ))}
      {view === 'merchants' &&
        merchants.map((m) => (
          <MerchantRow
            key={m.name}
            m={m}
            max={maxMerchant}
            catalog={catalog}
            period={period}
            onChanged={onChanged}
          />
        ))}

      {view === 'categories' && incomes.length > 0 && (
        <>
          <Text size="4" weight="bold" mt="4" as="div">
            Поступления
          </Text>
          {incomes.map((c) => (
            <CategoryRow
              key={`${c.group}/${c.name}`}
              cat={c}
              max={maxIncome}
              income
              catalog={catalog}
              period={period}
              onChanged={onChanged}
            />
          ))}
        </>
      )}
    </Card>
  );
}
