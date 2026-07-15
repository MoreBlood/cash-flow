import { Badge, Box, Card, Flex, Switch, Text } from '@radix-ui/themes';
import { fetchTransactions } from '@shared/api/client';
import type { Category, FeedTx } from '@shared/api/types';
import { categoryStyle } from '@shared/config/categories';
import { moneyExact } from '@shared/lib/format';
import { useEffect, useMemo, useState } from 'react';
import { TransactionModal } from './TransactionModal';

const dayLabel = (d: string) =>
  new Date(d).toLocaleDateString('ru', { day: 'numeric', month: 'long', weekday: 'short' });

/** служебная операция — не участвует в расчётах (перевод, обмен, исключённое, стартовый остаток) */
const isServiceTx = (t: FeedTx) => t.excluded || t.startingBalance;

const nativeFmt = (v: number, cur: string) =>
  new Intl.NumberFormat('pl-PL', {
    style: 'currency',
    currency: cur,
    minimumFractionDigits: 2,
  }).format(v);

interface Props {
  from: string;
  to: string;
  base: string;
  catalog: Category[];
  reloadKey: number;
  onChanged: () => void;
  title?: string;
  account?: string;
  limit?: number;
  /** показывать суммы в валюте счёта (для истории одного счёта) */
  nativeAmounts?: boolean;
}

export function TransactionFeed({
  from,
  to,
  base,
  catalog,
  reloadKey,
  onChanged,
  title = 'Все операции',
  account,
  limit,
  nativeAmounts = false,
}: Props) {
  const [txs, setTxs] = useState<FeedTx[]>([]);
  const [active, setActive] = useState<FeedTx | null>(null);
  const [hideService, setHideService] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadKey форсирует рефетч после правок
  useEffect(() => {
    fetchTransactions(from, to, base, { account, limit })
      .then((r) => setTxs(r.transactions))
      .catch(() => setTxs([]));
  }, [from, to, base, account, limit, reloadKey]);

  const visible = useMemo(
    () => (hideService ? txs.filter((t) => !isServiceTx(t)) : txs),
    [txs, hideService],
  );
  const groups = useMemo(() => {
    const m = new Map<string, FeedTx[]>();
    for (const t of visible) {
      if (!m.has(t.date)) m.set(t.date, []);
      m.get(t.date)?.push(t);
    }
    return [...m.entries()];
  }, [visible]);

  return (
    <Card size="3">
      <Flex justify="between" align="center" mb="2" gap="2" wrap="wrap">
        <Text size="4" weight="bold">
          {title}
        </Text>
        <Flex align="center" gap="2">
          <Text size="1" color="gray">
            скрыть служебные
          </Text>
          <Switch size="1" checked={hideService} onCheckedChange={setHideService} />
          <Badge color="gray" variant="soft">
            {hideService ? `${visible.length} / ${txs.length}` : txs.length}
          </Badge>
        </Flex>
      </Flex>
      {groups.map(([date, list]) => (
        <Box key={date} mb="2">
          <Text size="1" color="gray" style={{ textTransform: 'capitalize' }}>
            {dayLabel(date)}
          </Text>
          {list.map((t) => {
            const positive = t.amount >= 0;
            // стартовые остатки и переводы — не денежный поток: гасим и не красим в зелёный
            const muted = isServiceTx(t);
            const icon = t.category ? categoryStyle(t.category).icon : positive ? '💰' : '💳';
            return (
              <Flex
                key={t.id}
                gap="3"
                align="center"
                py="2"
                style={{ cursor: 'pointer' }}
                onClick={() => setActive(t)}
              >
                <Flex
                  align="center"
                  justify="center"
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    background: 'var(--gray-4)',
                    fontSize: 18,
                    flexShrink: 0,
                    opacity: muted ? 0.5 : 1,
                  }}
                >
                  {icon}
                </Flex>
                <Box flexGrow="1" minWidth="0">
                  <Text size="2" weight="medium" truncate as="div">
                    {t.payee}
                  </Text>
                  <Text size="1" color="gray" truncate as="div">
                    {t.category ?? 'без категории'}
                    {t.startingBalance ? ' · нач. остаток' : t.excluded ? ' · искл.' : ''}
                  </Text>
                </Box>
                <Text
                  size="2"
                  weight="medium"
                  style={{
                    fontVariantNumeric: 'tabular-nums',
                    flexShrink: 0,
                    color: positive && !muted ? 'var(--grass-11)' : undefined,
                    opacity: muted ? 0.5 : 1,
                  }}
                >
                  {positive ? '+' : ''}
                  {nativeAmounts ? nativeFmt(t.native, t.currency) : moneyExact(t.amount)}
                </Text>
              </Flex>
            );
          })}
        </Box>
      ))}
      <TransactionModal
        tx={active}
        catalog={catalog}
        period={{ from, to }}
        onChanged={onChanged}
        onClose={() => setActive(null)}
      />
    </Card>
  );
}
