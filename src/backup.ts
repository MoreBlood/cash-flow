// Локальная установка: снапшот базы в BACKUP_DIR (iCloud) — VACUUM INTO (консистентная копия без остановки) + gzip.
import { createReadStream, createWriteStream, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import type { Client } from '@libsql/client';

const PREFIX = 'cashflow-';
const SUFFIX = '.sqlite.gz';
const stamp = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

/** → путь к архиву или null, если BACKUP_DIR не задан/недоступен. Хранит последние BACKUP_KEEP. */
export async function backupDb(client: Client, dir = process.env.BACKUP_DIR, keep = Number(process.env.BACKUP_KEEP || 30)) {
  if (!dir || !existsSync(dir)) return null;
  const tmp = join(tmpdir(), `${PREFIX}${Date.now()}.sqlite`);
  try {
    await client.execute({ sql: 'VACUUM INTO ?', args: [tmp] });
    const arc = join(dir, `${PREFIX}${stamp()}${SUFFIX}`);
    await pipeline(createReadStream(tmp), createGzip(), createWriteStream(arc));
    const arcs = readdirSync(dir)
      .filter((f) => f.startsWith(PREFIX) && f.endsWith(SUFFIX))
      .sort()
      .reverse();
    for (const old of arcs.slice(keep)) rmSync(join(dir, old), { force: true });
    return arc;
  } finally {
    rmSync(tmp, { force: true });
  }
}
