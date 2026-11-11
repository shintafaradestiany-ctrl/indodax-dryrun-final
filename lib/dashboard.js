/* lib/dashboard.js
 * Perender dashboard HTML mandiri (tanpa aset/CDN eksternal). Dipakai oleh
 * scripts/hitung_ulang.mjs (offline) dan api/dashboard.js (live dari storage).
 */

const nf = (v, d = 2) => (v == null || Number.isNaN(v) ? '—' : Number(v).toLocaleString('id-ID', { maximumFractionDigits: d, minimumFractionDigits: d }));
const pct = (v, d = 2) => {
  if (v == null || Number.isNaN(v)) return '—';
  const n = Object.is(Number(v), -0) ? 0 : Number(v); // hindari "+-0,00"
  return `${n > 0 ? '+' : ''}${nf(n, d)}%`;
};
const pctPlain = (v, d = 2) => (v == null || Number.isNaN(v) ? '—' : `${nf(v, d)}%`);
const idr = v => (v == null ? '—' : `Rp${nf(v, 0)}`);
const dt = t => (t == null ? '—' : new Date(t * 1000).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'short', timeStyle: 'short' }));
const day = t => (t == null ? '—' : new Date((t + 7 * 3600) * 1000).toISOString().slice(0, 10));

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Grafik garis sederhana dengan sumbu Y dan label awal/akhir. */
function lineChart(series, { w = 860, h = 240, label = '', color = '#2563eb', fill = true, empty = '' } = {}) {
  const pts = series.filter(p => Number.isFinite(p.v));
  if (pts.length < 2) return `<div class="empty">${esc(empty || `belum ada data ${label}`)}</div>`;
  const pad = { l: 64, r: 12, t: 12, b: 26 };
  const W = w - pad.l - pad.r, H = h - pad.t - pad.b;
  const xs = pts.map(p => p.x), ys = pts.map(p => p.v);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  const X = x => pad.l + (x1 === x0 ? 0 : (x - x0) / (x1 - x0) * W);
  const Y = y => pad.t + H - (y1 === y0 ? 0.5 : (y - y0) / (y1 - y0)) * H;
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' ');
  const area = `${path} L${X(x1).toFixed(1)},${(pad.t + H).toFixed(1)} L${X(x0).toFixed(1)},${(pad.t + H).toFixed(1)} Z`;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => {
    const v = y0 + (y1 - y0) * f;
    return `<line x1="${pad.l}" x2="${w - pad.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="#e5e7eb"/>
      <text x="${pad.l - 8}" y="${Y(v) + 4}" text-anchor="end" font-size="10" fill="#6b7280">${nf(v, 1)}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${w} ${h}" class="chart" role="img" aria-label="${esc(label)}">
    ${ticks}
    ${fill ? `<path d="${area}" fill="${color}" opacity="0.08"/>` : ''}
    <path d="${path}" fill="none" stroke="${color}" stroke-width="2"/>
    <text x="${pad.l}" y="${h - 6}" font-size="10" fill="#6b7280">${pts[0].label ?? ''}</text>
    <text x="${w - pad.r}" y="${h - 6}" font-size="10" fill="#6b7280" text-anchor="end">${pts[pts.length - 1].label ?? ''}</text>
  </svg>`;
}

const metricRow = (label, a, b, c, fmt = pct) => `<tr><th>${esc(label)}</th><td>${fmt(a)}</td><td>${fmt(b)}</td><td>${fmt(c)}</td></tr>`;

function statCard(title, value, sub, cls = '') {
  return `<div class="card ${cls}"><div class="card-t">${esc(title)}</div><div class="card-v">${value}</div><div class="card-s">${sub}</div></div>`;
}

