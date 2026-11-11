/* lib/strategy.js
 * SATU-SATUNYA sumber aturan sinyal, sizing, dan pembulatan.
 * Dipakai oleh backtest (scripts/backtest.mjs), bot (lib/bot.js), dan hitung_ulang.
 *
 * Aturan (adaptasi dari strategi UTS Trend Following MA untuk pasar kripto Indodax):
 *   beli  : Close[t] > MA_N[t]  DAN  Close[t-1] <= MA_N[t-1]  DAN  MA_N[t] > MA_M[t]
 *   jual  : Close[t] < MA_N[t]
 *   stop  : harga <= entry * (1 - sl/100)  (intrabar, gap terisi di harga open)
 *   eksekusi: bar berikutnya, beli di ask / jual di bid (order book)
 */

/** Simple moving average; elemen sebelum MA penuh = NaN. */
export function sma(values, n) {
  const out = new Array(values.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

/** bars: [{t,o,h,l,c,v}] urut naik berdasarkan t (detik). */
export function computeSignals(bars, N, M) {
  const close = bars.map(b => b.c);
  const maN = sma(close, N);
  const maM = sma(close, M);
  const atv = sma(bars.map(b => b.c * b.v), 20);
  const buy = new Array(bars.length).fill(false);
  const sell = new Array(bars.length).fill(false);
  const sellM = new Array(bars.length).fill(false);
  const sellBuf = new Array(bars.length).fill(false);
  for (let i = 0; i < bars.length; i++) {
    buy[i] = i > 0
      && Number.isFinite(maN[i]) && Number.isFinite(maN[i - 1]) && Number.isFinite(maM[i])
      && close[i] > maN[i]
      && close[i - 1] <= maN[i - 1]
      && maN[i] > maM[i];
    sell[i] = Number.isFinite(maN[i]) && close[i] < maN[i];
    sellM[i] = Number.isFinite(maM[i]) && close[i] < maM[i];
  }
  return { maN, maM, atv, buy, sell, sellM };
}

/** Sinyal jual sesuai konfigurasi `exitMa` ('N' = MA cepat, 'M' = MA lambat). */
export function exitSignal(sig, exitMa) {
  return exitMa === 'M' ? sig.sellM : sig.sell;
}

/** Pembulatan kuantitas ke quantity_increment bursa (tidak pernah dibulatkan ke atas). */
export function floorToInc(qty, inc) {
  if (!(inc > 0)) return qty;
  const dec = Math.max(0, Math.round(-Math.log10(inc)));
  const f = Math.pow(10, dec);
  return Math.floor(qty * f + 1e-6) / f;
}

/**
 * Ukuran order.
 * @returns {{qty:number, notional:number, reason?:string}}
 *   qty <= 0 / reason terisi berarti order tidak layak.
 */
export function sizeOrder({ equity, cash, price, atv20, inc, cfg }) {
  const alloc = Math.min(equity * cfg.posPctEquity, cash);
  const fee = cfg.feeTakerPct / 100;
  let qty = alloc / (price * (1 + fee));
  // batas likuiditas: maks 5% rata-rata nilai transaksi 20 bar
  if (Number.isFinite(atv20) && atv20 > 0) qty = Math.min(qty, (cfg.maxTurnoverPct * atv20) / price);
  qty = floorToInc(qty, inc);
  if (!(qty > 0)) return { qty: 0, notional: 0, reason: 'kuantitas nol setelah pembulatan' };
  const notional = qty * price;
  if (notional < cfg.minOrderIDR) return { qty, notional, reason: `di bawah minimum order Rp${cfg.minOrderIDR}` };
  if (notional > cash) return { qty: 0, notional: 0, reason: 'kas tidak cukup' };
  return { qty, notional };
}

/** Tanggal batas hari WIB (UTC+7) dari timestamp detik. */
export function wibDay(tSec) {
  return new Date((tSec + 7 * 3600) * 1000).toISOString().slice(0, 10);
}

/** Waktu ISO WIB untuk log. */
export function wibIso(tSec) {
  return new Date((tSec + 7 * 3600) * 1000).toISOString().replace('Z', '+07:00');
}
