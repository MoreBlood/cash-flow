import { CategorySelect } from '@features/categorize/CategorySelect';
import {
  AlertDialog,
  Badge,
  Button,
  Dialog,
  Flex,
  Separator,
  Text,
  TextArea,
  TextField,
} from '@radix-ui/themes';
import { deleteTransaction, excludeTransaction, updateTransaction } from '@shared/api/client';
import type { Category, FeedTx } from '@shared/api/types';
import { moneyExact } from '@shared/lib/format';
import { useEffect, useState } from 'react';

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
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ payee: '', notes: '', date: '', amount: '' });
  useEffect(() => {
    if (tx) setForm({ payee: tx.payee, notes: tx.notes, date: tx.date, amount: String(tx.native) });
    setError(null);
  }, [tx]);
  if (!tx) return null;
  const positive = tx.amount >= 0;

  const act = (p: Promise<unknown>) => {
    setBusy(true);
    setError(null);
    p.then(() => {
      onChanged();
      onClose();
    })
      .catch((e) => setError(String(e.message || e)))
      .finally(() => setBusy(false));
  };
  const exclude = () => act(excludeTransaction(tx.id));
  const remove = () => act(deleteTransaction(tx.id));

  const dirty =
    form.payee.trim() !== tx.payee ||
    form.notes.trim() !== tx.notes ||
    (tx.manual && (form.date !== tx.date || Number(form.amount) !== tx.native));
  const save = () =>
    act(
      updateTransaction({
        id: tx.id,
        payee: form.payee,
        notes: form.notes,
        ...(tx.manual ? { date: form.date, amount: Number(form.amount) } : {}),
      }),
    );
  const field = (k: keyof typeof form) => ({
    value: form[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm({ ...form, [k]: e.target.value }),
  });

  return (
    <Dialog.Root open={!!tx} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Content maxWidth="440px" onOpenAutoFocus={(e) => e.preventDefault()}>
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
          {tx.pending && (
            <Badge variant="soft" color="amber">
              в обработке
            </Badge>
          )}
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

        <Separator size="4" my="3" />
        <Flex direction="column" gap="2">
          <TextField.Root size="2" placeholder="Получатель" {...field('payee')} />
          <TextArea size="2" placeholder="Заметка" rows={2} {...field('notes')} />
          {tx.manual && (
            <Flex gap="2">
              <TextField.Root size="2" type="date" style={{ flex: 1 }} {...field('date')} />
              <TextField.Root
                size="2"
                type="number"
                step="0.01"
                style={{ flex: 1 }}
                {...field('amount')}
              >
                <TextField.Slot side="right">{tx.currency}</TextField.Slot>
              </TextField.Root>
            </Flex>
          )}
          {dirty && (
            <Button disabled={busy} onClick={save}>
              Сохранить
            </Button>
          )}
          {error && (
            <Text size="1" color="red">
              {error}
            </Text>
          )}
        </Flex>

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
          {tx.manual && (
            <AlertDialog.Root>
              <AlertDialog.Trigger>
                <Button variant="soft" color="red" disabled={busy}>
                  Удалить операцию
                </Button>
              </AlertDialog.Trigger>
              <AlertDialog.Content maxWidth="400px">
                <AlertDialog.Title>Удалить операцию?</AlertDialog.Title>
                <AlertDialog.Description size="2">
                  {tx.payee}, {nativeFmt(tx.native, tx.currency)} — баланс счёта «{tx.account}»
                  изменится. Отменить нельзя.
                </AlertDialog.Description>
                <Flex gap="3" justify="end" mt="4">
                  <AlertDialog.Cancel>
                    <Button variant="soft" color="gray">
                      Отмена
                    </Button>
                  </AlertDialog.Cancel>
                  <AlertDialog.Action>
                    <Button color="red" onClick={remove}>
                      Удалить
                    </Button>
                  </AlertDialog.Action>
                </Flex>
              </AlertDialog.Content>
            </AlertDialog.Root>
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
