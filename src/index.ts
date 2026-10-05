// Точка входа Vercel (zero-config Hono): база — Turso, вход — GitHub, статика — public/ через CDN.
// Миграции выполняются при сборке (npm run build → src/migrate.ts).
import { drizzle } from 'drizzle-orm/libsql/web';
import type { Hono } from 'hono';
import { createApp, type Env } from './http.ts';
import { authConfigured, createAuth } from './auth.ts';
import { connection, dbConfig } from './db/index.ts';
import { createService } from './service/index.ts';

const { url, authToken } = connection();
const db = drizzle({ connection: { url, authToken }, ...dbConfig });
const app: Hono<Env> = createApp({ service: createService(db), auth: authConfigured() ? createAuth(db) : null });

export default app;
