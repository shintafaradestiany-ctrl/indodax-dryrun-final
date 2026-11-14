# Isi folder `bukti/`

Folder ini menyimpan bukti yang tidak bisa dihasilkan ulang tanpa jejak aslinya.
Semua berkas di sini **statis** — tidak ikut berubah saat bot berjalan.

| Berkas | Isi |
|---|---|
| `dashboard_PARSIAL_2026-11-14.html` | salinan `dashboard.html` saat dicetak 14 Nov 2026 18.55 WIB. Isinya identik dengan `dashboard.html` di akar proyek (SHA-256 sama) |
| `freeze.txt` | bukti pembekuan parameter dari Git: isi tag `freeze-2026-11-11`, tanggal, dan hasil `git diff` yang membuktikan logika strategi tidak berubah setelah freeze |
| `SHA256SUMS_2026-11-14.txt` | checksum SHA-256 seluruh berkas penting pada saat pengumpulan |
| `README.md` | berkas ini |

## Kenapa dashboard-nya ada dua

- `dashboard.html` di akar proyek = **bukti yang dikumpulkan**. Statis; dibuka
  kapan pun angkanya tetap sama.
- `dashboard_PARSIAL_2026-11-14.html` = **arsip bertanggal** dari berkas yang
  sama, supaya jelas file mana yang dikumpulkan pada tanggal tersebut.
- `https://indodax-dryrun-final.vercel.app` = **halaman live**, pelengkap.
  Isinya dihitung ulang setiap halaman dibuka, sehingga angkanya bertambah dan
  setelah 21 November 2026 labelnya otomatis berubah menjadi FINAL.

Untuk penilaian, yang dipakai adalah berkas bertanggal di folder ini, bukan
halaman live.

## Cara memeriksa keutuhan berkas

Dari akar proyek (folder yang berisi `dashboard.html`):

Linux/macOS:

```bash
shasum -a 256 -c bukti/SHA256SUMS_2026-11-14.txt
```

Windows PowerShell (per berkas):

```powershell
Get-FileHash dashboard.html -Algorithm SHA256
```

Catatan: checksum diukur dari berkas di dalam arsip ZIP ini. Kalau diperiksa
dari hasil `git clone` di Windows, Git bisa mengubah akhir baris (LF → CRLF)
pada berkas teks sehingga hash-nya berbeda. Berkas HTML, JSON, dan NDJSON di
dalam ZIP adalah acuannya.

## Cara memeriksa freeze

```bash
git clone https://github.com/shintafaradestiany-ctrl/indodax-dryrun-final
cd indodax-dryrun-final
git tag --list
git rev-parse freeze-2026-11-11^{commit}
git diff --stat freeze-2026-11-11..HEAD -- lib/config.js lib/strategy.js
```

Hasil yang diharapkan: tag `freeze-2026-11-11`, commit
`733e25fd70b7f9888fac7775c432b116a5172950`, dan diff **kosong** (tidak ada
perubahan logika strategi setelah dibekukan).
