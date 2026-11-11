/* scripts/backtest.mjs
 * Backtest 3 tahun dengan fungsi sinyal yang sama dengan bot, memakai biaya
 * (fee + spread + slippage) hasil pengukuran snapshot.
 *
 * Output:
 *   logs/backtest_result.json   hasil lengkap (trade + ekuitas)
 *   data/backtest_summary.mjs   ringkasan untuk dashboard (di-commit)
 *   data/backtest_trades.csv    daftar trade
 *   logs/validity.json          uji parameter (in-sample / out-of-sample / sensitivitas)
 */
import fs from 'node:fs';
import path from 'node:path';
import { CFG } from '../lib/config.js';
import { runBacktest } from '../lib/backtest.js';
import { perf, buyHold } from '../lib/metrics.js';
import { pctile } from '../lib/report.js';

const ROOT = process.cwd();
const DATA = path.join(ROOT, 'data');
const LOGS = path.join(ROOT, 'logs');
fs.mkdirSync(LOGS, { recursive: true });

const isoDay = t => new Date(t * 1000).toISOString().slice(0, 10);
const now = Math.floor(Date.now() / 1000);
const BT_START = process.env.BT_START || isoDay(now - Math.round(3 * 365.25 * 86400));
const BT_END = process.env.BT_END || isoDay(now);
const ymd = s => Math.floor(Date.parse(s + 'T00:00:00Z') / 1000);

function loadCsv(sym) {
  const p = path.join(DATA, `${sym}_${CFG.tfMin}.csv`);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').slice(1).filter(Boolean).map(line => {
    const [t, , o, h, lo, c, v] = line.split(',');
    return { t: Number(t), o: +o, h: +h, l: +lo, c: +c, v: +v };
  });
}

