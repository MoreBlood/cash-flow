import {
  Badge,
  Box,
  Button,
  Card,
  Flex,
  Heading,
  IconButton,
  Select,
  Text,
  TextField,
} from '@radix-ui/themes';
import { applyRules, deleteRule, fetchRules, saveRule } from '@shared/api/client';
import type { Category, Rule, RuleCondition, RuleField } from '@shared/api/types';
import { categoryStyle } from '@shared/config/categories';
import { useCallback, useEffect, useMemo, useState } from 'react';

const FIELD: Record<RuleField, string> = {
  payee: 'получатель',
  imported_payee: 'имя из банка',
  notes: 'описание',
};
const OP = { is: '=', contains: 'содержит', oneOf: 'один из' } as const;

const condText = (c: RuleCondition) =>
  `${FIELD[c.field]} ${OP[c.op]} «${Array.isArray(c.value) ? c.value.join('», «') : c.value}»`;

function CategoryPicker({
  catalog,
  value,
  onChange,
}: {
  catalog: Category[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Select.Root size="1" value={value} onValueChange={onChange}>
      <Select.Trigger variant="soft" placeholder="категория" />
      <Select.Content>
        {catalog.map((c) => (
          <Select.Item key={c.id} value={c.id}>
            {categoryStyle(c.name).icon} {c.name}
          </Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  );
}

export function RulesCard({ catalog }: { catalog: Category[] }) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState({
    field: 'imported_payee' as RuleField,
    op: 'contains',
    value: '',
    categoryId: '',
  });
  const [info, setInfo] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      fetchRules()
        .then(setRules)
        .catch((e) => setError(String(e.message || e))),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? rules.filter((r) =>
          `${r.conditions.map(condText).join(' ')} ${r.category}`.toLowerCase().includes(q),
        )
      : rules;
    return [...list].sort((a, b) => (a.category ?? '').localeCompare(b.category ?? ''));
  }, [rules, query]);

  const run = (p: Promise<unknown>, msg?: (r: never) => string) => {
    setError(null);
    setInfo(null);
    p.then((r) => {
      if (msg) setInfo(msg(r as never));
      return load();
    }).catch((e) => setError(String(e.message || e)));
  };

  const add = () =>
    run(
      saveRule({
        conditionsOp: 'and',
        conditions: [
          { field: draft.field, op: draft.op as 'is' | 'contains', value: draft.value.trim() },
        ],
        categoryId: draft.categoryId,
      }).then(() => setDraft({ ...draft, value: '' })),
    );

  return (
    <Card size="3">
      <Flex justify="between" align="start" mb="3" gap="3" wrap="wrap">
        <Flex direction="column">
          <Heading size="4">Правила ({rules.length})</Heading>
          <Text size="2" color="gray">
            Категория для новых операций из банка. Сравнение без учёта регистра; при нескольких
            совпадениях побеждает более точное правило.
          </Text>
        </Flex>
        <Button
          variant="soft"
          onClick={() =>
            run(applyRules(), (r: { updated: number }) => `Категоризировано: ${r.updated}`)
          }
        >
          Применить к операциям без категории
        </Button>
      </Flex>

      <Flex gap="2" wrap="wrap" align="center" mb="3">
        <Select.Root
          size="1"
          value={draft.field}
          onValueChange={(v) => setDraft({ ...draft, field: v as RuleField })}
        >
          <Select.Trigger variant="soft" />
          <Select.Content>
            {Object.entries(FIELD).map(([k, v]) => (
              <Select.Item key={k} value={k}>
                {v}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
        <Select.Root size="1" value={draft.op} onValueChange={(v) => setDraft({ ...draft, op: v })}>
          <Select.Trigger variant="soft" />
          <Select.Content>
            <Select.Item value="contains">содержит</Select.Item>
            <Select.Item value="is">=</Select.Item>
          </Select.Content>
        </Select.Root>
        <TextField.Root
          size="1"
          placeholder="текст"
          value={draft.value}
          onChange={(e) => setDraft({ ...draft, value: e.target.value })}
          style={{ minWidth: 160 }}
        />
        <Text size="1" color="gray">
          →
        </Text>
        <CategoryPicker
          catalog={catalog}
          value={draft.categoryId}
          onChange={(v) => setDraft({ ...draft, categoryId: v })}
        />
        <Button size="1" disabled={!draft.value.trim() || !draft.categoryId} onClick={add}>
          Добавить
        </Button>
      </Flex>

      {(info || error) && (
        <Text size="2" color={error ? 'red' : 'grass'} as="div" mb="2">
          {error || info}
        </Text>
      )}

      <TextField.Root
        size="2"
        placeholder="Поиск по правилам"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        mb="2"
      />
      <Box style={{ maxHeight: 420, overflowY: 'auto' }}>
        <Flex direction="column" gap="1" pr="3">
          {shown.map((r) => (
            <Flex
              key={r.id}
              justify="between"
              align="center"
              gap="2"
              py="1"
              style={{ borderBottom: '1px solid var(--gray-3)' }}
            >
              <Flex direction="column" style={{ flex: 1, minWidth: 0 }}>
                <Text size="2" truncate>
                  {r.conditions.map(condText).join(r.conditionsOp === 'or' ? ' или ' : ' и ')}
                </Text>
                <Text size="1" color="gray">
                  совпадений в истории: {r.matches}
                </Text>
              </Flex>
              <Flex align="center" gap="2" flexShrink="0">
                <CategoryPicker
                  catalog={catalog}
                  value={r.categoryId}
                  onChange={(v) => run(saveRule({ ...r, categoryId: v }))}
                />
                {confirmId === r.id ? (
                  <Button
                    size="1"
                    color="red"
                    onClick={() => run(deleteRule(r.id))}
                    onBlur={() => setConfirmId(null)}
                  >
                    Удалить?
                  </Button>
                ) : (
                  <IconButton
                    size="1"
                    variant="ghost"
                    color="red"
                    title="Удалить правило"
                    onClick={() => setConfirmId(r.id)}
                  >
                    ✕
                  </IconButton>
                )}
              </Flex>
            </Flex>
          ))}
          {!shown.length && (
            <Badge color="gray" variant="soft">
              ничего не найдено
            </Badge>
          )}
        </Flex>
      </Box>
    </Card>
  );
}
