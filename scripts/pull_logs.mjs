/* scripts/pull_logs.mjs
 * Menarik state + seluruh log mentah dari deployment (/api/export) lalu
 * menuliskannya ke logs/*.ndjson dan .data/state.json di laptop.
 *
 * Pemakaian (PowerShell):
 *   $env:BOT_URL="https://<project>.vercel.app"
 *   $env:CRON_SECRET="<secret>"
 *   node scripts/pull_logs.mjs
 *
 * Setelah itu jalankan: node scripts/hitung_ulang.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const LOGS = path.join(ROOT, 'logs');
const DATA = path.join(ROOT, '.data');

const base = process.env.BOT_URL || process.argv[2];
const secret = process.env.CRON_SECRET;

if (!base) {
  console.error('BOT_URL belum diisi. Contoh: $env:BOT_URL="https://<project>.vercel.app"');
  process.exit(1);
}
if (!secret) {
  console.error('CRON_SECRET belum diisi. Contoh: $env:CRON_SECRET="<secret>"');
  process.exit(1);
}

const url = `${base.replace(/\/+$/, '')}/api/export?secret=${encodeURIComponent(secret)}`;
console.log(`[pull] ${url.replace(secret, '***')}`);

const res = await fetch(url, {
  headers: { authorization: `Bearer ${secret}`, 'user-agent': 'Mozilla/5.0' },
});
if (!res.ok) {
  console.error(`[pull] gagal: HTTP ${res.status} ${await res.text().catch(() => '')}`);
  process.exit(1);
}
const body = await res.json();

const KINDS = ['calls', 'orders', 'equity', 'errors', 'snapshots', 'candles'];
fs.mkdirSync(LOGS, { recursive: true });
fs.mkdirSync(DATA, { recursive: true });

for (const k of KINDS) {
  const rows = body.logs?.[k] || [];
  const p = path.join(LOGS, `${k}.ndjson`);
  fs.writeFileSync(p, rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
  console.log(`[pull] ${k.padEnd(9)} ${String(rows.length).padStart(6)} baris -> ${path.relative(ROOT, p)}`);
}

if (body.state) {
  fs.writeFileSync(path.join(DATA, 'state.json'), JSON.stringify(body.state, null, 2));
  console.log('[pull] state      disimpan -> .data/state.json');
}

console.log('\nSelesai. Jalankan: node scripts/hitung_ulang.mjs');
