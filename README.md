# Bot Dry Run Indodax — UAS Algoritma Trading

Bot long-only yang menjalankan strategi **Trend Following MA** (adaptasi dari strategi UTS) di pasar kripto IDR Indodax. Semua order **disimulasikan** di harga bid/ask sungguhan. Tidak ada API key, tidak ada uang sungguhan.

- Sumber sinyal, sizing, dan aturan eksekusi: **satu file** (`lib/strategy.js`) yang dipakai bersama oleh backtest dan bot → sinyal identik.
- Data: API publik Indodax (`/tradingview/history_v2`, `/api/depth`, `/api/pairs`, `/api/price_increments`).
- Penyimpanan state + log: Vercel KV / Upstash Redis (REST) saat deploy, folder lokal saat dijalankan di laptop.
- Dashboard: HTML mandiri (offline) + endpoint live di Vercel.

## Parameter beku (ringkas)

| | |
|---|---|
| Strategi | Trend Following MA (adaptasi UTS), long-only spot |
| Timeframe | 1 jam |
| Entry | `close > MA150` dan cross-up, `MA150 > MA400` |
| Exit | `close < MA400` (exit MA lambat) atau stop loss 8% |
| Universe | 8 pasangan IDR: BTC, ETH, SOL, DOGE, XRP, ADA, BNB, LINK |
| Sizing | maks 5 posisi, 20% ekuitas/posisi, 5% ATV 20 bar, min Rp25.000 |
| Risiko | daily loss limit 3% (hari WIB), kill switch tanpa redeploy |
| Biaya | fee taker 0,30%/sisi + spread per pasangan + slippage ≥5 bp |

Detail dan alasan tiap pilihan: **`STRATEGI.md`**. Hasil backtest & refleksi: **`REFLEKSI.md`**.

## Struktur

```
api/tick.js              endpoint bot (dipanggil penjadwal)
api/dashboard.js         dashboard live dari log di storage
api/status.js            diagnostik read-only (mode storage, jumlah log, state)
api/export.js            ekspor state + log mentah untuk laporan
lib/strategy.js          aturan sinyal + sizing + pembulatan (dipakai backtest & bot)
lib/backtest.js          mesin backtest portofolio (biaya fee + spread + slippage)
lib/bot.js               satu tick bot: validasi -> sinyal -> eksekusi simulasi -> log
lib/exec.js              fill order book (walk the book), statistik spread
lib/validate.js          validasi data (candle basi, gap, nol, spread > 2%)
lib/metrics.js           metrik kinerja dari log mentah
lib/report.js            penyusun angka dashboard
lib/store.js             storage Redis (Upstash REST) / file
lib/dashboard.js         perender HTML
lib/config.js            parameter beku + universe
scripts/fetch_history.mjs    tarik candle 3 tahun (mundur, tidak paralel)
scripts/liquidity.mjs        ukur likuiditas kandidat pada AWAL periode backtest
scripts/backtest.mjs         backtest + uji parameter -> logs/, data/
scripts/snapshot.mjs         snapshot order book manual
scripts/local_tick.mjs       jalankan satu tick di lokal
scripts/pull_logs.mjs        tarik state + log mentah dari deployment
scripts/hitung_ulang.mjs     hitung ulang semua angka -> dashboard.html
scripts/selftest.mjs         uji unit logika inti
.github/workflows/tick.yml   penjadwal per jam (GitHub Actions)
```

## Menjalankan di lokal

Butuh **Node.js ≥ 18** (`node -v`). Jika belum ada: `winget install OpenJS.NodeJS.LTS`, lalu buka terminal baru.

```bash
npm run selftest                 # uji logika, tanpa jaringan
node scripts/fetch_history.mjs   # tarik ~3 tahun candle 1 jam (beberapa menit)
node scripts/liquidity.mjs       # ukur likuiditas kandidat di awal periode backtest
node scripts/backtest.mjs        # backtest + uji parameter
node scripts/snapshot.mjs        # snapshot order book (bisa diulang 3x sehari)
node scripts/local_tick.mjs      # satu tick bot (mode file)
node scripts/hitung_ulang.mjs    # bangun dashboard.html dari log mentah
```

Hasil penting:

