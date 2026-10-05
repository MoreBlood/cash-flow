// Правила автокатегоризации: условия по payee / imported_payee / notes → категория.
// Сравнение строк регистронезависимое (как было в Actual).

// Специфичность как в Actual: точное совпадение важнее «содержит»;
// при равенстве побеждает более длинный ключ («pizzeria» точнее «pizza»).
const OP_SCORE = { is: 10, oneOf: 9, contains: 0 };
const FIELDS = new Set(['payee', 'imported_payee', 'notes']);

export function validateConditions(conditions) {
  if (!Array.isArray(conditions) || !conditions.length) throw new Error('rule needs conditions');
  for (const c of conditions) {
    if (!FIELDS.has(c.field)) throw new Error(`unsupported rule field: ${c.field}`);
    if (!(c.op in OP_SCORE)) throw new Error(`unsupported rule op: ${c.op}`);
    const ok = c.op === 'oneOf' ? Array.isArray(c.value) && c.value.length : typeof c.value === 'string' && c.value;
    if (!ok) throw new Error(`bad value for ${c.field} ${c.op}`);
  }
  return conditions;
}

function conditionMatches(c, t) {
  const v = (t[c.field] || '').toLowerCase();
  if (!v) return false;
  if (c.op === 'is') return v === c.value.toLowerCase();
  if (c.op === 'contains') return v.includes(c.value.toLowerCase());
  if (c.op === 'oneOf') return c.value.some((x) => v === x.toLowerCase());
  return false;
}

export function ruleMatches(rule, t) {
  return rule.conditions_op === 'or'
    ? rule.conditions.some((c) => conditionMatches(c, t))
    : rule.conditions.every((c) => conditionMatches(c, t));
}

function specificity(rule) {
  const cs = rule.conditions;
  let s = cs.reduce((acc, c) => acc + OP_SCORE[c.op], 0);
  if (cs.every((c) => c.op === 'is' || c.op === 'oneOf')) s *= 2;
  const len = cs.reduce((acc, c) => acc + (Array.isArray(c.value) ? 0 : c.value.length), 0);
  return [s, len];
}

export function loadRules(db) {
  return db
    .prepare('SELECT id, conditions_op, conditions, category_id FROM rules')
    .all()
    .map((r) => ({ ...r, conditions: JSON.parse(r.conditions) }))
    .map((r) => ({ ...r, rank: specificity(r) }))
    .sort((a, b) => b.rank[0] - a.rank[0] || b.rank[1] - a.rank[1]);
}

/** Категория по самому специфичному сработавшему правилу (rules — из loadRules). */
export function categoryFor(rules, t) {
  return rules.find((r) => ruleMatches(r, t))?.category_id ?? null;
}
