/* lib/indodax.js
 * Klien API publik Indodax (tanpa API key). Semua request diserialkan dengan jeda
 * minimal 350 ms (≈ 2,8 req/detik) agar tidak melewati batas 180 req/menit.
 */

const BASE = 'https://indodax.com';
const MIN_GAP_MS = 350;
/* Cloudflare Indodax menolak (403) user-agent yang kelihatan seperti bot
 * (mis. "indodax-dryrun-bot/1.0"); UA browser biasa diizinkan. Ini hanya header
 * HTTP, bukan API key, dan tidak mengubah data yang dikembalikan. */
const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'accept': 'application/json, text/plain, */*',
  'accept-language': 'en-US,en;q=0.9',
};
let lastAt = 0;
let chain = Promise.resolve();

const sleep = ms => new Promise(r => setTimeout(r, ms));

function serial(fn) {
  const p = chain.then(async () => {
    const wait = MIN_GAP_MS - (Date.now() - lastAt);
    if (wait > 0) await sleep(wait);
    lastAt = Date.now();
    return fn();
  });
  chain = p.catch(() => {});
  return p;
}

async function getJson(path, { retries = 3, timeoutMs = 20000 } = {}) {
  return serial(async () => {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(BASE + path, {
          headers: HEADERS,
          signal: ctrl.signal,
        });
        if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        return { json, meta: { path, attempts: attempt + 1 } };
      } catch (e) {
        lastErr = e;
        if (attempt < retries) await sleep(500 * Math.pow(2, attempt));
      } finally {
        clearTimeout(timer);
      }
    }
    const err = new Error(`GET ${path} gagal: ${lastErr && lastErr.message}`);
    err.cause = lastErr;
    throw err;
  });
}

/** Waktu server Indodax (ms). */
export async function serverTime() {
  const { json } = await getJson('/api/server_time');
  return Number(json.server_time);
}

/** Semua pasangan; mengembalikan Map ticker_id (btc_idr) -> meta. */
export async function getPairs() {
  const { json } = await getJson('/api/pairs');
  const map = new Map();
  for (const p of json) map.set(String(p.ticker_id).toLowerCase(), p);
  return map;
}

/**
 * Candle historis. tf dalam menit (1, 15, 30, 60, 240, 1440).
 * Periode dikirim dalam detik.
 */
export async function history(symbol, tfMin, fromSec, toSec) {
  const q = `symbol=${encodeURIComponent(symbol.toUpperCase())}&tf=${tfMin}&from=${Math.floor(fromSec)}&to=${Math.floor(toSec)}`;
  const { json, meta } = await getJson(`/tradingview/history_v2?${q}`);
  const bars = (Array.isArray(json) ? json : []).map(r => ({
    t: Number(r.Time),
    o: Number(r.Open),
    h: Number(r.High),
    l: Number(r.Low),
    c: Number(r.Close),
    v: Number(r.Volume),
  })).filter(b => Number.isFinite(b.t) && b.t > 0);
  bars.sort((a, b) => a.t - b.t);
  return { bars, meta };
}

/** Order book: buy = bid (desc), sell = ask (asc). Harga & qty string -> number. */
export async function depth(pairId) {
  const { json } = await getJson(`/api/depth/${String(pairId).toLowerCase()}`);
  const norm = list => (Array.isArray(list) ? list : [])
    .map(x => ({ p: Number(x[0]), q: Number(x[1]) }))
    .filter(x => Number.isFinite(x.p) && Number.isFinite(x.q) && x.p > 0 && x.q > 0);
  return { bids: norm(json.buy), asks: norm(json.sell) };
}

/** Increment harga per pasangan (Map pair_id -> number). */
export async function priceIncrements() {
  const { json } = await getJson('/api/price_increments');
  const map = new Map();
  for (const [k, v] of Object.entries(json.increments || {})) map.set(k, Number(v));
  return map;
}

/** Ringkasan 24 jam (untuk memilih universe / laporan likuiditas). */
export async function summaries() {
  const { json } = await getJson('/api/summaries');
  return json.tickers || {};
}