| File | Isi |
|---|---|
| `logs/backtest_result.json` | backtest lengkap (trade + ekuitas harian) |
| `logs/validity.json` | in-sample/out-of-sample + sensitivitas parameter |
| `data/backtest_summary.mjs` | ringkasan backtest untuk dashboard (di-commit) |
| `data/backtest_trades.csv` | daftar trade backtest |
| `data/cost.json` | spread per pasangan + slippage + fee yang benar-benar dipakai |
| `data/liquidity.json` | likuiditas kandidat pada awal periode + aturan pemilihan universe |
| `data/fetch_report.json` | cakupan data historis (bar, celah, jumlah request) |
| `logs/{calls,orders,equity,errors,snapshots,candles}.ndjson` | log mentah forward test |
| `dashboard.html` | dashboard offline (angka dihitung dari log) |

## Deploy ke Vercel

1. **Push repo ke GitHub publik** (wajib: riwayat commit dipakai membuktikan freeze date).
2. **Import repo di Vercel** → framework preset: *Other*, tanpa build command.
3. **Buat Redis** di Vercel → Storage → Marketplace → Upstash Redis (gratis),hubungkan ke project. Vercel mengisi `KV_REST_API_URL` dan `KV_REST_API_TOKEN` otomatis.
4. **Environment Variables** (Production):
   - `CRON_SECRET` — string acak panjang.
   - `KILL_SWITCH=0`
   - parameter strategi (lihat `.env.example`) — **harus sama** dengan yang dipakai backtest.
5. Deploy, lalu uji:
   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" https://<project>.vercel.app/api/tick
   ```
   Buka `https://<project>.vercel.app/api/dashboard`.
6. **Penjadwal**: Vercel Hobby hanya mengizinkan cron harian, jadi pakai GitHub Actions:
   - Settings → Secrets: `BOT_URL` (mis. `https://<project>.vercel.app`) dan `CRON_SECRET`.
   - Workflow `.github/workflows/tick.yml` sudah berjalan tiap jam pada menit ke-7.
   - Di repo publik, jadwal Actions otomatis aktif. Cek tab **Actions** → *tick* → *Run workflow* untuk uji manual.

> Jika memakai Vercel Pro, cron per jam bisa ditambahkan di `vercel.json`:
> `"crons": [{ "path": "/api/tick", "schedule": "7 * * * *" }]`

## Memantau & menarik log dari deployment

- `GET /api/status?secret=...` — read-only: mode storage (`redis`/`file`), jumlah baris tiap log, ringkasan state, status kill switch.
- `GET /api/export?secret=...` — state + seluruh log mentah dalam satu JSON.
- Setelah forward test selesai, tarik log ke laptop lalu bangun ulang dashboard:

```powershell
$env:BOT_URL="https://<project>.vercel.app"
$env:CRON_SECRET="<secret>"
node scripts/pull_logs.mjs      # menulis logs/*.ndjson + .data/state.json
node scripts/hitung_ulang.mjs   # membangun dashboard.html dari log mentah
```

Commit `logs/*.ndjson` dan `dashboard.html` hasil tarikan itu sebagai bukti forward test.

## Kill switch

