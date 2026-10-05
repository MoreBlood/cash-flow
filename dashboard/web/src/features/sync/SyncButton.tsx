import { Button, Flex, Link, Spinner, Text, Tooltip } from '@radix-ui/themes';
import { emitRefresh, fetchSyncStatus, type SyncStatus, triggerBankSync } from '@shared/api/client';
import { relativeTime } from '@shared/lib/format';
import { useEffect, useRef, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';

export function SyncButton() {
  const [lastAt, setLastAt] = useState<string | null>(null);
  const [failed, setFailed] = useState<string[]>([]);
  const [expiring, setExpiring] = useState<NonNullable<SyncStatus['expiring']>>([]);
  const [syncing, setSyncing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetchSyncStatus()
      .then((s) => {
        setLastAt(s.lastBankSyncAt);
        setFailed(s.failedAccounts ?? []);
        setExpiring(s.expiring ?? []);
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
          content={`Не синкаются: ${failed.join(', ')}. Чаще всего это истёкшее согласие банка — переподключи на странице «Банки».`}
        >
          <Link size="1" color="amber" asChild>
            <RouterLink to="/banks">⚠ не синкаются: {failed.length}</RouterLink>
          </Link>
        </Tooltip>
      );
    if (expiring.length) {
      const days = Math.min(
        ...expiring.map((e) =>
          Math.floor((new Date(e.consentUntil).getTime() - Date.now()) / 864e5),
        ),
      );
      return (
        <Tooltip
          content={`Согласие кончается: ${expiring.map((e) => `${e.bank} — ${new Date(e.consentUntil).toLocaleDateString('ru')}`).join(', ')}`}
        >
          <Link size="1" color="amber" asChild>
            <RouterLink to="/banks">⚠ согласие: {Math.max(days, 0)} дн.</RouterLink>
          </Link>
        </Tooltip>
      );
    }
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
