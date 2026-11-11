/* scripts/local_tick.mjs
 * Menjalankan satu tick bot secara lokal (mode file: .data/state.json + logs/*.ndjson).
 *
 *   node scripts/local_tick.mjs
 *
 * Untuk simulasi berulang tanpa menunggu candle baru, jalankan sekali per jam
 * (atau lewat Task Scheduler). Idempotency mencegah candle yang sama diproses dua kali.
 */
import fs from 'node:fs';
import path from 'node:path';

/* pemuat .env sederhana (tanpa dependensi) */
const envPath = path.join(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const { runTick } = await import('../lib/bot.js');
const { mode } = await import('../lib/store.js');

try {
  const out = await runTick({ source: 'local' });
  console.log(JSON.stringify(out, null, 2));
  console.log(`\nmode storage: ${mode}`);
} catch (e) {
  console.error('tick gagal:', e.message);
  process.exit(1);
}
