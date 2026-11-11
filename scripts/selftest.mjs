/* scripts/selftest.mjs — uji unit logika inti (tanpa jaringan).
 * node scripts/selftest.mjs
 */
import assert from 'node:assert';
import { sma, computeSignals, sizeOrder, floorToInc } from '../lib/strategy.js';
import { fillBuy, fillSell, btFillPrice, bookStats } from '../lib/exec.js';
import { validateSeries, closedBars } from '../lib/validate.js';
import { perf, tradesFromOrders } from '../lib/metrics.js';

let ok = 0;
const t = (name, fn) => { fn(); ok++; console.log('  ok ' + name); };

const CFG = {
  N: 3, M: 5, slPct: 20, tfMin: 60, maxPos: 5, posPctEquity: 0.2,
  maxTurnoverPct: 0.05, feeTakerPct: 0.3, minOrderIDR: 25000,
  maxSpreadPct: 2, btSpreadBps: 10, btSlippageBps: 5, dailyLossLimitPct: 3, startCapital: 1e8,
};

t('SMA hanya terisi setelah n bar', () => {
  const a = sma([1, 2, 3, 4], 3);
  assert.ok(Number.isNaN(a[0]) && Number.isNaN(a[1]));
  assert.strictEqual(a[2], 2);
  assert.strictEqual(a[3], 3);
});

t('sinyal beli hanya saat cross-up dan MA_N > MA_M', () => {
  const bars = [];
  let px = 100;
  for (let i = 0; i < 400; i++) {
    // tren naik panjang (MA cepat > MA lambat), pullback tajam, lalu pemulihan
    const drift = i < 300 ? 0.004 : i < 305 ? -0.01 : 0.006;
    px *= 1 + drift;
    bars.push({ t: i * 3600, o: px, h: px * 1.01, l: px * 0.99, c: px, v: 10 });
  }
  const s = computeSignals(bars, 20, 50);
  assert.ok(s.buy.some(Boolean), 'harus ada cross-up saat tren masih naik');
  assert.ok(!s.buy[0]);
});

t('pembulatan kuantitas tidak pernah ke atas', () => {
  assert.strictEqual(floorToInc(1.23456789, 1e-8), 1.23456789);
  assert.strictEqual(floorToInc(0.000000019, 1e-8), 0.00000001);
  assert.strictEqual(floorToInc(123.999, 1), 123);
});

t('sizing menghormati 20% ekuitas dan minimum order', () => {
  const s = sizeOrder({ equity: 1e8, cash: 1e8, price: 1e9, atv20: 1e12, inc: 1e-8, cfg: CFG });
  assert.ok(s.qty * 1e9 <= 2e7 * 1.01);
  assert.ok(s.qty > 0);
  const small = sizeOrder({ equity: 1e8, cash: 10000, price: 1e9, atv20: 1e12, inc: 1e-8, cfg: CFG });
  assert.ok(small.qty === 0 || small.reason);
});

t('fill beli menelusuri beberapa level ask dan tidak memakai mid', () => {
  const asks = [{ p: 100, q: 0.05 }, { p: 101, q: 1 }, { p: 102, q: 1 }];
  const f = fillBuy(asks, 150, 0.3);
  assert.ok(f.levels >= 2);
  assert.ok(f.avgPrice > 100 && f.avgPrice <= 102);
  assert.ok(f.fee > 0);
});

t('fill jual menelusuri bid; book tipis = gagal', () => {
  const bids = [{ p: 100, q: 0.5 }, { p: 99, q: 0.5 }];
  const f = fillSell(bids, 0.8, 0.3);
  assert.ok(f.avgPrice < 100);
  assert.strictEqual(fillSell(bids, 2, 0.3), null);
});

t('spread dihitung dari bid/ask, book kosong ditolak', () => {
  const s = bookStats({ bids: [{ p: 100, q: 1 }], asks: [{ p: 101, q: 1 }] });
  assert.ok(Math.abs(s.spreadPct - 1 / 100.5 * 100) < 1e-9);
  assert.strictEqual(bookStats({ bids: [], asks: [] }).ok, false);
});

t('harga backtest beli di atas open, jual di bawah open', () => {
  assert.ok(btFillPrice(1000, 'buy', 0.1, 0.05) > 1000);
  assert.ok(btFillPrice(1000, 'sell', 0.1, 0.05) < 1000);
});

t('candle berjalan dibuang', () => {
  const now = 1000 * 3600;
  const bars = [{ t: now - 7200, o: 1, h: 1, l: 1, c: 1, v: 1 }, { t: now - 3600, o: 1, h: 1, l: 1, c: 1, v: 1 }, { t: now, o: 1, h: 1, l: 1, c: 1, v: 1 }];
  assert.strictEqual(closedBars(bars, 60, now + 60).length, 2);
});

t('validasi menolak candle hilang, volume nol di candle terakhir, data basi', () => {
  const now = Math.floor(Date.now() / 1000);
  const good = Array.from({ length: 10 }, (_, i) => ({
    t: now - (10 - i) * 3600, o: 100, h: 101, l: 99, c: 100, v: 5,
  }));
  assert.ok(validateSeries(good, { ...CFG, M: 5 }, 7).ok);
  const gap = good.filter((_, i) => i !== 3);
  assert.ok(!validateSeries(gap, { ...CFG, M: 5 }, 7).ok);
  const zeroLast = good.map((b, i) => (i === 9 ? { ...b, v: 0 } : b));
  assert.ok(!validateSeries(zeroLast, { ...CFG, M: 5 }, 7).ok);
  const zeroMid = good.map((b, i) => (i === 5 ? { ...b, v: 0 } : b));
  const mid = validateSeries(zeroMid, { ...CFG, M: 5 }, 7);
  assert.ok(mid.ok, 'jam tanpa transaksi di tengah jendela tidak membatalkan seri');
  assert.strictEqual(mid.zeroVolumeBars, 1);
  const stale = good.map(b => ({ ...b, t: b.t - 100 * 3600 }));
  assert.ok(!validateSeries(stale, { ...CFG, M: 5 }, 7).ok);
});

t('metrik: total return, drawdown, profit factor', () => {
  const dailyEq = [{ t: 0, equity: 100 }, { t: 86400, equity: 120 }, { t: 172800, equity: 90 }];
  const trades = [
    { pnl: 30, pnlPct: 30, fee: 1, spreadCost: 1 },
    { pnl: -10, pnlPct: -10, fee: 1, spreadCost: 1 },
  ];
  const p = perf({ dailyEq, trades, capital: 100 });
  assert.ok(Math.abs(p.totalReturnPct - (-10)) < 1e-9);
  assert.ok(Math.abs(p.mddPct - 25) < 1e-9);
  assert.strictEqual(p.profitFactor, 3);
  assert.strictEqual(p.nTrades, 2);
});

t('trade forward direkonstruksi dari log order', () => {
  const tr = tradesFromOrders([
    { ts: 1, sym: 'BTCIDR', side: 'buy', qty: 1, avgPrice: 100, notional: 100, fee: 0.3, spreadCost: 0.1 },
    { ts: 2, sym: 'BTCIDR', side: 'sell', qty: 1, avgPrice: 110, notional: 110, fee: 0.33, spreadCost: 0.1, reason: 'Close<MA' },
  ]);
  assert.strictEqual(tr.length, 1);
  assert.ok(Math.abs(tr[0].pnl - (110 - 0.33 - 100 - 0.3)) < 1e-9);
});

console.log(`\nSelftest: ${ok} lulus`);
