import { useBaseCurrency } from '@app/currency';
import { PlusIcon } from '@radix-ui/react-icons';
import {
  Button,
  Card,
  Container,
  Flex,
  Grid,
  Heading,
  IconButton,
  Spinner,
  Text,
} from '@radix-ui/themes';
import {
  fetchAccounts,
  fetchBalances,
  fetchCategories,
  fetchNetWorthHistory,
  REFRESH_EVENT,
} from '@shared/api/client';
import type {
  AccountBalance,
  AccountRef,
  Balances,
  Category,
  NetWorthPoint,
} from '@shared/api/types';
import { money } from '@shared/lib/format';
import { AccountHistoryModal } from '@widgets/capital/AccountHistoryModal';
import { AccountsDonut } from '@widgets/capital/AccountsDonut';
import { AccountsList } from '@widgets/capital/AccountsList';
import { NetWorthChart } from '@widgets/capital/NetWorthChart';
import { OperationModal } from '@widgets/capital/OperationModal';
import { useCallback, useEffect, useMemo, useState } from 'react';

export function CapitalPage() {
  const { base } = useBaseCurrency();
  const [data, setData] = useState<Balances | null>(null);
  const [history, setHistory] = useState<NetWorthPoint[]>([]);
  const [accounts, setAccounts] = useState<AccountRef[]>([]);
  const [catalog, setCatalog] = useState<Category[]>([]);
  const [opOpen, setOpOpen] = useState(false);
  const [opAccount, setOpAccount] = useState<string | undefined>(undefined);
  const [accountView, setAccountView] = useState<AccountBalance | null>(null);
  const [feedKey, setFeedKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const openOp = (accountId?: string) => {
    setOpAccount(accountId);
    setOpOpen(true);
  };

  useEffect(() => {
    fetchAccounts()
      .then(setAccounts)
      .catch(() => setAccounts([]));
    fetchCategories()
      .then(setCatalog)
      .catch(() => setCatalog([]));
  }, []);

  const load = useCallback(
    (spinner: boolean) => {
      if (spinner) setData(null);
      fetchBalances(base)
        .then(setData)
        .catch((e) => setError(String(e)));
      fetchNetWorthHistory(base)
        .then((h) => setHistory(h.series))
        .catch(() => setHistory([]));
    },
    [base],
  );

  const refresh = useCallback(() => {
    load(false);
    setFeedKey((k) => k + 1);
  }, [load]);

  useEffect(() => {
    load(true);
  }, [load]);

  // после операции баланс в открытой истории счёта берётся из свежих данных
  useEffect(() => {
    if (!data) return;
    setAccountView((prev) => (prev ? (data.accounts.find((a) => a.id === prev.id) ?? prev) : prev));
  }, [data]);

  useEffect(() => {
    const h = () => refresh();
    window.addEventListener(REFRESH_EVENT, h);
    return () => window.removeEventListener(REFRESH_EVENT, h);
  }, [refresh]);

  if (error)
    return (
      <Container size="2" py="9">
        <Text color="red">Ошибка: {error}</Text>
      </Container>
    );
  if (!data)
    return (
      <Flex justify="center" py="9">
        <Spinner size="3" />
      </Flex>
    );

  const onBudget = data.accounts.filter((a) => !a.offBudget).reduce((s, a) => s + a.balancePln, 0);
  const offBudget = data.totalPln - onBudget;

  return (
    <Container size="4" px={{ initial: '3', sm: '4' }} py="5">
      <Flex direction="column" gap="4">
        <OperationModal
          open={opOpen}
          onOpenChange={setOpOpen}
          initialAccountId={opAccount}
          accounts={accounts}
          catalog={catalog}
          onDone={refresh}
        />
        <AccountHistoryModal
          account={accountView}
          base={base}
          accounts={accounts}
          catalog={catalog}
          today={today}
          reloadKey={feedKey}
          onChanged={refresh}
          onClose={() => setAccountView(null)}
        />
        {/* телефон: крупная сумма по центру и круглая кнопка действия — как баланс в Revolut */}
        <Flex
          direction="column"
          align="center"
          gap="1"
          py="2"
          display={{ initial: 'flex', sm: 'none' }}
        >
          <Text size="2" color="gray">
            Капитал · {base}
          </Text>
          <Text size="8" weight="bold" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {money(data.totalPln)}
          </Text>
          <Flex direction="column" align="center" gap="1" mt="3">
            <IconButton
              size="4"
              radius="full"
              variant="soft"
              aria-label="Новая операция"
              onClick={() => openOp()}
            >
              <PlusIcon width={22} height={22} />
            </IconButton>
            <Text size="1" color="gray">
              Операция
            </Text>
          </Flex>
        </Flex>
        <Flex
          justify="between"
          align="center"
          wrap="wrap"
          gap="3"
          display={{ initial: 'none', sm: 'flex' }}
        >
          <Flex align="center" gap="3">
            <Heading size={{ initial: '6', sm: '7' }}>Капитал</Heading>
            <Button size="2" variant="solid" onClick={() => openOp()}>
              + Операция
            </Button>
          </Flex>
          <Heading size={{ initial: '6', sm: '7' }} style={{ fontVariantNumeric: 'tabular-nums' }}>
            {money(data.totalPln)}
          </Heading>
        </Flex>
        <Grid columns={{ initial: '1', xs: '2' }} gap="3">
          <Card size="3">
            <Text size="2" color="gray">
              Доступно (в бюджете)
            </Text>
            <Text size="6" weight="bold" as="div" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {money(onBudget)}
            </Text>
          </Card>
          <Card size="3">
            <Text size="2" color="gray">
              Инвестиции (вне бюджета)
            </Text>
            <Text size="6" weight="bold" as="div" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {money(offBudget)}
            </Text>
          </Card>
        </Grid>
        <NetWorthChart series={history} />
        <Grid columns={{ initial: '1', md: '3fr 2fr' }} gap="3">
          <AccountsList data={data} onPick={setAccountView} />
          <Flex direction="column" gap="3">
            <AccountsDonut data={data} />
            <Card size="3">
              <Text size="2" color="gray">
                Курсы НБП (таблица A)
              </Text>
              <Flex direction="column" gap="1" mt="1">
                {Object.entries(data.rates).map(([cur, rate]) => (
                  <Flex key={cur} justify="between">
                    <Text size="2">{cur}/PLN</Text>
                    <Text size="2" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {rate}
                    </Text>
                  </Flex>
                ))}
              </Flex>
            </Card>
          </Flex>
        </Grid>
      </Flex>
    </Container>
  );
}
