import { NewCategoryDialog } from '@features/categorize/NewCategoryDialog';
import {
  Badge,
  Button,
  Card,
  Dialog,
  DropdownMenu,
  Flex,
  Heading,
  IconButton,
  Select,
  Text,
  TextField,
} from '@radix-ui/themes';
import { deleteCategory, renameCategory } from '@shared/api/client';
import type { Category } from '@shared/api/types';
import { categoryStyle } from '@shared/config/categories';
import { useMemo, useState } from 'react';

const NONE = '__none__';

interface Props {
  catalog: Category[];
  onChanged: () => void;
}

export function CategoriesCard({ catalog, onChanged }: Props) {
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<Category | null>(null);
  const [removing, setRemoving] = useState<Category | null>(null);
  const [name, setName] = useState('');
  const [target, setTarget] = useState(NONE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const groups = useMemo(() => {
    const m = new Map<string, Category[]>();
    for (const c of catalog) m.set(c.group, [...(m.get(c.group) ?? []), c]);
    return [...m.entries()];
  }, [catalog]);

  const act = (p: Promise<unknown>) => {
    setBusy(true);
    setError(null);
    p.then(() => {
      setRenaming(null);
      setRemoving(null);
      onChanged();
    })
      .catch((e) => setError(String(e.message || e)))
      .finally(() => setBusy(false));
  };

  return (
    <Card size="3">
      <Flex justify="between" align="center" mb="3" gap="3">
        <Flex direction="column">
          <Heading size="4">Категории</Heading>
          <Text size="2" color="gray">
            Удаление переносит операции и правила в другую категорию — так же сливаются дубли.
          </Text>
        </Flex>
        <Button variant="soft" onClick={() => setCreating(true)}>
          + Категория
        </Button>
      </Flex>
      <Flex direction="column" gap="3">
        {groups.map(([group, cats]) => (
          <Flex key={group} direction="column" gap="1">
            <Text size="1" color="gray" weight="medium">
              {group}
            </Text>
            {cats.map((c) => (
              <Flex key={c.id} justify="between" align="center" gap="2">
                <Text size="2">
                  {categoryStyle(c.name).icon} {c.name}
                </Text>
                <Flex align="center" gap="2">
                  <Badge variant="soft" color="gray">
                    {c.count}
                  </Badge>
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger>
                      <IconButton size="1" variant="ghost" color="gray">
                        ⋯
                      </IconButton>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Content>
                      <DropdownMenu.Item
                        onSelect={() => {
                          setName(c.name);
                          setError(null);
                          setRenaming(c);
                        }}
                      >
                        Переименовать
                      </DropdownMenu.Item>
                      <DropdownMenu.Item
                        color="red"
                        onSelect={() => {
                          setTarget(NONE);
                          setError(null);
                          setRemoving(c);
                        }}
                      >
                        Удалить…
                      </DropdownMenu.Item>
                    </DropdownMenu.Content>
                  </DropdownMenu.Root>
                </Flex>
              </Flex>
            ))}
          </Flex>
        ))}
      </Flex>

      <NewCategoryDialog
        open={creating}
        catalog={catalog}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          onChanged();
        }}
      />

      <Dialog.Root open={!!renaming} onOpenChange={(o) => !o && setRenaming(null)}>
        <Dialog.Content maxWidth="380px">
          <Dialog.Title>Переименовать</Dialog.Title>
          <Flex direction="column" gap="3">
            <TextField.Root autoFocus value={name} onChange={(e) => setName(e.target.value)} />
            {error && (
              <Text size="1" color="red">
                {error}
              </Text>
            )}
            <Flex gap="3" justify="end">
              <Dialog.Close>
                <Button variant="soft" color="gray">
                  Отмена
                </Button>
              </Dialog.Close>
              <Button
                disabled={busy || !name.trim()}
                onClick={() => renaming && act(renameCategory(renaming.id, name))}
              >
                Сохранить
              </Button>
            </Flex>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>

      <Dialog.Root open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <Dialog.Content maxWidth="420px">
          <Dialog.Title>Удалить «{removing?.name}»</Dialog.Title>
          <Flex direction="column" gap="3">
            <Text size="2" color="gray">
              Операций: {removing?.count ?? 0}. Куда их перенести вместе с правилами?
            </Text>
            <Select.Root value={target} onValueChange={setTarget}>
              <Select.Trigger />
              <Select.Content>
                <Select.Item value={NONE}>
                  — оставить без категории (правила удалятся) —
                </Select.Item>
                {groups.map(([group, cats]) => (
                  <Select.Group key={group}>
                    <Select.Label>{group}</Select.Label>
                    {cats
                      .filter((c) => c.id !== removing?.id)
                      .map((c) => (
                        <Select.Item key={c.id} value={c.id}>
                          {categoryStyle(c.name).icon} {c.name}
                        </Select.Item>
                      ))}
                  </Select.Group>
                ))}
              </Select.Content>
            </Select.Root>
            {error && (
              <Text size="1" color="red">
                {error}
              </Text>
            )}
            <Flex gap="3" justify="end">
              <Dialog.Close>
                <Button variant="soft" color="gray">
                  Отмена
                </Button>
              </Dialog.Close>
              <Button
                color="red"
                disabled={busy}
                onClick={() =>
                  removing && act(deleteCategory(removing.id, target === NONE ? null : target))
                }
              >
                Удалить
              </Button>
            </Flex>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
    </Card>
  );
}
