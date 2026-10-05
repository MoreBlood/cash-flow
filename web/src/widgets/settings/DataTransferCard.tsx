import { AlertDialog, Button, Card, Flex, Heading, Text } from '@radix-ui/themes';
import { emitRefresh, importData } from '@shared/api/client';
import { useState } from 'react';

type Parsed = { data: unknown; accounts: number; transactions: number };

/** Перенос всех данных между установками (например, локальная → облако). */
export function DataTransferCard() {
  const [pending, setPending] = useState<Parsed | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = (file?: File) => {
    if (!file) return;
    setError(null);
    setResult(null);
    file
      .text()
      .then((t) => {
        const data = JSON.parse(t);
        if (data?.format !== 'cashflow-export') throw new Error('это не файл экспорта Cash Flow');
        setPending({
          data,
          accounts: data.accounts?.length ?? 0,
          transactions: data.transactions?.length ?? 0,
        });
      })
      .catch((e) => setError(String(e.message || e)));
  };

  const run = () => {
    if (!pending) return;
    setBusy(true);
    importData(pending.data)
      .then((r) => {
        setResult(
          `Загружено: ${r.accounts} счетов, ${r.transactions} операций, ${r.categories} категорий, ${r.rules} правил`,
        );
        emitRefresh();
      })
      .catch((e) => setError(String(e.message || e)))
      .finally(() => {
        setBusy(false);
        setPending(null);
      });
  };

  return (
    <Card size="3">
      <Heading size="4" mb="1">
        Перенос данных
      </Heading>
      <Text size="2" color="gray" as="div" mb="3">
        Счета, операции, категории, правила и настройки — одним файлом. Так локальная установка
        переезжает в облако и обратно. Ключи (вход, Enable Banking) в файл не попадают; с тем же
        приложением Enable Banking счета продолжат синкаться без переподключения банков.
      </Text>
      <Flex gap="2" wrap="wrap">
        <Button asChild variant="soft">
          <a href="/api/export" download>
            Скачать экспорт
          </a>
        </Button>
        <Button asChild variant="soft" color="gray" disabled={busy}>
          <label style={{ cursor: 'pointer' }}>
            {busy ? 'Загружаю…' : 'Загрузить из файла…'}
            <input type="file" accept=".json" hidden onChange={(e) => pick(e.target.files?.[0])} />
          </label>
        </Button>
      </Flex>
      {(result || error) && (
        <Text size="2" color={error ? 'red' : 'grass'} as="div" mt="2">
          {error || result}
        </Text>
      )}
      <AlertDialog.Root open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialog.Content maxWidth="420px">
          <AlertDialog.Title>Заменить все данные?</AlertDialog.Title>
          <AlertDialog.Description size="2">
            Текущие счета, операции, категории и правила этой установки будут заменены данными из
            файла ({pending?.accounts} счетов, {pending?.transactions} операций). Отменить нельзя —
            при необходимости сначала скачайте экспорт.
          </AlertDialog.Description>
          <Flex gap="3" justify="end" mt="4">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray">
                Отмена
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button color="red" onClick={run}>
                Заменить
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </Card>
  );
}
