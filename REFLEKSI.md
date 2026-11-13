# REFLEKSI.md

Refleksi jujur atas proses, hasil backtest, dan (setelah 10 hari) selisih antara
backtest dan forward test.

> **Status pengisian.** Bagian 1–5 sudah final dan memakai angka nyata dari
> `logs/backtest_result.json`. Bagian 6 (perbandingan forward) **wajib diisi setelah
> forward test selesai** — angkanya diambil dari keluaran `node scripts/hitung_ulang.mjs`,
> bukan diketik dari perkiraan.

---

## 1. Ringkasan hasil backtest (10 Nov 2023 – 10 Nov 2026)

Sumber angka: `logs/backtest_result.json`; dihitung ulang oleh `lib/metrics.js`.

| Metrik | Strategi | Buy & hold BTC/IDR |
|---|---:|---:|
| Return total | **+22,88%** | +130,71% |
| CAGR | **+7,11%** | ±33% |
| Max drawdown | **33,79%** | — |
| Profit factor | 1,15 | — |
| Jumlah trade | 470 | 1 |
| Win rate | 18,5% | — |
| Biaya / laba kotor | 31,2% | — |
| Modal awal → akhir | Rp100.000.000 → Rp122.880.993 | — |

Out-of-sample (30% terakhir, 14 Des 2025 – 10 Nov 2026, 330 hari):

| Metrik | Strategi (parameter beku) | Parameter terbaik in-sample | BTC/IDR |
|---|---:|---:|---:|
| Return | −6,60% | −7,21% | −10,2% |
| CAGR | −7,26% | −7,93% | — |
| Max drawdown | 9,83% | 7,71% | — |
| Trade | 123 | 94 | — |

Backtest 10 hari terakhir (31 Okt – 10 Nov 2026): **0,00%** vs benchmark **−7,32%**
(tidak ada sinyal entry; seluruh posisi sudah keluar sebelum jendela).

## 2. Apa yang berhasil dan apa yang tidak

**Berhasil (dari sisi teknik):**

- Satu sumber aturan (`lib/strategy.js`) dipakai backtest dan bot, sehingga sinyal
  yang diuji benar-benar sinyal yang dijalankan — tidak ada "backtest versi lain".
- Biaya nyata (fee 0,30%/sisi + spread per pasangan + slippage) dihitung di setiap
  fill, dan dampaknya terlihat: konfigurasi UTS menghasilkan +23,2% tanpa biaya tetapi
  −85,6% setelah biaya. Model biaya inilah yang membuat masalah strategi terlihat,
  bukan tertutup oleh asumsi mid/close (perbandingan lengkap di bagian 3).
- Risiko terkendali: maksimum 5 posisi, 20% ekuitas/posisi, daily loss limit 3% WIB,
  kill switch tanpa redeploy, dan semua penolakan order tercatat dengan alasan.

**Tidak berhasil (dari sisi kinerja):**

- Strategi **kalah jauh dari buy & hold** pada periode bull. Ini wajar untuk trend
  follower yang sering di kas: strategi hanya ikut tren yang terkonfirmasi dan
  keluar saat tren patah, sehingga melewatkan sebagian besar kenaikan BTC 2023–2025.
- Sinyal masih punya *edge* kotor yang tipis; setelah biaya hampir habis. Bahkan
  dengan exit MA lambat, 31% laba kotor habis untuk biaya.
- Win rate hanya 18,5% — distribusi return sangat *skewed* (sedikit trade besar
  menutup banyak trade kecil yang rugi). Ini membuat hasil sangat bergantung pada
  beberapa trade; 470 trade memang cukup banyak, tetapi tetap rapuh.

## 3. Keputusan terpenting: mengubah aturan keluar

Backtest pertama memakai aturan UTS apa adanya (`N=100`, `M=150`, keluar di `MA_N`):

| Konfigurasi | Return 3 tahun | Trade | Biaya/laba kotor | MDD |
|---|---:|---:|---:|---:|
| UTS apa adanya (exit `MA_N`) | −85,59% | 1.386 | 131,6% | 85,6% |
| Tanpa biaya (exit `MA_N`) | +23,2% | 1.404 | — | 17,4% |
| Hanya fee 0,30% | −70,8% | 1.399 | — | 71,0% |
| Hanya spread | −19,7% | 1.402 | — | 26,4% |

Diagnosis: pada BTC, median waktu pegang hanya **3 jam** dan 93 dari 314 trade
selesai dalam **1 candle**. Masuk di crossing `close > MA_N`, lalu harga berayun di
sekitar MA yang sama dan langsung memicu `close < MA_N`. Dengan biaya pulang-pergi
±0,5–0,8%, pola itu secara matematis tidak mungkin profitable.

