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
import { connectBank, fetchAspsps, fetchBanks, fetchSetup, type Setup } from '@shared/api/client';
import type { Aspsp, Bank, BankAccount } from '@shared/api/types';
import { EbSetupCard } from '@widgets/banks/EbSetupCard';
import { relativeTime } from '@shared/lib/format';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

const daysLeft = (iso: string) => Math.floor((new Date(iso).getTime() - Date.now()) / 864e5);

function ConsentBadge({ bank }: { bank: Bank }) {
  if (!bank.consentUntil)
    return (
      <Badge color="gray" variant="soft">
        срок согласия неизвестен
      </Badge>
    );
  const d = daysLeft(bank.consentUntil);
  const date = new Date(bank.consentUntil).toLocaleDateString('ru');
  if (d < 0)
    return (
      <Badge color="red" variant="soft">
        согласие истекло {date}
      </Badge>
    );
  return (
    <Badge color={d <= 14 ? 'red' : d <= 30 ? 'amber' : 'grass'} variant="soft">
      {bank.estimated ? '≈ ' : ''}до {date} · {d} дн.
    </Badge>
  );
}

const nativeFmt = (v: number, cur: string) =>
  new Intl.NumberFormat('pl-PL', { style: 'currency', currency: cur }).format(v);

function AccountStatus({ a }: { a: BankAccount }) {
  if (a.error === 'login_required')
    return (
      <Text size="1" color="red">
        нужно переподключить
      </Text>
    );
  if (a.error)
    return (
      <Text size="1" color="red" title={a.error}>
        ошибка синка
      </Text>
    );
  return (
    <Text size="1" color="gray">
      {relativeTime(a.syncedAt)}
    </Text>
  );
}

export function BanksPage() {
  const [banks, setBanks] = useState<Bank[] | null>(null);
  const [aspsps, setAspsps] = useState<Aspsp[]>([]);
  const [newBank, setNewBank] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [params] = useSearchParams();

  useEffect(() => {
    fetchBanks()
      .then(setBanks)
      .catch((e) => setError(String(e.message || e)));
    fetchSetup()
      .then(setSetup)
      .catch(() => {});
  }, []);

  // уходим в банк; он вернёт на /enablebanking/auth_callback → сервер привяжет счета и вернёт сюда
  const connect = (aspsp: string) => {
    setBusy(aspsp);
    setError(null);
    connectBank(aspsp)
      .then(({ url }) => {
        window.location.href = url;
      })
      .catch((e) => {
        setError(String(e.message || e));
        setBusy(null);
      });
  };

  const loadAspsps = () => {
    if (!aspsps.length)
      fetchAspsps()
        .then(setAspsps)
        .catch((e) => setError(String(e.message || e)));
  };

  const linked = params.get('linked');
  const until = params.get('until');
  const failed = params.get('error');

  return (
    <Container size="3" px={{ initial: '3', sm: '4' }} py="5">
      <Flex direction="column" gap="4">
        <Heading size={{ initial: '6', sm: '7' }}>Банки</Heading>

        {linked && (
          <Callout.Root color="grass">
            <Callout.Text>
              Привязано: {linked}
              {until ? ` · согласие до ${new Date(until).toLocaleDateString('ru')}` : ''}
            </Callout.Text>
          </Callout.Root>
        )}
        <EbSetupCard />
        {(failed || error) && (
          <Callout.Root color="red">
            <Callout.Text>{failed || error}</Callout.Text>
          </Callout.Root>
        )}

        {!banks ? (
          <Flex justify="center" py="9">
            <Spinner size="3" />
          </Flex>
        ) : (
          banks.map((b) => (
            <Card key={b.name} size="3">
              <Flex justify="between" align="center" gap="3" wrap="wrap" mb="3">
                <Flex direction="column" gap="1">
                  <Heading size="4">{b.name}</Heading>
                  <ConsentBadge bank={b} />
                </Flex>
                <Button variant="soft" disabled={!!busy} onClick={() => connect(b.name)}>
                  {busy === b.name ? <Spinner size="1" /> : '↻'} Переподключить
                </Button>
              </Flex>
              <Table.Root size="1">
                <Table.Body>
                  {b.accounts.map((a) => (
                    <Table.Row key={a.id}>
                      <Table.Cell>
                        <Flex direction="column">
                          <Text size="2">{a.name}</Text>
                          {a.iban && (
                            <Text size="1" color="gray">
                              {a.iban.slice(0, 4)} … {a.iban.slice(-4)}
                            </Text>
                          )}
                        </Flex>
                      </Table.Cell>
                      <Table.Cell align="right">
                        <Text size="2" style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {a.bankBalance == null ? '—' : nativeFmt(a.bankBalance, a.currency)}
                        </Text>
                      </Table.Cell>
                      <Table.Cell align="right">
                        <AccountStatus a={a} />
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            </Card>
          ))
        )}

        <Card size="3">
          <Heading size="4" mb="1">
            Подключить банк
          </Heading>
          <Text size="2" color="gray" as="div" mb="3">
            Через Enable Banking. Согласие берётся на максимальный срок банка (до 180 дней); счета,
            которые уже есть, привязываются сами — по идентификатору счёта и IBAN.
          </Text>
          <Flex gap="2" wrap="wrap">
            <Select.Root value={newBank} onValueChange={setNewBank} onOpenChange={loadAspsps}>
              <Select.Trigger placeholder="банк" style={{ minWidth: 220 }} />
              <Select.Content>
                {aspsps.map((a) => (
                  <Select.Item key={a.name} value={a.name}>
                    {a.name} · {a.maxConsentDays} дн.
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
            <Button disabled={!newBank || !!busy} onClick={() => connect(newBank)}>
              Подключить
            </Button>
          </Flex>
        </Card>

        {setup && !setup.auth && (
          <Callout.Root color="gray" size="1">
            <Callout.Text>
              Банк вернёт вас на {setup.redirectUrl} — у локального сервера самоподписанный
              сертификат, браузер один раз попросит подтвердить переход.
            </Callout.Text>
          </Callout.Root>
        )}
      </Flex>
    </Container>
  );
}
