# Riwayat perubahan

Catatan ini dibuat agar urutan pekerjaan bisa diperiksa tanpa harus menebak dari
nama file. Semua waktu **WIB**. Hash commit bisa dicek langsung dengan
`git show <hash>`.

Repo ini sengaja dimulai pada 11 November 2026, dipisahkan dari repo eksperimen
sebelumnya (`indodax-dryrun`, strategi harian MA100/150) supaya versi yang
dikumpulkan tidak tercampur dengan versi lain. Pekerjaan 10 November karena itu
tidak muncul sebagai commit, tetapi buktinya tersimpan di dalam file yang
di-commit (timestamp di `data/fetch_report.json`, `data/cost.json`, dan
`logs/validity.json`).

## 10 November 2026 — data, biaya, backtest awal

| Waktu | Kegiatan | Bukti |
|---|---|---|
| 20.32 | Tarik 10 kandidat pair, candle 1 jam, 2023-08-29 s/d 2026-11-10 | `data/fetch_report.json` (`startedAt`, 44 request/pair, 0 gap) |
| 20.38 | Ukur likuiditas pada **awal** periode backtest, pilih 8 pair | `data/liquidity.json` |
| 20.41 | Ukur order book 26 snapshot → spread median 0,1773% | `data/cost.json` (`computedAt`, `snapshotsUsed: 22`) |
| 20.42 | Backtest 3 tahun + uji parameter | `data/backtest_summary.mjs`, `logs/validity.json` |

## 11 November 2026 — pembekuan dan deploy

| Waktu | Commit | Isi |
|---|---|---|
| 09.43 | — | `STRATEGI.md` selesai (aturan, universe, biaya, prosedur freeze) |
| 11.13 | `733e25f` | **Freeze UAS** — dikunci dengan tag `freeze-2026-11-11` |
| 20.31 | — | Forward test dimulai (tick pertama) |
| 20.38 | `dd8f34e` | Endpoint diagnostik read-only `/api/status` |
| 21.18 | `38a80d6` | `/api/export` + `scripts/pull_logs.mjs` (tarik log dari server) |
| 21.25 | `ed4a4d0` | Dashboard: bedakan "belum ada log" vs "log masuk, return butuh ≥2 hari" |
| 21.57 | `cb6c435` | Label status log otomatis: **PARSIAL (oranye)** / **FINAL (hijau)** |

Semua commit setelah freeze hanya menyentuh operasional dan tampilan. Parameter
strategi (N=150, M=400, SL 8%, universe 8 pair, fee, batas risiko) tidak berubah.

## 12 November 2026 — penjadwalan

| Waktu | Commit | Isi |
|---|---|---|
| 10.37 | `e288223` | Snapshot log forward (13 tick) + dashboard PARSIAL |
| 10.45 | `fcc92bd` | Jadwal GitHub dirapatkan jadi 4×/jam (menit 7, 22, 37, 52) |
| 18.00 | — | Penjadwal cadangan **cron-job.org** tiap 15 menit diaktifkan |
| 19.03 | `13ac880` | Snapshot log forward (28 tick) |

Alasan: cron GitHub bersifat best-effort. Pada 11–12 November beberapa run telat
60–90 menit sehingga 4 dari 23 candle tidak dievaluasi (uptime 82,6%). Tick
tambahan aman karena `/api/tick` idempoten per candle — terbukti: empat tick pada
candle 17.00 hanya diproses sekali, tanpa order ganda.

## 13 November 2026 — perbaikan reproduksibilitas

| Commit | Isi |
|---|---|
| (lihat `git log`) | `scripts/backtest.mjs`: tanggal acuan memakai candle terakhir di `data/` (bukan tanggal hari ini), biaya dibaca dari `data/cost.json` yang dibekukan, dan jendela pembanding dibatasi ke data yang tersedia |

Kenapa diperbaiki: setelah bot berjalan, `logs/snapshots.ndjson` ikut terisi
snapshot forward test. Tanpa perbaikan ini, menjalankan `node scripts/backtest.mjs`
menghitung ulang biaya dari snapshot baru dan bisa gagal saat jendela forward
belum punya data candle — angkanya jadi tidak bisa direproduksi. Setelah
perbaikan, keluaran backtest kembali **persis sama** dengan ringkasan yang
dibekukan (+22,88%, CAGR 7,11%, MDD 33,79%, 470 trade).

## 13–21 November 2026 — forward test berjalan

Bot dipanggil cron-job.org setiap 15 menit (GitHub Actions sebagai cadangan).
Setiap hari log ditarik dengan `scripts/pull_logs.mjs`, lalu `scripts/hitung_ulang.mjs`
membangun ulang `dashboard.html` dari log mentah, dan hasilnya di-commit sebagai
snapshot bertanggal. Dengan begitu riwayat commit menunjukkan perkembangan
forward test hari demi hari, bukan satu unggahan di akhir.

## Setelah 21 November 2026

Forward test genap 10 hari. Langkah penutup: tarik log final, jalankan
`hitung_ulang.mjs` sampai status berubah **FINAL (hijau)**, isi tabel bagian 6
`REFLEKSI.md` dengan perbandingan backtest vs forward, lalu commit dan kirim
sebagai addendum.