function readNdjson(p) {
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

/* ---------- biaya: median spread & slippage hasil pengukuran ---------- */
const snapshots = readNdjson(path.join(LOGS, 'snapshots.ndjson'));
const orders = readNdjson(path.join(LOGS, 'orders.ndjson'));
/* hanya snapshot pasangan yang benar-benar ditradingkan, supaya spread pasangan
 * tipis di luar universe tidak menggeser median biaya */
const uniSet = new Set(CFG.universe);
const snapsU = snapshots.filter(s => uniSet.has(s.sym));
const spreadMedian = snapsU.length ? pctile(snapsU.map(s => s.spreadPct), 50) : null;
const slipMedian = orders.length ? pctile(orders.map(o => Math.abs(o.slipPct || 0)), 50) : null;
const cost = {
  spreadPct: Number((spreadMedian ?? CFG.btSpreadBps / 100).toFixed(4)),
  slippagePct: Number(Math.max(slipMedian ?? 0, CFG.btSlippageBps / 100).toFixed(4)),
};
const spreadBySym = {};
for (const sym of CFG.universe) {
  const rows = snapshots.filter(s => s.sym === sym).map(s => s.spreadPct).filter(Number.isFinite);
  if (rows.length) spreadBySym[sym] = Number(pctile(rows, 50).toFixed(4));
}
fs.writeFileSync(path.join(DATA, 'cost.json'), JSON.stringify({
  ...cost, feeTakerPct: CFG.feeTakerPct, spreadBySym,
  snapshotsUsed: snapsU.length, snapshotsTotal: snapshots.length,
  source: snapsU.length
    ? `median ${snapsU.length} snapshot order book (universe saja)`
    : 'fallback konfigurasi (belum ada snapshot untuk universe)',
  computedAt: new Date().toISOString(),
}, null, 2));
const costRun = { ...cost, spreadBySym };

/* ---------- data ---------- */
const data = {};
const coverage = [];
for (const sym of CFG.universe) {
  const bars = loadCsv(sym);
  if (!bars.length) { console.warn(`[backtest] ${sym}: data kosong, dilewati`); continue; }
  data[sym] = bars;
  coverage.push({ sym, bars: bars.length, first: isoDay(bars[0].t), last: isoDay(bars[bars.length - 1].t) });
}
if (!Object.keys(data).length) {
  console.error('Tidak ada data. Jalankan dulu: node scripts/fetch_history.mjs');
  process.exit(1);
}

const capital = CFG.startCapital;
const wrap = r => ({ ...r, perf: perf({ dailyEq: r.dailyEq, trades: r.trades, capital }) });

/* ---------- backtest penuh ---------- */
console.log(`[backtest] ${Object.keys(data).length} pasangan, ${BT_START} s/d ${BT_END}, biaya spread ${cost.spreadPct}% + slippage ${cost.slippagePct}%`);
const full = wrap(runBacktest({ data, cfg: CFG, start: BT_START, end: BT_END, cost: costRun }));
const btcBars = data[CFG.universe[0]] || Object.values(data)[0];
const benchFull = buyHold(btcBars, ymd(BT_START), now, cost, CFG.feeTakerPct);
full.perf.benchmarkPct = benchFull;

/* ---------- backtest jendela forward (10 hari) ---------- */
const fwEq = readNdjson(path.join(LOGS, 'equity.ndjson'));
let wStart, wEnd;
if (fwEq.length > 1) {
  const sorted = fwEq.slice().sort((a, b) => a.ts - b.ts);
  wStart = isoDay(sorted[0].ts);
  wEnd = isoDay(sorted[sorted.length - 1].ts);
} else {
  wStart = isoDay(now - 10 * 86400);
  wEnd = BT_END;
}
const windowBt = wrap(runBacktest({ data, cfg: CFG, start: wStart, end: wEnd, cost: costRun }));
windowBt.perf.benchmarkPct = buyHold(btcBars, ymd(wStart), ymd(wEnd) + 86399, cost, CFG.feeTakerPct);

/* ---------- uji parameter (in-sample 70% / out-of-sample 30% / sensitivitas) ---------- */
function validity() {
  const D = full.dailyEq;
  const n = D.length;
  const splitT = D[Math.max(1, Math.floor(n * 0.7)) - 1].t;
  const GRID = { N: [75, 150, 300], M: [200, 400, 700], sl: [5, 8, 15, 20] };
  const run = (start, end, o = {}) => {
    const cfg = { ...CFG, ...o };
    const r = wrap(runBacktest({ data, cfg, start, end, cost: costRun }));
    return r.perf;
  };
  const score = p => (p ? p.cagrPct / Math.max(1, p.mddPct) : -9);
  const grid = [];
  for (const N of GRID.N) for (const M of GRID.M) for (const sl of GRID.sl) {
    if (M <= N) continue;
    const p = run(BT_START, isoDay(splitT), { N, M, slPct: sl });
    grid.push({ N, M, sl, cagr: p?.cagrPct, mdd: p?.mddPct, trades: p?.nTrades, score: score(p) });
  }
  const best = grid.slice().sort((a, b) => b.score - a.score)[0];
  const oos = run(isoDay(splitT), BT_END, { N: best.N, M: best.M, slPct: best.sl });
  const currentOos = run(isoDay(splitT), BT_END, {});
  const sensitivity = {};
  for (const [key, base] of [['N', CFG.N], ['M', CFG.M], ['sl', CFG.slPct]]) {
    sensitivity[key] = [-0.3, -0.15, 0, 0.15, 0.3].map(f => {
      const v = key === 'sl' ? Number((base * (1 + f)).toFixed(1)) : Math.max(5, Math.round(base * (1 + f)));
      const p = { N: CFG.N, M: CFG.M, slPct: CFG.slPct };
      if (key === 'N') p.N = v; else if (key === 'M') p.M = v; else p.slPct = v;
      if (p.M <= p.N) p.M = p.N + 10;
      const r = run(BT_START, BT_END, p);
      return { value: v, cagr: r?.cagrPct, mdd: r?.mddPct, trades: r?.nTrades };
    });
  }
  return {
    split: isoDay(splitT),
    grid,
    bestInSample: best,
    bestOos: { params: { N: best.N, M: best.M, slPct: best.sl }, ...oos },
    frozenParams: { N: CFG.N, M: CFG.M, slPct: CFG.slPct },
    frozenOos: currentOos,
    sensitivity,
    note: 'Parameter dibekukan (bukan dipilih ulang) setelah melihat uji ini. OOS = 30% terakhir.',
  };
}

console.log('[backtest] uji parameter (grid 36 kombinasi)...');
const val = validity();
fs.writeFileSync(path.join(LOGS, 'validity.json'), JSON.stringify(val, null, 2));

/* ---------- ringkasan ---------- */
const meta = {
  title: 'UAS Algoritma Trading — Bot Dry Run Indodax',
  student: process.env.STUDENT || 'Shinta Faradillah Destiany',
  nim: process.env.NIM || '25110200007',
  freeze: process.env.FREEZE_DATE || null,
  universe: Object.keys(data),
  universeNotes: coverage.map(c => ({
    sym: c.sym,
    note: `data ${c.first} s/d ${c.last} (${c.bars} bar); diukur likuiditasnya pada awal periode, bukan hanya hari ini`,
  })),
  btPeriod: `${BT_START} s/d ${BT_END}`,
  coverage,
  validity: {
    split: val.split,
    bestInSample: val.bestInSample,
    bestOos: val.bestOos,
    frozenOos: val.frozenOos,
    sensitivity: val.sensitivity,
  },
  gapNote: 'Gap = forward return - backtest pada jendela tanggal yang sama.',
};

const summary = {
  meta,
  cost: { ...cost, feeTakerPct: CFG.feeTakerPct },
  btPeriod: meta.btPeriod,
  backtest: {
    perf: full.perf,
    dailyEq: full.dailyEq.map(p => ({ t: p.t, day: p.day, equity: p.equity })),
    tradesTop: full.trades.slice().sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl)).slice(0, 20),
    openPositions: full.openPositions.map(p => ({ sym: p.sym, qty: p.qty, entryPrice: p.entryPrice, mark: p.mark, unrealized: p.unrealized })),
  },
  windowBacktest: {
    period: `${wStart} s/d ${wEnd}`,
    perf: windowBt.perf,
    dailyEq: windowBt.dailyEq.map(p => ({ t: p.t, day: p.day, equity: p.equity })),
  },
};

