/* lib/bot.js
 * Satu "tick" bot dry run: baca state -> ambil data live -> validasi -> hitung
 * sinyal dengan fungsi yang sama seperti backtest -> eksekusi simulasi di bid/ask
 * -> simpan state + log.
 *
 * Tidak memakai API key. Tidak ada order sungguhan.
 */
import { CFG } from './config.js';
import * as api from './indodax.js';
import { computeSignals, exitSignal, sizeOrder, wibDay, wibIso } from './strategy.js';
import { validateSeries, validateBook, closedBars } from './validate.js';
import { fillBuy, fillSell, bookStats, topLevels } from './exec.js';
import { readState, writeState, appendLogs, getFlag } from './store.js';

const initialState = nowSec => ({
  version: 1,
  cash: CFG.startCapital,
  startCapital: CFG.startCapital,
  positions: {},
  lastProcessed: {},
  day: null,
  dayStartEquity: CFG.startCapital,
  haltedDay: null,
  createdAt: nowSec,
  lastTickAt: null,
});

function equityOf(state, marks) {
  let mtm = 0;
  let n = 0;
  for (const [sym, p] of Object.entries(state.positions)) {
    const px = marks[sym] ?? p.entryPrice;
    mtm += p.qty * px;
    n++;
  }
  return { equity: state.cash + mtm, mtm, nPos: n };
}

