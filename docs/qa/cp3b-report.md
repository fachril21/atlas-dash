# Laporan QA CP3b

**Oleh:** 🧪 QA · **Tanggal:** 2026-11-16 · **Build:** CP3b di `main` (tanpa perubahan `src/`)

## Hasil jalan

| Perintah | Hasil |
|---|---|
| `npm test` | 10 file, **169 test lulus** (161 lama + 8 baru di `tests/cp3b.test.ts`) |
| `npm run build` (typecheck + vite build) | lulus; JS 628 kB (gzip 162 kB) |
| `npm run test:e2e` (Chromium headless, SwiftShader) | 62 terjadwal: **59 lulus, 3 skip, 0 gagal**. Skip = 3 tes khusus keyboard di project mobile. CP3a: 23 lulus + 1 skip (sama seperti sebelumnya, tidak ada regresi). CP3b baru: 36 lulus + 2 skip (desktop 19, mobile 17 + 2 skip) |

Tes baru: `tests/e2e/cp3b.spec.ts` (19 tes x desktop + mobile) dan `tests/cp3b.test.ts` (cooldown literal 8/6/4 + batas Mulai, pick rule 300 seed x 6 win dengan gagal-ulang di tengah, registry 2D/3D, kalimat intro <= 8 kata, level deterministik). Seed dicari otomatis dengan memutar ulang reducer di node (bukan angka tetap), lalu tes memastikan browser menghasilkan attempt yang sama.

## Kriteria penerimaan CP3b

| Kriteria | Status | Bukti |
|---|---|---|
| Simon: ronde benar maju tanpa miss, tap saat playback/delay diabaikan (bukan mistake) | LULUS | e2e `a correct round advances...` |
| Simon: pad salah = 1 miss, ronde diulang dari awal | LULUS | e2e `a wrong pad costs one miss...` |
| Simon: idle 3 s = 1 miss (DR-19) | LULUS | e2e `idle for 3 s...` + unit `simon.test.ts` |
| Simon: lulus (bermain sempurna, win dihitung di race) dan gagal (miss > batas, cooldown mulai) | LULUS | e2e `pass:` / `fail:` |
| Simon: pad >= 48 px, glyph bentuk (bukan warna saja), jumlah pad sesuai difficulty, tanpa scroll horizontal; Digit 1-N di desktop | LULUS | e2e `mg_simon_ui`, `digit keys` |
| Dodge: pindah jalur dengan tap kiri/kanan, swipe (arah menang atas separuh layar), tombol panah dan A/D | LULUS | e2e (swipe = event pointer sintetis bertimestamp) |
| Dodge: satu gestur = satu pindah (tahan 500 ms tidak pindah dua kali; drag vertikal tidak pindah) | LULUS | e2e `one gesture = one move` + unit `laneGesture.test.ts` |
| Dodge: nyawa turun bertahap (`mg-lives`), nyawa habis = gagal + cooldown | LULUS | e2e `losing lives` |
| Dodge: lulus dengan bertahan sampai akhir (bot di halaman menghindar berdasarkan `rows`) | LULUS | e2e `pass:` |
| Dodge 3D: canvas dibuat saat minigame dibuka, race renderer berhenti (frame counter tidak naik), canvas dihapus setelah ditutup, race view render lagi, board masih bisa dipilih | LULUS | e2e `3D canvas...` |
| Pick rule: tidak pernah sama dua kali setelah win (8 win berturut, seed 42; 1.800 win di unit) | LULUS | e2e + unit |
| Pick rule: gagal = minigame sama, intro 1,5 s, seed level baru; setelah win diundi ulang, intro 3 s | LULUS | e2e + unit |
| Pick rule: pilihan tersembunyi sampai Mulai (panel target, toast, daftar progres tidak memuat id/kalimat intro/ikon; ganti target tidak membocorkan); overlay baru terisi setelah Mulai | LULUS (lihat B-1) | e2e `stays hidden` |
| Cooldown 8/6/4 s (easy/medium/hard) | LULUS | unit (nilai literal + batas tepat, tolak sebelum habis, terima tepat setelahnya) + e2e (padang 4, medan 6, yogyakarta 8, tombol Mulai nonaktif, timer tampil, ganti target saat cooldown tidak mereset cooldown) |
| Regresi CP3a | LULUS | 23 lulus + 1 skip, sama dengan laporan CP3a |
| Tanpa error console di semua alur | LULUS | `consoleErrors` kosong di tiap tes yang memeriksanya |

