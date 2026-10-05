import {
  Badge,
  Button,
  Callout,
  Card,
  Code,
  Flex,
  Heading,
  Link,
  Text,
  TextField,
} from '@radix-ui/themes';
import { deleteEb, type EbStatus, fetchEbStatus, saveEb } from '@shared/api/client';
import { useEffect, useState } from 'react';

/** Ключ приложения Enable Banking: проверка, ввод через UI, подсказка про redirect URL. */
export function EbSetupCard({ onChanged }: { onChanged?: () => void }) {
  const [status, setStatus] = useState<EbStatus | null>(null);
  const [editing, setEditing] = useState(false);
  const [appId, setAppId] = useState('');
  const [key, setKey] = useState('');
  const [keyName, setKeyName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchEbStatus()
      .then(setStatus)
      .catch((e) => setError(String(e.message || e)));
  }, []);

  const pickKey = (file?: File) => {
    if (!file) return;
    setKeyName(file.name);
    // имя файла ключа в панели EB — это Application ID
    const id = file.name.match(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    )?.[0];
    if (id && !appId) setAppId(id);
    file.text().then(setKey);
  };

  const save = () => {
    setBusy(true);
    setError(null);
    saveEb(appId, key)
      .then((s) => {
        setStatus(s);
        setEditing(false);
        setKey('');
        onChanged?.();
      })
      .catch((e) => setError(String(e.message || e).replace(/^\d+ /, '')))
      .finally(() => setBusy(false));
  };

  const remove = () =>
    deleteEb()
      .then((s) => {
        setStatus(s);
        onChanged?.();
      })
      .catch((e) => setError(String(e.message || e)));

  if (!status) return null;
  const ready = status.configured && !status.error && status.redirectRegistered !== false;
  if (ready && !editing)
    return (
      <Flex gap="2" align="center" wrap="wrap">
        <Badge color="grass" variant="soft">
          Enable Banking ✓
        </Badge>
        <Text size="1" color="gray">
          {status.app?.name ?? 'приложение'} · {status.app?.environment ?? ''}
          {status.source === 'env' ? ' · ключ из переменных окружения' : ''}
        </Text>
        {status.source === 'ui' && (
          <Button size="1" variant="ghost" color="gray" onClick={() => setEditing(true)}>
            сменить ключ
          </Button>
        )}
      </Flex>
    );

  return (
    <Card size="3">
      <Heading size="4" mb="2">
        Подключение к Enable Banking
      </Heading>
      <Flex direction="column" gap="3">
        {status.configured && status.error && (
          <Callout.Root color="red" size="1">
            <Callout.Text>Ключ не работает: {status.error}</Callout.Text>
          </Callout.Root>
        )}
        {status.configured && status.redirectRegistered === false && (
          <Callout.Root color="amber" size="1">
            <Callout.Text>
              В приложении «{status.app?.name}» не зарегистрирован redirect URL этой установки —
              добавьте его в панели Enable Banking, иначе банк не сможет вернуть вас сюда.
            </Callout.Text>
          </Callout.Root>
        )}
        <Text size="2">
          1. В{' '}
          <Link href="https://enablebanking.com/cp/applications" target="_blank">
            панели Enable Banking
          </Link>{' '}
          создайте приложение (Production) — или откройте существующее — и добавьте redirect URL:
        </Text>
        <Code size="2" style={{ wordBreak: 'break-all' }}>
          {status.redirectUrl}
        </Code>
        <Text size="2" color="gray">
          Ключ генерируется в браузере — скачается <Code>&lt;application-id&gt;.pem</Code>.
          Активируйте приложение, привязав свои счета (бесплатный restricted-режим: доступ только к
          вашим счетам).
        </Text>
        {status.source !== 'env' && (status.configured === false || editing || status.error) && (
          <>
            <Text size="2">2. Загрузите ключ — Application ID подставится из имени файла:</Text>
            <Flex gap="2" align="center" wrap="wrap">
              <Button asChild variant="soft">
                <label style={{ cursor: 'pointer' }}>
                  {keyName || 'Выбрать .pem'}
                  <input
                    type="file"
                    accept=".pem"
                    hidden
                    onChange={(e) => pickKey(e.target.files?.[0])}
                  />
                </label>
              </Button>
              <TextField.Root
                placeholder="Application ID"
                value={appId}
                onChange={(e) => setAppId(e.target.value)}
                style={{ minWidth: 320 }}
              />
            </Flex>
            {error && (
              <Text size="2" color="red">
                {error}
              </Text>
            )}
            <Flex gap="2">
              <Button disabled={busy || !appId || !key} onClick={save}>
                {busy ? 'Проверяю…' : 'Сохранить и проверить'}
              </Button>
              {status.source === 'ui' && (
                <Button variant="soft" color="red" onClick={remove}>
                  Удалить ключ
                </Button>
              )}
            </Flex>
            <Text size="1" color="gray">
              Ключ хранится в базе этой установки в зашифрованном виде.
            </Text>
          </>
        )}
      </Flex>
    </Card>
  );
}