Tanpa deploy ulang:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" "https://<project>.vercel.app/api/tick?kill=1"
curl -H "Authorization: Bearer $CRON_SECRET" "https://<project>.vercel.app/api/tick?resume=1"
```

Setara dengan set `KILL_SWITCH=1` di environment. Setiap penggunaan tercatat di `logs/calls.ndjson` (`status: kill_switch`).

## Format log (semua mentah, JSON per baris)

| Jenis | Field inti |
|---|---|
| `calls` | `ts, iso, source, ok, status, candleT, equity, orders, errors[], durationMs` |
| `orders` | `ts, sym, side, qty, price, notional, fee, bestBid, bestAsk, spreadPct, levels, slipPct, signalClose, slipVsSignalPct, candleT, reason` |
| `equity` | `ts, equity, cash, nPos, day, dailyLossPct, halted` |
| `snapshots` | `ts, sym, bid, ask, mid, spreadPct, bids[5], asks[5]` |
| `candles` | `ts, sym, t, o, h, l, c, v` (setiap candle baru yang diproses) |
| `errors` | `ts, sym, reason` |

Dashboard **tidak** memakai angka yang diketik manual: `scripts/hitung_ulang.mjs` membaca file di atas dan menghitung ulang semuanya.

## Idempotency & ketahanan

- Setiap simbol menyimpan `lastProcessed` = waktu candle terakhir yang diproses. Panggilan kedua untuk candle yang sama tidak membeli lagi.
- Retry API maksimal 3x dengan backoff; request diserialkan (~2,8 req/detik) agar tidak kena blokir 180 req/menit.
- Cloudflare Indodax menolak `403` user-agent yang jelas-jelas bot (mis. `indodax-dryrun-bot/1.0`), jadi `lib/indodax.js` memakai user-agent browser biasa. Ini hanya header HTTP — bukan API key — dan tidak mengubah data yang dikembalikan.
- Data divalidasi sebelum keputusan: candle berjalan dibuang, candle basi > 2× timeframe, gap di jendela indikator, harga nol, volume nol pada candle keputusan, book kosong, spread > 2% → tidak membuka posisi dan alasannya dicatat. Jam tanpa transaksi di tengah jendela (volume 0) tetap dihitung di `zeroVolumeBars` dan bar itu tidak dipakai untuk eksekusi.
- `daily loss limit` memakai batas hari WIB (00.00 WIB = 17.00 UTC).

## Sumber biaya (diukur, bukan diasumsikan)

| Sumber | Nilai | Tanggal akses |
|---|---|---|
| `https://indodax.com/api/pairs` → `trade_fee_percent_taker` | 0,20% | 10 Nov 2026 |
| Halaman resmi *Rincian Biaya Transaksi* (`help.indodax.com`) | 0,30% (taker, **dipakai** — lebih mahal) | 10 Nov 2026 |
| Minimum order API (`trade_min_base_currency`) | Rp10.000 | 10 Nov 2026 |
| Minimum order mode Pro | Rp25.000 (**dipakai** — lebih ketat) | 10 Nov 2026 |
| Spread top-of-book per pasangan | 0,014%–0,934% (median 3 snapshot) | 10 Nov 2026, `scripts/snapshot.mjs` |
| Slippage | minimum 5 bp (naik bila log order menunjukkan lebih besar) | `logs/orders.ndjson` |

`data/cost.json` mencatat nilai persis yang dipakai backtest beserta jumlah snapshot
dan median per pasangan. Menjalankan ulang `node scripts/backtest.mjs` akan
memperbarui `data/backtest_summary.mjs` — lakukan **sebelum** freeze, bukan setelahnya.

> Bot memakai **0,30% per sisi (all-in)** dan minimum **Rp25.000**. Ganti
> `FEE_TAKER_PCT` / `MIN_ORDER_IDR` bila hasil pengecekan ulang berbeda — dan catat
> di `STRATEGI.md`.

## Batasan yang diakui

- Fill dry-run memakai snapshot order book saat bot berjalan, bukan book sepanjang jam. Order besar menghabiskan beberapa level (bukan mid/close).
- Snapshot hanya tersimpan saat bot berjalan; spread di luar jam tersebut tidak terukur.
- Spread backtest memakai median 3 snapshot (10 Nov 2026). Spread kripto berubah menurut jam; angka ini titik estimasi, bukan rata-rata 3 tahun. Nilainya ditulis apa adanya di `data/cost.json`.
- Universe dipilih dari pasangan yang **masih listed** hari ini. Survivorship bias dikurangi dengan mengukur likuiditas pada awal periode backtest, tetapi pasangan yang delisting tidak dapat direkonstruksi dari API publik.
- Backtest mengasumsikan order selalu tereksekusi penuh di level book; slippage di luar 5 level teratas tidak dimodelkan.
- Backtest memakai harga `open` candle berikutnya, sedangkan bot mengeksekusi pada detik scheduler berjalan (beberapa menit setelah candle tutup). Selisih ini tercatat sebagai `slipVsSignalPct` di log order.
- Hanya 1 akun/1 proses yang diasumsikan memanggil `/api/tick`; dua scheduler yang berjalan bersamaan bisa lolos dari idempotency karena state dibaca di awal tick.
