// Стартовый набор для новой установки: категории и правила по общим сетям/сервисам (Польша).
// Потом всё правится в UI (Настройки → Категории / Правила).
import { randomUUID } from 'node:crypto';
import type { Db } from './index.ts';
import { categories, categoryGroups, rules } from './schema.ts';

/** [группа, доходная (0/1), категории] */
export const SEED_CATEGORIES: [string, boolean, string[]][] = [
  ['Доходы', true, ['Доход']],
  ['Жильё и быт', false, ['Жильё', 'Коммунальные и связь']],
  ['Еда', false, ['Продукты', 'Рестораны и доставка']],
  ['Транспорт', false, ['Транспорт']],
  ['Подписки', false, ['Подписки']],
  ['Здоровье', false, ['Здоровье']],
  ['Развлечения и покупки', false, ['Покупки', 'Развлечения', 'Красота']],
  ['Финансы', false, ['Комиссии банка', 'Налоги и взносы']],
  ['Личные переводы', false, ['Друзья', 'Семья']],
  // группа исключается из cash flow (см. настройки)
  ['Переводы и обмены', false, ['Переводы между счетами', 'Обмен валюты', 'Отменённые платежи', 'Исключено']],
];

/** категория → подстроки имени получателя от банка (без учёта регистра) */
export const SEED_RULES: Record<string, string[]> = {
  Продукты: ['zabka', 'żabka', 'biedronka', 'lidl', 'carrefour', 'auchan', 'kaufland', 'dino polska', 'netto', 'stokrotka', 'aldi', 'frisco'],
  'Рестораны и доставка': ['wolt', 'glovo', 'pyszne', 'uber eats', 'mcdonald', 'kfc', 'burger king', 'starbucks', 'costa coffee', 'pizza'],
  Транспорт: ['uber', 'bolt.eu', 'jakdojade', 'orlen', 'shell', 'circle k', 'koleo', 'pkp intercity', 'parking'],
  Подписки: ['netflix', 'spotify', 'apple.com', 'youtube', 'disney plus', 'hbo max', 'openai', 'anthropic'],
  Покупки: ['allegro', 'amazon', 'aliexpress', 'zalando', 'ikea', 'decathlon', 'media expert', 'euro-net', 'pepco', 'rossmann', 'hebe'],
  Здоровье: ['apteka', 'lux med', 'medicover', 'enel-med', 'super-pharm', 'ziko'],
  'Коммунальные и связь': ['orange', 't-mobile', 'p4 sp', 'upc', 'pge', 'tauron'],
  'Налоги и взносы': ['urząd skarbowy', 'zus skład', 'nbp zus'],
  'Комиссии банка': ['opłata za prowadzenie', 'opłata miesięczna za kartę'],
  'Обмен валюты': ['exchanged to'],
  'Переводы между счетами': ['top-up by', 'apple pay top-up'],
};

/** Пустая база (новая установка): стартовые категории и правила. */
export async function seed(db: Db) {
  if (await db.select({ id: categoryGroups.id }).from(categoryGroups).limit(1).get()) return;
  await db.transaction(async (tx) => {
    const catId: Record<string, string> = {};
    let gs = 0;
    let cs = 0;
    for (const [group, isIncome, cats] of SEED_CATEGORIES) {
      const groupId = randomUUID();
      await tx.insert(categoryGroups).values({ id: groupId, name: group, isIncome, sort: ++gs });
      for (const name of cats) {
        catId[name] = randomUUID();
        await tx.insert(categories).values({ id: catId[name], groupId, name, isIncome, sort: ++cs });
      }
    }
    for (const [category, keys] of Object.entries(SEED_RULES)) {
      await tx.insert(rules).values({
        id: randomUUID(),
        conditionsOp: keys.length > 1 ? 'or' : 'and',
        conditions: keys.map((value) => ({ field: 'imported_payee' as const, op: 'contains' as const, value })),
        categoryId: catId[category],
      });
    }
  });
}
