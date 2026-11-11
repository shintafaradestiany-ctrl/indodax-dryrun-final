# STRATEGI.md — Strategi, Universe, dan Perubahan dari UTS

Dokumen ini menjelaskan **aturan yang dibekukan (frozen)**. Semua parameter di sini
sama persis dengan `lib/config.js` dan dipakai oleh backtest maupun bot, sehingga
sinyal yang diuji dan sinyal yang dijalankan benar-benar identik.

- Kebekuan parameter: **11 November 2026 12:00 WIB** (lihat bagian 9; tanggal asli
  di soal adalah 4 November 2026 — keterlambatan dijelaskan di `REFLEKSI.md`).
- Forward test: 10 hari setelah pembekuan (11–21 November 2026).
- Tidak ada perubahan parameter setelah commit kebekuan.

---

## 1. Strategi: Trend Following MA (adaptasi UTS)

Strategi UTS adalah *trend following* berbasis moving average: masuk saat harga
menembus MA ke atas selagi tren jangka lebih panjang masih naik, keluar saat tren
berakhir. Logika inti itu dipertahankan; yang berubah adalah **pasar, timeframe,
aturan keluar, dan cara eksekusi** (lihat bagian 7).

### Aturan sinyal (satu-satunya sumber: `lib/strategy.js`)

| Keputusan | Aturan (dihitung pada candle tertutup ke-`t`) | Eksekusi |
|---|---|---|
| **Beli** | `close[t] > MA_N[t]` **dan** `close[t-1] <= MA_N[t-1]` **dan** `MA_N[t] > MA_M[t]` | candle `t+1`, beli di **ask** (menelusuri order book) |
| **Jual** | `close[t] < MA_M[t]` | candle `t+1`, jual di **bid** |
| **Stop loss** | harga ≤ `entry × (1 − 8%)` (pakai low candle; jika gap turun, pakai harga open) | segera saat terdeteksi |

- `N = 150`, `M = 400` candle 1 jam → MA cepat ±6 hari, MA lambat ±17 hari.
- Sinyal beli memakai **crossing** (`close[t-1] <= MA_N[t-1]`), jadi tidak membeli
  berulang selama harga masih di atas MA.
- Keluar memakai **MA lambat** (`MA_M`), bukan MA cepat. Ini perubahan yang disengaja
  dari UTS: pada data 1 jam, memakai MA cepat sebagai pemicu masuk *dan* keluar
  membuat posisi ditutup rata-rata 3 jam setelah dibuka (whipsaw) sehingga biaya
  transaksi menggerus seluruh hasil (lihat bagian 8).
- Long-only spot. Tidak ada short, margin, leverage, atau averaging down.
- Satu posisi per pasangan.

### Timeframe

**1 jam (`tf=60`)**. Jendela forward test hanya 10 hari: dengan candle harian,
3 tahun data hanya menghasilkan puluhan sinyal sehingga perbandingan backtest vs
forward tidak punya daya statistik. Dengan candle 1 jam, 10 hari = 240 candle per
pasangan.

---

## 2. Universe (8 pasangan, dipilih dari 10 kandidat)

Aturan pemilihan, dievaluasi pada **30 hari pertama periode backtest**, bukan
likuiditas hari ini (`scripts/liquidity.mjs` → `data/liquidity.json`):

1. **Cakupan data**: pasangan harus sudah tercatat di Indodax sebelum 10 Nov 2023
   (≥ 3 tahun data candle 1 jam). Ini menutup *survivorship bias* karena tidak
   memilih aset yang baru populer belakangan.
2. **Likuiditas awal periode**: urutkan menurut rata-rata nilai transaksi per jam
   (`close × volume`) pada 30 hari pertama backtest. Ambil 8 teratas.
3. **Kapasitas order**: 5% dari rata-rata nilai transaksi per jam harus ≥ Rp25.000
   (minimum order yang dipakai bot). Semua kandidat lolos jauh di atas batas ini.
