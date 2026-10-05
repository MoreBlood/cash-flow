// MCP-сервер: те же операции, что в дашборде, — для Claude, ChatGPT и других агентов.
import { createMcpHandler, McpServer, type StandardSchemaWithJSON } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { BASES, today } from './lib/fx.ts';
import type { Service } from './service/index.ts';

const INSTRUCTIONS = `Cash Flow — личные финансы пользователя: банковские счета (синк через Enable Banking) и ручные счета.
- Суммы операций в валюте счёта; аналитика пересчитывает в базовую валюту (PLN/EUR/USD/CHF) по курсу НБП на дату операции.
- Расход — отрицательная сумма, доход — положительная. Группа категорий «Переводы и обмены» (переводы между своими счетами, обмен валют) исключена из доходов/расходов.
- Чтобы разложить операции без категории: list_transactions с uncategorized_only, затем categorize. Для повторяющегося мерчанта лучше scope="all" + create_rule=true — будущие операции из банка категоризируются сами.
- Перед созданием новой категории проверь list_categories: возможно, подходящая уже есть.`;

const base = z.enum(BASES).default('PLN').describe('Валюта пересчёта');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('YYYY-MM-DD');
const read = { readOnlyHint: true, openWorldHint: false };
const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const out = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data) }] });

function buildServer(s: Service) {
  const server = new McpServer({ name: 'cashflow', version: '1.0.0' }, { instructions: INSTRUCTIONS });
  const tool = <T extends StandardSchemaWithJSON>(
    name: string,
    description: string,
    inputSchema: T,
    annotations: object,
    fn: (args: StandardSchemaWithJSON.InferOutput<T>) => Promise<unknown>,
  ) =>
    // колбэк SDK для дженерика T не выводится (условный тип) — аргументы уже типизированы через InferOutput<T>
    server.registerTool(name, { description, inputSchema, annotations }, (async (
      args: StandardSchemaWithJSON.InferOutput<T>,
    ) => out(await fn(args))) as never);

  tool(
    'get_summary',
    'Сводка за период: доход, расход, net, норма сбережений, категории с топ-мерчантами, траты по дням.',
    z.object({ from: date.optional().describe('По умолчанию — 1-е число текущего месяца'), to: date.optional(), base }),
    read,
    async ({ from, to, base: b }) => {
      const r = await s.summary(from ?? `${today().slice(0, 7)}-01`, to ?? today(), b);
      // мерчантов урезаем до топ-10 на категорию, чтобы не раздувать ответ
      return { ...r, categories: r.categories.map((c) => ({ ...c, payees: c.payees.slice(0, 10) })) };
    },
  );

  tool(
    'list_transactions',
    'Операции за период (новые сверху). Фильтры: счёт, подстрока, только без категории.',
    z.object({
      from: date,
      to: date,
      base,
      account_id: z.string().optional().describe('Только этот счёт (включая вне-бюджетные)'),
      uncategorized_only: z.boolean().default(false),
      search: z.string().optional().describe('Подстрока в получателе или заметке'),
      limit: z.number().int().min(1).max(1000).default(200),
    }),
    read,
    async ({ from, to, base: b, account_id, uncategorized_only, search, limit }) => {
      let list = (await s.transactions(from, to, b, { accountId: account_id })).transactions;
      if (uncategorized_only) list = list.filter((t) => !t.categoryId && !t.startingBalance);
      if (search) {
        const q = search.toLowerCase();
        list = list.filter((t) => `${t.payee} ${t.notes}`.toLowerCase().includes(q));
      }
      return { total: list.length, transactions: list.slice(0, limit) };
    },
  );

  tool('list_categories', 'Категории с группами и числом операций.', z.object({}), read, () => s.categories());
  tool('list_accounts', 'Открытые счета: id, имя, валюта, вне бюджета ли.', z.object({}), read, () => s.accounts());
  // поля API для дашборда называются *Pln исторически; агенту отдаём однозначные имена
  tool(
    'get_balances',
    'Балансы всех счетов (balance — в валюте счёта, inBase — в базовой валюте) и итог total в базовой валюте по свежему курсу НБП.',
    z.object({ base }),
    read,
    async ({ base: b }) => {
      const r = await s.balances(b);
      return {
        base: r.base,
        total: r.totalPln,
        ratesToPln: r.rates,
        accounts: r.accounts.map(({ balancePln, ...a }) => ({ ...a, inBase: balancePln })),
      };
    },
  );
  tool(
    'get_networth_history',
    'История капитала по дням: total — сумма всех счетов в базовой валюте base.',
    z.object({ base, from: date.optional().describe('С какой даты отдавать точки') }),
    read,
    async ({ base: b, from }) => {
      const h = await s.networthHistory(b);
      const series = from ? h.series.filter((p) => p.date >= from) : h.series;
      return { base: h.base, series: series.map((p) => ({ date: p.date, total: p.totalPln })) };
    },
  );

  tool(
    'categorize',
    'Назначить категорию одной операции (transaction_id) или всем операциям мерчанта (payee): за всё время (можно с правилом на будущее) или за период.',
    z.object({
      category_id: z.string(),
      transaction_id: z.string().optional(),
      payee: z.string().optional().describe('Точное имя получателя, как в операциях'),
      scope: z.enum(['all', 'period']).default('all').describe('Для payee: вся история или период from–to'),
      create_rule: z.boolean().default(true).describe('Для payee+all: правило для будущих операций'),
      from: date.optional(),
      to: date.optional(),
    }),
    write,
    async ({ category_id, transaction_id, payee, scope, create_rule, from, to }) => {
      if (transaction_id) return s.categorize({ categoryId: category_id, txId: transaction_id });
      if (!payee) throw new Error('нужен transaction_id или payee');
      if (scope === 'period') return s.categorize({ categoryId: category_id, payee, from, to });
      return s.categorize({ categoryId: category_id, payee, allTime: true, rule: create_rule });
    },
  );

  tool(
    'exclude_transaction',
    'Исключить операцию из аналитики (перевод между своими счетами, возврат и т.п.).',
    z.object({ transaction_id: z.string() }),
    write,
    ({ transaction_id }) => s.exclude(transaction_id),
  );

  tool(
    'update_transaction',
    'Изменить получателя/заметку операции; у ручных операций — ещё дату и сумму.',
    z.object({
      transaction_id: z.string(),
      payee: z.string().optional(),
      notes: z.string().optional(),
      date: date.optional(),
      amount: z.number().optional().describe('В валюте счёта, расход со знаком минус'),
    }),
    write,
    ({ transaction_id, ...rest }) => s.updateTransaction({ id: transaction_id, ...rest }),
  );

  tool(
    'add_operation',
    'Ручная операция на счёт (наличные, инвестиции и т.п.). Расход — отрицательная сумма.',
    z.object({
      account_id: z.string(),
      date,
      amount: z.number().describe('В валюте счёта'),
      payee: z.string().optional(),
      notes: z.string().optional(),
      category_id: z.string().optional(),
    }),
    write,
    ({ account_id, category_id, ...rest }) => s.addOperation({ accountId: account_id, categoryId: category_id, ...rest }),
  );

  tool(
    'add_transfer',
    'Перевод между своими счетами одной валюты (две операции в «Переводы между счетами»).',
    z.object({ from_account_id: z.string(), to_account_id: z.string(), amount: z.number().positive(), date }),
    write,
    ({ from_account_id, to_account_id, amount, date: d }) =>
      s.addTransfer({ fromAccountId: from_account_id, toAccountId: to_account_id, amount, date: d }),
  );

  tool(
    'create_category',
    'Новая категория в существующей группе (group_id) или в группе по имени (group_name; создастся, если нет).',
    z.object({ name: z.string(), group_id: z.string().optional(), group_name: z.string().optional() }),
    write,
    ({ name, group_id, group_name }) => s.createCategory({ name, groupId: group_id, groupName: group_name }),
  );

  tool('list_rules', 'Правила автокатегоризации и сколько операций под каждое попадает.', z.object({}), read, () => s.rules());

  tool(
    'create_rule',
    'Правило: если условия совпали — операция из банка получает категорию. Сравнение без учёта регистра.',
    z.object({
      category_id: z.string(),
      conditions: z
        .array(
          z.object({
            field: z.enum(['payee', 'imported_payee', 'notes']).describe('imported_payee — имя получателя от банка'),
            op: z.enum(['is', 'contains', 'oneOf']),
            value: z.union([z.string(), z.array(z.string())]),
          }),
        )
        .min(1),
      conditions_op: z.enum(['and', 'or']).default('and'),
    }),
    write,
    ({ category_id, conditions, conditions_op }) =>
      s.saveRule({ categoryId: category_id, conditions, conditionsOp: conditions_op }),
  );

  tool('delete_rule', 'Удалить правило.', z.object({ rule_id: z.string() }), { ...write, destructiveHint: true }, ({ rule_id }) =>
    s.deleteRule(rule_id),
  );
  tool('apply_rules', 'Прогнать правила по всем операциям без категории.', z.object({}), write, () => s.applyRules());
  tool('sync_status', 'Когда был банк-синк, какие счета не синкаются, у каких банков кончается согласие.', z.object({}), read, () =>
    s.syncStatus(),
  );
  tool('sync_banks', 'Запустить банк-синк сейчас (до минуты).', z.object({}), { ...write, openWorldHint: true }, () =>
    s.bankSync(),
  );
  return server;
}

/** Web-обработчик MCP (Streamable HTTP; клиенты 2025 и 2026 годов). */
export const createMcp = (s: Service) => createMcpHandler(() => buildServer(s));
