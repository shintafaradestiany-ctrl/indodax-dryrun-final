/* lib/metrics.js
 * Metrik kinerja dari data mentah (log/backtest). Semua angka dashboard
 * dihitung ulang lewat fungsi di file ini.
 */
import { wibDay } from './strategy.js';

const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
const avg = (a, f) => (a.length ? sum(a, f) / a.length : 0);

/** Statistik dari kurva ekuitas harian + daftar trade tertutup. */
export function perf({ dailyEq, trades, capital, benchmarkPct = null }) {
  if (!dailyEq || dailyEq.length < 2) return null;
  const eq = dailyEq.slice().sort((a, b) => a.t - b.t);
  const e0 = capital ?? eq[0].equity;
  const e1 = eq[eq.length - 1].equity;
  const yrs = Math.max(1 / 365, (eq[eq.length - 1].t - eq[0].t) / (365.25 * 86400));
  const cagr = e1 > 0 ? (Math.pow(e1 / e0, 1 / yrs) - 1) * 100 : -100;
  let peak = -Infinity, mdd = 0;
  for (const p of eq) { peak = Math.max(peak, p.equity); mdd = Math.max(mdd, (peak - p.equity) / peak * 100); }

  const W = trades.filter(t => t.pnl > 0);
  const L = trades.filter(t => t.pnl <= 0);
  const grossProfit = sum(W, t => t.pnl);
  const grossLoss = -sum(L, t => t.pnl);
  const totalCost = sum(trades, t => (t.fee || 0) + (t.spreadCost || 0));

  return {
    start: eq[0].t,
    end: eq[eq.length - 1].t,
    days: (eq[eq.length - 1].t - eq[0].t) / 86400,
    equityStart: e0,
    equityEnd: e1,
    totalReturnPct: (e1 / e0 - 1) * 100,
    cagrPct: cagr,
    mddPct: mdd,
    nTrades: trades.length,
    winRatePct: trades.length ? W.length / trades.length * 100 : 0,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0),
    avgWinPct: avg(W, t => t.pnlPct),
    avgLossPct: avg(L, t => t.pnlPct),
    grossProfit,
    grossLoss,
    totalCost,
    costSharePct: grossProfit > 0 ? totalCost / grossProfit * 100 : null,
    benchmarkPct,
  };
}

/** Buy & hold satu aset pada jendela yang sama, dengan biaya yang sama. */
export function buyHold(bars, t0, t1, cost, feeTakerPct) {
  const inWin = bars.filter(b => b.t >= t0 && b.t <= t1);
  if (inWin.length < 2) return null;
  const first = inWin[0], last = inWin[inWin.length - 1];
  const buyPx = first.o * (1 + (cost.spreadPct / 2 + cost.slippagePct) / 100);
  const sellPx = last.c * (1 - (cost.spreadPct / 2 + cost.slippagePct) / 100);
  const gross = sellPx / buyPx - 1;
  const fees = (feeTakerPct / 100) * 2;
  return (gross - fees) * 100;
}

/**
 * Rekonstruksi trade forward dari log order mentah (satu posisi per simbol,
 * beli lalu jual). Fee dihitung dari log order (bukan diasumsikan).
 */
export function tradesFromOrders(orders) {
  const open = {};
  const trades = [];
  const sorted = orders.slice().sort((a, b) => a.ts - b.ts);
  for (const o of sorted) {
    if (o.side === 'buy') {
      open[o.sym] = o;
    } else if (o.side === 'sell' && open[o.sym]) {
      const b = open[o.sym];
      const cost = b.notional + b.fee;
      const proceeds = o.notional - o.fee;
      trades.push({
        sym: o.sym,
        entryT: b.ts,
        exitT: o.ts,
        entryPrice: b.avgPrice,
        exitPrice: o.avgPrice,
        qty: o.qty,
        fee: b.fee + o.fee,
        spreadCost: (b.spreadCost || 0) + (o.spreadCost || 0),
        pnl: proceeds - cost,
        pnlPct: (proceeds / cost - 1) * 100,
        why: o.reason || '-',
        signalClose: b.signalClose ?? null,
        slipVsSignalPct: b.slipVsSignalPct ?? null,
      });
      delete open[o.sym];
    }
  }
  return trades;
}

/** Ekuitas harian dari log equity: ambil observasi pertama tiap hari WIB. */
export function dailyFromEquityLog(rows) {
  const byDay = new Map();
  for (const r of rows.slice().sort((a, b) => a.ts - b.ts)) {
    const d = wibDay(r.ts);
    if (!byDay.has(d)) byDay.set(d, r);
  }
  return [...byDay.values()].map(r => ({ t: r.ts, day: wibDay(r.ts), equity: r.equity, cash: r.cash, nPos: r.nPos }));
}

/** Uptime: candle yang diproses sebelum candle berikutnya tutup / candle yang seharusnya. */
export function uptime(calls, tfMin) {
  const ok = calls.filter(c => c.ok && c.candleT);
  const candles = new Set(ok.map(c => c.candleT));
  if (!calls.length) return { expected: 0, processed: 0, pct: 0, calls: 0, okCalls: ok.length };
  const ts = calls.map(c => c.ts).sort((a, b) => a - b);
  const span = ts[ts.length - 1] - ts[0];
  const expected = Math.max(1, Math.round(span / (tfMin * 60)) + 1);
  const processed = Math.min(candles.size, expected);
  return { expected, processed, pct: processed / expected * 100, calls: calls.length, okCalls: ok.length };
}
