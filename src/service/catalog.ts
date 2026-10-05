// Справочники: настройки, счета, категории, правила.
import { randomUUID } from 'node:crypto';
import { and, asc, count, eq, isNull, max, ne, notExists, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { Q } from '../db/index.ts';
import { kvGet, kvSet } from '../db/kv.ts';
import { accounts, categories, categoryGroups, type RuleCondition, rules, transactions } from '../db/schema.ts';
import { categoryFor, rankRules, ruleMatches, validateConditions } from '../lib/rules.ts';

export const bad = (message: string) => new HTTPException(400, { message });
export const notFound = (message: string) => new HTTPException(404, { message });
export const touch = { updatedAt: sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))` };

// --- настройки ----------------------------------------------------------------
export type Settings = { excludedGroup: string; transferCategoryId: string | null; excludeCategoryId: string | null };
const SETTINGS_DEFAULT: Settings = { excludedGroup: 'Переводы и обмены', transferCategoryId: null, excludeCategoryId: null };

export const getSettings = async (db: Q): Promise<Settings> => ({
  ...SETTINGS_DEFAULT,
  ...(await kvGet<Partial<Settings>>(db, 'settings', {})),
});

export async function saveSettings(db: Q, patch: Partial<Settings>) {
  const next = await getSettings(db);
  for (const k of Object.keys(SETTINGS_DEFAULT) as (keyof Settings)[]) if (k in patch) Object.assign(next, { [k]: patch[k] });
  await kvSet(db, 'settings', next);
  return next;
}

// --- счета --------------------------------------------------------------------
export const openAccounts = (db: Q) => db.select().from(accounts).where(eq(accounts.closed, false)).orderBy(asc(accounts.sort));

export const accountsList = async (db: Q) =>
  (await openAccounts(db)).map((a) => ({ id: a.id, name: a.name, currency: a.currency, offBudget: a.offbudget }));

// --- категории ------------------------------------------------------------------
export async function listCategories(db: Q) {
  const used = db
    .select({ categoryId: transactions.categoryId, n: count().as('n') })
    .from(transactions)
    .groupBy(transactions.categoryId)
    .as('used');
  return (
    await db
      .select({
        id: categories.id,
        name: categories.name,
        group: categoryGroups.name,
        groupId: categories.groupId,
        isIncome: categories.isIncome,
        count: sql<number>`coalesce(${used.n}, 0)`,
      })
      .from(categories)
      .innerJoin(categoryGroups, eq(categoryGroups.id, categories.groupId))
      .leftJoin(used, eq(used.categoryId, categories.id))
      .orderBy(asc(categoryGroups.sort), asc(categories.sort))
  ).map((c) => ({ ...c, count: Number(c.count) }));
}

/** {catInfo: id → категория, excluded: id категорий группы «исключить из аналитики»} */
export async function categoryIndex(db: Q) {
  const { excludedGroup } = await getSettings(db);
  const catInfo: Record<string, Awaited<ReturnType<typeof listCategories>>[number]> = {};
  const excluded = new Set<string>();
  for (const c of await listCategories(db)) {
    catInfo[c.id] = c;
    if (c.group === excludedGroup) excluded.add(c.id);
  }
  return { catInfo, excluded };
}

export async function requireCategory(db: Q, id?: string | null) {
  if (!id || !(await db.select({ id: categories.id }).from(categories).where(eq(categories.id, id)).get()))
    throw bad('unknown categoryId');
}

const nextSort = async (db: Q, table: typeof categories | typeof categoryGroups) =>
  ((await db.select({ m: max(table.sort) }).from(table).get())?.m ?? 0) + 1;

/** Новая категория в существующей группе (groupId) или в новой/найденной по имени (groupName). */
export async function createCategory(db: Q, b: { name?: string; groupId?: string; groupName?: string; isIncome?: boolean }) {
  const name = String(b.name || '').trim();
  if (!name) throw bad('need name');
  let group = b.groupId
    ? await db.select().from(categoryGroups).where(eq(categoryGroups.id, b.groupId)).get()
    : await db
        .select()
        .from(categoryGroups)
        .where(eq(categoryGroups.name, String(b.groupName || '').trim()))
        .get();
  if (!group) {
    if (b.groupId) throw bad('unknown groupId');
    const groupName = String(b.groupName || '').trim();
    if (!groupName) throw bad('need groupId or groupName');
    group = { id: randomUUID(), name: groupName, isIncome: !!b.isIncome, sort: await nextSort(db, categoryGroups) };
    await db.insert(categoryGroups).values(group);
  }
  if (await db.select().from(categories).where(and(eq(categories.groupId, group.id), eq(categories.name, name))).get())
    throw bad('такая категория уже есть');
  const id = randomUUID();
  await db
    .insert(categories)
    .values({ id, groupId: group.id, name, isIncome: group.isIncome, sort: await nextSort(db, categories) });
  return (await listCategories(db)).find((c) => c.id === id);
}

export async function renameCategory(db: Q, b: { id?: string; name?: string }) {
  await requireCategory(db, b.id);
  const name = String(b.name || '').trim();
  if (!name) throw bad('need name');
  await db.update(categories).set({ name }).where(eq(categories.id, b.id as string));
  return { ok: true };
}

/** Удаление категории: операции и правила переезжают в replaceWith (или операции остаются без категории). */
export async function deleteCategory(db: Q, b: { id?: string; replaceWith?: string | null }) {
  await requireCategory(db, b.id);
  const id = b.id as string;
  const to = b.replaceWith || null;
  if (to) await requireCategory(db, to);
  if (to === id) throw bad('replaceWith = id');
  const moved = (await db.update(transactions).set({ categoryId: to, ...touch }).where(eq(transactions.categoryId, id)))
    .rowsAffected;
  if (to) await db.update(rules).set({ categoryId: to }).where(eq(rules.categoryId, id));
  else await db.delete(rules).where(eq(rules.categoryId, id));
  const s = await getSettings(db);
  if (s.transferCategoryId === id) s.transferCategoryId = to;
  if (s.excludeCategoryId === id) s.excludeCategoryId = to;
  await kvSet(db, 'settings', s);
  const { groupId } = (await db.select({ groupId: categories.groupId }).from(categories).where(eq(categories.id, id)).get())!;
  await db.delete(categories).where(eq(categories.id, id));
  // пустую группу убираем (кроме группы исключений из настроек)
  await db
    .delete(categoryGroups)
    .where(
      and(
        eq(categoryGroups.id, groupId),
        ne(categoryGroups.name, s.excludedGroup),
        notExists(db.select().from(categories).where(eq(categories.groupId, groupId))),
      ),
    );
  return { moved };
}

// --- правила ----------------------------------------------------------------------
export const loadRules = async (db: Q) => rankRules(await db.select().from(rules));

/** Правила + сколько операций из истории под них попадает. */
export async function listRules(db: Q) {
  const { catInfo } = await categoryIndex(db);
  const txs = await db
    .select({ payee: transactions.payee, importedPayee: transactions.importedPayee, notes: transactions.notes })
    .from(transactions)
    .where(eq(transactions.startingBalance, false));
  return (await loadRules(db)).map((r) => ({
    id: r.id,
    conditionsOp: r.conditionsOp,
    conditions: r.conditions,
    categoryId: r.categoryId,
    category: catInfo[r.categoryId]?.name ?? null,
    matches: txs.filter((t) => ruleMatches(r, t)).length,
  }));
}

export async function saveRule(
  db: Q,
  b: { id?: string; conditions?: unknown; conditionsOp?: string; categoryId?: string },
) {
  await requireCategory(db, b.categoryId);
  let conditions: RuleCondition[];
  try {
    conditions = validateConditions(b.conditions);
  } catch (e) {
    throw bad((e as Error).message);
  }
  const values = { conditions, conditionsOp: b.conditionsOp === 'or' ? ('or' as const) : ('and' as const), categoryId: b.categoryId as string };
  if (b.id) {
    if (!(await db.update(rules).set(values).where(eq(rules.id, b.id))).rowsAffected) throw notFound('rule not found');
    return { id: b.id };
  }
  const id = randomUUID();
  await db.insert(rules).values({ id, ...values });
  return { id };
}

export async function deleteRule(db: Q, id?: string) {
  if (!id || !(await db.delete(rules).where(eq(rules.id, id))).rowsAffected) throw notFound('rule not found');
  return { ok: true };
}

/** Upsert правила «payee → категория»: одно правило на мерчанта, без дублей. */
export async function upsertPayeeRule(db: Q, payee: string, categoryId: string) {
  const name = payee.toLowerCase();
  const existing = (await db.select().from(rules)).find((r) =>
    r.conditions.some(
      (c) =>
        (c.field === 'payee' && (Array.isArray(c.value) ? c.value : [c.value]).some((v) => v.toLowerCase() === name)) ||
        (c.field === 'imported_payee' && String(c.value).toLowerCase() === name),
    ),
  );
  const values = { conditions: [{ field: 'payee' as const, op: 'is' as const, value: payee }], conditionsOp: 'and' as const, categoryId };
  if (existing) await db.update(rules).set(values).where(eq(rules.id, existing.id));
  else await db.insert(rules).values({ id: randomUUID(), ...values });
}

/** Прогнать правила по операциям без категории. */
export async function applyRules(db: Q) {
  const ranked = await loadRules(db);
  let updated = 0;
  for (const t of await db
    .select()
    .from(transactions)
    .where(and(isNull(transactions.categoryId), eq(transactions.startingBalance, false)))) {
    const c = categoryFor(ranked, t);
    if (c) updated += (await db.update(transactions).set({ categoryId: c, ...touch }).where(eq(transactions.id, t.id))).rowsAffected;
  }
  return { updated };
}
