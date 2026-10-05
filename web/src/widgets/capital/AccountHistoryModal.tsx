import { Badge, Button, Dialog, Flex, Separator, Text } from '@radix-ui/themes';
import type { AccountBalance, AccountRef, Category } from '@shared/api/types';
import { moneyExact } from '@shared/lib/format';
import { TransactionFeed } from '@widgets/feed/TransactionFeed';
import { useEffect, useState } from 'react';
import { OperationModal } from './OperationModal';

const WIDE_FROM = '2020-01-01';
const nativeFmt = (v: number, cur: string) =>
  new Intl.NumberFormat('pl-PL', {
    style: 'currency',
    currency: cur,
    minimumFractionDigits: 2,
  }).format(v);

interface Props {
  account: AccountBalance | null;
  base: string;
  accounts: AccountRef[];
  catalog: Category[];
  today: string;
  reloadKey: number;
  onChanged: () => void;
  onClose: () => void;
}

export function AccountHistoryModal({
  account,
  base,
  accounts,
  catalog,
  today,
  reloadKey,
  onChanged,
  onClose,
}: Props) {
  const [opOpen, setOpOpen] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: сброс формы при смене счёта
  useEffect(() => {
    setOpOpen(false);
  }, [account?.id]);

  if (!account) return null;
  return (
    <Dialog.Root open={!!account} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Content maxWidth="560px" style={{ maxHeight: '85vh', overflowY: 'auto' }}>
        <Flex justify="between" align="start" gap="3" wrap="wrap">
          <Flex direction="column" gap="1">
            <Flex gap="2" align="center">
              <Dialog.Title mb="0">{account.name}</Dialog.Title>
              {account.currency !== 'PLN' && (
                <Badge variant="soft" color="iris">
                  {account.currency}
                </Badge>
              )}
              {account.offBudget && (
                <Badge size="1" variant="soft" color="amber">
                  вне бюджета
                </Badge>
              )}
            </Flex>
            <Text size="5" weight="bold" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {nativeFmt(account.balance, account.currency)}
            </Text>
            {account.currency !== base && (
              <Text size="1" color="gray">
                ≈ {moneyExact(account.balancePln)}
              </Text>
            )}
          </Flex>
          <Button size="2" onClick={() => setOpOpen(true)}>
            + Операция
          </Button>
        </Flex>
        <Separator size="4" my="3" />
        <TransactionFeed
          from={WIDE_FROM}
          to={today}
          base={base}
          catalog={catalog}
          reloadKey={reloadKey}
          onChanged={onChanged}
          account={account.id}
          title="История"
          nativeAmounts
        />

        {/* форма операции вложена внутрь — Radix держит стек, закрытие формы не роняет историю */}
        <OperationModal
          open={opOpen}
          onOpenChange={setOpOpen}
          initialAccountId={account.id}
          accounts={accounts}
          catalog={catalog}
          onDone={onChanged}
        />
      </Dialog.Content>
    </Dialog.Root>
  );
}
