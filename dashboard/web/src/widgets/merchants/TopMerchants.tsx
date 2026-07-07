import { Card, Flex, Text } from '@radix-ui/themes';
import type { CategorySummary } from '@shared/api/types';
import { categoryStyle } from '@shared/config/categories';
import { moneyExact } from '@shared/lib/format';

export function TopMerchants({ categories }: { categories: CategorySummary[] }) {
  const merchants = categories
    .filter((c) => c.total < 0)
    .flatMap((c) => c.payees.filter((p) => p.sum < 0).map((p) => ({ ...p, category: c.name })))
    .sort((a, b) => a.sum - b.sum)
    .slice(0, 5);
  if (!merchants.length) return null;
  return (
    <Card size="3">
      <Text size="4" weight="bold">
        Топ мерчантов
      </Text>
      <Flex direction="column" mt="2">
        {merchants.map((m) => (
          <Flex key={`${m.category}/${m.name}`} gap="2" align="center" py="1">
            <Text size="3">{categoryStyle(m.category).icon}</Text>
            <Text size="2" truncate style={{ flexGrow: 1 }}>
              {m.name}
            </Text>
            <Text size="2" weight="medium" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {moneyExact(-m.sum)}
            </Text>
          </Flex>
        ))}
      </Flex>
    </Card>
  );
}
