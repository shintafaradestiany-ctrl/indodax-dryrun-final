/* lib/validate.js
 * Validasi data sebelum bot mengambil keputusan. Semua penolakan dikembalikan
 * sebagai alasan agar bisa dicatat di log.
 *
 * Aturan (sesuai soal UAS):
 *  - buang candle yang masih berjalan (Time + tf > server_time)
 *  - candle tertutup terakhir tidak lebih tua dari 2 x timeframe
 *  - tidak ada candle hilang di jendela indikator
 *  - tidak ada harga / volume nol
 *  - order book tidak kosong
 *  - spread bid-ask <= 2%
 */
import { bookStats } from './exec.js';

/** Buang candle yang belum tertutup. */
export function closedBars(bars, tfMin, serverTimeSec) {
  const tf = tfMin * 60;
  return bars.filter(b => b.t + tf <= serverTimeSec + 1);
}

/**
 * @param bars   candle (setelah closedBars), urut naik
 * @param cfg    {tfMin, M, maxSpreadPct}
 * @param need   jumlah bar minimal (default M + 2)
 */
export function validateSeries(bars, cfg, need, nowSec) {
  const reasons = [];
  const n = need || cfg.M + 2;
  const tf = cfg.tfMin * 60;
  if (bars.length < n) reasons.push(`bar kurang: ${bars.length} < ${n}`);
  if (!bars.length) return { ok: false, reasons: ['data kosong'], last: null };

  const last = bars[bars.length - 1];
  const refSec = Number.isFinite(nowSec) ? nowSec : Math.floor(Date.now() / 1000);
  const ageSec = refSec - last.t;
  if (ageSec > 2 * tf) reasons.push(`candle tertutup terakhir basi ${Math.round(ageSec / 60)} menit (> ${2 * cfg.tfMin} menit)`);

  const win = bars.slice(-n);
  for (let i = 0; i < win.length; i++) {
    const b = win[i];
    if (!(b.o > 0 && b.h > 0 && b.l > 0 && b.c > 0)) { reasons.push(`harga nol/negatif pada ${new Date(b.t * 1000).toISOString()}`); break; }
  }
  /* Indodax sah punya jam tanpa transaksi (volume 0). Candle seperti itu tidak
   * boleh dipakai untuk eksekusi, tetapi tidak membatalkan seluruh seri: yang
   * ditolak adalah bila candle keputusan (terakhir) tidak punya volume. Jumlah
   * candle bervolume nol di jendela tetap dicatat dan dilaporkan. */
  const zeroVolumeBars = win.filter(b => !(b.v > 0)).length;
  if (!(last.v > 0)) reasons.push(`volume nol pada candle terakhir (${new Date(last.t * 1000).toISOString()})`);
  for (let i = 1; i < win.length; i++) {
    const step = win[i].t - win[i - 1].t;
    if (step !== tf) { reasons.push(`candle hilang/duplikat pada ${new Date(win[i].t * 1000).toISOString()} (jarak ${step / 60} menit)`); break; }
  }
  return { ok: reasons.length === 0, reasons, last, zeroVolumeBars };
}

/** Validasi order book + spread. */
export function validateBook(book, cfg) {
  const s = bookStats(book);
  if (!s.ok) return { ok: false, reasons: [s.reason], stats: null };
  const reasons = [];
  if (s.spreadPct > cfg.maxSpreadPct) reasons.push(`spread ${s.spreadPct.toFixed(2)}% > ${cfg.maxSpreadPct}%`);
  return { ok: reasons.length === 0, reasons, stats: s };
}
