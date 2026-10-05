import { CategorySelect } from '@features/categorize/CategorySelect';
import { Badge, Button, Card, Flex, Table, Text } from '@radix-ui/themes';
import type { AccountSummary, Category, UncategorizedTx } from '@shared/api/types';
import { moneyExact, shortDate, signed } from '@shared/lib/format';
import { useState } from 'react';

function claudePrompt(txs: UncategorizedTx[]): string {
  const list = txs
    .map((t) => `- ${t.date} | ${t.amount.toFixed(2)} PLN | ${t.account} | ${t.payee}`)
    .join('\n');
  return `Докатегоризируй некатегоризированные транзакции в Actual (используй существующие категории, переводы между своими счетами → «Переводы между счетами»):\n${list}`;
}

function CopyPromptButton({ txs }: { txs: UncategorizedTx[] }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="1"
      variant="soft"
      onClick={() => {
        navigator.clipboard.writeText(claudePrompt(txs)).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? '✓ Скопировано' : 'Промпт для Claude'}
    </Button>
  );
}

export function AccountsTable({
  accounts,
  uncategorized,
  catalog,
  onChanged,
}: {
  accounts: AccountSummary[];
  uncategorized: UncategorizedTx[];
  catalog: Category[];
  onChanged: () => void;
}) {
  return (
    <Flex direction="column" gap="3">
      <Card size="3">
        <Text size="4" weight="bold">
          По счетам
        </Text>
        <Table.Root size="1" mt="2">
          <Table.Body>
            {accounts.map((a) => (
              <Table.Row key={a.name}>
                <Table.Cell>
                  <Flex gap="2" align="center">
                    <Text>{a.name}</Text>
                    {a.currency !== 'PLN' && (
                      <Badge variant="soft" color="iris">
                        {a.currency}
                      </Badge>
                    )}
                  </Flex>
                </Table.Cell>
                <Table.Cell align="right">
                  <Text
                    style={{
                      fontVariantNumeric: 'tabular-nums',
                      color: a.net >= 0 ? 'var(--grass-11)' : undefined,
                    }}
                  >
                    {signed(a.net)}
                  </Text>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </Card>
      {uncategorized.length > 0 && (
        <Card size="3">
          <Flex justify="between" align="center">
            <Text size="4" weight="bold">
              Без категории
            </Text>
            <Flex gap="2" align="center">
              <Badge color="orange" variant="soft">
                {uncategorized.length}
              </Badge>
              <CopyPromptButton txs={uncategorized} />
            </Flex>
          </Flex>
          {uncategorized.map((t) => (
            <Flex key={t.id} justify="between" align="center" gap="2" py="1" mt="1">
              <Text size="2" color="gray" truncate style={{ flexGrow: 1 }}>
                {shortDate(t.date)} · {t.payee}
              </Text>
              <Text size="2" style={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                {moneyExact(t.amount)}
              </Text>
              <CategorySelect catalog={catalog} txId={t.id} payee={t.payee} onDone={onChanged} />
            </Flex>
          ))}
        </Card>
      )}
    </Flex>
  );
}
