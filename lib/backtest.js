/* lib/backtest.js
 * Backtest portofolio long-only yang memakai fungsi sinyal & sizing yang sama
 * dengan bot (lib/strategy.js). Eksekusi memakai model spread + slippage hasil
 * pengukuran snapshot order book (bukan mid, bukan close).
 *
 * Urutan tiap bar (identik dengan urutan keputusan bot):
 *   1. exit sinyal / stop loss  -> jual di bid
 *   2. entry dari sinyal bar sebelumnya -> beli di ask
 *   3. mark-to-market (posisi dinilai di bid)
 *   4. hitung sinyal close bar ini (dieksekusi bar berikutnya)
 */
import { computeSignals, sizeOrder, wibDay, exitSignal } from './strategy.js';
import { btFillPrice } from './exec.js';

const toTs = d => (typeof d === 'number' ? d : Math.floor(Date.parse(d + 'T00:00:00Z') / 1000));

export function runBacktest({ data, cfg, start, end, cost, capital }) {
  const spreadPct = cost.spreadPct;
  const slippagePct = cost.slippagePct;
  /* spread per pasangan bila terukur (snapshot), jatuh ke median universe */
  const spreadOf = s => (cost.spreadBySym && Number.isFinite(cost.spreadBySym[s]) ? cost.spreadBySym[s] : spreadPct);
  const cap = capital ?? cfg.startCapital;
  const t0 = toTs(start), t1 = toTs(end) + 86399;

  const syms = Object.keys(data).filter(s => data[s] && data[s].length > cfg.M + 2);
  const X = {};
  for (const s of syms) {
    const bars = data[s].slice().sort((a, b) => a.t - b.t);
    const sig = computeSignals(bars, cfg.N, cfg.M);
    X[s] = {
      bars,
      index: new Map(bars.map((b, i) => [b.t, i])),
      sig,
      sell: exitSignal(sig, cfg.exitMa),
    };
  }

  const tsSet = new Set();
  for (const s of syms) for (const b of X[s].bars) if (b.t >= t0 && b.t <= t1) tsSet.add(b.t);
  const timeline = [...tsSet].sort((a, b) => a - b);

  let cash = cap;
  const positions = {};
  const trades = [];
  const dailyEq = [];
  const pending = [];            // {sym, at} entry yang menunggu eksekusi
  const lastClose = {};
  let day = null, dayStartEq = null, haltedDay = null, peak = cap;

  const equityNow = t => {
    let mtm = 0;
    for (const s in positions) {
      const px = lastClose[s] ?? positions[s].entryPrice;
      mtm += positions[s].qty * px;
    }
    return { equity: cash + mtm, mtm };
  };

  const sellAt = (sym, rawPrice, t, why, signalClose) => {
    const p = positions[sym];
    const px = btFillPrice(rawPrice, 'sell', spreadOf(sym), slippagePct);
    const gross = p.qty * px;
    const fee = gross * cfg.feeTakerPct / 100;
    const proceeds = gross - fee;
    cash += proceeds;
    const fillCost = p.qty * Math.abs(px - rawPrice);
    const trade = {
      sym,
      entryT: p.entryT,
      exitT: t,
      entryPrice: p.entryPrice,
      exitPrice: px,
      qty: p.qty,
      notionalEntry: p.qty * p.entryPrice,
      notionalExit: gross,
      fee: p.fee + fee,
      spreadCost: p.spreadCost + fillCost,
      pnl: proceeds - p.cost,
      pnlPct: (proceeds - p.cost) / p.cost * 100,
      bars: Math.round((t - p.entryT) / (cfg.tfMin * 60)),
      why,
      signalClose: signalClose ?? null,
      slipVsSignalPct: signalClose ? (px / signalClose - 1) * 100 : null,
    };
    trades.push(trade);
    delete positions[sym];
  };

  const buyAt = (sym, rawPrice, t) => {
    if (positions[sym]) return;
    if (Object.keys(positions).length >= cfg.maxPos) return;
    if (haltedDay === wibDay(t)) return;
    const i = X[sym].index.get(t);
    if (i === undefined || i < 1) return;
    const bar = X[sym].bars[i];
    if (!(bar.v > 0)) return;
    const px = btFillPrice(rawPrice, 'buy', spreadOf(sym), slippagePct);
    const equity = equityNow(t).equity;
    const atv20 = X[sym].sig.atv[i - 1];
    const size = sizeOrder({ equity, cash, price: px, atv20, inc: 1e-8, cfg });
    if (!(size.qty > 0) || size.reason) return;
    const gross = size.qty * px;
    const fee = gross * cfg.feeTakerPct / 100;
    cash -= gross + fee;
    positions[sym] = {
      sym,
      qty: size.qty,
      entryPrice: px,
      cost: gross + fee,
      fee,
      spreadCost: size.qty * Math.abs(px - rawPrice),
      entryT: t,
      stop: px * (1 - cfg.slPct / 100),
    };
  };

  for (const t of timeline) {
    const d = wibDay(t);

    /* 0) pergantian hari WIB: kunci baseline equity harian */
    if (d !== day) {
      day = d;
      const eq = equityNow(t).equity;
      dayStartEq = eq;
      haltedDay = null;
      dailyEq.push({ t, day: d, equity: eq });
    }

    /* 1) exit sinyal / stop loss (dieksekusi di bar ini) */
    for (const s of Object.keys(positions)) {
      const i = X[s].index.get(t);
      if (i === undefined || i < 1) continue;
      const p = positions[s];
      if (!(X[s].bars[i].v > 0)) continue;
      if (p.exitAt === t) {
        sellAt(s, X[s].bars[i].o, t, `Close<MA_${cfg.exitMa}`, X[s].bars[i - 1].c);
        continue;
      }
      if (cfg.slPct > 0 && t > p.entryT) {
        const bar = X[s].bars[i];
        if (bar.l <= p.stop) {
          sellAt(s, Math.min(bar.o, p.stop), t, 'Stop Loss', X[s].bars[i - 1].c);
        }
      }
    }

    /* 2) entry dari sinyal bar sebelumnya */
    const todays = pending.filter(x => x.at === t).sort((a, b) => a.score - b.score || (a.s < b.s ? -1 : 1));
    for (const e of todays) buyAt(e.s, e.open, t);
    for (let k = pending.length - 1; k >= 0; k--) if (pending[k].at <= t) pending.splice(k, 1);

    /* 3) mark-to-market di close */
    for (const s of syms) {
      const i = X[s].index.get(t);
      if (i !== undefined) lastClose[s] = X[s].bars[i].c;
    }
    const { equity } = equityNow(t);
    peak = Math.max(peak, equity);
    if (dayStartEq != null && equity < dayStartEq * (1 - cfg.dailyLossLimitPct / 100)) haltedDay = day;

    /* 4) sinyal close bar ini */
    for (const s of syms) {
      const i = X[s].index.get(t);
      if (i === undefined) continue;
      const { bars, sig } = X[s];
      if (positions[s]) {
        if (X[s].sell[i] && !positions[s].exitAt) {
          const nx = bars[i + 1];
          positions[s].exitAt = nx ? nx.t : Infinity;
        }
      } else if (sig.buy[i] && bars[i + 1]) {
        pending.push({
          s,
          at: bars[i + 1].t,
          open: bars[i + 1].o,
          score: bars[i].c / sig.maN[i] - 1, // paling dekat MA diprioritaskan
        });
      }
    }
  }

  /* posisi yang masih terbuka dinilai di bid terakhir */
  const openPositions = Object.keys(positions).map(s => {
    const p = positions[s];
    const px = lastClose[s] ?? p.entryPrice;
    const bid = px * (1 - (spreadOf(s) / 2 + slippagePct) / 100);
    return { ...p, mark: bid, unrealized: p.qty * bid * (1 - cfg.feeTakerPct / 100) - p.cost };
  });

  return {
    syms,
    trades,
    dailyEq,
    openPositions,
    start: t0,
    end: t1,
    params: { N: cfg.N, M: cfg.M, slPct: cfg.slPct, exitMa: cfg.exitMa, maxPos: cfg.maxPos },
    cost: { spreadPct, slippagePct, feeTakerPct: cfg.feeTakerPct },
    finalEquity: equityNow(t1).equity,
  };
}
