/* scripts/fetch_history.mjs
 * Menarik candle historis Indodax mundur sampai tanggal awal backtest.
 *
 * Pemakaian:
 *   node scripts/fetch_history.mjs                       # 3 tahun, 10 kandidat
 *   CANDIDATES=BTCIDR,ETHIDR START_DATE=2023-01-01 node scripts/fetch_history.mjs
 *
 * Catatan: satu request history_v2 hanya mengembalikan ~650 bar terakhir sebelum
 * `to`, jadi penarikan dilakukan mundur. Jeda antar request diatur lib/indodax.js
 * (maks ~2,8 req/detik, tidak paralel).
 */
import fs from 'node:fs';
import path from 'node:path';
import { history } from '../lib/indodax.js';

const TF = Number(process.env.TF_MINUTES || 60);
const CANDIDATES = (process.env.CANDIDATES
  || 'BTCIDR,ETHIDR,SOLIDR,XRPIDR,DOGEIDR,ADAIDR,BNBIDR,LINKIDR,AVAXIDR,TRXIDR')
  .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);

const START = process.env.START_DATE
  ? Math.floor(Date.parse(process.env.START_DATE + 'T00:00:00Z') / 1000)
  : Math.floor(Date.now() / 1000) - Math.round(3.2 * 365.25 * 86400);
const END = Math.floor(Date.now() / 1000);

const DATA = path.join(process.cwd(), 'data');
fs.mkdirSync(DATA, { recursive: true });

const iso = t => new Date(t * 1000).toISOString();
const csvPath = sym => path.join(DATA, `${sym}_${TF}.csv`);

function readCsv(p) {
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').slice(1).filter(Boolean).map(l => {
    const [t, , o, h, lo, c, v] = l.split(',');
    return { t: Number(t), o: +o, h: +h, l: +lo, c: +c, v: +v };
  });
}

function writeCsv(p, bars) {
  const lines = ['t,iso,o,h,l,c,v'];
  for (const b of bars) lines.push(`${b.t},${iso(b.t)},${b.o},${b.h},${b.l},${b.c},${b.v}`);
  fs.writeFileSync(p, lines.join('\n') + '\n');
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchSymbol(sym) {
  const existing = readCsv(csvPath(sym));
  const map = new Map(existing.map(b => [b.t, b]));
  let to = map.size ? Math.min(END, Math.min(...map.keys()) - 1) : END;
  let requests = 0;
  let empty = 0;

  while (to > START) {
    const from = Math.max(START, to - 660 * TF * 60);
    let bars = [];
    try {
      ({ bars } = await history(sym, TF, from, to));
      requests++;
    } catch (e) {
      console.warn(`  ${sym}: ${e.message}, ulangi 2 detik`);
      await sleep(2000);
      empty++;
      if (empty > 5) break;
      continue;
    }
    if (!bars.length) { empty++; if (empty > 2) break; to -= 660 * TF * 60; continue; }
    empty = 0;
    for (const b of bars) map.set(b.t, b);
    const earliest = bars[0].t;
    if (earliest <= START) break;
    if (earliest >= to) break;           // tidak ada kemajuan
    to = earliest - 1;
  }

  const bars = [...map.values()].filter(b => b.t >= START && b.t <= END).sort((a, b) => a.t - b.t);
  writeCsv(csvPath(sym), bars);

  /* cek celah pada TF */
  let gaps = 0;
  for (let i = 1; i < bars.length; i++) if (bars[i].t - bars[i - 1].t !== TF * 60) gaps++;

  return {
    sym,
    bars: bars.length,
    first: bars.length ? iso(bars[0].t) : null,
    last: bars.length ? iso(bars[bars.length - 1].t) : null,
    gaps,
    requests,
  };
}

const report = [];
for (const sym of CANDIDATES) {
  const t0 = Date.now();
  process.stdout.write(`[fetch] ${sym} ... `);
  const r = await fetchSymbol(sym);
  r.seconds = Math.round((Date.now() - t0) / 1000);
  report.push(r);
  console.log(`${r.bars} bar, ${r.first?.slice(0, 10)} s/d ${r.last?.slice(0, 10)}, ${r.gaps} celah, ${r.requests} req, ${r.seconds}s`);
}

const meta = { tfMin: TF, start: iso(START), end: iso(END), startedAt: new Date().toISOString(), report };
fs.writeFileSync(path.join(DATA, 'fetch_report.json'), JSON.stringify(meta, null, 2));
console.log(`\nSelesai. Laporan: data/fetch_report.json`);
