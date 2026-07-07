import { Button, Flex, Spinner, Text } from '@radix-ui/themes';
import { emitRefresh, fetchSyncStatus, triggerBankSync } from '@shared/api/client';
import { relativeTime } from '@shared/lib/format';
import { useEffect, useRef, useState } from 'react';

export function SyncButton() {
  const [lastAt, setLastAt] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetchSyncStatus()
      .then((s) => {
        setLastAt(s.lastBankSyncAt);
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
        emitRefresh();
      })
      .catch(() => setError(true))
      .finally(() => setSyncing(false));
  };

  return (
    <Flex gap="2" align="center">
      <Button size="2" variant="soft" disabled={syncing} onClick={run}>
        {syncing ? (
          <>
            <Spinner size="1" /> Синхронизация… {elapsed}s
          </>
        ) : (
          '↻ Обновить'
        )}
      </Button>
      <Text size="1" color={error ? 'red' : 'gray'} style={{ whiteSpace: 'nowrap' }}>
        {error ? 'ошибка синка' : syncing ? 'тянем банки…' : relativeTime(lastAt)}
      </Text>
    </Flex>
  );
}
