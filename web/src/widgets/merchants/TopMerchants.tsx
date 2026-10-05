import { Badge, Card, Flex, Text } from '@radix-ui/themes';
import type { CategorySummary } from '@shared/api/types';
import { categoryStyle } from '@shared/config/categories';
import { getDisplayCurrency, moneyExact, moneyIn } from '@shared/lib/format';

export function TopMerchants({ categories }: { categories: CategorySummary[] }) {
  const merchants = categories
    .filter((c) => c.total < 0)
    .flatMap((c) => c.payees.filter((p) => p.sum < 0).map((p) => ({ ...p, category: c.name })))
    .sort((a, b) => a.sum - b.sum)
    .slice(0, 5);
  if (!merchants.length) return null;
  const base = getDisplayCurrency();
  // имена, встречающиеся в нескольких валютах — показываем валюту
  const seen = new Map<string, string>();
  const mixed = new Set<string>();
  for (const m of merchants) {
    const prev = seen.get(m.name);
    if (prev !== undefined && prev !== m.currency) mixed.add(m.name);
    seen.set(m.name, m.currency);
  }
  return (
    <Card size="3">
      <Text size="4" weight="bold">
        Топ мерчантов
      </Text>
      <Flex direction="column" mt="2">
        {merchants.map((m) => (
          <Flex key={`${m.category}/${m.name} ${m.currency}`} gap="2" align="center" py="1">
            <Text size="3">{categoryStyle(m.category).icon}</Text>
            <Flex align="center" gap="1" style={{ flexGrow: 1, minWidth: 0 }}>
              <Text size="2" truncate>
                {m.name}
              </Text>
              {mixed.has(m.name) && (
                <Badge size="1" variant="soft" color="gray" style={{ flexShrink: 0 }}>
                  {m.currency}
                </Badge>
              )}
            </Flex>
            <Flex direction="column" align="end" style={{ flexShrink: 0 }}>
              <Text size="2" weight="medium" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {moneyExact(-m.sum)}
              </Text>
              {m.currency !== base && (
                <Text size="1" color="gray" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {moneyIn(-m.native, m.currency)}
                </Text>
              )}
            </Flex>
          </Flex>
        ))}
      </Flex>
    </Card>
  );
}
