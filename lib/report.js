/* lib/report.js
 * Menyusun angka dashboard dari log mentah. Semua metrik forward test dihitung
 * di sini supaya bisa direproduksi (tidak ada angka yang diketik manual).
 */
import { perf, tradesFromOrders, dailyFromEquityLog, uptime, buyHold } from './metrics.js';
import { wibDay } from './strategy.js';

export const pctile = (arr, p) => {
  if (!arr.length) return null;
  const s = arr.slice().sort((a, b) => a - b);
  const k = (s.length - 1) * p / 100, f = Math.floor(k), c = Math.ceil(k);
  return s[f] + (s[c] - s[f]) * (k - f);
};

/** Rekonstruksi rangkaian candle dari log (satu baris = satu candle tertutup). */
export function candlesFromLog(rows) {
  const map = new Map();
  for (const r of rows || []) map.set(`${r.sym}:${r.t}`, r);
  const out = {};
  for (const r of map.values()) {
    (out[r.sym] ||= []).push({ t: r.t, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v });
  }
  for (const s of Object.keys(out)) out[s].sort((a, b) => a.t - b.t);
  return out;
}

/** Statistik forward test dari log mentah. */
export function forwardStats({ orders = [], equity = [], calls = [], errors = [], snapshots = [], candles = [] }, cfg) {
  const trades = tradesFromOrders(orders);
  const dailyEq = dailyFromEquityLog(equity);

  const windowStart = dailyEq.length ? dailyEq[0].t : (calls[0]?.ts ?? null);
  const windowEnd = dailyEq.length ? dailyEq[dailyEq.length - 1].t : (calls[calls.length - 1]?.ts ?? null);
  const series = candlesFromLog(candles);
  const btcSym = cfg.universe[0];
  const benchmarkPct = series[btcSym]?.length
    ? buyHold(series[btcSym], windowStart, windowEnd, { spreadPct: cfg.btSpreadBps / 100, slippagePct: cfg.btSlippageBps / 100 }, cfg.feeTakerPct)
    : null;

  const p = dailyEq.length >= 2 ? perf({ dailyEq, trades, capital: cfg.startCapital, benchmarkPct }) : null;
  const spreads = snapshots.map(s => s.spreadPct).filter(Number.isFinite);
  const slips = orders.map(o => Math.abs(o.slipPct ?? 0)).filter(Number.isFinite);
  const feesPaid = orders.reduce((s, o) => s + (o.fee || 0), 0);
  const spreadCost = orders.reduce((s, o) => s + Math.abs((o.price - (o.side === 'buy' ? o.bestAsk : o.bestBid)) * o.qty), 0);

  const ops = {
    uptime: uptime(calls, cfg.tfMin),
    calls: calls.length,
    okCalls: calls.filter(c => c.ok).length,
    lastCall: calls.length ? calls[calls.length - 1].ts : null,
    errorCount: errors.length,
    killUses: calls.filter(c => c.status === 'kill_switch').length,
  };

  return {
    perf: p,
    trades,
    orders,
    dailyEq,
    windowStart,
    windowEnd,
    benchmarkPct,
    ops,
    dataQuality: {
      snapshotCount: snapshots.length,
      medianSpreadPct: pctile(spreads, 50),
      p90SpreadPct: pctile(spreads, 90),
      medianSlipPct: pctile(slips, 50),
      p90SlipPct: pctile(slips, 90),
      feesPaid: Number(feesPaid.toFixed(2)),
      spreadCost: Number(spreadCost.toFixed(2)),
      rejectedOrders: errors.filter(e => /dilewati|tidak cukup|ditolak|di bawah minimum|maksimum/.test(e.reason || '')).length,
    },
    errors,
    byDay: Object.fromEntries(dailyEq.map(r => [r.day, r.equity])),
  };
}

/** Metadata umum + periode backtest. */
export function baseMeta(cfg, opts = {}) {
  return {
    title: opts.title || 'UAS Algoritma Trading — Bot Dry Run Indodax',
    student: opts.student || 'Shinta Faradillah Destiany',
    nim: opts.nim || '25110200007',
    freeze: opts.freeze || null,
    generatedAt: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' }) + ' WIB',
    tfMin: cfg.tfMin,
    capital: cfg.startCapital,
    universe: cfg.universe,
    universeNotes: opts.universeNotes || null,
    params: {
      N: cfg.N, M: cfg.M, slPct: cfg.slPct, maxPos: cfg.maxPos,
      posPctEquity: cfg.posPctEquity, maxTurnoverPct: cfg.maxTurnoverPct,
      dailyLossLimitPct: cfg.dailyLossLimitPct, minOrderIDR: cfg.minOrderIDR,
    },
    cost: { feeTakerPct: cfg.feeTakerPct, spreadPct: opts.spreadPct ?? cfg.btSpreadBps / 100, slippagePct: opts.slippagePct ?? cfg.btSlippageBps / 100 },
    btPeriod: opts.btPeriod || '',
  };
}

/** Data dashboard lengkap (offline): backtest penuh + backtest jendela + forward. */
export function buildDashboardData({ summary, logs, cfg, meta }) {
  const fw = forwardStats(logs, cfg);
  const bt = summary?.backtest || null;
  const wb = summary?.windowBacktest || null;
  return {
    meta: {
      ...baseMeta(cfg, {
        ...meta,
        spreadPct: summary?.cost?.spreadPct,
        slippagePct: summary?.cost?.slippagePct,
        btPeriod: summary?.btPeriod,
      }),
      forwardStart: fw.dailyEq.length ? wibDay(fw.dailyEq[0].t) : null,
      forwardEnd: fw.dailyEq.length ? wibDay(fw.dailyEq[fw.dailyEq.length - 1].t) : null,
    },
    backtest: bt,
    windowBt: wb,
    forward: { perf: fw.perf, trades: fw.trades, dailyEq: fw.dailyEq, benchmarkPct: fw.benchmarkPct },
    ops: fw.ops,
    errors: fw.errors,
    dataQuality: fw.dataQuality,
  };
}