export async function runTick({ source = 'cron' } = {}) {
  const startedAt = Date.now();
  const serverMs = await api.serverTime();
  const nowSec = Math.floor(serverMs / 1000);

  let state = await readState() || initialState(nowSec);

  const callLog = {
    ts: nowSec,
    iso: wibIso(nowSec),
    source,
    ok: false,
    status: 'started',
    candleT: null,
    equity: null,
    orders: 0,
    errors: [],
    durationMs: 0,
  };

  /* ---------- kill switch (env atau flag storage, tanpa deploy ulang) ---------- */
  let kill = process.env.KILL_SWITCH === '1';
  if (!kill) { try { kill = (await getFlag('kill')) === '1'; } catch { /* storage opsional */ } }
  if (kill) {
    callLog.status = 'kill_switch';
    callLog.errors.push('kill switch aktif: tidak ada keputusan diambil');
    callLog.durationMs = Date.now() - startedAt;
    await appendLogs('calls', [callLog]);
    return { ok: false, status: 'kill_switch', killSwitch: true };
  }

  /* ---------- data referensi ---------- */
  const pairMap = await api.getPairs();
  const incMap = await api.priceIncrements();

  const marks = {};
  const snapshots = [];
  const errors = [];
  const symbols = [];

  for (const sym of CFG.universe) {
    const pairId = sym.toLowerCase();
    const meta = pairMap.get(pairId) || pairMap.get(pairId.replace('idr', '_idr'));
    if (!meta) { errors.push({ sym, reason: 'pasangan tidak ada di /api/pairs' }); continue; }
    if (Number(meta.is_maintenance) || Number(meta.is_market_suspended)) {
      errors.push({ sym, reason: 'pasangan maintenance/suspended' });
      continue;
    }
    const inc = incMap.get(pairId.replace('idr', '_idr')) || Number(meta.pricescale) || 1;

    let bars = [], book = null, series = null, stats = null, reasons = [];
    try {
      const from = nowSec - (CFG.M + 40) * CFG.tfMin * 60;
      const h = await api.history(sym, CFG.tfMin, from, nowSec);
      bars = closedBars(h.bars, CFG.tfMin, nowSec);
      series = validateSeries(bars, CFG, CFG.M + 2, nowSec);
      book = await api.depth(meta.id || pairId);

      const bs = bookStats(book);
      if (bs.ok) {
        snapshots.push({
          ts: nowSec,
          iso: wibIso(nowSec),
          sym,
          bid: bs.bestBid,
          ask: bs.bestAsk,
          mid: bs.mid,
          spreadPct: Number(bs.spreadPct.toFixed(4)),
          bids: topLevels(book.bids),
          asks: topLevels(book.asks),
        });
      } else {
        errors.push({ sym, reason: bs.reason });
      }
      const vb = validateBook(book, CFG);
      stats = vb.stats;

      reasons = [...series.reasons, ...vb.reasons];
      if (series.ok && vb.ok && bars.length) {
        marks[sym] = vb.stats.bestBid; // posisi dinilai di best bid
      } else if (bars.length) {
        marks[sym] = bars[bars.length - 1].c;
      }
      symbols.push({ sym, meta, inc, bars, book, series, stats });
    } catch (e) {
      errors.push({ sym, reason: `api error: ${e.message}` });
    }
  }

  /* ---------- hari WIB & daily loss limit ---------- */
  const day = wibDay(nowSec);
  let eq = equityOf(state, marks);
  if (state.day !== day) {
    state.day = day;
    state.dayStartEquity = eq.equity;
    state.haltedDay = null;
  }
  const dailyLossPct = state.dayStartEquity > 0 ? (eq.equity / state.dayStartEquity - 1) * 100 : 0;
  if (dailyLossPct <= -CFG.dailyLossLimitPct) state.haltedDay = day;
  let entriesBlocked = state.haltedDay === day;

  const orders = [];
  const processedCandles = new Set();
  let lastCandleT = null;

  /* ---------- 1) EXIT lebih dulu ---------- */
  for (const item of symbols) {
    const { sym, bars, book, stats } = item;
    const pos = state.positions[sym];
    if (!pos || !bars.length || !book) continue;
    const i = bars.length - 1;
    const bar = bars[i];
    if (!(bar.v > 0)) { errors.push({ sym, reason: 'volume nol, exit ditunda' }); continue; }
    if (!stats) { errors.push({ sym, reason: 'book kosong, exit ditunda' }); continue; }

    const sig = computeSignals(bars, CFG.N, CFG.M);
    const doExit = exitSignal(sig, CFG.exitMa)[i];
    const whySignal = doExit && bar.t > (pos.entryCandleT || 0) ? `Close<MA_${CFG.exitMa}` : null;
    const whyStop = CFG.slPct > 0 && (stats.bestBid <= pos.stopPrice || bar.l <= pos.stopPrice) ? 'Stop Loss' : null;
    const why = whyStop || whySignal;
    if (!why) continue;

    const fill = fillSell(book.bids, pos.qty, CFG.feeTakerPct);
    if (!fill) { errors.push({ sym, reason: 'bid tidak cukup dalam untuk exit' }); continue; }
    const plannedQty = pos.qty;
    const proceeds = fill.proceeds - fill.fee;
    const pnl = proceeds - pos.cost;
    state.cash += proceeds;
    delete state.positions[sym];

    orders.push({
      ts: nowSec,
      iso: wibIso(nowSec),
      sym,
      side: 'sell',
      qty: fill.qty,
      plannedQty,
      price: fill.avgPrice,
      notional: fill.proceeds,
      fee: fill.fee,
      feePct: CFG.feeTakerPct,
      bestBid: stats.bestBid,
      bestAsk: stats.bestAsk,
      spreadPct: Number(stats.spreadPct.toFixed(4)),
      levels: fill.levels,
      slipPct: Number(fill.slipPct.toFixed(4)),
      signalClose: bar.c,
      slipVsSignalPct: Number((fill.avgPrice / bar.c - 1) * 100).toFixed(4),
      candleT: bar.t,
      reason: why,
      pnl: Number(pnl.toFixed(2)),
      pnlPct: Number((pnl / pos.cost * 100).toFixed(4)),
      entryT: pos.entryT,
      entryPrice: pos.entryPrice,
      holdBars: Math.round((nowSec - pos.entryT) / (CFG.tfMin * 60)),
    });

    if (stats.spreadPct > CFG.maxSpreadPct) {
      errors.push({ sym, reason: `exit dieksekusi saat spread ${stats.spreadPct.toFixed(2)}% (> ${CFG.maxSpreadPct}%)` });
    }
  }

  /* ---------- 2) ENTRY ---------- */
  /* ulangi cek daily loss setelah exit (harga jual bisa memperburuk ekuitas) */
  eq = equityOf(state, marks);
  if (eq.equity < state.dayStartEquity * (1 - CFG.dailyLossLimitPct / 100)) state.haltedDay = day;
  entriesBlocked = state.haltedDay === day;

  for (const item of symbols) {
    const { sym, bars, book, stats, inc, series } = item;
    if (!bars.length) continue;
    const i = bars.length - 1;
    const bar = bars[i];
    lastCandleT = lastCandleT == null ? bar.t : Math.max(lastCandleT, bar.t);

    if (!series.ok) { errors.push({ sym, reason: `data tidak valid: ${series.reasons.join('; ')}` }); continue; }
    if (!stats) { errors.push({ sym, reason: 'order book kosong' }); continue; }

    const prevProcessed = state.lastProcessed[sym];
    const isNewCandle = !(prevProcessed >= bar.t);
    state.lastProcessed[sym] = bar.t;
    if (!isNewCandle) continue; // idempotency: candle ini sudah diproses
    processedCandles.add(bar.t);
    if (state.positions[sym]) continue;

    if (prevProcessed) {
      const missed = Math.round((bar.t - prevProcessed) / (CFG.tfMin * 60)) - 1;
      if (missed > 0) errors.push({ sym, reason: `${missed} candle terlewat sejak tick terakhir` });
    }

    const sig = computeSignals(bars, CFG.N, CFG.M);
    if (!sig.buy[i]) continue;

    if (entriesBlocked) {
      errors.push({ sym, reason: `daily loss limit ${dailyLossPct.toFixed(2)}% tercapai, entry diblokir sampai besok` });
      state.lastProcessed[sym] = bar.t;
      continue;
    }
    if (Object.keys(state.positions).length >= CFG.maxPos) {
      errors.push({ sym, reason: `posisi maksimum (${CFG.maxPos}) tercapai` });
      state.lastProcessed[sym] = bar.t;
      continue;
    }
    if (stats.spreadPct > CFG.maxSpreadPct) {
      errors.push({ sym, reason: `spread ${stats.spreadPct.toFixed(2)}% > ${CFG.maxSpreadPct}%` });
      state.lastProcessed[sym] = bar.t;
      continue;
    }

    eq = equityOf(state, marks);
    const plan = sizeOrder({ equity: eq.equity, cash: state.cash, price: stats.bestAsk, atv20: sig.atv[i - 1], inc, cfg: CFG });
    if (!(plan.qty > 0)) {
      errors.push({ sym, reason: `order dilewati: ${plan.reason || 'qty 0'}` });
      state.lastProcessed[sym] = bar.t;
      continue;
    }
    if (plan.notional > state.cash) {
      errors.push({ sym, reason: 'kas tidak cukup' });
      state.lastProcessed[sym] = bar.t;
      continue;
    }

    const fill = fillBuy(book.asks, plan.notional, CFG.feeTakerPct);
    if (!fill || fill.notional < CFG.minOrderIDR) {
      errors.push({ sym, reason: 'ask tidak cukup dalam untuk entry' });
      state.lastProcessed[sym] = bar.t;
      continue;
    }
    const total = fill.notional + fill.fee;
    if (total > state.cash) {
      errors.push({ sym, reason: 'kas tidak cukup setelah slippage' });
      state.lastProcessed[sym] = bar.t;
      continue;
    }

    state.cash -= total;
    state.positions[sym] = {
      qty: fill.qty,
      entryPrice: fill.avgPrice,
      cost: total,
      fee: fill.fee,
      entryT: nowSec,
      entryCandleT: bar.t,
      stopPrice: fill.avgPrice * (1 - CFG.slPct / 100),
      signalClose: bar.c,
    };

    orders.push({
      ts: nowSec,
      iso: wibIso(nowSec),
      sym,
      side: 'buy',
      qty: fill.qty,
      plannedQty: plan.qty,
      price: fill.avgPrice,
      notional: fill.notional,
      fee: fill.fee,
      feePct: CFG.feeTakerPct,
      bestBid: stats.bestBid,
      bestAsk: stats.bestAsk,
      spreadPct: Number(stats.spreadPct.toFixed(4)),
      levels: fill.levels,
      slipPct: Number(fill.slipPct.toFixed(4)),
      signalClose: bar.c,
      slipVsSignalPct: Number((fill.avgPrice / bar.c - 1) * 100).toFixed(4),
      candleT: bar.t,
      reason: 'cross-up MA',
      entryDelaySec: nowSec - bar.t,
      maN: Number(sig.maN[i].toFixed(2)),
      maM: Number(sig.maM[i].toFixed(2)),
      atv20: Number(sig.atv[i - 1].toFixed(0)),
    });
    marks[sym] = stats.bestBid;
  }

  /* ---------- 3) simpan ---------- */
  eq = equityOf(state, marks);
  state.lastTickAt = nowSec;
  await writeState(state);

  const finalDailyLoss = state.dayStartEquity > 0 ? (eq.equity / state.dayStartEquity - 1) * 100 : 0;
  const equityRow = { ts: nowSec, iso: wibIso(nowSec), equity: Number(eq.equity.toFixed(2)), cash: Number(state.cash.toFixed(2)), nPos: eq.nPos, day, dailyLossPct: Number(finalDailyLoss.toFixed(3)), halted: entriesBlocked };

  callLog.ok = errors.filter(e => /api error|data tidak valid|book kosong|pasangan/.test(e.reason)).length === 0;
  callLog.status = 'done';
  callLog.candleT = lastCandleT;
  callLog.equity = equityRow.equity;
  callLog.orders = orders.length;
  callLog.errors = errors;
  callLog.durationMs = Date.now() - startedAt;
  callLog.processed = processedCandles.size;

  const errorRows = errors.map(e => ({ ts: nowSec, iso: wibIso(nowSec), ...e }));
  const candleRows = symbols
    .filter(s => s.series && s.series.ok && s.bars.length && processedCandles.has(s.bars[s.bars.length - 1].t))
    .map(s => {
      const b = s.bars[s.bars.length - 1];
      return { ts: nowSec, sym: s.sym, t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v };
    });

  await appendLogs('calls', [callLog]);
  await appendLogs('orders', orders);
  await appendLogs('equity', [equityRow]);
  if (snapshots.length) await appendLogs('snapshots', snapshots);
  if (errorRows.length) await appendLogs('errors', errorRows);
  if (candleRows.length) await appendLogs('candles', candleRows);

  return {
    ok: callLog.ok,
    status: callLog.status,
    equity: equityRow.equity,
    cash: equityRow.cash,
    nPos: eq.nPos,
    orders: orders.map(o => ({ sym: o.sym, side: o.side, qty: o.qty, price: o.price, fee: o.fee, reason: o.reason })),
    errors,
    durationMs: callLog.durationMs,
    candleT: lastCandleT,
    dailyLossPct: equityRow.dailyLossPct,
    halted: entriesBlocked,
  };
}
