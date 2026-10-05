import { Button, Card, Flex, Heading, Text } from '@radix-ui/themes';
import { Link } from 'react-router-dom';

/** Пустая установка: с чего начать. */
export function WelcomeCard() {
  return (
    <Card size="4">
      <Flex direction="column" gap="3">
        <Heading size="6">Данных пока нет</Heading>
        <Text color="gray">
          Подключите банк — операции за последние 90 дней подтянутся сами и дальше будут обновляться
          каждый день. Если данные уже есть в другой установке (например, локальной), перенесите их
          одним файлом.
        </Text>
        <Flex gap="3" wrap="wrap">
          <Button asChild size="3">
            <Link to="/banks">Подключить банк</Link>
          </Button>
          <Button asChild size="3" variant="soft">
            <Link to="/settings#transfer">Перенести данные</Link>
          </Button>
        </Flex>
      </Flex>
    </Card>
  );
}
