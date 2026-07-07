import {
  Badge,
  Button,
  Callout,
  Card,
  Container,
  Flex,
  Heading,
  Select,
  Spinner,
  Table,
  Text,
} from '@radix-ui/themes';
import { fetchAccounts, fetchCategories, fetchSettings, saveSettings } from '@shared/api/client';
import type { AccountRef, Category, Settings } from '@shared/api/types';
import { useEffect, useMemo, useState } from 'react';

const CURRENCIES = ['PLN', 'USD', 'EUR', 'CHF'];
const NONE = '__none__';

function CategoryPicker({
  value,
  groups,
  onChange,
}: {
  value: string | null;
  groups: [string, Category[]][];
  onChange: (v: string | null) => void;
}) {
  return (
    <Select.Root value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : v)}>
      <Select.Trigger placeholder="не выбрано" style={{ minWidth: 220 }} />
      <Select.Content>
        <Select.Item value={NONE}>— не выбрано —</Select.Item>
        {groups.map(([group, cats]) => (
          <Select.Group key={group}>
            <Select.Label>{group}</Select.Label>
            {cats.map((c) => (
              <Select.Item key={c.id} value={c.id}>
                {c.name}
              </Select.Item>
            ))}
          </Select.Group>
        ))}
      </Select.Content>
    </Select.Root>
  );
}

export function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [catalog, setCatalog] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<AccountRef[]>([]);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchSettings(), fetchCategories(), fetchAccounts()])
      .then(([s, c, a]) => {
        setSettings(s);
        setCatalog(c);
        setAccounts(a);
      })
      .catch((e) => setError(String(e)));
  }, []);

  const groupNames = useMemo(() => [...new Set(catalog.map((c) => c.group))], [catalog]);
  const catGroups = useMemo(() => {
    const m = new Map<string, Category[]>();
    for (const c of catalog) {
      if (!m.has(c.group)) m.set(c.group, []);
      m.get(c.group)?.push(c);
    }
    return [...m.entries()];
  }, [catalog]);

  if (error)
    return (
      <Container size="2" py="9">
        <Text color="red">Ошибка: {error}</Text>
      </Container>
    );
  if (!settings)
    return (
      <Flex justify="center" py="9">
        <Spinner size="3" />
      </Flex>
    );

  const patch = (p: Partial<Settings>) => setSettings({ ...settings, ...p });
  const setCurrency = (accountId: string, cur: string, detected: string) => {
    const next = { ...settings.accountCurrencies };
    if (cur === detected) delete next[accountId];
    else next[accountId] = cur;
    patch({ accountCurrencies: next });
  };

  const save = () => {
    setBusy(true);
    setError(null);
    saveSettings(settings)
      .then((s) => {
        setSettings(s);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      })
      .catch((e) => setError(String(e.message || e)))
      .finally(() => setBusy(false));
  };

  return (
    <Container size="3" px={{ initial: '3', sm: '4' }} py="5">
      <Flex direction="column" gap="4">
        <Flex justify="between" align="center" wrap="wrap" gap="3">
          <Heading size={{ initial: '6', sm: '7' }}>Настройки</Heading>
          <Flex align="center" gap="3">
            {saved && (
              <Text size="2" style={{ color: 'var(--grass-11)' }}>
                Сохранено ✓
              </Text>
            )}
            <Button disabled={busy} onClick={save}>
              {busy ? 'Сохранение…' : 'Сохранить'}
            </Button>
          </Flex>
        </Flex>

        <Card size="3">
          <Heading size="4" mb="1">
            Аналитика
          </Heading>
          <Text size="2" color="gray" as="div" mb="3">
            Как дашборд отличает переводы/обмены от реальных трат.
          </Text>
          <Flex direction="column" gap="3">
            <Flex justify="between" align="center" gap="3" wrap="wrap">
              <Flex direction="column">
                <Text size="2" weight="medium">
                  Группа исключений
                </Text>
                <Text size="1" color="gray">
                  переводы между счетами, обмены валют — не считаются доходом/расходом
                </Text>
              </Flex>
              <Select.Root
                value={settings.excludedGroup}
                onValueChange={(v) => patch({ excludedGroup: v })}
              >
                <Select.Trigger style={{ minWidth: 220 }} />
                <Select.Content>
                  {groupNames.map((g) => (
                    <Select.Item key={g} value={g}>
                      {g}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </Flex>
            <Flex justify="between" align="center" gap="3" wrap="wrap">
              <Text size="2" weight="medium">
                Категория для «Исключить из аналитики»
              </Text>
              <CategoryPicker
                value={settings.excludeCategoryId}
                groups={catGroups}
                onChange={(v) => patch({ excludeCategoryId: v })}
              />
            </Flex>
            <Flex justify="between" align="center" gap="3" wrap="wrap">
              <Text size="2" weight="medium">
                Категория для переводов между счетами
              </Text>
              <CategoryPicker
                value={settings.transferCategoryId}
                groups={catGroups}
                onChange={(v) => patch({ transferCategoryId: v })}
              />
            </Flex>
          </Flex>
        </Card>

        <Card size="3">
          <Heading size="4" mb="1">
            Валюты счетов
          </Heading>
          <Text size="2" color="gray" as="div" mb="3">
            По умолчанию валюта определяется по названию счёта. Здесь можно задать явно.
          </Text>
          <Table.Root size="1">
            <Table.Body>
              {accounts.map((a) => (
                <Table.Row key={a.id}>
                  <Table.Cell>
                    <Flex gap="2" align="center">
                      <Text size="2">{a.name}</Text>
                      {settings.accountCurrencies[a.id] && (
                        <Badge size="1" variant="soft" color="iris">
                          вручную
                        </Badge>
                      )}
                    </Flex>
                  </Table.Cell>
                  <Table.Cell align="right">
                    <Select.Root
                      size="1"
                      value={settings.accountCurrencies[a.id] || a.currency}
                      onValueChange={(v) => setCurrency(a.id, v, a.currency)}
                    >
                      <Select.Trigger variant="soft" />
                      <Select.Content>
                        {CURRENCIES.map((c) => (
                          <Select.Item key={c} value={c}>
                            {c}
                          </Select.Item>
                        ))}
                      </Select.Content>
                    </Select.Root>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        </Card>

        <Callout.Root color="gray" size="1">
          <Callout.Text>
            Базовая валюта отображения (PLN/USD/EUR/CHF) выбирается в шапке и хранится в браузере.
            Пароль сервера и Sync ID бюджета задаются в файле <code>.env</code>.
          </Callout.Text>
        </Callout.Root>
      </Flex>
    </Container>
  );
}
