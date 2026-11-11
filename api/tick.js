/* api/tick.js — satu-satunya endpoint bot. Dipanggil penjadwal (Vercel Cron /
 * GitHub Actions). Membaca state, mengambil data live, menghitung sinyal,
 * mengeksekusi simulasi, menyimpan state + log.
 *
 * Otorisasi: Authorization: Bearer <CRON_SECRET> (atau ?secret=..., atau
 * header x-vercel-cron dari penjadwal Vercel).
 *
 * Kill switch tanpa deploy ulang:
 *   GET /api/tick?kill=1&secret=...     -> aktifkan
 *   GET /api/tick?resume=1&secret=...   -> matikan
 */
import { runTick } from '../lib/bot.js';
import { setFlag, getFlag } from '../lib/store.js';

export const config = { maxDuration: 60 };

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // lokal / demo; isi CRON_SECRET saat deploy
  if (req.headers['x-vercel-cron']) return true;
  const auth = req.headers.authorization || '';
  if (auth === `Bearer ${secret}`) return true;
  return req.query?.secret === secret;
}

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  try {
    if (!authorized(req)) return res.status(401).json({ error: 'tidak berwenang' });

    if (req.query?.kill) {
      await setFlag('kill', '1');
      return res.status(200).json({ ok: true, kill: true, message: 'kill switch aktif; bot tidak akan membuka/menutup posisi sampai di-resume' });
    }
    if (req.query?.resume) {
      await setFlag('kill', '0');
      return res.status(200).json({ ok: true, kill: false, flag: await getFlag('kill') });
    }

    const source = req.headers['x-vercel-cron'] ? 'vercel-cron' : (req.query?.source || 'http');
    const out = await runTick({ source });
    return res.status(out.ok ? 200 : 207).json(out);
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
