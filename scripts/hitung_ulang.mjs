/* scripts/hitung_ulang.mjs
 * Menghitung ulang SEMUA angka dashboard dari log mentah, lalu menulis
 * dashboard.html (offline, mandiri) dan data/dashboard_data.json.
 *
 * Pemakaian: node scripts/hitung_ulang.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { CFG } from '../lib/config.js';
import { buildDashboardData } from '../lib/report.js';
import { renderDashboard } from '../lib/dashboard.js';

const ROOT = process.cwd();
const LOGS = path.join(ROOT, 'logs');

function ndjson(name) {
  const p = path.join(LOGS, `${name}.ndjson`);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

const logs = {
  orders: ndjson('orders'),
  equity: ndjson('equity'),
  calls: ndjson('calls'),
  errors: ndjson('errors'),
  snapshots: ndjson('snapshots'),
  candles: ndjson('candles'),
};

let summary = {};
const summaryPath = path.join(ROOT, 'data', 'backtest_summary.mjs');
if (fs.existsSync(summaryPath)) {
  summary = (await import(`../data/backtest_summary.mjs?t=${Date.now()}`)).default;
} else {
  console.warn('[hitung-ulang] data/backtest_summary.mjs belum ada, jalankan scripts/backtest.mjs dulu');
}

const data = buildDashboardData({ summary, logs, cfg: CFG, meta: summary.meta || {} });

fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'data', 'dashboard_data.json'), JSON.stringify(data, null, 2));
fs.writeFileSync(path.join(ROOT, 'dashboard.html'), renderDashboard(data));

const fw = data.forward.perf;
const wb = data.windowBt?.perf;
console.log('=== Forward test ===');
if (fw) {
  console.log(`Periode      : ${data.meta.forwardStart} s/d ${data.meta.forwardEnd}`);
  console.log(`Return       : ${fw.totalReturnPct.toFixed(2)}%   Max DD: ${fw.mddPct.toFixed(2)}%`);
  console.log(`Trade        : ${fw.nTrades}   Win rate: ${fw.winRatePct.toFixed(1)}%   PF: ${Number.isFinite(fw.profitFactor) ? fw.profitFactor.toFixed(2) : 'inf'}`);
  console.log(`Benchmark    : ${fw.benchmarkPct == null ? '—' : fw.benchmarkPct.toFixed(2) + '%'}`);
  if (wb) console.log(`Gap vs BT    : ${(fw.totalReturnPct - wb.totalReturnPct).toFixed(2)} pp`);
} else {
  console.log('belum ada log forward test (logs/equity.ndjson < 2 baris)');
}
console.log(`Uptime       : ${data.ops.uptime.pct.toFixed(1)}% (${data.ops.uptime.processed}/${data.ops.uptime.expected} candle)`);
console.log(`Snapshot     : ${data.dataQuality.snapshotCount} · median spread ${data.dataQuality.medianSpreadPct?.toFixed(3) ?? '—'}%`);
console.log(`\nDashboard    : ${path.join(ROOT, 'dashboard.html')}`);
