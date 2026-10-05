import { useBaseCurrency } from '@app/currency';
import {
  monthPeriod,
  monthsBetween,
  type Period,
  PeriodPicker,
  periodFromParams,
  periodToParams,
  prevPeriod,
} from '@features/period/PeriodPicker';
import { Box, Container, Flex, Grid, Spinner, Text } from '@radix-ui/themes';
import { fetchCategories, fetchMeta, fetchSummary, REFRESH_EVENT } from '@shared/api/client';
import type { Category, Meta, Summary } from '@shared/api/types';
import { AccountsTable } from '@widgets/accounts/AccountsTable';
import { CategoryList } from '@widgets/categories/CategoryList';
import { CashflowChart } from '@widgets/chart/CashflowChart';
import { DonutChart } from '@widgets/chart/DonutChart';
import { TransactionFeed } from '@widgets/feed/TransactionFeed';
import { KpiCards } from '@widgets/kpi/KpiCards';
import { TopMerchants } from '@widgets/merchants/TopMerchants';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

export function DashboardPage() {
  const { base } = useBaseCurrency();
  const [searchParams, setSearchParams] = useSearchParams();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [period, setPeriod] = useState<Period | null>(null);
  const [data, setData] = useState<Summary | null>(null);
  const [prev, setPrev] = useState<Summary | null>(null);
  const [catalog, setCatalog] = useState<Category[]>([]);
  const [feedKey, setFeedKey] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: читаем query один раз при монтировании
  useEffect(() => {
    fetchMeta()
      .then((m) => {
        setMeta(m);
        const range = { from: m.firstDate, to: m.lastDate };
        setPeriod(periodFromParams(searchParams, range) ?? monthPeriod(m.lastDate.slice(0, 7)));
      })
      .catch((e) => setError(String(e)));
    fetchCategories()
      .then(setCatalog)
      .catch(() => setCatalog([]));
  }, []);

  const changePeriod = (p: Period) => {
    setPeriod(p);
    setSearchParams(
      (prev) => {
        const np = new URLSearchParams(prev);
        for (const k of ['period', 'from', 'to']) np.delete(k);
        for (const [k, v] of periodToParams(p)) np.set(k, v);
        return np;
      },
      { replace: true },
    );
  };

  const load = useCallback(
    (p: Period) => {
      fetchSummary(p.from, p.to, base)
        .then(setData)
        .catch((e) => setError(String(e)));
      const pp = prevPeriod(p);
      fetchSummary(pp.from, pp.to, base)
        .then(setPrev)
        .catch(() => setPrev(null));
    },
    [base],
  );

  useEffect(() => {
    if (!period || period.from > period.to) return;
    // смена периода — сброс до спиннера; точечный refresh делаем без сброса
    setData(null);
    setPrev(null);
    load(period);
  }, [period, load]);

  const refresh = () => {
    if (period) load(period);
    setFeedKey((k) => k + 1);
  };

  // обновление после банковского синка (кнопка в навбаре)
  useEffect(() => {
    const h = () => {
      if (period) load(period);
      setFeedKey((k) => k + 1);
    };
    window.addEventListener(REFRESH_EVENT, h);
    return () => window.removeEventListener(REFRESH_EVENT, h);
  }, [period, load]);

  const months = useMemo(() => (meta ? monthsBetween(meta.firstDate, meta.lastDate) : []), [meta]);

  if (error)
    return (
      <Container size="2" py="9">
        <Text color="red">Ошибка: {error}</Text>
      </Container>
    );

  return (
    <Container size="4" px={{ initial: '3', sm: '4' }} py="5">
      <Flex direction="column" gap="4">
        {meta && period && (
          <Flex justify="end" wrap="wrap" gap="3">
            <PeriodPicker
              months={months}
              allRange={{ from: meta.firstDate, to: meta.lastDate }}
              value={period}
              onChange={changePeriod}
            />
          </Flex>
        )}
        {!data ? (
          <Flex justify="center" py="9">
            <Spinner size="3" />
          </Flex>
        ) : (
          <>
            <KpiCards data={data} prev={prev} />
            <CashflowChart
              daily={data.daily}
              base={base}
              catalog={catalog}
              reloadKey={feedKey}
              onChanged={refresh}
            />
            <Grid columns={{ initial: '1', md: '3fr 2fr' }} gap="3">
              <CategoryList
                categories={data.categories}
                catalog={catalog}
                period={{ from: data.from, to: data.to }}
                onChanged={refresh}
              />
              <Flex direction="column" gap="3">
                <DonutChart categories={data.categories} />
                <TopMerchants categories={data.categories} />
                <AccountsTable
                  accounts={data.accounts}
                  uncategorized={data.uncategorized}
                  catalog={catalog}
                  onChanged={refresh}
                />
              </Flex>
            </Grid>
            <TransactionFeed
              from={data.from}
              to={data.to}
              base={base}
              catalog={catalog}
              reloadKey={feedKey}
              onChanged={refresh}
            />
            <Box>
              <Text size="1" color="gray">
                Переводы между счетами, обмены валют и отменённые платежи исключены (
                {data.excludedCount} шт.). Валютные счета сконвертированы по курсу НБП на дату
                транзакции.
              </Text>
            </Box>
          </>
        )}
      </Flex>
    </Container>
  );
}
