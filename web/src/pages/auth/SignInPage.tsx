import { Button, Callout, Card, Flex, Heading, Text } from '@radix-ui/themes';
import { authClient } from '@shared/auth/client';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';

/** Вход через GitHub. Сюда же Better Auth приводит при подключении MCP-коннектора (Claude, ChatGPT). */
export function SignInPage() {
  const [params] = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(params.get('error'));
  const mcpFlow = params.has('client_id');

  const signIn = () => {
    setBusy(true);
    authClient.signIn
      .social({ provider: 'github', callbackURL: params.get('callbackURL') || '/' })
      .then((r) => r.error && setError(r.error.message ?? 'Не удалось войти'))
      .finally(() => setBusy(false));
  };

  return (
    <Flex justify="center" align="center" px="4" style={{ minHeight: '80vh' }}>
      <Card size="4" style={{ maxWidth: 420, width: '100%' }}>
        <Flex direction="column" gap="4">
          <Heading size="6">💸 Финансы</Heading>
          <Text color="gray" size="2">
            {mcpFlow
              ? 'Войдите, чтобы разрешить ассистенту доступ к вашим финансам.'
              : 'Войдите через GitHub — пускает только владельца этой установки.'}
          </Text>
          {error && (
            <Callout.Root color="red" size="1">
              <Callout.Text>{error}</Callout.Text>
            </Callout.Root>
          )}
          <Button size="3" disabled={busy} onClick={signIn}>
            Войти через GitHub
          </Button>
        </Flex>
      </Card>
    </Flex>
  );
}
