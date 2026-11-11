/* lib/store.js
 * Penyimpanan state + log mentah. Dua mode:
 *   - redis : Vercel KV / Upstash Redis lewat REST (tanpa dependensi)
 *   - file  : lokal, .data/state.json + logs/<jenis>.ndjson
 * Mode dipilih otomatis dari environment.
 */
import fs from 'node:fs';
import path from 'node:path';

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const PREFIX = process.env.STORE_PREFIX || 'bot';
const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, '.data');
const LOG_DIR = path.join(ROOT, 'logs');

export const mode = URL_ && TOKEN ? 'redis' : 'file';

/* ---------------- redis ---------------- */
async function redis(cmds) {
  const res = await fetch(`${URL_}/pipeline`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(cmds),
  });
  if (!res.ok) throw new Error(`storage HTTP ${res.status}`);
  const out = await res.json();
  const err = out.find(x => x && x.error);
  if (err) throw new Error(`storage: ${err.error}`);
  return out.map(x => x && x.result);
}

/* ---------------- file ---------------- */
function ensure(dir) { fs.mkdirSync(dir, { recursive: true }); }
const stateFile = path.join(DATA_DIR, 'state.json');
const logFile = kind => path.join(LOG_DIR, `${kind}.ndjson`);

/* ---------------- API ---------------- */
export async function readState() {
  if (mode === 'redis') {
    const [raw] = await redis([['GET', `${PREFIX}:state`]]);
    return raw ? JSON.parse(raw) : null;
  }
  try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { return null; }
}

export async function writeState(state) {
  const raw = JSON.stringify(state);
  if (mode === 'redis') { await redis([['SET', `${PREFIX}:state`, raw]]); return; }
  ensure(DATA_DIR);
  fs.writeFileSync(stateFile, raw);
}

/** Tambah banyak baris log sekaligus (dipanggil sekali per tick). */
export async function appendLogs(kind, rows) {
  if (!rows || !rows.length) return;
  if (mode === 'redis') {
    const key = `${PREFIX}:log:${kind}`;
    const cmds = rows.map(r => ['RPUSH', key, JSON.stringify(r)]);
    cmds.push(['LTRIM', key, '-200000', '-1']);
    await redis(cmds);
    return;
  }
  ensure(LOG_DIR);
  fs.appendFileSync(logFile(kind), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
}

export async function readLogs(kind) {
  if (mode === 'redis') {
    const [raw] = await redis([['LRANGE', `${PREFIX}:log:${kind}`, '0', '-1']]);
    return (raw || []).map(x => JSON.parse(x));
  }
  try {
    return fs.readFileSync(logFile(kind), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  } catch { return []; }
}

/** Flag kecil (kill switch) tanpa deploy ulang. */
export async function getFlag(name) {
  if (mode === 'redis') {
    const [v] = await redis([['GET', `${PREFIX}:flag:${name}`]]);
    return v;
  }
  try { return fs.readFileSync(path.join(DATA_DIR, `flag_${name}`), 'utf8').trim(); } catch { return null; }
}

export async function setFlag(name, value) {
  if (mode === 'redis') { await redis([['SET', `${PREFIX}:flag:${name}`, String(value)]]); return; }
  ensure(DATA_DIR);
  fs.writeFileSync(path.join(DATA_DIR, `flag_${name}`), String(value));
}

/** Daftar berkas log lokal (untuk skrip hitung ulang). */
export function localLogPath(kind) { return logFile(kind); }
export { DATA_DIR, LOG_DIR };