fs.writeFileSync(path.join(LOGS, 'backtest_result.json'), JSON.stringify({
  meta: summary.meta, cost: summary.cost, backtest: full, windowBacktest: windowBt,
}, null, 2));

fs.writeFileSync(path.join(DATA, 'backtest_summary.mjs'),
  '/* dibuat otomatis oleh scripts/backtest.mjs — jangan diedit manual */\nexport default ' + JSON.stringify(summary, null, 2) + ';\n');

const csv = ['sym,entry_t,exit_t,entry_price,exit_price,qty,fee,spread_cost,pnl,pnl_pct,bars,reason'];
for (const t of full.trades) {
  csv.push([t.sym, new Date(t.entryT * 1000).toISOString(), new Date(t.exitT * 1000).toISOString(),
    t.entryPrice, t.exitPrice, t.qty, t.fee, t.spreadCost, t.pnl.toFixed(2), t.pnlPct.toFixed(4), t.bars, t.why].join(','));
}
fs.writeFileSync(path.join(DATA, 'backtest_trades.csv'), csv.join('\n') + '\n');

/* ---------- cetak ---------- */
const p = full.perf, wp = windowBt.perf;
console.log('\n=== Backtest penuh ===');
console.log(`Return ${p.totalReturnPct.toFixed(2)}% | CAGR ${p.cagrPct.toFixed(2)}% | MaxDD ${p.mddPct.toFixed(2)}% | PF ${Number.isFinite(p.profitFactor) ? p.profitFactor.toFixed(2) : 'inf'} | Trade ${p.nTrades} | Win ${p.winRatePct.toFixed(1)}%`);
console.log(`Benchmark BTC/IDR ${benchFull?.toFixed(2)}% | Porsi biaya ${p.costSharePct?.toFixed(1)}%`);
console.log(`\n=== Backtest jendela forward ${wStart}..${wEnd} ===`);
console.log(`Return ${wp.totalReturnPct.toFixed(2)}% | MaxDD ${wp.mddPct.toFixed(2)}% | Trade ${wp.nTrades} | Benchmark ${windowBt.perf.benchmarkPct?.toFixed(2)}%`);
console.log(`\n=== Uji parameter ===`);
console.log(`Split ${val.split} | Terbaik in-sample MA${val.bestInSample.N}/${val.bestInSample.M} SL${val.bestInSample.sl} (CAGR ${val.bestInSample.cagr?.toFixed(2)}%)`);
console.log(`Frozen OOS: CAGR ${val.frozenOos?.cagrPct?.toFixed(2)}% | MDD ${val.frozenOos?.mddPct?.toFixed(2)}%`);
console.log('\nFile: logs/backtest_result.json, data/backtest_summary.mjs, data/backtest_trades.csv, logs/validity.json');
