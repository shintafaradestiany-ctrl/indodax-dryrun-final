/* api/export.js — ekspor state + seluruh log mentah (JSON).
 *
 * Dipakai scripts/pull_logs.mjs untuk menyalin log forward test dari Redis
 * ke folder logs/ lokal saat menyusun laporan. Read-only.
 *
 * Otorisasi sama dengan /api/tick (Authorization: Bearer <CRON_SECRET>).
 */
import { readState, readLogs } from '../lib/store.js';

export const config = { maxDuration: 60 };

const KINDS = ['calls', 'orders', 'equity', 'errors', 'snapshots', 'candles'];

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // lokal / demo
  if (req.headers['x-vercel-cron']) return true;
  const auth = req.headers.authorization || '';
  if (auth === `Bearer ${secret}`) return true;
  return req.query?.secret === secret;
}

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  if (!authorized(req)) return res.status(401).json({ error: 'tidak berwenang' });

  try {
    const logs = {};
    for (const k of KINDS) logs[k] = await readLogs(k);
    const state = await readState();
    const counts = Object.fromEntries(KINDS.map(k => [k, logs[k].length]));
    return res.status(200).json({
      ok: true,
      exportedAt: Math.floor(Date.now() / 1000),
      counts,
      state,
      logs,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
