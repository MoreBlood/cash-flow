// Ключ приложения Enable Banking, заданный через UI (страница «Банки»): хранится в kv зашифрованным
// секретом установки (Better Auth symmetricEncrypt). Переменные окружения важнее.
import { symmetricDecrypt, symmetricEncrypt } from 'better-auth/crypto';
import { HTTPException } from 'hono/http-exception';
import { authSecret } from '../auth-options.ts';
import type { Db } from '../db/index.ts';
import { kvDelete, kvGet, kvSet } from '../db/kv.ts';
import { eb, ebSource, setEbCredentials } from '../lib/eb.ts';

type Stored = { appId: string; keyEnc: string; savedAt: string };

/** Подтянуть ключ из базы (в облаке — на каждом инстансе, перед обращением к банку). */
export async function loadEbCredentials(db: Db) {
  if (ebSource() === 'env') return;
  const s = await kvGet<Stored | null>(db, 'ebCredentials', null);
  setEbCredentials(s ? { appId: s.appId, key: await symmetricDecrypt({ key: authSecret(), data: s.keyEnc }) } : null);
}

/** Проверить ключ запросом к Enable Banking и сохранить. */
export async function saveEbCredentials(db: Db, b: { appId?: string; privateKey?: string }) {
  if (ebSource() === 'env') throw new HTTPException(409, { message: 'ключ задан переменными окружения EB_*' });
  const appId = String(b.appId || '').trim();
  const key = String(b.privateKey || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(appId)) throw new HTTPException(400, { message: 'Application ID — UUID из панели Enable Banking' });
  if (!/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+-----END [A-Z ]*PRIVATE KEY-----/.test(key))
    throw new HTTPException(400, { message: 'нужен приватный ключ .pem (BEGIN … PRIVATE KEY)' });
  try {
    await eb.application({ appId, key });
  } catch (e) {
    throw new HTTPException(400, { message: `Enable Banking не принял ключ: ${(e as Error).message}` });
  }
  await kvSet(db, 'ebCredentials', {
    appId,
    keyEnc: await symmetricEncrypt({ key: authSecret(), data: key }),
    savedAt: new Date().toISOString(),
  } satisfies Stored);
  setEbCredentials({ appId, key });
}

export async function deleteEbCredentials(db: Db) {
  await kvDelete(db, 'ebCredentials');
  setEbCredentials(null);
}

/** Состояние подключения к Enable Banking для страницы «Банки». */
export async function ebStatus(db: Db, redirectUrl: string) {
  await loadEbCredentials(db);
  const source = ebSource();
  if (!source) return { configured: false, source, redirectUrl };
  try {
    const app = await eb.application();
    return {
      configured: true,
      source,
      redirectUrl,
      app: { name: app.name ?? null, environment: app.environment ?? null, active: app.active ?? null },
      redirectRegistered: app.redirect_urls ? app.redirect_urls.includes(redirectUrl) : null,
    };
  } catch (e) {
    return { configured: true, source, redirectUrl, error: (e as Error).message };
  }
}