4. **Spread**: buang pasangan yang median spread top-of-book terukurnya > 2%
   (batas yang sama dipakai bot saat entry). TRX (4,34%) dan AVAX (2,05%) gugur.
5. Sisanya tepat 8 pasangan → memenuhi rentang 3–10 pasangan di soal.

### Universe final

| Pasangan | Nilai transaksi awal (Rp/jam) | ≈ Rp/hari | 5% ATV/jam | Median spread terukur |
|---|---:|---:|---:|---:|
| BTCIDR | 1.069.121.968 | 25,7 miliar | 53.456.098 | 0,105% |
| ETHIDR | 359.233.712 | 8,6 miliar | 17.961.686 | 0,126% |
| SOLIDR | 296.199.723 | 7,1 miliar | 14.809.986 | 0,014% |
| DOGEIDR | 274.715.325 | 6,6 miliar | 13.735.766 | 0,241% |
| XRPIDR | 264.519.887 | 6,3 miliar | 13.225.994 | 0,047% |
| ADAIDR | 183.401.110 | 4,4 miliar | 9.170.056 | 0,847% |
| BNBIDR | 79.389.387 | 1,9 miliar | 3.969.469 | 0,934% |
| LINKIDR | 37.585.784 | 902 juta | 1.879.289 | 0,391% |

Dibuang: **TRXIDR** (spread 4,34%) dan **AVAXIDR** (spread 2,05%).

Catatan penting: peringkat likuiditas hari ini berbeda dari peringkat awal periode
(mis. DOGE turun dari 275 juta menjadi 80 juta per jam, ADA dari 183 juta menjadi
42 juta). Universe tetap memakai peringkat **awal periode** agar tidak memilih
pemenang di belakang (lihat `data/liquidity.json`, kolom `now`).

---

## 3. Sizing dan manajemen risiko (di dalam kode)

| Aturan | Nilai | Implementasi |
|---|---|---|
| Modal awal (virtual) | Rp100.000.000 | `START_CAPITAL`, `lib/config.js` |
| Maksimum posisi terbuka | 5 | `MAX_POSITIONS`, dicek sebelum setiap entry |
| Maksimum per posisi | 20% ekuitas (= 1/maxPos) | `sizeOrder()` |
| Batas likuiditas order | 5% rata-rata nilai transaksi 20 bar | `sizeOrder()` |
| Minimum order | Rp25.000 (mode Pro; API hanya mewajibkan Rp10.000) | `sizeOrder()` |
| Daily loss limit | 3% ekuitas awal hari **WIB** | `lib/bot.js`, `lib/backtest.js` |
| Stop loss per posisi | 8% dari harga masuk | exit intrabar |
| Batas spread saat entry | 2% | `lib/validate.js` |
| Kill switch | `KILL_SWITCH=1` atau `?kill=1` / `?resume=1` (tanpa deploy ulang) | `lib/store.js` + `api/tick.js` |

- **Hari WIB**: batas harian dihitung 00.00–23.59 WIB (17.00 UTC hari sebelumnya).
- **Daily loss limit** memblokir *entry baru* sampai hari WIB berikutnya; posisi yang
  sudah ada tetap boleh keluar (stop loss / sinyal jual), karena menghentikan exit
  justru menambah risiko. Setiap blokir dicatat di `logs/errors.ndjson`.
- **Idempotency**: setiap pasangan menyimpan `lastProcessed` (waktu candle terakhir
  yang diproses). Pemanggilan kedua untuk candle yang sama — termasuk retry setelah
  timeout — tidak membuka posisi kedua.
- **Bounded retry**: maksimal 3 percobaan per request dengan backoff eksponensial;
  request diserialkan ±2,8/detik (batas API 180/menit).

---

## 4. Model biaya (fee + spread + slippage)

Backtest **tidak** memakai harga close maupun mid. Setiap fill memakai:

