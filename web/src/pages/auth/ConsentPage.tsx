import { Avatar, Button, Callout, Card, Flex, Heading, Text } from '@radix-ui/themes';
import { authClient } from '@shared/auth/client';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

type PublicClient = { client_name?: string; logo_uri?: string; client_uri?: string };

/** Согласие на доступ MCP-коннектора (claude.ai, ChatGPT…) — шаг OAuth, которым управляет Better Auth. */
export function ConsentPage() {
  const [params] = useSearchParams();
  const clientId = params.get('client_id') ?? '';
  const [client, setClient] = useState<PublicClient | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (clientId)
      authClient.oauth2
        .publicClient({ query: { client_id: clientId } })
        .then((r) => setClient((r.data as PublicClient) ?? {}))
        .catch(() => setClient({}));
  }, [clientId]);

  const decide = (accept: boolean) => {
    setBusy(true);
    authClient.oauth2
      .consent({ accept })
      .then((r) => {
        const uri = (r.data as { redirect_uri?: string } | null)?.redirect_uri;
        if (uri) window.location.href = uri;
        else setError(r.error?.message ?? 'Не удалось завершить подключение');
      })
      .finally(() => setBusy(false));
  };

  const name = client?.client_name || 'Приложение';
  return (
    <Flex justify="center" align="center" px="4" style={{ minHeight: '80vh' }}>
      <Card size="4" style={{ maxWidth: 460, width: '100%' }}>
        <Flex direction="column" gap="4">
          <Flex align="center" gap="3">
            <Avatar size="4" src={client?.logo_uri} fallback={name[0]} />
            <Heading size="5">Подключить «{name}»?</Heading>
          </Flex>
          <Text color="gray" size="2">
            Ассистент получит доступ к вашим финансам: операции, балансы, категории и правила —
            чтение и изменение (категоризация, ручные операции, запуск синка). Отозвать доступ
            можно, отключив коннектор.
          </Text>
          {error && (
            <Callout.Root color="red" size="1">
              <Callout.Text>{error}</Callout.Text>
            </Callout.Root>
          )}
          <Flex gap="3" justify="end">
            <Button variant="soft" color="gray" disabled={busy} onClick={() => decide(false)}>
              Отклонить
            </Button>
            <Button disabled={busy} onClick={() => decide(true)}>
              Разрешить
            </Button>
          </Flex>
        </Flex>
      </Card>
    </Flex>
  );
}
