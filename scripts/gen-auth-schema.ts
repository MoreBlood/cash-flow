// Генерирует src/db/auth-schema.ts — Drizzle-схему таблиц Better Auth для текущих плагинов.
// Запускать после обновления better-auth / смены плагинов, затем `npm run db:generate` (миграция).
// Генератор пакета @better-auth/drizzle-adapter (тот же, что у `npx auth generate`) — без инициализации плагинов.
import { writeFileSync } from 'node:fs';
// @ts-expect-error внутренний модуль пакета: публично генератор доступен только через CLI
import { generateDrizzleSchema } from '../node_modules/@better-auth/drizzle-adapter/dist/generate-drizzle-schema-iWvrXnu0.mjs';
import { authOptions } from '../src/auth-options.ts';

const out = new URL('../src/db/auth-schema.ts', import.meta.url).pathname;
const { code } = await generateDrizzleSchema({ options: authOptions(), file: out, provider: 'sqlite' });
// связи генератор пишет в формате Drizzle 1.0 (defineRelationsPart); адаптеру Better Auth на 0.45 они не нужны
const tables = (code as string)
  .replace(/import \{ defineRelationsPart, /, 'import { ')
  .replace(/\n+export const authRelations = defineRelationsPart[\s\S]*$/, '\n');
writeFileSync(out, `// Сгенерировано scripts/gen-auth-schema.ts — не править руками.\n${tables}`);
console.log('auth-schema:', out);
