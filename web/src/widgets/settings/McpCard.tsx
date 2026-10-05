import { Button, Card, Code, Flex, Heading, Text } from '@radix-ui/themes';
import type { Setup } from '@shared/api/client';
import { useState } from 'react';

/** Как подключить сервис к Claude / ChatGPT / Claude Code (MCP). */
export function McpCard({ setup }: { setup: Setup }) {
  const [copied, setCopied] = useState(false);
  const copy = () =>
    navigator.clipboard.writeText(setup.mcpUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });

  return (
    <Card size="3">
      <Heading size="4" mb="1">
        Ассистенты (MCP)
      </Heading>
      <Text size="2" color="gray" as="div" mb="3">
        Claude, ChatGPT и другие ассистенты могут смотреть сводки, раскладывать операции по
        категориям и запускать синк — через MCP.
      </Text>
      <Flex gap="2" align="center" mb="3" wrap="wrap">
        <Code size="3" style={{ wordBreak: 'break-all' }}>
          {setup.mcpUrl}
        </Code>
        <Button size="1" variant="soft" onClick={copy}>
          {copied ? 'Скопировано ✓' : 'Копировать'}
        </Button>
      </Flex>
      {setup.auth ? (
        <Flex direction="column" gap="1">
          <Text size="2">
            <b>Claude</b> (веб, Desktop, телефон): Настройки → Коннекторы → «Добавить свой
            коннектор» → вставить адрес → «Подключить», войти через GitHub и разрешить доступ.
          </Text>
          <Text size="2">
            <b>ChatGPT</b>: Настройки → Приложения и коннекторы → Расширенные → режим разработчика →
            «Создать» → тот же адрес, аутентификация OAuth.
          </Text>
          <Text size="2">
            <b>Claude Code</b>: <Code>claude mcp add --transport http cashflow {setup.mcpUrl}</Code>
          </Text>
        </Flex>
      ) : (
        <Text size="2">
          Это локальная установка: облачные Claude и ChatGPT до неё не достанут. Подключается Claude
          Code: <Code>claude mcp add --transport http cashflow {setup.mcpUrl}</Code>
        </Text>
      )}
    </Card>
  );
}
