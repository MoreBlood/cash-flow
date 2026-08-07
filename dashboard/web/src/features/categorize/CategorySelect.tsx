import { AlertDialog, Button, Flex, Select, Text } from '@radix-ui/themes';
import { type CategorizePayload, categorize } from '@shared/api/client';
import type { Category } from '@shared/api/types';
import { categoryStyle } from '@shared/config/categories';
import { useMemo, useState } from 'react';

interface Props {
  catalog: Category[];
  /** одна транзакция */
  txId?: string;
  /** мерчант (включает выбор охвата) */
  payee?: string;
  /** период для варианта «только за период» */
  period?: { from: string; to: string };
  onDone: () => void;
}

export function CategorySelect({ catalog, txId, payee, period, onDone }: Props) {
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Category | null>(null);

  const groups = useMemo(() => {
    const m = new Map<string, Category[]>();
    for (const c of catalog) {
      if (!m.has(c.group)) m.set(c.group, []);
      m.get(c.group)?.push(c);
    }
    return [...m.entries()];
  }, [catalog]);

  const run = (payload: CategorizePayload) => {
    setBusy(true);
    setPending(null);
    categorize(payload)
      .then(onDone)
      .finally(() => setBusy(false));
  };

  const pick = (categoryId: string) => {
    const cat = catalog.find((c) => c.id === categoryId);
    if (!cat) return;
    if (payee)
      setPending(cat); // спросить охват
    else if (txId) run({ txId, categoryId });
  };

  return (
    <>
      <Select.Root size="1" disabled={busy} value="" onValueChange={pick}>
        <Select.Trigger
          variant="soft"
          color="gray"
          placeholder={busy ? '…' : 'категория'}
          onClick={(e) => e.stopPropagation()}
        />
        <Select.Content>
          {groups.map(([group, cats]) => (
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

      <AlertDialog.Root open={pending !== null} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialog.Content maxWidth="440px">
          <AlertDialog.Title>
            «{pending?.name}» для {payee}
          </AlertDialog.Title>
          <AlertDialog.Description size="2" color="gray">
            К каким операциям мерчанта применить категорию?
          </AlertDialog.Description>
          <Flex direction="column" gap="2" mt="4">
            {pending && payee && (
              <Button
                variant="solid"
                onClick={() => run({ payee, categoryId: pending.id, allTime: true, rule: true })}
              >
                Все прошлые и будущие (создать правило)
              </Button>
            )}
            {pending && txId && (
              <Button variant="soft" onClick={() => run({ txId, categoryId: pending.id })}>
                Только эту транзакцию
              </Button>
            )}
            {pending && payee && period && !txId && (
              <Button
                variant="soft"
                onClick={() =>
                  run({ payee, categoryId: pending.id, from: period.from, to: period.to })
                }
              >
                Только за выбранный период
              </Button>
            )}
            <AlertDialog.Cancel>
              <Button variant="ghost" color="gray">
                Отмена
              </Button>
            </AlertDialog.Cancel>
          </Flex>
          <Text size="1" color="gray" mt="3" as="div">
            «Все прошлые и будущие» обновит всю историю мерчанта и создаст правило в Actual — новые
            транзакции из банка будут категоризироваться автоматически.
          </Text>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </>
  );
}
