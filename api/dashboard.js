/* api/dashboard.js — dashboard live dari state/log di storage.
 * Backtest lengkap dibaca dari data/backtest_summary.mjs (dibuat oleh backtest).
 */
import { renderDashboard } from '../lib/dashboard.js';
import { buildDashboardData } from '../lib/report.js';
import { CFG } from '../lib/config.js';
import { readLogs } from '../lib/store.js';
import summary from '../data/backtest_summary.mjs';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  try {
    const [orders, equity, calls, errors, snapshots, candles] = await Promise.all([
      readLogs('orders'), readLogs('equity'), readLogs('calls'),
      readLogs('errors'), readLogs('snapshots'), readLogs('candles'),
    ]);
    const data = buildDashboardData({
      summary,
      logs: { orders, equity, calls, errors, snapshots, candles },
      cfg: CFG,
      meta: summary.meta,
    });
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.status(200).send(renderDashboard(data));
  } catch (e) {
    res.status(500).send(`<pre>dashboard error: ${String(e.message).replace(/[<>]/g, '')}</pre>`);
  }
}
