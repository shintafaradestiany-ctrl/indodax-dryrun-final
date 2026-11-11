/* lib/exec.js
 * Model eksekusi dry run: beli menelusuri ask, jual menelusuri bid (order book live).
 * Tidak ada fill di mid/close. Dipakai bot; backtest memakai model spread+slippage
 * dari snapshot (lihat lib/backtest.js).
 */

const round = (x, d = 8) => Number(x.toFixed(d));

/** Ringkasan order book + validasi spread. */
export function bookStats(book) {
  const bid = book.bids[0], ask = book.asks[0];
  if (!bid || !ask) return { ok: false, reason: 'order book kosong' };
  const mid = (bid.p + ask.p) / 2;
  const spreadPct = (ask.p - bid.p) / mid * 100;
  return {
    ok: true,
    bestBid: bid.p,
    bestAsk: ask.p,
    bidQty: bid.q,
    askQty: ask.q,
    mid,
    spreadPct,
  };
}

/**
 * Beli dengan uang `notionalIDR`: habiskan level ask sampai uang terpakai.
 * @returns {{qty, avgPrice, notional, fee, levels, worstPrice, slipPct}|null}
 */
export function fillBuy(asks, notionalIDR, feePct) {
  if (!asks.length || !(notionalIDR > 0)) return null;
  const best = asks[0].p;
  let remaining = notionalIDR;
  let qty = 0, cost = 0, levels = 0;
  for (const lvl of asks) {
    if (remaining <= 0) break;
    const maxCost = lvl.p * lvl.q;
    const take = Math.min(remaining, maxCost);
    qty += take / lvl.p;
    cost += take;
    remaining -= take;
    levels++;
    if (remaining <= 1e-9) break;
  }
  if (!(qty > 0)) return null;
  if (remaining > 1) return null; // likuiditas tidak cukup untuk seluruh order
  const avgPrice = cost / qty;
  return {
    qty: round(qty, 8),
    avgPrice: round(avgPrice, 2),
    notional: round(cost, 2),
    fee: round(cost * feePct / 100, 2),
    levels,
    worstPrice: asks[Math.min(levels, asks.length) - 1].p,
    slipPct: (avgPrice / best - 1) * 100,
  };
}

/**
 * Jual `qty` unit: habiskan level bid.
 * @returns {{qty, avgPrice, proceeds, fee, levels, worstPrice, slipPct}|null}
 */
export function fillSell(bids, qty, feePct) {
  if (!bids.length || !(qty > 0)) return null;
  const best = bids[0].p;
  let remaining = qty, filled = 0, gross = 0, levels = 0;
  for (const lvl of bids) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, lvl.q);
    filled += take;
    gross += take * lvl.p;
    remaining -= take;
    levels++;
  }
  if (remaining > 1e-8) return null; // book tidak cukup dalam
  const avgPrice = gross / filled;
  return {
    qty: round(filled, 8),
    avgPrice: round(avgPrice, 2),
    proceeds: round(gross, 2),
    fee: round(gross * feePct / 100, 2),
    levels,
    worstPrice: bids[Math.min(levels, bids.length) - 1].p,
    slipPct: (1 - avgPrice / best) * 100,
  };
}

/**
 * Harga eksekusi backtest: referensi open candle, ditambah setengah spread
 * (beli di ask / jual di bid) dan slippage hasil pengukuran snapshot.
 */
export function btFillPrice(open, side, spreadPct, slippagePct) {
  const halfSpread = spreadPct / 2;
  const adj = (halfSpread + slippagePct) / 100;
  return side === 'buy' ? open * (1 + adj) : open * (1 - adj);
}

/** Simpan 5 level teratas untuk snapshot (bukti mentah spread). */
export function topLevels(levels, n = 5) {
  return levels.slice(0, n).map(x => [x.p, x.q]);
}
