import { Button, Dialog, Flex, Select, Text, TextField } from '@radix-ui/themes';
import { createCategory } from '@shared/api/client';
import type { Category } from '@shared/api/types';
import { useEffect, useMemo, useState } from 'react';

const NEW_GROUP = '__new_group__';

interface Props {
  open: boolean;
  catalog: Category[];
  onCreated: (c: Category) => void;
  onClose: () => void;
}

export function NewCategoryDialog({ open, catalog, onCreated, onClose }: Props) {
  const groups = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of catalog) m.set(c.groupId, c.group);
    return [...m.entries()];
  }, [catalog]);
  const [name, setName] = useState('');
  const [groupId, setGroupId] = useState('');
  const [groupName, setGroupName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName('');
      setGroupId(groups[0]?.[0] ?? NEW_GROUP);
      setGroupName('');
      setError(null);
    }
  }, [open, groups]);

  const isNewGroup = groupId === NEW_GROUP;
  const valid = name.trim() && (!isNewGroup || groupName.trim());

  const submit = () => {
    setBusy(true);
    setError(null);
    createCategory(isNewGroup ? { name, groupName } : { name, groupId })
      .then(onCreated)
      .catch((e) => setError(String(e.message || e)))
      .finally(() => setBusy(false));
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Content maxWidth="400px">
        <Dialog.Title>Новая категория</Dialog.Title>
        <Flex direction="column" gap="3">
          <TextField.Root
            autoFocus
            placeholder="Название"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && valid && submit()}
          />
          <Select.Root value={groupId} onValueChange={setGroupId}>
            <Select.Trigger />
            <Select.Content>
              {groups.map(([id, g]) => (
                <Select.Item key={id} value={id}>
                  {g}
                </Select.Item>
              ))}
              <Select.Separator />
              <Select.Item value={NEW_GROUP}>+ новая группа…</Select.Item>
            </Select.Content>
          </Select.Root>
          {isNewGroup && (
            <TextField.Root
              placeholder="Название группы"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
            />
          )}
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
            <Button disabled={!valid || busy} onClick={submit}>
              Создать
            </Button>
          </Flex>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
