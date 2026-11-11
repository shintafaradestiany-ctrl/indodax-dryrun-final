/* scripts/liquidity.mjs
 * Mengukur likuiditas kandidat universe PADA AWAL periode backtest (bukan hari ini),
 * supaya pemilihan pasangan tidak terjebak survivorship bias / "memilih pemenang".
 *
 * Output: data/liquidity.json
 *
 * Pemakaian: node scripts/liquidity.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const DATA = path.join(process.cwd(), 'data');
const CANDIDATES = (process.env.CANDIDATES
  || 'BTCIDR,ETHIDR,SOLIDR,XRPIDR,DOGEIDR,ADAIDR,BNBIDR,LINKIDR,AVAXIDR,TRXIDR')
  .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);

const TF = Number(process.env.TF_MINUTES || 60);
const START = process.env.BT_START || new Date(Date.now() - Math.round(3 * 365.25 * 86400) * 1000).toISOString().slice(0, 10);
const startTs = Math.floor(Date.parse(START + 'T00:00:00Z') / 1000);
const WINDOW_DAYS = 30;

function load(sym) {
  const p = path.join(DATA, `${sym}_${TF}.csv`);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').slice(1).filter(Boolean).map(row => {
    const [t, , o, h, lo, c, v] = row.split(',');
    return { t: Number(t), o: +o, h: +h, l: +lo, c: +c, v: +v };
  });
}

const sum = a => a.reduce((s, x) => s + x, 0);
const avgTradedValue = bars => (bars.length ? sum(bars.map(b => b.c * b.v)) / bars.length : 0);

const rows = [];
for (const sym of CANDIDATES) {
  const bars = load(sym).sort((a, b) => a.t - b.t);
  if (!bars.length) { rows.push({ sym, ok: false, note: 'data tidak ada' }); continue; }
  const firstTs = bars[0].t;
  const win = (fromTs, days) => bars.filter(b => b.t >= fromTs && b.t < fromTs + days * 86400);
  const startWin = win(Math.max(firstTs, startTs), WINDOW_DAYS);
  const nowWin = win(bars[bars.length - 1].t - WINDOW_DAYS * 86400, WINDOW_DAYS);
  const atvStart = avgTradedValue(startWin);
  const atvNow = avgTradedValue(nowWin);
  const price = bars[bars.length - 1].c;
  rows.push({
    sym,
    ok: startWin.length >= WINDOW_DAYS * 24 * 0.8,
    bars: bars.length,
    firstDay: new Date(firstTs * 1000).toISOString().slice(0, 10),
    backtestStart: new Date(Math.max(firstTs, startTs) * 1000).toISOString().slice(0, 10),
    coverageOk: firstTs <= startTs,
    // volume Indodax dalam satuan aset; close x volume = nilai transaksi per candle 1 jam
    avgHourlyTradedValueStart: Math.round(atvStart),
    avgHourlyTradedValueNow: Math.round(atvNow),
    avgDailyTradedValueStart: Math.round(atvStart * 24),
    avgDailyTradedValueNow: Math.round(atvNow * 24),
    // kapasitas order 5% ATV per jam, harus di atas minimum Rp25.000
    cap5pctStart: Math.round(atvStart * 0.05),
    price,
    note: firstTs <= startTs ? 'tercatat sebelum awal backtest' : `baru tercatat ${new Date(firstTs * 1000).toISOString().slice(0, 10)}`,
  });
}

const eligible = rows.filter(r => r.ok && r.coverageOk && r.cap5pctStart >= 25_000)
  .sort((a, b) => b.avgHourlyTradedValueStart - a.avgHourlyTradedValueStart);

/* Aturan spread: buang pasangan yang median spread order book terukurnya > 2%
 * (batas yang sama dipakai bot saat entry). Tanpa snapshot, filter ini dilewati. */
const snapPath = path.join(process.cwd(), 'logs', 'snapshots.ndjson');
const spreadOf = {};
if (fs.existsSync(snapPath)) {
  const bySym = new Map();
  for (const line of fs.readFileSync(snapPath, 'utf8').split('\n').filter(Boolean)) {
    let r; try { r = JSON.parse(line); } catch { continue; }
    if (!Number.isFinite(r.spreadPct)) continue;
    (bySym.get(r.sym) || bySym.set(r.sym, []).get(r.sym)).push(r.spreadPct);
  }
  for (const [sym, arr] of bySym) {
    arr.sort((a, b) => a - b);
    spreadOf[sym] = Number(arr[Math.floor((arr.length - 1) / 2)].toFixed(4));
  }
}
for (const r of rows) {
  r.medianSpreadPct = spreadOf[r.sym] ?? null;
  r.spreadOk = r.medianSpreadPct == null ? null : r.medianSpreadPct <= 2;
}

const target = Number(process.env.UNIVERSE_SIZE || 8);
const chosen = eligible.filter(r => r.spreadOk !== false).slice(0, target).map(r => r.sym);

const out = {
  measuredAt: new Date().toISOString(),
  method: 'rata-rata close x volume per candle 1 jam selama 30 hari pertama periode backtest; '
    + 'kolom now dipakai untuk menunjukkan bahwa peringkat likuiditas hari ini TIDAK dipakai memilih universe',
  rule: `ambil ${target} teratas menurut likuiditas awal periode, buang yang median spread order book > 2%`,
  windowDays: WINDOW_DAYS,
  backtestStart: START,
  candidates: rows,
  rankingAtStart: eligible.map(r => r.sym),
  excludedBySpread: rows.filter(r => r.spreadOk === false).map(r => r.sym),
  chosen,
};
fs.mkdirSync(DATA, { recursive: true });
fs.writeFileSync(path.join(DATA, 'liquidity.json'), JSON.stringify(out, null, 2));

console.log(`Likuiditas awal periode (${START}, ${WINDOW_DAYS} hari pertama)\n`);
const pad = (s, n) => String(s).padEnd(n);
console.log(`${pad('pasangan', 10)} ${pad('nilai/jam (Rp)', 16)} ${pad('nilai/hari (Rp)', 18)} ${pad('5% ATV/jam', 14)} ${pad('nilai/hari sekarang', 20)} cakupan`);
for (const r of rows.slice().sort((a, b) => b.avgHourlyTradedValueStart - a.avgHourlyTradedValueStart)) {
  console.log(`${pad(r.sym, 10)} ${pad(r.avgHourlyTradedValueStart.toLocaleString('id-ID'), 16)} ${pad(r.avgDailyTradedValueStart.toLocaleString('id-ID'), 18)} ${pad(r.cap5pctStart.toLocaleString('id-ID'), 14)} ${pad(r.avgDailyTradedValueNow.toLocaleString('id-ID'), 20)} ${r.coverageOk ? '3 tahun' : r.note}`);
}
const K = chosen.length;
console.log(`\nDibuang karena spread > 2%: ${out.excludedBySpread.join(', ') || '—'}`);
console.log(`Terpilih (${K} pasangan): ${chosen.join(', ')}`);
console.log('File: data/liquidity.json');
