// Миграции базы (drizzle-kit: наши таблицы и таблицы Better Auth), затем стартовые данные для новой установки.
// Запускается при сборке на Vercel (`npm run build`) и при старте локального сервера.
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql/node';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { connection, dbConfig } from './db/index.ts';
import { seed } from './db/seed.ts';

const MIGRATIONS = new URL('../drizzle', import.meta.url).pathname;

export async function migrateAll() {
  const { url, authToken, local } = connection();
  const client = createClient({ url, authToken });
  if (local) await client.execute('PRAGMA journal_mode = WAL');
  const db = drizzle({ client, ...dbConfig });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  await seed(db);
  client.close();
}

if (import.meta.main ?? process.argv[1] === new URL(import.meta.url).pathname) {
  if (!process.env.VERCEL) {
    const env = new URL('../.env', import.meta.url).pathname;
    try {
      process.loadEnvFile(env);
    } catch {}
  }
  await migrateAll();
  console.log('migrations: ok');
}
