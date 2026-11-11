/* scripts/snapshot.mjs
 * Mengambil snapshot order book semua pasangan universe sekali, menyimpannya
 * mentah ke logs/snapshots.ndjson (format sama dengan yang ditulis bot), dan
 * mencetak spread. Dipakai backtest untuk mengukur spread, jadi jalankan
 * minimal sekali sebelum scripts/backtest.mjs.
 *
 * Jalankan minimal 3x sehari selama masa persiapan (soal UAS) atau setiap jam
 * lewat penjadwal. Bot juga menyimpan snapshot setiap kali /api/tick berjalan.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CFG } from '../lib/config.js';
import { depth, getPairs, serverTime } from '../lib/indodax.js';
import { bookStats, topLevels } from '../lib/exec.js';
import { pctile } from '../lib/report.js';

const OUT = path.join(process.cwd(), 'logs', 'snapshots.ndjson');
const pairs = await getPairs();
const now = Math.floor((await serverTime()) / 1000);
const rows = [];

for (const sym of CFG.universe) {
  const meta = pairs.get(sym.toLowerCase()) || pairs.get(sym.toLowerCase().replace('idr', '_idr'));
  if (!meta) { console.warn(`${sym}: tidak ditemukan`); continue; }
  try {
    const book = await depth(meta.id);
    const s = bookStats(book);
    if (!s.ok) { console.warn(`${sym}: ${s.reason}`); continue; }
    const row = {
      ts: now,
      iso: new Date(now * 1000).toISOString(),
      sym,
      bid: s.bestBid,
      ask: s.bestAsk,
      mid: s.mid,
      spreadPct: Number(s.spreadPct.toFixed(4)),
      bids: topLevels(book.bids),
      asks: topLevels(book.asks),
    };
    rows.push(row);
    console.log(`${sym.padEnd(9)} bid ${String(s.bestBid).padStart(12)}  ask ${String(s.bestAsk).padStart(12)}  spread ${s.spreadPct.toFixed(3)}%`);
  } catch (e) {
    console.warn(`${sym}: ${e.message}`);
  }
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.appendFileSync(OUT, rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
const spreads = rows.map(r => r.spreadPct);
if (spreads.length) console.log(`\nmedian spread ${pctile(spreads, 50).toFixed(4)}% · tersimpan di ${OUT}`);