```
beli : open[t+1] × (1 + (spread_pair/2 + slippage)/100)
jual : open[t+1] × (1 − (spread_pair/2 + slippage)/100)
fee  : 0,30% × nilai transaksi, per sisi
```

| Komponen | Nilai yang dipakai | Sumber |
|---|---|---|
| Fee taker | **0,30% per sisi** | halaman resmi *Rincian Biaya Transaksi* Indodax. API `/api/pairs` melaporkan 0,20%; dipakai angka **lebih mahal** agar konservatif |
| Spread | **per pasangan**, median 3 snapshot order book (5 level teratas) | `logs/snapshots.ndjson`, lihat `data/cost.json` |
| Slippage | median `slipPct` order nyata; minimum **5 bp** | `logs/orders.ndjson` |

Nilai yang benar-benar dipakai ditulis ke `data/cost.json` setiap kali backtest
dijalankan, lengkap dengan jumlah snapshot dan median per pasangan — sehingga
angka biaya bisa diaudit ulang.

Untuk **forward test** biaya tidak dimodelkan: bot menelusuri order book live
(`fillBuy`/`fillSell`) dan mencatat `slipPct`, `spreadPct`, `bestBid`, `bestAsk`,
`avgPrice` per order.

---

## 5. Backtest

- Periode: **10 Nov 2023 – 10 Nov 2026** (1.096 hari, candle 1 jam, 28.051 bar per
  pasangan, 0 celah; `data/fetch_report.json`).
- Portofolio, bukan per-pasangan: kas bersama, maksimum 5 posisi, 20% ekuitas/posisi.
- Urutan tiap bar **identik** dengan urutan keputusan bot:
  exit → entry → mark-to-market → hitung sinyal (dieksekusi bar berikutnya).
- Benchmark: buy & hold BTC/IDR dengan biaya yang sama.
- **Uji parameter** (`logs/validity.json`): 36 kombinasi (N × M × SL) di 70% data
  pertama, diuji pada 30% terakhir (out-of-sample), plus sensitivitas ±30% di sekitar
  parameter beku. Parameter **tidak** dipilih ulang dari hasil uji ini.

### Hasil (angka lengkap: `logs/backtest_result.json`, ringkasan: `data/backtest_summary.mjs`)

| Metrik | Nilai |
|---|---:|
| Return total 3 tahun | **+22,88%** |
| CAGR | **+7,11%** |
| Max drawdown | **33,79%** |
| Profit factor | 1,15 |
| Jumlah trade | 470 |
| Win rate | 18,5% |
| Biaya / laba kotor | 31,2% |
| Benchmark BTC/IDR | +130,71% |
| Out-of-sample (30% terakhir, 330 hari) | **−7,26% CAGR**, MDD 9,83% |
| Backtest 10 hari terakhir (31 Okt–10 Nov 2026) | 0,00% vs benchmark **−7,32%** |

Interpretasi jujur: strategi **tidak** mengalahkan buy & hold BTC pada periode bull,
tetapi membatasi kerugian saat pasar turun (out-of-sample dan 10 hari terakhir).
Rinciannya ada di `REFLEKSI.md`.

---

## 6. Validasi data sebelum keputusan

Semua penolakan dicatat beserta alasannya di `logs/errors.ndjson`.

| Pemeriksaan | Perlakuan |
|---|---|
| Candle yang masih berjalan | dibuang (`closedBars`) |
| Candle tertutup terakhir lebih tua dari 2× timeframe | pasangan dilewati |
| Gap/duplikat timestamp di jendela indikator | pasangan dilewati |
| Harga nol/negatif | pasangan dilewati |
| Volume nol pada candle keputusan (terakhir) | pasangan dilewati |
| Volume nol di tengah jendela (jam tanpa transaksi) | boleh, dihitung di `zeroVolumeBars`; bar itu tidak dipakai untuk eksekusi |
| Order book kosong / satu sisi | entry & exit ditunda, dicatat |
| Spread > 2% | entry diblokir |