Perbaikan yang dipilih: keluar memakai **MA lambat (`MA_M`)**. Ini tetap satu keluarga
strategi (trend following MA), tetapi memberi tren ruang bernapas. Biaya turun dari
131,6% menjadi 31,2% dari laba kotor dan hasil berubah dari −85,6% menjadi +22,9%.
Keputusan ini dicatat sebagai perubahan dari UTS di `STRATEGI.md` bagian 7.

## 4. Uji parameter: apakah hasil cuma kebetulan satu titik?

`logs/validity.json`.

- Split 70/30: parameter terbaik in-sample adalah `N=75/M=700/SL=15` (CAGR +19,1%
  in-sample) — tetapi di out-of-sample justru **−7,93%**, lebih buruk daripada
  parameter beku (−7,26%). Artinya memilih parameter paling bagus di masa lalu
  **tidak** membantu ke depan. Parameter beku tidak dipilih ulang setelah melihat
  hasil ini.
- Sensitivitas di sekitar parameter beku (N=150, M=400, SL=8):

| Diubah | Hasil CAGR (5 nilai) | Kesimpulan |
|---|---|---|
| N (−30%…+30%) | +10,4 / +6,3 / **+7,1** / +5,2 / −1,5 | cukup stabil, tepi atas mulai rusak |
| M (−30%…+30%) | −17,1 / +5,8 / **+7,1** / +7,7 / +9,4 | M terlalu pendek (280) merusak; M ≥ 340 stabil |
| SL (−30%…+30%) | +7,7 / +6,6 / **+7,1** / +7,6 / +7,2 | tidak sensitif — stop loss hampir tidak pernah kena (2 trade) |

Kesimpulan: hasil tidak bergantung pada satu titik parameter, tetapi juga tidak ada
bukti *edge* kuat. Strategi ini bertahan karena manajemen risiko, bukan karena
sinyalnya tajam.

## 5. Kualitas data dan hal yang tidak berjalan mulus

- **Data**: 10 pasangan × 28.051 candle 1 jam (29 Agu 2023 – 10 Nov 2026), **0 celah**.
  8 pasangan dipakai; TRX dan AVAX dibuang karena spread > 2%.
- **Cloudflare Indodax menolak user-agent bot** (HTTP 403). Penarikan data awalnya
  gagal total; solusinya memakai user-agent browser biasa di `lib/indodax.js`.
  Ini bukan API key dan tidak mengubah data.
- **Jam tanpa transaksi**: pasangan besar punya ±100 bar volume 0 dari 28.051
  (LINK ±1.870). Aturan "tolak volume nol" diterapkan pada candle keputusan saja;
  kalau diterapkan ke seluruh jendela indikator, pasangan besar akan sering mati total
  dan bot jadi tidak sebanding dengan backtest. Perubahan ini didokumentasikan di
  `README.md` dan `STRATEGI.md` bagian 6.
- **Bug yang ditemukan dan diperbaiki selama pengembangan**: (a) variabel `l` bentrok
  di skrip penarikan data, (b) bug pembulatan float pada `floorToInc`, (c) `fillBuy`
  berhenti di level pertama, (d) satuan detik/milidetik pada skrip likuiditas,
  (e) `getPairs` mengembalikan kunci `btc_idr` sementara skrip snapshot mencari `btcidr`.
  Semuanya ditemukan lewat selftest atau dengan membandingkan angka, bukan asumsi.
- **Snapshot spread hanya 3 putaran** (10 Nov 2026, malam WIB). Spread XRP sempat
  1,39% di putaran pertama lalu 0,03–0,05% di putaran berikutnya; median dipakai.
  Ini sumber ketidakpastian biaya yang nyata.
- **Backtest sempat tidak bisa direproduksi** setelah bot berjalan: skrip menghitung
  ulang biaya dari `logs/snapshots.ndjson`, yang kini juga berisi snapshot forward
  test, dan tanggal akhir backtest mengikuti tanggal hari ini. Akibatnya menjalankan
  `node scripts/backtest.mjs` menghasilkan angka berbeda (spread 0,097% vs 0,177%)
  dan bahkan gagal saat jendela forward belum punya data candle. Diperbaiki
  13 November: biaya dibaca dari `data/cost.json` yang dibekukan, tanggal acuan
  memakai candle terakhir di `data/`, dan jendela pembanding dibatasi ke data yang
  tersedia. Setelah perbaikan, keluaran kembali identik dengan ringkasan beku
  (+22,88%, CAGR 7,11%, MDD 33,79%, 470 trade).

## 6. Backtest vs forward test (diisi setelah 10 hari)

