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
