import { Badge, Box, Card, Flex, Text } from '@radix-ui/themes';
import type { AccountBalance, Balances } from '@shared/api/types';
import { moneyExact } from '@shared/lib/format';
import { CURRENCY_COLORS } from './currency';

const native = (v: number, cur: string) =>
  `${v.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} ${cur}`;

export function AccountsList({
  data,
  onPick,
}: {
  data: Balances;
  onPick?: (a: AccountBalance) => void;
}) {
  const max = Math.max(...data.accounts.map((a) => Math.abs(a.balancePln)), 1);
  return (
    <Card size="3">
      <Flex justify="between" align="center">
        <Text size="4" weight="bold">
          Счета
        </Text>
        {onPick && (
          <Text size="1" color="gray">
            клик по счёту → история
          </Text>
        )}
      </Flex>
      <Flex direction="column" mt="2">
        {data.accounts.map((a) => {
          const share = data.totalPln > 0 ? a.balancePln / data.totalPln : 0;
          return (
            <Box
              key={a.id}
              py="2"
              style={onPick ? { cursor: 'pointer' } : undefined}
              onClick={onPick ? () => onPick(a) : undefined}
            >
              <Flex justify="between" align="center" gap="2">
                <Flex gap="2" align="center" minWidth="0">
                  <Text size="3" weight="medium" truncate>
                    {a.name}
                  </Text>
                  {a.offBudget && (
                    <Badge size="1" variant="soft" color="amber">
                      вне бюджета
                    </Badge>
                  )}
                </Flex>
                <Flex direction="column" align="end" flexShrink="0">
                  <Text size="3" weight="bold" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {moneyExact(a.balancePln)}
                  </Text>
                  {a.currency !== (data.base ?? 'PLN') && (
                    <Text size="1" color="gray" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {native(a.balance, a.currency)}
                    </Text>
                  )}
                </Flex>
              </Flex>
              <Flex align="center" gap="2" mt="1">
                <Box
                  flexGrow="1"
                  height="6px"
                  style={{ background: 'var(--gray-4)', borderRadius: 3, overflow: 'hidden' }}
                >
                  <Box
                    height="6px"
                    style={{
                      width: `${Math.max(1, (Math.abs(a.balancePln) / max) * 100)}%`,
                      background: CURRENCY_COLORS[a.currency],
                      borderRadius: 3,
                    }}
                  />
                </Box>
                <Text
                  size="1"
                  color="gray"
                  style={{ width: 44, textAlign: 'right', whiteSpace: 'nowrap' }}
                >
                  {(share * 100).toFixed(1)}%
                </Text>
              </Flex>
            </Box>
          );
        })}
      </Flex>
    </Card>
  );
}
