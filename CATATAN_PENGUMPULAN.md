# Catatan pengumpulan — 14 November 2026

**Nama:** Shinta Faradillah Destiany
**NIM:** 25110200007
**Mata kuliah:** UAS Algoritma Trading

## Status paket ini: PARSIAL

Paket ini dikumpulkan **14 November 2026 pukul 18.55 WIB**. Forward test baru
berjalan **2,2 dari 10 hari** (log sudah menyentuh 4 tanggal: 11–14 November).

Angka forward test yang tertera karena itu **belum final** dan tidak boleh
dibandingkan langsung dengan backtest 3 tahun sebagai hasil akhir. Halaman
dashboard memberi label **LOG PARSIAL (oranye)** supaya tidak tertukar dengan
versi final.

Forward test genap 10 hari pada **21 November 2026 ± 20.31 WIB**. Setelah itu
akan dikirim addendum berisi:

- log mentah 10 hari penuh,
- `dashboard.html` berlabel **LOG FINAL (hijau)**,
- tabel perbandingan backtest vs forward test pada jendela yang sama
  (`REFLEKSI.md` bagian 6).

## Isi paket

| Berkas | Isi |
|---|---|
| `dashboard.html` | dashboard offline, dicetak dari log mentah per 14 Nov 18.55 WIB |
| `bukti/dashboard_PARSIAL_2026-11-14.html` | salinan bertanggal dari file di atas (untuk arsip) |
| `bukti/freeze.txt` | bukti pembekuan dari Git: tag, tanggal, dan diff nol pada logika strategi |
| `bukti/SHA256SUMS_2026-11-14.txt` | checksum seluruh berkas penting, untuk memeriksa keutuhan |
| `bukti/README.md` | penjelasan isi folder `bukti/` dan cara memeriksanya |
| `logs/*.ndjson` | log mentah: tick, order, ekuitas, error, snapshot order book, candle |
| `data/backtest_summary.mjs` | ringkasan backtest 3 tahun yang dipakai dashboard |
| `STRATEGI.md`, `REFLEKSI.md` | aturan beku, alasan keputusan, keterbatasan |
| `.env.example` | contoh konfigurasi — **tanpa secret asli**, hanya placeholder |
| `CHANGELOG.md` | riwayat pekerjaan per tanggal + hash commit |

`dashboard.html` adalah file mandiri: tidak memuat CDN, tidak butuh internet,
bisa dibuka langsung dengan klik dua kali.

## Bukti freeze

Parameter dibekukan pada **11 November 2026 pukul 11.13 WIB** dan ditandai dengan
annotated tag `freeze-2026-11-11` yang menunjuk commit
`733e25fd70b7f9888fac7775c432b116a5172950`. Bukti lengkapnya ada di
`bukti/freeze.txt`, yang dibuat langsung dari repository (bukan ditulis tangan)
dan memuat:

- isi objek tag beserta tanggal dan pesan pembekuannya,
- perintah `git diff` pada `lib/config.js`, `lib/strategy.js`, `lib/backtest.js`,
  `lib/bot.js`, `lib/exec.js`, dan `lib/validate.js` sejak freeze sampai commit
  terakhir — **hasilnya kosong**, artinya tidak ada satu baris pun logika
  strategi yang berubah setelah dibekukan,
- daftar berkas yang berubah sejak freeze (hanya operasional, tampilan,
  dokumentasi, dan penambahan log),
- parameter beku apa adanya dari `lib/config.js`.

Arsip ZIP sengaja tidak memuat folder `.git`. Untuk memverifikasi tag, jalankan
dari repo:

```bash
git tag --list                                  # freeze-2026-11-11
git rev-parse freeze-2026-11-11^{commit}         # 733e25fd70b7f9888fac7775c432b116a5172950
git diff --stat freeze-2026-11-11..HEAD -- lib/config.js lib/strategy.js   # harus kosong
```

## Angka pada saat pencetakan

| Metrik | Nilai |
|---|---|
| Backtest 3 tahun (10 Nov 2023 – 10 Nov 2026) | +22,88% · CAGR 7,11% · max DD 33,79% · 470 trade |
| Benchmark BTC/IDR (biaya sama) | +130,71% |
| Forward test | 0,00% · 0 trade · ekuitas Rp100.000.000 |
| Benchmark forward | −6,67% |
| Tick tercatat | 271 |
| Uptime candle | 90,1% (64/71) |
| Order | 0 (belum ada sinyal entry) |

## Cara memeriksa ulang (tanpa langkah manual)

Butuh Node.js ≥ 18. Tidak perlu `npm install` (proyek tanpa dependensi), tidak
perlu akun, tidak perlu API key.

```bash
node scripts/backtest.mjs       # harus menghasilkan +22,88%, CAGR 7,11%, MDD 33,79%, 470 trade
node scripts/hitung_ulang.mjs   # membangun ulang dashboard.html dari logs/*.ndjson
```

Backtest memakai tanggal acuan candle terakhir di `data/` (bukan tanggal hari
ini), dan biaya dibaca dari `data/cost.json` yang dibekukan, sehingga hasilnya
sama kapan pun dijalankan.

## Tautan

- Repo: https://github.com/shintafaradestiany-ctrl/indodax-dryrun-final
- Dashboard live (pelengkap, isinya berubah setiap tick):
  https://indodax-dryrun-final.vercel.app

> Halaman live akan berubah dan setelah 21 November otomatis berlabel FINAL.
> Bukti yang dikumpulkan tanggal 14 November adalah **file bertanggal** di paket
> ini, bukan halaman live.

## Integritas file

SHA-256 `dashboard.html` saat dicetak:

```
B653400724FC64D8901197BA3EA756B3DE3DCEA91E43BEFDC5268441961F02AF
```

Checksum seluruh berkas penting (dashboard, log mentah, data, dokumen) ada di
`bukti/SHA256SUMS_2026-11-14.txt`. Cara memeriksa di Windows:

```powershell
Get-FileHash dashboard.html -Algorithm SHA256
```

atau di Linux/macOS:

```bash
shasum -a 256 -c bukti/SHA256SUMS_2026-11-14.txt
```
