/* api/status.js — endpoint diagnostik read-only.
 *
 * Dipakai untuk memastikan penyimpanan mana yang aktif (redis vs file) dan
 * apakah log/state benar-benar tersimpan, tanpa harus membuka dashboard
 * penyedia database. Tidak menulis apa pun, tidak mengambil data pasar.
 *
 * Otorisasi sama dengan /api/tick (Authorization: Bearer <CRON_SECRET>).
 */
import { readState, readLogs, getFlag, mode } from '../lib/store.js';

export const config = { maxDuration: 30 };

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // lokal / demo
  if (req.headers['x-vercel-cron']) return true;
  const auth = req.headers.authorization || '';
  if (auth === `Bearer ${secret}`) return true;
  return req.query?.secret === secret;
}

const KINDS = ['calls', 'orders', 'equity', 'errors', 'snapshots', 'candles'];

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  if (!authorized(req)) return res.status(401).json({ error: 'tidak berwenang' });

  const env = {
    KV_REST_API_URL: Boolean(process.env.KV_REST_API_URL),
    KV_REST_API_TOKEN: Boolean(process.env.KV_REST_API_TOKEN),
    UPSTASH_REDIS_REST_URL: Boolean(process.env.UPSTASH_REDIS_REST_URL),
    UPSTASH_REDIS_REST_TOKEN: Boolean(process.env.UPSTASH_REDIS_REST_TOKEN),
    STORE_PREFIX: process.env.STORE_PREFIX || 'bot',
    CRON_SECRET: Boolean(process.env.CRON_SECRET),
  };

  let state = null;
  const logs = {};
  let killFlag = null;
  let error = null;
  try {
    state = await readState();
    for (const k of KINDS) logs[k] = (await readLogs(k)).length;
    killFlag = await getFlag('kill');
  } catch (e) {
    error = e.message;
  }

  return res.status(200).json({
    ok: !error,
    storage: mode,
    env,
    state: state
      ? {
          cash: state.cash,
          nPos: Object.keys(state.positions || {}).length,
          positions: Object.keys(state.positions || {}),
          day: state.day,
          dayStartEquity: state.dayStartEquity,
          lastTickAt: state.lastTickAt,
          lastProcessed: state.lastProcessed,
        }
      : null,
    logs,
    killFlag,
    error,
  });
}