## Cek leak GPU / memori (dodge)

10 siklus buka-tutup dalam satu sesi (Mulai -> fase main -> tutup lewat banner), desktop dan mobile:

- Jumlah `<canvas>` kembali ke baseline (1) setelah **setiap** siklus; `mg-canvas` 0 setelah tutup.
- Konteks WebGL: 11 dibuat (1 race + 10 dodge), **10 menerima `webglcontextlost`** (`forceContextLoss` di `dispose`). Tidak ada konteks dodge yang tersisa.
- Console: 0 error, 0 warning bertema WebGL/context/GPU/three.
- Heap JS (setelah GC paksa lewat CDP): siklus 1 = 5,66 MB, siklus 10 = 6,16 MB (desktop); 5,74 -> 6,26 MB (mobile). Naik ~0,5 MB dalam 9 siklus, di batas noise (sebagian dari log debug dan buffer event); tidak ada tren bocor yang jelas, tapi 10 siklus tidak cukup untuk menyatakan nol bocor.
- Catatan: `renderer.info.memory` milik renderer dodge tidak terekspos hook debug, jadi geometri/tekstur three.js tidak dihitung langsung; kebersihan disimpulkan dari konteks yang hilang, canvas, dan heap.

## Bug

Tidak ada bug blocker/mayor. Temuan:

| ID | Severity | Ringkasan |
|---|---|---|
| B-1 | Rendah (kosmetik/DOM saja) | Setelah minigame pertama ditutup, `.mg-overlay` tetap membawa atribut `data-minigame` dari percobaan terakhir (`MinigameHost.close()` tidak menghapusnya; hanya `data-phase` yang dihapus). Overlay `hidden`, jadi pemain tidak melihatnya dan HUD tidak membocorkan undian berikutnya. Langkah: buka minigame, tutup, inspeksi `[data-testid=mg-overlay]`. Harapan: atribut dihapus saat tutup. Aktual: atribut lama tersisa. Bukti: `src/ui/minigameHost.ts` (open set, close tidak delete). Saran: `delete this.overlay.dataset.minigame` di `close()`. |
| B-2 | Info (bukan bug game) | Swipe dengan `page.mouse` headless ~6 fps bisa diputuskan sebagai tap tahan 100 ms (tick frame berjalan antara pointerdown dan pointermove). Sesuai catatan Engineer; tes memakai event sintetis bertimestamp. Perlu dicek ulang di HP (frame nyata). |

Catatan tes (bukan bug): `expect.poll` pada state saat attempt baru dimulai: `startAttempt` diproses di frame berikutnya, jadi `attempt` sesaat null setelah tekan Mulai; tes menunggu dulu.

## Perlu HP asli / playtest manual

- Rasa Simon di HP: latensi tap pad, nada audio (WebAudio butuh tap pertama di iOS), getar saat salah, pad >= 48 px dengan jempol.
- Dodge di HP: gestur swipe dan tap-tahan 100 ms dengan jari dan 60 fps asli, kebenaran keputusan gestur pada frame rate nyata (B-2), apakah tap kiri/kanan terasa responsif, kontrol tidak menggulir halaman.
- Performa 3D: p95 frame <= 33,3 ms, tris <= 60k, hitch saat minigame 3D pertama dibuka, pembuatan konteks WebGL kedua di iOS Safari (batas konteks, context lost), thermal setelah banyak ronde.
- Keterbacaan jalur dan rintangan 3D (becak, bajaj, dst.) di layar kecil dengan font nyata; hati (nyawa) dan angka tidak terukur di mesin tanpa font.
- Aturan 3 detik untuk Simon dan Hindari Rintangan (3 orang baru), dan anggaran waktu Simon hard (6 pad, 30 s) oleh pemain kasual.
- Auto-pause `visibilitychange` saat dodge terbuka (renderer sendiri ikut berhenti?) dan rotasi portrait/landscape saat dodge (resize canvas).
- Leak jangka panjang: 1 match penuh + "Main Lagi" dengan overlay `renderer.info` di perangkat nyata; 10 siklus di sini hanya cek awal.
