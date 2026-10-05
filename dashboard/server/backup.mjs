// Снапшот базы в BACKUP_DIR (iCloud): консистентная online-копия SQLite, сжатая gzip.
import { createReadStream, createWriteStream, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backup } from 'node:sqlite';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';

const PREFIX = 'cashflow-';
const SUFFIX = '.sqlite.gz';

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** → путь к архиву или null, если BACKUP_DIR не задан/недоступен. Хранит последние BACKUP_KEEP. */
export async function backupDb(db, dir = process.env.BACKUP_DIR, keep = Number(process.env.BACKUP_KEEP || 30)) {
  if (!dir || !existsSync(dir)) return null;
  const tmp = join(tmpdir(), `${PREFIX}${Date.now()}.sqlite`);
  try {
    await backup(db, tmp);
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
