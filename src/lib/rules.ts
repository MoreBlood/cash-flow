// Правила автокатегоризации: условия по payee / imported_payee / notes → категория.
// Сравнение строк регистронезависимое.
import type { RuleCondition } from '../db/schema.ts';

export type RuleLike = { id: string; conditionsOp: 'and' | 'or'; conditions: RuleCondition[]; categoryId: string };
type Fields = { payee?: string | null; importedPayee?: string | null; notes?: string | null };

// Специфичность: точное совпадение важнее «содержит»;
// при равенстве побеждает более длинный ключ («pizzeria» точнее «pizza»).
const OP_SCORE = { is: 10, oneOf: 9, contains: 0 } as const;
const FIELD = { payee: 'payee', imported_payee: 'importedPayee', notes: 'notes' } as const;

export function validateConditions(conditions: unknown): RuleCondition[] {
  if (!Array.isArray(conditions) || !conditions.length) throw new Error('rule needs conditions');
  for (const c of conditions) {
    if (!(c?.field in FIELD)) throw new Error(`unsupported rule field: ${c?.field}`);
    if (!(c.op in OP_SCORE)) throw new Error(`unsupported rule op: ${c.op}`);
    const ok = c.op === 'oneOf' ? Array.isArray(c.value) && c.value.length : typeof c.value === 'string' && c.value;
    if (!ok) throw new Error(`bad value for ${c.field} ${c.op}`);
  }
  return conditions as RuleCondition[];
}

function conditionMatches(c: RuleCondition, t: Fields) {
  const v = (t[FIELD[c.field]] || '').toLowerCase();
  if (!v) return false;
  if (c.op === 'is') return v === String(c.value).toLowerCase();
  if (c.op === 'contains') return v.includes(String(c.value).toLowerCase());
  return (c.value as string[]).some((x) => v === x.toLowerCase());
}

export function ruleMatches(rule: RuleLike, t: Fields) {
  return rule.conditionsOp === 'or'
    ? rule.conditions.some((c) => conditionMatches(c, t))
    : rule.conditions.every((c) => conditionMatches(c, t));
}

function specificity(rule: RuleLike): [number, number] {
  const cs = rule.conditions;
  let s = cs.reduce((acc, c) => acc + OP_SCORE[c.op], 0);
  if (cs.every((c) => c.op === 'is' || c.op === 'oneOf')) s *= 2;
  const len = cs.reduce((acc, c) => acc + (Array.isArray(c.value) ? 0 : c.value.length), 0);
  return [s, len];
}

/** Самые специфичные правила — первыми. */
export function rankRules<R extends RuleLike>(rules: R[]): R[] {
  return rules
    .map((r) => ({ r, rank: specificity(r) }))
    .sort((a, b) => b.rank[0] - a.rank[0] || b.rank[1] - a.rank[1])
    .map((x) => x.r);
}

/** Категория по самому специфичному сработавшему правилу (rules — из rankRules). */
export function categoryFor(rules: RuleLike[], t: Fields) {
  return rules.find((r) => ruleMatches(r, t))?.categoryId ?? null;
}
