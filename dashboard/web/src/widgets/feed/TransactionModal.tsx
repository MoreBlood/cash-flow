import { CategorySelect } from '@features/categorize/CategorySelect';
import { Badge, Button, Dialog, Flex, Separator, Text } from '@radix-ui/themes';
import { excludeTransaction } from '@shared/api/client';
import type { Category, FeedTx } from '@shared/api/types';
import { moneyExact } from '@shared/lib/format';
import { useState } from 'react';

const nativeFmt = (v: number, cur: string) =>
  new Intl.NumberFormat('pl-PL', {
    style: 'currency',
    currency: cur,
    minimumFractionDigits: 2,
  }).format(v);

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Flex justify="between" align="center" gap="3" py="1">
      <Text size="2" color="gray">
        {label}
      </Text>
      <Flex align="center" gap="2">
        {children}
      </Flex>
    </Flex>
  );
}

interface Props {
  tx: FeedTx | null;
  catalog: Category[];
  period: { from: string; to: string };
  onChanged: () => void;
  onClose: () => void;
}

export function TransactionModal({ tx, catalog, period, onChanged, onClose }: Props) {
  const [busy, setBusy] = useState(false);
  if (!tx) return null;
  const positive = tx.amount >= 0;

  const exclude = () => {
    setBusy(true);
    excludeTransaction(tx.id)
      .then(() => {
        onChanged();
        onClose();
      })
      .finally(() => setBusy(false));
  };

  return (
    <Dialog.Root open={!!tx} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Content maxWidth="440px">
        <Flex direction="column" align="center" gap="1" mb="2">
          <Text size="2" color="gray">
            {tx.payee}
          </Text>
          <Text
            size="8"
            weight="bold"
            style={{
              color: positive ? 'var(--grass-11)' : undefined,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {positive ? '+' : ''}
            {nativeFmt(tx.native, tx.currency)}
          </Text>
          {Math.abs(tx.amount - tx.native) > 0.01 && (
            <Text size="2" color="gray">
              ≈ {moneyExact(tx.amount)}
            </Text>
          )}
        </Flex>
        <Separator size="4" mb="2" />
        <Row label="Дата">
          <Text size="2">{new Date(tx.date).toLocaleDateString('ru')}</Text>
        </Row>
        <Row label="Счёт">
          <Flex gap="2" align="center">
            <Text size="2">{tx.account}</Text>
            {tx.currency !== 'PLN' && (
              <Badge variant="soft" color="iris">
                {tx.currency}
              </Badge>
            )}
          </Flex>
        </Row>
        <Row label="Категория">
          {tx.category ? (
            <Badge variant="soft" color={tx.excluded ? 'gray' : 'iris'}>
              {tx.category}
            </Badge>
          ) : (
            <Badge variant="soft" color="orange">
              без категории
            </Badge>
          )}
        </Row>
        {tx.notes && (
          <Row label="Заметка">
            <Text size="2" style={{ maxWidth: 240, textAlign: 'right' }}>
              {tx.notes}
            </Text>
          </Row>
        )}

        <Separator size="4" my="3" />
        <Flex direction="column" gap="2">
          <Flex justify="between" align="center" gap="2">
            <Text size="2" weight="medium">
              Изменить категорию
            </Text>
            <CategorySelect
              catalog={catalog}
              txId={tx.id}
              payee={tx.payee}
              period={period}
              onDone={() => {
                onChanged();
                onClose();
              }}
            />
          </Flex>
          {!tx.excluded && (
            <Button variant="soft" color="gray" disabled={busy} onClick={exclude}>
              Исключить из аналитики
            </Button>
          )}
        </Flex>

        <Flex justify="end" mt="3">
          <Dialog.Close>
            <Button variant="ghost" color="gray">
              Закрыть
            </Button>
          </Dialog.Close>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