Catatan: jam tanpa transaksi memang ada di Indodax (±100 bar dari 28.051 untuk
pasangan besar, ±1.870 untuk LINK). Karena itu volume nol di tengah jendela
indikator tidak membatalkan seluruh seri — kalau dibatalkan, pasangan akan sering
mati total dan backtest (yang tetap memakai bar tersebut untuk MA) jadi tidak
sebanding dengan bot.

---

## 7. Perubahan dari UTS

| Aspek | UTS | UAS | Alasan |
|---|---|---|---|
| Pasar | pasar saham/umum | **Indodax spot IDR** | tugas UAS |
| Timeframe | harian | **1 jam** | jendela forward hanya 10 hari |
| Aturan keluar | `close < MA_N` (MA cepat) | **`close < MA_M` (MA lambat)** | MA cepat yang sama dipakai masuk & keluar → whipsaw rata-rata 3 jam/trade; biaya menghabiskan hasil |
| Eksekusi | harga close / asumsi mid | **bid/ask order book + spread + slippage + fee** | tugas menilai realisme eksekusi |
| Universe | 1 aset | **8 pasangan, likuiditas diukur di awal periode** | diversifikasi + hindari survivorship bias |
| Sizing | 100% modal per sinyal | **20% ekuitas/posisi, maks 5 posisi, 5% ATV** | risiko |
| Stop loss / batas harian | tidak ada | **8% per posisi + 3% kerugian harian (WIB)** | risiko |
| Short | diizinkan (bila ada) | **tidak ada** (long-only) | aturan UAS |
| Validasi data | tidak ada | candle berjalan, stale, gap, nol, book kosong, spread | tugas |
| Log | print konsol | **NDJSON mentah + state persisten + dashboard yang dihitung ulang** | tugas |
| Penjadwal | manual | GitHub Actions tiap jam (menit ke-7) | Vercel Hobby hanya cron harian |

Yang **tidak** berubah dari UTS: aturan masuk (crossing MA cepat + filter tren
MA cepat > MA lambat), long-only, dan konsep trend following.

---

## 8. Mengapa aturan keluar diubah (bukti dari data)

Backtest awal dengan aturan UTS apa adanya (`N=100`, `M=150`, keluar di `MA_N`):

| Konfigurasi | Return 3 tahun | Trade | Biaya/laba kotor |
|---|---:|---:|---:|
| UTS apa adanya (exit MA_N) | −85,6% | 1.386 | 132% |
| Exit MA_M, N=100/M=300 | −40,2% | 430 | 49% |
| **Exit MA_M, N=150/M=400 (dipakai)** | **+22,9%** | 470 | 31% |

Analisis pada BTC: median waktu pegang dengan aturan UTS hanya **3 jam**, dan 93 dari
314 trade selesai dalam **1 candle** — masuk di crossing, langsung keluar karena
harga berayun di sekitar MA yang sama. Dengan biaya pulang-pergi ±0,5–0,8%, pola itu
tidak mungkin profitable. Memindahkan exit ke MA lambat membuat tren punya ruang
bernapas dan menurunkan biaya dari 132% menjadi 31% dari laba kotor.

---

## 9. Prosedur pembekuan

1. Semua parameter di `lib/config.js` (termasuk `UNIVERSE`) dikunci; commit diberi
   tag `freeze-2026-11-11`.
2. Commit yang sama memuat `data/backtest_summary.mjs`, `data/cost.json`,
   `data/liquidity.json`, `data/backtest_trades.csv`, dan `logs/validity.json` —
   bukti bahwa seluruh angka backtest sudah ada **sebelum** forward test dimulai.
3. Setelah 11 November 2026 12:00 WIB hanya boleh berubah: perbaikan bug yang tidak
   mengubah sinyal/parameter, dokumentasi, dan konfigurasi deployment. Perubahan
   parameter apa pun membatalkan keabsahan forward test (dan harus dicatat di
   `REFLEKSI.md` bila terpaksa dilakukan).
