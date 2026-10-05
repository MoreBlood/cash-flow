// Better Auth поверх общей базы: таблицы user, session, oauth*… — схема в src/db/auth-schema.ts.
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { authOptions } from './auth-options.ts';
import * as authSchema from './db/auth-schema.ts';
import type { Db } from './db/index.ts';

export { allowedLogin, authConfigured, authRequired, baseURL, mcpResource } from './auth-options.ts';

export const createAuth = (db: Db) =>
  betterAuth(authOptions(drizzleAdapter(db, { provider: 'sqlite', schema: authSchema })));
export type Auth = ReturnType<typeof createAuth>;

/**
 * Better Auth инициализируется один раз на процесс (создаёт свою запись ресурса MCP), и неудачная
 * инициализация остаётся навсегда. При одновременном холодном старте нескольких инстансов запись
 * может вставиться дважды — тогда пересоздаём экземпляр: вторая попытка уже найдёт запись.
 */
export async function createReadyAuth(db: Db, attempts = 3): Promise<Auth> {
  for (let i = 1; ; i++) {
    const auth = createAuth(db);
    try {
      await auth.$context;
      return auth;
    } catch (e) {
      if (i >= attempts) throw e;
      console.warn(`[auth] инициализация не удалась (${(e as Error).message}), повтор`);
      await new Promise((r) => setTimeout(r, 300 * i));
    }
  }
}
