// Локальная установка (launchd на Mac): http://127.0.0.1:5055 + https :5443 для колбэка Enable Banking,
// автосинк по расписанию с догоном после сна, бэкап в iCloud после каждого синка.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createServer as createHttpsServer } from 'node:https';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql/node';
import { createApp } from './http.ts';
import { authConfigured, createAuth } from './auth.ts';
import { backupDb } from './backup.ts';
import { connection, dbConfig } from './db/index.ts';
import { migrateAll } from './migrate.ts';
import { createService } from './service/index.ts';

const ROOT = new URL('../', import.meta.url).pathname;
try {
  process.loadEnvFile(join(ROOT, '.env'));
} catch {}
process.env.BACKUP_DIR ||= process.env.ICLOUD_BACKUP_DIR;

const PORT = Number(process.env.PORT || 5055);
const HTTPS_PORT = Number(process.env.HTTPS_PORT ?? 5443);
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;

await migrateAll();
const { url, authToken } = connection();
const client = createClient({ url, authToken });
await client.execute('PRAGMA busy_timeout = 5000');
const db = drizzle({ client, ...dbConfig });
console.log('db:', url);

const service = createService(db, {
  // копия в iCloud после каждого синка — не валим синк, если бэкап не удался
  onSyncDone: async () => {
    const arc = await backupDb(client).catch((e) => console.error('[backup] не удалось:', e?.message || e));
    if (arc) console.log('[backup] снапшот:', arc);
  },
});
const app = createApp({ service, auth: authConfigured() ? createAuth(db) : null, publicUrl: PUBLIC_URL });

// фронтенд (собранный Vite) + SPA-fallback
app.use('/*', serveStatic({ root: join(ROOT, 'public') }));
app.get('*', serveStatic({ path: join(ROOT, 'public/index.html') }));

serve({ fetch: app.fetch, port: PORT, hostname: '127.0.0.1' }, () => console.log(`dashboard on ${PUBLIC_URL}`));

// https-вход только ради redirect URL Enable Banking: самоподписанный сертификат на localhost
if (HTTPS_PORT) {
  const dir = join(ROOT, 'data/tls');
  const key = join(dir, 'localhost-key.pem');
  const cert = join(dir, 'localhost.pem');
  if (!existsSync(cert)) {
    mkdirSync(dir, { recursive: true });
    execFileSync('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '3650', '-subj', '/CN=localhost',
      '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1', '-keyout', key, '-out', cert], { stdio: 'ignore' });
  }
  serve(
    { fetch: app.fetch, port: HTTPS_PORT, hostname: '127.0.0.1', createServer: createHttpsServer, serverOptions: { key: readFileSync(key), cert: readFileSync(cert) } },
    () => console.log(`https on :${HTTPS_PORT}`),
  );
}

// автосинк по расписанию (локальное время): не чаще раза в 12 часов, догоняет после сна/выключения
const TIMES = (process.env.AUTO_SYNC_TIMES ?? '07:30').split(',').map((x) => x.trim()).filter(Boolean);
function lastScheduledBefore(now: Date) {
  let best: Date | null = null;
  for (const hm of TIMES) {
    const [h, m] = hm.split(':').map(Number);
    for (const back of [0, 1]) {
      const d = new Date(now);
      d.setDate(d.getDate() - back);
      d.setHours(h, m, 0, 0);
      if (d <= now && (!best || d > best)) best = d;
    }
  }
  return best;
}
async function autoSyncTick() {
  const due = lastScheduledBefore(new Date());
  const last = (await service.syncStatus()).lastAttemptAt;
  if (due && (!last || new Date(last) < due)) await service.scheduledSync().catch((e) => console.error('[auto-sync]', e));
}
if (TIMES.length && process.env.AUTO_SYNC !== 'off') {
  setTimeout(autoSyncTick, 30_000);
  setInterval(autoSyncTick, 5 * 60_000);
}
