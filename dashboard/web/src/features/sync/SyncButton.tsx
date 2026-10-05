import { Button, Flex, Link, Spinner, Text, Tooltip } from '@radix-ui/themes';
import { emitRefresh, fetchSyncStatus, triggerBankSync } from '@shared/api/client';
import { relativeTime } from '@shared/lib/format';
import { useEffect, useRef, useState } from 'react';

/** Actual по https — нужен для переподключения банков (redirect Enable Banking) */
const ACTUAL_RELINK_URL = 'https://localhost:5443';

export function SyncButton() {
  const [lastAt, setLastAt] = useState<string | null>(null);
  const [failed, setFailed] = useState<string[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetchSyncStatus()
      .then((s) => {
        setLastAt(s.lastBankSyncAt);
        setFailed(s.failedAccounts ?? []);
        setSyncing(s.syncing);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (syncing) {
      timer.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    } else if (timer.current) {
      clearInterval(timer.current);
    }
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [syncing]);

  const run = () => {
    setSyncing(true);
    setElapsed(0);
    setError(false);
    triggerBankSync()
      .then((s) => {
        setLastAt(s.lastBankSyncAt);
        setFailed(s.failedAccounts ?? []);
        emitRefresh();
      })
      .catch(() => setError(true))
      .finally(() => setSyncing(false));
  };

  const status = () => {
    if (syncing)
      return (
        <Text size="1" color="gray">
          тянем банки…
        </Text>
      );
    if (error)
      return (
        <Text size="1" color="red">
          ошибка синка
        </Text>
      );
    if (failed.length)
      return (
        <Tooltip
          content={`Не синкаются: ${failed.join(', ')}. Чаще всего это истёкшее согласие банка (PSD2, ~90 дней) — переподключи счета в Actual.`}
        >
          <Link size="1" color="amber" href={ACTUAL_RELINK_URL} target="_blank" rel="noreferrer">
            ⚠ не синкаются: {failed.length}
          </Link>
        </Tooltip>
      );
    return (
      <Text size="1" color="gray">
        {relativeTime(lastAt)}
      </Text>
    );
  };

  return (
    <Flex gap="2" align="center" style={{ whiteSpace: 'nowrap' }}>
      <Button size="2" variant="soft" disabled={syncing} onClick={run}>
        {syncing ? (
          <>
            <Spinner size="1" /> Синхронизация… {elapsed}s
          </>
        ) : (
          '↻ Обновить'
        )}
      </Button>
      {status()}
    </Flex>
  );
}
