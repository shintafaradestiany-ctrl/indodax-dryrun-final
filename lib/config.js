/* lib/config.js
 * Konfigurasi tunggal untuk backtest dan bot. Nilai default = nilai yang dibekukan
 * pada freeze date. Backtest memakai konfigurasi yang sama dengan bot supaya
 * sinyal yang dihasilkan benar-benar identik.
 */
const num = (v, d) => (v === undefined || v === null || v === '' || Number.isNaN(Number(v)) ? d : Number(v));

export const CFG = {
  /* --- Strategi (Trend Following MA) --- */
  N: num(process.env.STRATEGY_N, 150),          // MA cepat (bar)
  M: num(process.env.STRATEGY_M, 400),          // MA lambat / filter tren (bar)
  slPct: num(process.env.STRATEGY_SL, 8),       // stop loss dari harga masuk (%)
  exitMa: (process.env.STRATEGY_EXIT_MA || 'M').toUpperCase(), // 'N' = exit di MA cepat (UTS), 'M' = MA lambat
  tfMin: num(process.env.TF_MINUTES, 60),       // timeframe candle (menit)

  /* --- Sizing & risiko --- */
  startCapital: num(process.env.START_CAPITAL, 100_000_000),
  maxPos: num(process.env.MAX_POSITIONS, 5),
  posPctEquity: num(process.env.POS_PCT_EQUITY, 0.2),   // maks 20% ekuitas per posisi = 1/maxPos
  maxTurnoverPct: num(process.env.MAX_TURNOVER_PCT, 0.05), // maks 5% rata-rata nilai transaksi 20 bar
  dailyLossLimitPct: num(process.env.DAILY_LOSS_LIMIT_PCT, 3),

  /* --- Biaya & eksekusi --- */
  feeTakerPct: num(process.env.FEE_TAKER_PCT, 0.3), // all-in per sisi (taker + pajak)
  minOrderIDR: num(process.env.MIN_ORDER_IDR, 25_000), // pakai yang lebih ketat (mode Pro)
  maxSpreadPct: num(process.env.MAX_SPREAD_PCT, 2),

  /* --- Backtest: fallback bila snapshot belum ada --- */
  btSpreadBps: num(process.env.BT_SPREAD_BPS, 10),   // median spread dari snapshot (bp dari mid)
  btSlippageBps: num(process.env.BT_SLIPPAGE_BPS, 5),

  /* --- Universe --- */
  universe: (process.env.UNIVERSE || 'BTCIDR,ETHIDR,SOLIDR,DOGEIDR,XRPIDR,ADAIDR,BNBIDR,LINKIDR')
    .split(',').map(s => s.trim().toUpperCase()).filter(Boolean),
};

export const FROZEN = Object.freeze({
  N: CFG.N, M: CFG.M, slPct: CFG.slPct, exitMa: CFG.exitMa, tfMin: CFG.tfMin,
  maxPos: CFG.maxPos, posPctEquity: CFG.posPctEquity,
  maxTurnoverPct: CFG.maxTurnoverPct, dailyLossLimitPct: CFG.dailyLossLimitPct,
  feeTakerPct: CFG.feeTakerPct, minOrderIDR: CFG.minOrderIDR,
  maxSpreadPct: CFG.maxSpreadPct, universe: CFG.universe.slice(),
});