export function renderDashboard(d) {
  const m = d.meta, bt = d.backtest, fw = d.forward, wb = d.windowBt;
  const bp = bt && bt.perf, fp = fw && fw.perf, wp = wb && wb.perf;

  const btSeries = (bt?.dailyEq || []).map(p => ({ x: p.t, v: (p.equity / (bp?.equityStart || m.capital) - 1) * 100, label: p.day }));
  const fwSeries = (fw?.dailyEq || []).map(p => ({ x: p.t, v: (p.equity / m.capital - 1) * 100, label: p.day }));
  const wbSeries = (wb?.dailyEq || []).map(p => ({ x: p.t, v: (p.equity / m.capital - 1) * 100, label: p.day }));

  // drawdown backtest
  let peak = -Infinity;
  const ddSeries = (bt?.dailyEq || []).map(p => {
    peak = Math.max(peak, p.equity);
    return { x: p.t, v: -(peak - p.equity) / peak * 100, label: p.day };
  });

  const last = fp || {};
  const tradeRows = (arr, max = 12) => (arr || []).slice(0, max).map(t => `<tr>
    <td>${esc(t.sym)}</td><td>${day(t.entryT)}</td><td>${day(t.exitT)}</td>
    <td>${nf(t.entryPrice, 2)}</td><td>${nf(t.exitPrice, 2)}</td>
    <td>${pct(t.pnlPct)}</td><td>${idr(t.pnl)}</td><td>${esc(t.why || '-')}</td>
  </tr>`).join('') || '<tr><td colspan="8" class="empty">belum ada trade</td></tr>';

  const errRows = (d.errors || []).slice(-15).reverse().map(e => `<tr><td>${dt(e.ts)}</td><td>${esc(e.sym || '-')}</td><td>${esc(e.reason)}</td></tr>`).join('')
    || '<tr><td colspan="3" class="empty">tidak ada error</td></tr>';

  const ops = d.ops || {};

  return `<!doctype html>
<html lang="id"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(m.title)}</title>
<style>
  :root{--ink:#111827;--mut:#6b7280;--line:#e5e7eb;--bg:#f8fafc;--blue:#2563eb;--green:#059669;--red:#dc2626}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
  header{background:#0f172a;color:#fff;padding:28px 32px}
  header h1{margin:0 0 6px;font-size:22px;letter-spacing:.2px}
  header .sub{color:#cbd5e1;font-size:13px}
  header .badges{margin-top:12px;display:flex;gap:8px;flex-wrap:wrap}
  .badge{background:#1e293b;border:1px solid #334155;border-radius:999px;padding:4px 10px;font-size:12px;color:#e2e8f0}
  main{max-width:1180px;margin:0 auto;padding:24px 20px 60px}
  h2{font-size:16px;margin:28px 0 10px;letter-spacing:.3px;text-transform:uppercase;color:#334155}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px}
  .card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:14px 16px}
  .card-t{font-size:12px;color:var(--mut);text-transform:uppercase;letter-spacing:.4px}
  .card-v{font-size:24px;font-weight:700;margin:4px 0 2px}
  .card-s{font-size:12px;color:var(--mut)}
  .pos{color:var(--green)} .neg{color:var(--red)}
  .panel{background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px;overflow:auto}
  .chart{width:100%;height:auto;display:block}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th,td{text-align:right;padding:7px 8px;border-bottom:1px solid var(--line);white-space:nowrap}
  th:first-child,td:first-child{text-align:left}
  thead th{color:var(--mut);font-weight:600;font-size:12px;text-transform:uppercase}
  tbody th{font-weight:600;color:#374151}
  tr:last-child td,tr:last-child th{border-bottom:none}
  .empty{color:var(--mut);text-align:center;padding:16px}
  .note{color:var(--mut);font-size:12px;margin-top:8px}
  .cols{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  @media(max-width:800px){.cols{grid-template-columns:1fr}}
  code{background:#f1f5f9;padding:1px 5px;border-radius:4px}
  footer{max-width:1180px;margin:0 auto;padding:0 20px 40px;color:var(--mut);font-size:12px}
</style></head><body>
<header>
  <h1>${esc(m.title)}</h1>
  <div class="sub">${esc(m.student || '')} ${m.nim ? '· ' + esc(m.nim) : ''} · Forward test ${esc(m.forwardStart || '—')} s/d ${esc(m.forwardEnd || '—')} (WIB)</div>
  <div class="badges">
    <span class="badge">Universe: ${esc((m.universe || []).join(' · '))}</span>
    <span class="badge">MA ${m.params.N}/${m.params.M} · SL ${m.params.slPct}% · ${m.tfMin} menit</span>
    <span class="badge">Fee taker all-in ${nf(m.cost.feeTakerPct, 2)}%/sisi</span>
    <span class="badge">Spread backtest ${nf(m.cost.spreadPct, 3)}% · slippage ${nf(m.cost.slippagePct, 3)}%</span>
    <span class="badge">Modal ${idr(m.capital)}</span>
    <span class="badge">Dibuat ${esc(m.generatedAt)}</span>
  </div>
</header>
<main>

  <h2>1. Ringkasan</h2>
  <div class="grid">
    ${statCard('Backtest — total return', bp ? pct(bp.totalReturnPct) : '—', bp ? `${nf(bp.days / 365.25, 2)} tahun · ${bp.nTrades} trade` : 'belum dijalankan', bp && bp.totalReturnPct >= 0 ? 'pos' : 'neg')}
    ${statCard('Backtest — CAGR', bp ? pct(bp.cagrPct) : '—', bp ? `Max DD ${pct(-bp.mddPct)}` : '')}
    ${statCard('Forward — total return', fp ? pct(fp.totalReturnPct) : '—', fp ? `${nf(fp.days, 1)} hari · ${fp.nTrades} trade` : (d.ops?.calls ? `${d.ops.calls} tick masuk — return butuh ≥2 hari WIB` : 'belum ada log'), fp && fp.totalReturnPct >= 0 ? 'pos' : 'neg')}
    ${statCard('Forward — max drawdown', fp ? pct(-fp.mddPct) : '—', fp ? `equity akhir ${idr(fp.equityEnd)}` : (d.ops?.calls ? 'butuh ≥2 hari WIB' : ''))}
    ${statCard('Gap backtest vs forward', fp && wp ? pct(fp.totalReturnPct - wp.totalReturnPct) : '—', 'forward dikurangi backtest jendela sama')}
    ${statCard('Benchmark BTC/IDR', fp && fp.benchmarkPct != null ? pct(fp.benchmarkPct) : '—', 'buy & hold, biaya sama', fp && fp.benchmarkPct >= 0 ? 'pos' : 'neg')}
  </div>
  <div class="note">CAGR 10 hari tidak ditampilkan (tidak bermakna). Semua return sudah dikurangi fee dan spread/slippage.</div>

  <h2>2. Backtest vs Forward (jendela 10 hari yang sama)</h2>
  <div class="panel">
    <table>
      <thead><tr><th>Metrik</th><th>Backtest ${esc(m.btPeriod || '')}</th><th>Backtest jendela forward</th><th>Forward test</th></tr></thead>
      <tbody>
        ${metricRow('Total return', bp?.totalReturnPct, wp?.totalReturnPct, fp?.totalReturnPct)}
        ${metricRow('Max drawdown', bp ? -bp.mddPct : null, wp ? -wp.mddPct : null, fp ? -fp.mddPct : null)}
        ${metricRow('Profit factor', bp?.profitFactor, wp?.profitFactor, fp?.profitFactor, v => (v == null ? '—' : nf(v, 2)))}
        ${metricRow('Win rate', bp?.winRatePct, wp?.winRatePct, fp?.winRatePct, v => pctPlain(v))}
        ${metricRow('Rata-rata untung/trade', bp?.avgWinPct, wp?.avgWinPct, fp?.avgWinPct)}
        ${metricRow('Rata-rata rugi/trade', bp?.avgLossPct, wp?.avgLossPct, fp?.avgLossPct)}
        ${metricRow('Jumlah trade', bp?.nTrades, wp?.nTrades, fp?.nTrades, v => (v == null ? '—' : nf(v, 0)))}
        ${metricRow('Porsi biaya / laba kotor', bp?.costSharePct, wp?.costSharePct, fp?.costSharePct, v => pctPlain(v))}
        ${metricRow('Benchmark BTC/IDR', bp?.benchmarkPct, wp?.benchmarkPct, fp?.benchmarkPct)}
      </tbody>
    </table>
    <div class="note">Baris "backtest jendela forward" = strategi yang sama dijalankan ulang hanya pada tanggal forward test, dengan candle dan biaya yang sama. Selisih baris ini dengan forward adalah gap eksekusi (timing, spread, slippage).</div>
  </div>

  <h2>3. Kurva ekuitas</h2>
  <div class="panel">
    <div class="card-t" style="margin-bottom:6px">Backtest (${esc(m.btPeriod || '')}) — return kumulatif %</div>
    ${lineChart(btSeries, { label: 'backtest', color: '#2563eb' })}
    <div class="card-t" style="margin:18px 0 6px">Drawdown backtest %</div>
    ${lineChart(ddSeries, { label: 'drawdown', color: '#dc2626' })}
    <div class="card-t" style="margin:18px 0 6px">Forward test vs backtest jendela yang sama — return kumulatif %</div>
    <div class="cols">
      <div><div class="card-s" style="margin-bottom:4px">Forward test</div>${lineChart(fwSeries, { label: 'forward', color: '#059669', empty: 'log tick tersimpan; kurva return muncul setelah 2 hari WIB' })}</div>
      <div><div class="card-s" style="margin-bottom:4px">Backtest jendela sama</div>${lineChart(wbSeries, { label: 'backtest jendela', color: '#7c3aed' })}</div>
    </div>
  </div>

  <h2>4. Trade forward test</h2>
  <div class="panel"><table>
    <thead><tr><th>Pasangan</th><th>Masuk</th><th>Keluar</th><th>Harga masuk</th><th>Harga keluar</th><th>P/L %</th><th>P/L Rp</th><th>Alasan keluar</th></tr></thead>
    <tbody>${tradeRows(fw.trades)}</tbody>
  </table></div>

  <h2>5. Eksekusi &amp; biaya</h2>
  <div class="grid">
    ${statCard('Snapshot order book', String(d.dataQuality?.snapshotCount ?? 0), 'tersimpan mentah di logs/snapshots.ndjson')}
    ${statCard('Median spread diamati', d.dataQuality?.medianSpreadPct != null ? nf(d.dataQuality.medianSpreadPct, 3) + '%' : '—', `vs spread backtest ${nf(m.cost.spreadPct, 3)}%`)}
    ${statCard('Median slippage fill', d.dataQuality?.medianSlipPct != null ? nf(d.dataQuality.medianSlipPct, 3) + '%' : '—', 'selisih harga fill vs best bid/ask level 1')}
    ${statCard('Fee dibayar', idr(d.dataQuality?.feesPaid), `${fp?.nTrades ?? 0} trade tertutup`)}
    ${statCard('Biaya spread+slippage', idr(d.dataQuality?.spreadCost), 'selisih harga fill vs harga sinyal')}
    ${statCard('Order ditolak', String(d.dataQuality?.rejectedOrders ?? 0), 'lihat log errors')}
  </div>

  <h2>6. Operasional</h2>
  <div class="grid">
    ${statCard('Uptime candle', ops.uptime ? nf(ops.uptime.pct, 1) + '%' : '—', ops.uptime ? `${ops.uptime.processed} dari ${ops.uptime.expected} candle` : '', ops.uptime && ops.uptime.pct >= 95 ? 'pos' : ops.uptime && ops.uptime.pct < 80 ? 'neg' : '')}
    ${statCard('Panggilan bot', String(ops.calls ?? 0), `${ops.okCalls ?? 0} sukses · terakhir ${ops.lastCall ? dt(ops.lastCall) : '—'}`)}
    ${statCard('Error API / data', String(ops.errorCount ?? 0), 'retry dibatasi 3x, tercatat di log')}
    ${statCard('Kill switch dipakai', String(ops.killUses ?? 0), 'flag storage / env KILL_SWITCH')}
  </div>
  <div class="panel" style="margin-top:12px">
    <table><thead><tr><th>Waktu</th><th>Pasangan</th><th>Alasan</th></tr></thead><tbody>${errRows}</tbody></table>
  </div>

  <h2>7. Parameter &amp; universe</h2>
  <div class="cols">
    <div class="panel"><table><tbody>
      <tr><th>Timeframe</th><td>${m.tfMin} menit</td></tr>
      <tr><th>MA cepat (N)</th><td>${m.params.N}</td></tr>
      <tr><th>MA lambat / filter (M)</th><td>${m.params.M}</td></tr>
      <tr><th>Stop loss</th><td>${m.params.slPct}%</td></tr>
      <tr><th>Maks posisi</th><td>${m.params.maxPos}</td></tr>
      <tr><th>Maks ekuitas / posisi</th><td>${nf(m.params.posPctEquity * 100, 0)}%</td></tr>
      <tr><th>Maks nilai order</th><td>${nf(m.params.maxTurnoverPct * 100, 0)}% rata-rata nilai transaksi 20 bar</td></tr>
      <tr><th>Daily loss limit</th><td>${m.params.dailyLossLimitPct}% (batas hari 00.00 WIB)</td></tr>
      <tr><th>Minimum order</th><td>${idr(m.params.minOrderIDR)}</td></tr>
    </tbody></table></div>
    <div class="panel"><table><thead><tr><th>Pasangan</th><th>Alasan masuk universe</th></tr></thead><tbody>
      ${(m.universeNotes || m.universe.map(s => ({ sym: s, note: 'likuiditas diukur pada awal periode backtest' }))).map(u => `<tr><th>${esc(u.sym)}</th><td style="text-align:left">${esc(u.note)}</td></tr>`).join('')}
    </tbody></table></div>
  </div>

  <div class="note" style="margin-top:16px">Sumber angka: <code>logs/*.ndjson</code> (mentah) + <code>logs/backtest_result.json</code>. Jalankan <code>npm run hitung-ulang</code> untuk membangun ulang seluruh angka dan halaman ini dari log mentah.</div>
</main>
<footer>
  Bot dry run — tidak ada order atau API key sungguhan. Data publik Indodax (history_v2, depth, pairs). Dibuat otomatis oleh <code>scripts/hitung_ulang.mjs</code>.
</footer>
</body></html>`;
}