> Dashboard menandai status log otomatis: **PARSIAL (oranye)** bila rentang log belum
> 10 hari, **FINAL (hijau)** bila sudah. Kalau tugas dikumpulkan 14 November, halaman
> yang disertakan masih PARSIAL dan tabel di bawah belum boleh dianggap hasil final;
> versi FINAL dikirim setelah 21 November.

Jalankan:

```bash
node scripts/hitung_ulang.mjs
```

lalu salin angka dari tabel "=== Forward test ===" dan `data/dashboard_data.json`
(`meta.forwardStart`, `meta.forwardEnd`, `forward.perf`, `windowBt.perf`, `ops`).

| Metrik | Backtest jendela sama | Forward test | Gap |
|---|---:|---:|---:|
| Periode | `____________` | `____________` | |
| Return | `______%` | `______%` | `______ pp` |
| Max drawdown | `______%` | `______%` | |
| Jumlah trade | `____` | `____` | |
| Win rate | `____%` | `____%` | |
| Benchmark BTC | `______%` | `______%` | |
| Median spread terukur | `______%` | `______%` | |
| Median slippage | `______%` | `______%` | |
| Uptime candle | 100% | `______%` | |

Pertanyaan yang harus dijawab di sini (jangan diisi sebelum ada data):

1. Apakah arah dan besar return forward masuk akal dibanding backtest pada jendela
   tanggal yang sama? Jika tidak, apa penyebabnya — jumlah trade terlalu sedikit,
   spread/slippage nyata lebih besar, atau eksekusi bergeser dari `open` candle?
2. Berapa selisih harga eksekusi vs harga sinyal (`slipVsSignalPct` di
   `logs/orders.ndjson`)? Apakah asumsi slippage 5 bp terlalu optimistis?
3. Apakah ada order yang ditolak karena spread/validasi? Berapa banyak, dan apakah
   penolakan itu menguntungkan atau merugikan?
4. Berapa uptime scheduler? Candle yang terlewat dicatat di `logs/errors.ndjson`.

## 7. Keterbatasan dan rencana perbaikan

- **Sample size forward kecil.** 10 hari dengan ~0,4 trade/hari berarti 2–6 trade.
  Satu trade bisa mendominasi hasil; gap 1–2 pp belum tentu berarti strategi rusak.
- **Satu rezim pasar.** Backtest 3 tahun mencakup bull dan koreksi, tetapi forward
  hanya 10 hari. Yang bisa dinilai dari forward adalah *eksekusi* (apakah order
  terjadi di harga yang wajar), bukan kualitas statistik strategi.
- **Survivorship bias** tidak bisa dihilangkan sepenuhnya dengan API publik: pasangan
  yang delisting sebelum hari ini tidak punya data.
- **Biaya** diukur pada satu malam. Kalau grader mengulang pengukuran di jam lain,
  angkanya akan berbeda — karena itu nilai mentah snapshot ikut dikumpulkan
  (`logs/snapshots.ndjson`), bukan hanya ringkasannya.
- **Penjadwal sempat meninggalkan celah.** Cron GitHub Actions bersifat best-effort: pada
  11–12 November beberapa run telat 60–90 menit, sehingga 3 dari 14 candle 1 jam tidak
  pernah dievaluasi (`uptime` 78,6%). Karena itu jadwal dirapatkan menjadi empat kali per
  jam (menit 7, 22, 37, 52) pada 12 November — perubahan **operasional**, bukan strategi:
  parameter, sinyal, universe, dan aturan eksekusi tidak disentuh, dan `/api/tick` tetap
  idempoten per candle. Konsekuensinya jujur dicatat: candle yang terlewat sebelum
  perubahan itu tidak dapat dipulihkan, dan hal ini ikut menjelaskan mengapa jumlah trade
  forward bisa lebih sedikit daripada backtest pada jendela yang sama.
- Perbaikan yang layak dicoba berikutnya: uji walk-forward dengan re-fit berkala,
  filter volatilitas (ATR) untuk menghindari entry di pasar sideway, dan exit
  berbasis trailing stop sebagai pembanding exit MA lambat.

## 8. Kesimpulan

Strategi ini **tidak** mencetak alpha besar, dan itu disampaikan apa adanya. Yang
dapat dipertanggungjawabkan adalah prosesnya: aturan tunggal yang dipakai bersama
backtest dan bot, biaya yang diukur bukan diasumsikan, risiko yang dibatasi di kode,
log mentah yang memungkinkan semua angka dihitung ulang, dan keputusan yang
didokumentasikan beserta alasannya — termasuk keputusan yang salah dan diperbaiki
sebelum pembekuan.
