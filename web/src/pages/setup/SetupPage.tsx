import { Button, Card, Code, Container, Flex, Heading, Link, Text } from '@radix-ui/themes';
import type { Setup } from '@shared/api/client';
import { useState } from 'react';

function Copy({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <Flex gap="2" align="center" wrap="wrap">
      <Code size="2" style={{ wordBreak: 'break-all' }}>
        {value}
      </Code>
      <Button
        size="1"
        variant="soft"
        onClick={() =>
          navigator.clipboard.writeText(value).then(() => {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          })
        }
      >
        {done ? '✓' : 'Копировать'}
      </Button>
    </Flex>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <Card size="3">
      <Heading size="4" mb="2">
        {n}. {title}
      </Heading>
      <Flex direction="column" gap="2">
        {children}
      </Flex>
    </Card>
  );
}

/** Первый запуск облачной установки: что создать и какие переменные задать в Vercel. */
export function SetupPage({ setup }: { setup: Setup }) {
  return (
    <Container size="2" px={{ initial: '3', sm: '4' }} py="6">
      <Flex direction="column" gap="4">
        <Heading size="7">💸 Настройка установки</Heading>
        <Text color="gray">
          Сервис развёрнут, база создана. Осталось подключить вход и банк — до этого данные закрыты.
        </Text>

        <Step n={1} title="Вход через GitHub">
          <Text size="2">
            Создайте{' '}
            <Link href="https://github.com/settings/applications/new" target="_blank">
              OAuth App на GitHub
            </Link>{' '}
            с адресами:
          </Text>
          <Text size="2">Homepage URL</Text>
          <Copy value={setup.baseUrl} />
          <Text size="2">Authorization callback URL</Text>
          <Copy value={setup.githubCallbackUrl} />
          <Text size="2">Скопируйте Client ID и сгенерируйте Client secret.</Text>
        </Step>

        <Step n={2} title="Банк через Enable Banking">
          <Text size="2">
            В{' '}
            <Link href="https://enablebanking.com/cp/applications" target="_blank">
              панели Enable Banking
            </Link>{' '}
            создайте приложение (Production) с redirect URL:
          </Text>
          <Copy value={setup.redirectUrl} />
          <Text size="2">
            Ключ сгенерируйте в браузере — скачается файл <Code>.pem</Code>. Активируйте приложение,
            привязав свои счета (бесплатный restricted-режим: доступ только к вашим счетам).
          </Text>
        </Step>

        <Step n={3} title="Переменные в Vercel">
          <Text size="2">Project → Settings → Environment Variables:</Text>
          <Text size="2">
            <Code>GITHUB_CLIENT_ID</Code>, <Code>GITHUB_CLIENT_SECRET</Code> — из шага 1
            <br />
            <Code>ALLOWED_GITHUB_USERS</Code> — ваш логин GitHub (кому разрешён вход)
            <br />
            <Code>EB_APP_ID</Code> — Application ID из шага 2
            <br />
            <Code>EB_PRIVATE_KEY</Code> — содержимое .pem целиком
          </Text>
          <Text size="2">Затем Deployments → ⋯ → Redeploy.</Text>
        </Step>

        <Step n={4} title="Дальше">
          <Text size="2">
            Войдите через GitHub → «Банки» → «Подключить банк». В «Настройках» — адрес для
            подключения Claude или ChatGPT.
          </Text>
          <Text size="2" color="gray">
            Сейчас: вход {setup.authConfigured ? 'настроен ✓' : 'не настроен'}, Enable Banking{' '}
            {setup.eb ? 'настроен ✓' : 'не настроен'}.
          </Text>
        </Step>
      </Flex>
    </Container>
  );
}
