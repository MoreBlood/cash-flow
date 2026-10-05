import { Button, Dialog, Flex, SegmentedControl, Select, Text, TextField } from '@radix-ui/themes';
import { addOperation, addTransfer } from '@shared/api/client';
import type { AccountRef, Category } from '@shared/api/types';
import { categoryStyle } from '@shared/config/categories';
import { useEffect, useMemo, useState } from 'react';

const today = () => new Date().toISOString().slice(0, 10);

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  accounts: AccountRef[];
  catalog: Category[];
  onDone: () => void;
  /** предвыбранный счёт (клик по строке счёта) */
  initialAccountId?: string;
}

export function OperationModal({
  open,
  onOpenChange,
  accounts,
  catalog,
  onDone,
  initialAccountId,
}: Props) {
  const [mode, setMode] = useState<'op' | 'transfer'>('op');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // общая операция
  const [accountId, setAccountId] = useState('');
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [categoryId, setCategoryId] = useState<string>('');

  // перевод
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');

  // при открытии — сброс полей и предвыбор счёта
  useEffect(() => {
    if (open) {
      setMode('op');
      setAccountId(initialAccountId ?? '');
      setFromId(initialAccountId ?? '');
      setToId('');
      setAmount('');
      setNotes('');
      setCategoryId('');
      setError(null);
    }
  }, [open, initialAccountId]);

  const catGroups = useMemo(() => {
    const m = new Map<string, Category[]>();
    for (const c of catalog) {
      if (!m.has(c.group)) m.set(c.group, []);
      m.get(c.group)?.push(c);
    }
    return [...m.entries()];
  }, [catalog]);

  const fromCur = accounts.find((a) => a.id === fromId)?.currency;
  const toOptions = accounts.filter((a) => a.id !== fromId && (!fromCur || a.currency === fromCur));

  const submit = () => {
    setBusy(true);
    setError(null);
    const p =
      mode === 'op'
        ? addOperation({
            accountId,
            date,
            amount: Number(amount),
            notes,
            categoryId: categoryId || null,
          })
        : addTransfer({ fromAccountId: fromId, toAccountId: toId, amount: Number(amount), date });
    p.then(() => {
      onDone();
      onOpenChange(false);
    })
      .catch((e) => setError(String(e.message || e)))
      .finally(() => setBusy(false));
  };

  const valid =
    mode === 'op'
      ? accountId && date && amount !== '' && Number.isFinite(Number(amount))
      : fromId && toId && fromId !== toId && Number(amount) > 0 && date;

  const acctOption = (a: AccountRef) => (
    <Select.Item key={a.id} value={a.id}>
      {a.name}
    </Select.Item>
  );

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="440px">
        <Dialog.Title>Новая операция</Dialog.Title>
        <SegmentedControl.Root
          value={mode}
          onValueChange={(v) => setMode(v as typeof mode)}
          size="2"
          mt="2"
        >
          <SegmentedControl.Item value="op">Операция</SegmentedControl.Item>
          <SegmentedControl.Item value="transfer">Перевод</SegmentedControl.Item>
        </SegmentedControl.Root>

        <Flex direction="column" gap="3" mt="3">
          {mode === 'op' ? (
            <>
              <Field label="Счёт">
                <Select.Root value={accountId} onValueChange={setAccountId}>
                  <Select.Trigger placeholder="выберите счёт" style={{ width: '100%' }} />
                  <Select.Content>{accounts.map(acctOption)}</Select.Content>
                </Select.Root>
              </Field>
              <Field label="Сумма (+ приход, − расход)">
                <TextField.Root
                  type="number"
                  placeholder="напр. 5200 или -100"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </Field>
              <Field label="Категория (необязательно)">
                <Select.Root value={categoryId} onValueChange={setCategoryId}>
                  <Select.Trigger placeholder="без категории" style={{ width: '100%' }} />
                  <Select.Content>
                    {catGroups.map(([group, cats]) => (
                      <Select.Group key={group}>
                        <Select.Label>{group}</Select.Label>
                        {cats.map((c) => (
                          <Select.Item key={c.id} value={c.id}>
                            {categoryStyle(c.name).icon} {c.name}
                          </Select.Item>
                        ))}
                      </Select.Group>
                    ))}
                  </Select.Content>
                </Select.Root>
              </Field>
              <Field label="Заметка">
                <TextField.Root value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>
            </>
          ) : (
            <>
              <Field label="Со счёта">
                <Select.Root value={fromId} onValueChange={setFromId}>
                  <Select.Trigger placeholder="откуда" style={{ width: '100%' }} />
                  <Select.Content>{accounts.map(acctOption)}</Select.Content>
                </Select.Root>
              </Field>
              <Field label="На счёт (та же валюта)">
                <Select.Root value={toId} onValueChange={setToId} disabled={!fromId}>
                  <Select.Trigger placeholder="куда" style={{ width: '100%' }} />
                  <Select.Content>{toOptions.map(acctOption)}</Select.Content>
                </Select.Root>
              </Field>
              <Field label="Сумма">
                <TextField.Root
                  type="number"
                  placeholder="напр. 2300"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </Field>
            </>
          )}
          <Field label="Дата">
            <TextField.Root type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          {error && (
            <Text size="1" color="red">
              {error}
            </Text>
          )}
        </Flex>

        <Flex justify="end" gap="2" mt="4">
          <Dialog.Close>
            <Button variant="soft" color="gray">
              Отмена
            </Button>
          </Dialog.Close>
          <Button disabled={busy || !valid} onClick={submit}>
            {busy ? 'Сохранение…' : 'Сохранить'}
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Text size="1" color="gray" as="div" mb="1">
        {label}
      </Text>
      {children}
    </div>
  );
}
