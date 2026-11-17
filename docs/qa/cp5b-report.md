# Laporan QA CP5b: Whack-a-Mole, Cocokkan Kartu, Tebak Lokasi, Ketapel 3D, pool 7 minigame, retune sim

**Oleh:** 🧪 QA · **Tanggal:** 2026-11-17 · **Acuan:** [minigames.md v0.5](../minigames.md) §5-§10 (kriteria A-G) · [cards.md v0.6](../cards.md) §5.1 · [map-indonesia.md v0.4](../map-indonesia.md) · [bots.md v0.2](../bots.md) (G1-G6) · [pm-decisions.md](../pm-decisions.md) (CP5b) · commit `562c73e`. `src/` tidak diubah.

## Ringkasan
- **Logic solid, tidak ada bug logic.** Semua sweep yang Engineer kurangi ukurannya sudah dijalankan penuh (A2 1000 seed, A5 2000 seed per set modifier): 0 kegagalan. DR-15 Whack terjaga di 108.000 level dengan modifier acak (rasio target-spawn/hits minimum 1,579, batas 1,5). Setiap level Ketapel solvabel: pemain sempurna 0 gagal di semua campuran modifier yang bisa dialami pemain.
- **Pool 7 minigame benar:** tiap kandidat 16,4-17,2% (target 16,7 ± 1,5), matriks transisi 70.000 undian: sel terburuk menyimpang 0,60 poin, tidak pernah sama dengan `last`, tepat satu tarikan per undian. Lewat reducer asli di 400 match bot: 8.251 undian segar tidak pernah sama dengan minigame terakhir, 3.218 win kedua semuanya beda dari win pertama.
- **Sim G1-G6 di tiga seed baru (n=4000; seed 11 semua sel, seed 23 dan 37 sel casual): 0 aksi ditolak, semua gerbang lulus.** Tapi margin Hard **tipis dan sistematis**: median casual vs 1 Hard = 8,90 / 8,90 / 8,89 (batas 9,0, margin ±0,10 menit). Detail di bagian sim.
- **5 temuan, tidak ada yang blocker:** 2 medium bug (QA-CP5b-01 tombol Pause HUD tertutup overlay selama minigame; QA-CP5b-02 Tambah Beban di Whack medium/hard tidak lebih sulit, malah sedikit lebih mudah), 1 medium desain/UX (QA-CP5b-03 skala drag Ketapel: presisi jari ±3 px di HP landscape), 2 low (Ngebut di Cocokkan Kartu hampir tanpa efek; Kabut di Ketapel nyaris tak terlihat). Detail dan reproduksi di bawah.
- **Interpretasi Engineer 1-7: semua diterima** (dua dengan catatan dokumen).
- **Perlu HP asli / playtest CP6:** rasa drag Ketapel (terutama hard dan landscape), p95 frame time Ketapel (DR-13), rasa tap Whack, pass rate casual 80/60/40%, Zona Lebar di Cocokkan Kartu hard (boost ±30 poin di model), jam nyata C-1 dan win rate Hard.

## Hasil run
| Perintah | Hasil |
|---|---|
| `npm run typecheck` | Lulus (logic, app, tes) |
| `npm test` | Suite penuh (sebelum tes ke-37 ditambahkan): `516 passed + 1 expected fail`, 388 s. Sesudah tes terakhir (cek independen Tebak Lokasi): `tests/cp5b-qa.test.ts` sendirian `36 passed + 1 expected fail (37)`, 303 s. Jadi total sekarang **517 passed + 1 expected fail** = 481 baseline + 36 tes QA + 1 `it.fails` (QA-CP5b-02) |
| `npm run sim -- --n 4000 --seed 11` | 827 s, `rejected bot actions: 0`. Seed 23 dan 37: sel casual saja (`--only win --human casual`), n=4000 per sel, 0 ditolak |
| E2E penuh | `npx playwright test` (desktop + mobile, 1 worker, build produksi): **319 passed, 20 skipped, 1 failed (44,7 mnt) dari 340**. Satu gagal = tes QA-ku sendiri (mobile, "dua jari di Whack"): menunggu dua target hidup bersamaan di medium dalam 60 kali baca dan kalah oleh beban mesin; diperbaiki (hard, 300 kali baca) dan lulus 3 dari 3 ulang. 20 skip = 15 lama + 5 baru (tes khusus keyboard dilewati di mobile, tes khusus HP dilewati di desktop). Suite Engineer: 0 gagal, flake "guess mobile intro" tidak muncul kali ini. `test.fail` yang sedang "hijau karena bug ada": QA-CP4b-01/02/03, QA-CP5a-01/01b, QA-CP5b-01 (2 instance) |
| E2E spec QA baru `tests/e2e/cp5b-qa.spec.ts` | 27 tes per viewport (54 instance, 5 dilewati: 3 khusus HP, 2 khusus keyboard). 2 instance `test.fail` (QA-CP5b-01) |

## Peta kriteria §10 ke tes
`E` = tes Engineer (`tests/cp5b.test.ts`, `tests/e2e/cp5b.spec.ts`), `Q` = tes QA (`tests/cp5b-qa.test.ts`, `tests/e2e/cp5b-qa.spec.ts`).

| # | Kriteria | Hasil | Tes dan angka |
|---|---|---|---|
| A1 | Murni (tanpa DOM/Math.random/Date) | Lulus | E (grep + jalan di node) |
| A2 | Determinisme | Lulus | E 200 seed. **Q 1000 seed** x 3 difficulty x {kosong, 6 tunggal, keenam, 20 acak} x 4 minigame = 84.000 pasangan level tiap minigame, `deepEqual`, urutan modifier dibalik identik. E: seed beda beda di ≥ 99%, kabut tidak menggeser jadwal Whack, hint tidak menggeser soal Tebak Lokasi |
| A3 | Tabel knob | Lulus | E (tabel ditulis dari dokumen, bukan diimpor) |
| A4 | Enam modifier | Lulus | E registry + tak dikenal. Q: 240 sel kartu x minigame x difficulty tanpa warning, tiap kartu bermodifier mengubah level (fixed seed, deep compare) |
| A5 | Pemain sempurna lulus; pemain diam gagal | Lulus | E 2000 seed tanpa modifier, 300 per set tunggal (Ketapel 150). **Q: 2000 seed x 3 difficulty x 11 set tunggal (termasuk 2x Jam Pasir, 2x Jam Rusak, Tambah Beban +1 dan +2) x 4 minigame = 264.000 run, 0 gagal; kombinasi ekstrem 2000 seed per difficulty: 100% untuk keempat minigame** (batas 95%) |
| A6 | Batas hasil 1 ms | Lulus | E (W4, K5, M3, T6) |
| A7 | progress/timeTaken/result | Lulus | E satu level. **Q: fuzz input acak** 600 seed x 3 difficulty x modifier acak x 4 minigame = 7.200 run: waktu tidak mundur, hasil tidak berubah setelah selesai, `step` tidak memutasi state input (JSON sebelum/sesudah), progress ∈ [0,1] tidak turun, timeTaken ≤ batas (Ketapel +3 s, Cocokkan Kartu + preview), hasil ada setelah akhir |
| A8 | Pause | Lulus untuk minigame; **bug di tombol Pause** | E per minigame via hook. Q: Esc (desktop) dan tab disembunyikan (desktop + mobile) di keempat minigame: play time beku, konten tertutup, lanjut benar. **Tombol Pause HUD tertutup overlay: QA-CP5b-01** |
| A9 | Layout, target sentuh, aksesibilitas | Lulus (satu celah) | Q, tiga ukuran 1280x720 / 390x844 / 844x390 pada konfigurasi terburuk: lubang Whack hard 4x3 terkecil **124 / 107 / 95 px** (min 64); 24 kartu (12 pasangan) **96 / 83 / 67 px** (min 64), Intip **48x48** (tepat di batas 48); tombol Tebak Lokasi **56 px** (tepat di batas; 2 kolom desktop, 1 kolom HP portrait, 2 kolom di landscape 844 px, terendah y=566 dari 844 dan y=195 dari 390); HUD Ketapel dalam layar tanpa tumpang tindih, kanvas penuh layar. Tanpa scroll horizontal maupun vertikal. `prefers-reduced-motion` memasang kelas `reduced-motion` di keempat minigame. Kalimat intro ≤ 8 kata di keempat. **Celah:** `reducedFlash` selalu `false` di `main.ts` (tidak ada jalur untuk menyalakannya, CSS-nya ada); tidak ada hit-stop sama sekali (spec §1.4/§6 minta 0,05-0,1 s), jadi batas ≤ 0,15 s terpenuhi dengan nol. Dua-duanya untuk CP6 |
| A10 | Siklus hidup, GPU | Lulus; HP belum | E 10x buka-tutup. **Q: 45x buka-tutup Ketapel** (semua difficulty, 4 set modifier, hasil lulus/gagal bergantian): tiap kali `lastDisposedGpu()` = 0 geometri 0 tekstur, jumlah kanvas kembali ke dasar, **0 peringatan/error konsol**, konteks WebGL balapan tidak hilang, frame balapan jalan lagi (338 -> 344), heap JS 6,0 -> 6,9 MB (desktop) dan 6,3 -> 7,0 MB (mobile). Listener `window`/`document` kembali persis ke dasar setelah 5 siklus per minigame (CDP `getEventListeners`). **HP:** p95 frame time (DR-13) |
| W1 | DR-15 | Lulus | E 5000 seed x extra 0/1/2. **Q: 108.000 level dengan modifier acak (3000 seed x 3 difficulty x 12 campuran): jadwal spawn identik dengan tanpa modifier (kecuali `extraTarget`), T ≥ ⌈1,5 x hits⌉ selalu, tanpa warning, rasio T/hits minimum 1,579** |
| W2-W5 | Aturan, tempo, batas, render | Lulus | E. Q: layout + 1 tap = +1 hit tepat (tidak ganda), dua jari bersamaan di dua target hidup keduanya terhitung (CDP, mobile) |
| K1 | Solvabel | Lulus | E 5000 seed. **Q dengan modifier yang bisa dialami pemain (1500 seed x 3 x 8 campuran): target diam ditembak tembakan idealnya sendiri 158.336/158.504 = 99,89%** (sisanya terhalang target lain yang masih berdiri), target bergerak kena pada waktu lepas tertentu 5988/6000 (sisa 12 terhalang, **0 tak terjangkau**), **pemain sempurna 0 gagal** |
| K2 | Penempatan | Lulus (lihat interpretasi 1) | E. Q: tanpa modifier 17/7500 level (0,23%) punya pasangan terlalu dekat/terhalang, dengan campuran modifier 44/7500 (0,59%); y ≥ 2 m dan z 8-30 m tidak pernah dilanggar |
| K3-K5 | Frame-independen, drag, batas | Lulus | E. Q: tembakan ideal tiap target melewati `aimFromDrag` bolak-balik di tinggi layar 844/720/390 tanpa selisih (< 1e-6): drag bisa menyatakannya |
| K6 | Render Ketapel | Lulus | E (mouse, sintetis di mobile). **Q: sentuhan nyata lewat CDP (mobile): drag 15% tinggi = power 0,55-0,72, < 5% batal tanpa memakai peluru, mulai di separuh atas tidak berbuat apa-apa, tidak ada `pointercancel`, halaman tidak ter-scroll; jari kedua tidak menembak peluru kedua**; Esc saat drag mouse membatalkan tanpa pause |
| M1-M5 | Cocokkan Kartu | Lulus | E. Q: layout 24 kartu tiga ukuran, Intip ≥ 48 px dan tidak tertimpa kartu |
| T1-T7 | Tebak Lokasi | Lulus | E. **Q independen (27.000 level): jawaban benar tepat sekali, tanpa duplikat, spread kemunculan region ≤ 2, deviasi posisi jawaban dari seragam ≤ 1,8 poin, hint tidak menggeser soal.** Q e2e: Tab + Enter menjawab, satu klik mouse = satu jawaban, layout |
| 11 | Bot di 4 minigame baru | Lulus (E) | E 12.000 percobaan ± 1,5 poin per sel, ± 8 per modifier, `D` benar, 2 tarikan `bot`. Tidak diulang |
| 12 | Pool dan undian | Lulus | Q, lihat bagian pool |
| 13 | Matriks kartu x minigame | Lulus | E contoh angka + kembar. Q: lihat matriks (arah, besar efek, alur nyata) |
| 14-16 | Gerbang sim, delta, urutan tuning | Gerbang lulus; margin tipis | Q: sim n=4000, 3 seed |
| G | Playtest CP6 | Belum | Daftar di bagian HP |

## Temuan

### QA-CP5b-01 (medium, bug UI, berlaku juga untuk minigame lama): tombol Pause HUD tertutup overlay selama minigame
- **Langkah:** buka `/?debug=1&bots=1`, `selectTarget` ke `medan`, `forceMinigame('whack_a_mole')`, tekan Mulai. Selama intro dan selama main, `document.elementFromPoint` di tengah `btn-pause` mengembalikan `mg-intro` (intro) dan `mg-play-area` (main).
- **Harapan:** ui-flow §Minigame: "tombol pause di kanan atas (solo saja)"; ui-flow §6 tombol Pause "selalu di atas modal apa pun".
- **Aktual:** overlay minigame (`z-index: 20`, anak `body`) menutupi `#hud` (`z-index: 10`). Di HP satu-satunya cara pause adalah menyembunyikan tab (auto-pause); di desktop ada Esc. Tidak ada cara pause manual dengan sentuhan selama minigame. Overlay dan HUD dipakai bersama semua minigame, jadi berlaku untuk ketujuhnya (diuji langsung di Whack; bukan regresi CP5b, baru ketahuan karena A8 minta pause diuji per minigame).
- **Bukti:** `tests/e2e/cp5b-qa.spec.ts` "the Pause button of the HUD can be pressed while a minigame is open", desktop + mobile, ditandai `test.fail` (hijau selama bug ada, merah begitu diperbaiki). Konsol: `element on top of the Pause button (mobile): intro -> mg-intro, play -> mg-play-area`.
- **Saran:** naikkan tombol Pause di atas overlay (z-index) atau beri tombol pause di dalam overlay minigame. Perlu keputusan kecil: pause saat intro/banner juga?

### QA-CP5b-02 (medium, spesifikasi/balance): Tambah Beban di Whack medium dan hard tidak lebih sulit
- **Data (angka dokumen §5):** syarat hit/jumlah target spawn: easy 53,3% -> 58,8% (lebih sulit), **medium 60,0% -> 58,6%, hard 63,3% -> 60,0% (lebih mudah)**. Hit per detik yang dibutuhkan: easy 0,400 -> 0,435, **medium 0,750 -> 0,739, hard 0,950 -> 0,913**. Penyebab: +2 hit dan +3 s durasi, tapi 3 s tambahan menghasilkan lebih banyak target spawn daripada 2 hit tambahan.
- **Model pemain berderau (3000 run/sel):** Whack hard 82,3% -> 84,1% dengan Tambah Beban (z = +1,9). Sabotase yang tidak mempersulit, di dua dari tiga difficulty. Di tiga minigame lain Tambah Beban jelas lebih sulit (Ketapel hard -5,7 poin, Cocokkan Kartu hard -15,5, Tebak Lokasi medium -10,5).
- **Bukti:** `tests/cp5b-qa.test.ts` -> `it.fails('QA-CP5b-02 ...')` (hijau selama angka ini berlaku) dan tes pengukur "QA-CP5b-02 evidence".
- **Saran (tuas Designer):** `hits` +3 per count (medium 18/29 = 62%, hard 22/35 = 63%) atau durasi +2 s per count. Keputusan PM/Designer; tidak menyentuh jaminan DR-15 (T/hits tetap ≥ 1,5).

### QA-CP5b-03 (medium, UX/balance): presisi drag Ketapel, terutama HP landscape dan hard
- **Pengukuran:** panjang drag penuh (`maxDragPx`) = 25% **tinggi kontainer**. Setengah-lebar jendela di mana tembakan ideal masih kena (median / p10, dalam px layar):

| Ukuran | maxDrag | easy | medium | hard |
|---|---|---|---|---|
| 390x844 portrait | 211 px | ±12 / ±7 | ±9 / ±7 | ±7 / ±6 |
| 1280x720 desktop | 180 px | ±10 / ±6 | ±7 / ±6 | ±6 / ±5 |
| **844x390 landscape** | **98 px** | ±5 / ±3 | ±4 / ±3 | **±3 / ±2** |

- **Pemain yang tahu persis aim idealnya** tapi jarinya goyang Gaussian sigma px, lulus (800 level per sel, target bergerak ditembak pada fase acak):

| sigma | portrait 844 easy / med / hard | desktop 720 | landscape 390 |
|---|---|---|---|
| 2 px | 100 / 100 / 89% | 100 / 100 / 88% | 100 / 100 / 71% |
| 4 px | 100 / 100 / 76% | 100 / 100 / 63% | 99 / 72 / 13% |
| 6 px | 100 / 96 / 40% | 100 / 90 / 28% | 87 / 29 / 2% |
| 9 px | 99 / 66 / 8% | 95 / 50 / 4% | 51 / 7 / 0% |
| 14 px | 81 / 24 / 1% | 69 / 15 / 0% | 23 / 2 / 0% |

  Jari manusia umumnya sigma 5-9 px saat melepas drag. Itu batas **atas** (pemain nyata tidak tahu aim ideal; ia hanya punya garis bidik 15% di hard). Target keputusan PM (hard 40%) tampak tidak terjangkau di portrait dan mustahil di landscape. Hard butuh 5 dari 6 peluru kena.
- **Saran konkret, murah:** `maxDragPx = 0,25 x max(lebar, tinggi)` (landscape jadi 211 px seperti portrait; hasil sama di tiga ukuran) dan/atau `hitRadiusM` hard 0,8 -> 1,0 sebelum playtest. Verifikasi di HP (★5/★6 pm-decisions CP5b).
- **Catatan:** keyboard tepat (1° dan 1% per langkah), jadi desktop dengan keyboard tidak terpengaruh.

### QA-CP5b-04 (low, spesifikasi): Ngebut di Cocokkan Kartu hampir tanpa efek, dan prinsip DR-16 terbalik di sebagian
- `speed` x1,25 membagi `previewMs` (2000 -> 1600, 1000 -> 800, **hard 0 -> 0**), `mismatchDelayMs` (800 -> 640, 700 -> 560, 600 -> 480), dan `flipMs`. Pemain berderau closed-loop pada fungsi `step` asli (3000 run/sel): pass rate easy 100,0 -> 100,0%, medium 99,1 -> 99,0%, hard 34,8 -> 35,4% (z = +0,5): **tidak ada efek terukur**. Tap pada kartu yang masih terbuka dalam jendela salah diabaikan (aturan spec); jendela lebih pendek mengurangi ketap hilang dari 0,74 ke 0,66 per run di hard, dan di easy/medium dari 0,18/0,17 ke 0,06/0,05. Jadi di hard satu-satunya efek Ngebut condong membantu pemain.
- **Bukan bug kode** (sesuai cards.md §5.1), tapi sabotase rare yang pada Cocokkan Kartu hard praktis tidak berbuat apa-apa. Saran: seperti Ketapel, pendekkan durasi (`max(min(d, 15 s), d ÷ mult)`: 30 -> 24 s), yang memang menggigit (Jam Rusak -5 s menjatuhkan hard 34,8 -> 1,6% di model).

### QA-CP5b-05 (low, feel): Kabut Asap di Ketapel nyaris tak terlihat
- Hanya bola target dengan z ≥ 20 m (37-41% target) menjadi 50% transparan; platform tetap padat. Selisih piksel kanvas dengan/tanpa kabut pada frame beku: desktop 1280x720 **3014** piksel berbeda (0,33%) vs derau antar-frame 1092; mobile 390x844 **7685** (2,3%) vs derau 706. Terukur (tes lulus) tapi kecil. Whack (17-22% spawn tertutup kabut saat muncul), Cocokkan Kartu (kontras 60% + blur) dan Tebak Lokasi (blur 6 px memudar 2 s) jelas lebih terasa. Perlu rasa di HP; tuas: transparansi platform juga, atau radius mulai `fogDepthM` 16 m.

### Pengamatan (tanpa ID bug)
- **Whack, boost terpangkas:** dengan 2x Jam Pasir + Zona Lebar, **12,9% (medium) dan 11,6% (hard)** spawn digantikan spawn berikutnya di lubang yang sama sebelum masa tampilnya habis (easy 0%). Sesuai spec §5 (menghapus tanpa penalti), tapi boost "waktu tampil x1,18/x1,3" lebih kecil dari angkanya dan karakter tampak hilang mendadak.
- **Placement Ketapel dan Tambah Beban:** +1 target di hard menaikkan level tidak bersih (pasangan < 4 m atau tembakan ideal menabrak target lain dulu) ke 1,4% (21/1500); +2 (tak bisa dicapai: Tambah Beban `maxStacks` 1) 11,3%. Tidak mempengaruhi solvabilitas (pemain sempurna tetap 100%).
- **Memori hard + Zona Lebar:** preview 0 -> 1 s mengangkat pass rate model dari 34,8% ke 64,6% (+30 poin), Jam Pasir +5 s ke 84,0%. ★4 pm-decisions: dipantau di playtest, tuas "preview bonus maks +2 s" tidak menolong (bonusnya +1 s).
- **Keyboard Whack di portrait:** pemetaan tombol `1 2 3 4 / Q W E R / A S D F` mengikuti indeks logika (4 kolom di hard), sedangkan di portrait tampilannya 3 kolom x 4 baris. Hanya relevan desktop dengan jendela portrait.
- **Tebak Lokasi, tombol 56 px:** pas di batas spesifikasi; sama dengan Intip 48 px. Tidak ada ruang untuk padding yang berubah.

## Verdict interpretasi Engineer
1. **Penempatan Ketapel 200 percobaan + aturan jalur bersih: DITERIMA.** Klaim Engineer terbukti: 10 percobaan hanya spasi memberi 96,5 / 82,3 / 57,6% level bersih (klaim 96 / 83 / 57). Aturan yang dikirim menyisakan 0,23% level tidak bersih tanpa modifier dan 0,59% dengan campuran modifier; pemain sempurna tetap 100%. Catatan dokumen: tulis di §6 (sudah diputuskan PM) bahwa percobaan terakhir diterima apa adanya dan bahwa "tidak bersih" masih mungkin ±0,2-1,4%.
2. **Mendarat = akhir terbang; satu sampel kena banyak target -> yang terdekat: DITERIMA.** Hasil tidak bergantung urutan array target (300 seed, indeks ditukar, target fisik yang sama dan `flightMs` sama). "Target pertama" di spec ambigu; "terdekat di sampel pertama yang menyentuh" deterministik. Catatan dokumen: perjelas §6 dan bahwa `timeTakenMs` adalah waktu sampel kena, bukan waktu mendarat di tanah.
3. **timeTakenMs = preview + durasi saat timeout Cocokkan Kartu: DITERIMA.** Sesuai §7 ("tMs termasuk preview") dan pengecualian A7; sama dengan waktu nyata dan dengan `D` bot (`durationMs + previewMs`).
4. **Urutan pengecoh dan tarikan hint Tebak Lokasi: DITERIMA.** Kocok -> urut stabil naik menurut kemunculan sebelumnya; indeks pengecoh yang dihapus selalu ditarik lalu dipetakan ke posisi di `choices`. Cek independen 27.000 level: jawaban benar tepat sekali, tanpa duplikat, spread kemunculan ≤ 2, deviasi posisi jawaban ≤ 1,8 poin, hint tidak menggeser soal.
5. **Tarikan kabut Whack dan field level tambahan: DITERIMA.** Dua tarikan per jendela 3 s, selalu ditarik, di akhir (kabut tidak menggeser jadwal: 108.000 level). Field tambahan (`wideTouch`, `tempo`, `slots`, `warnings`) turunan, tidak mempengaruhi aturan. Efek kabut terukur: 22,2 / 22,5 / 16,8% spawn tertutup saat muncul.
6. **Ukuran sampel dikurangi: tidak ada risiko tersembunyi.** Semua dijalankan ulang penuh (A2 1000 seed, A5 2000 seed per set, ekstrem 2000): 0 kegagalan. Risiko nyata justru di luar tabel: penempatan Ketapel dengan Tambah Beban (di atas) dan hal-hal yang bergantung perilaku manusia (QA-CP5b-02/03/04).
7. **Esc di Ketapel membatalkan bidikan, kalau tidak ada bidikan baru pause: DITERIMA.** Diuji dengan mouse nyata: Esc di tengah drag membatalkan, pelepasan sesudahnya bukan tembakan, tidak ada pause; Esc tanpa bidikan membuka pause, Esc lagi melanjutkan. Catatan: sesudah satu tekan panah (bidikan keyboard aktif) Esc pertama membatalkan bidikan, baru Esc kedua pause. Konsisten dengan "Esc kembali ke nilai awal".

## Matriks kartu x minigame
Tiap kartu bermodifier mengubah level di keempat minigame dan ketiga difficulty (240 sel, 0 warning). Arah diperiksa dua cara: (a) knob bernama per minigame (boost tidak pernah memperberat, sabotase tidak pernah meringankan): lulus kecuali QA-CP5b-02; (b) pemain berderau pada `step` asli, pass rate dasar -> dengan kartu (n=3000, Ketapel 1200; sel jenuh 0%/100% tidak informatif):

| Minigame / difficulty | dasar | Jam Pasir | Zona Lebar | Teropong | Jam Rusak | Ngebut | Tambah Beban | Kabut |
|---|---|---|---|---|---|---|---|---|
| Whack hard | 82,3 | 88,9 | 89,5 | 82,3 (visual) | 26,3 | 4,1 | **84,1** | 82,3 (visual) |
| Whack medium | 99,9 | 99,9 | 99,9 | 99,9 | 99,9 | 97,7 | 99,9 | 99,9 |
| Tebak Lokasi hard | 20,5 | 33,8 | 36,4 | 24,6 | 6,0 | 6,0 | 12,7 | 20,5 (visual) |
| Tebak Lokasi medium | 74,2 | 79,0 | 79,3 | 77,6 | 49,1 | 50,3 | 63,7 | 74,2 |
| Cocokkan Kartu hard | 34,8 | 84,0 | 64,6 | 49,4 | 1,6 | **35,4** | 19,3 | 34,8 (visual) |
| Cocokkan Kartu medium | 99,1 | 100 | 99,9 | 99,2 | 84,9 | **99,0** | 96,3 | 99,1 |
| Ketapel hard (jari sigma 7 px, portrait) | 18,1 | 24,7 | 38,0 | 18,1 (aim line) | 6,5 | 5,0 | 12,4 | 18,1 (visual) |
| Ketapel medium | 90,2 | 90,3 | 98,5 | 90,2 | 74,8 | 73,9 | 86,0 | 90,2 |

(Model: angka absolut bukan prediksi pemain nyata, hanya arah dan besar relatif. Kabut dan Teropong tidak mengubah aturan menurut spec, jadi di model netral; efeknya diperiksa di layar.) Tidak ada sabotase yang berbalik jadi boost secara signifikan; yang mendekati nol: Tambah Beban Whack (QA-CP5b-02) dan Ngebut Cocokkan Kartu (QA-CP5b-04). Kabut/Teropong: efek visual terbukti di DOM (e2e).

**Alur nyata (e2e, desktop + mobile, 4 minigame x 3 putaran kartu):** boost (Jam Pasir, Zona Lebar, Teropong) dimainkan, sabotase (Jam Rusak, Kabut Asap; lalu Ngebut, Tambah Beban) dikirim bot lewat reducer; tekan Mulai: snapshot `attempt.modifiers` sama dengan `resolveAttemptEffects` dari kartunya, level di halaman `toEqual` level yang dihasilkan logic untuk snapshot itu (peta asli), tanpa warning, lencana intro ada untuk tiap jenis modifier, dan efeknya terlihat: lubang Whack `.fogged` dan `.soon` muncul, `.wide` di semua lubang, progres `0/hits` baru, kartu 2 x pasangan, tombol Intip, satu pilihan tersembunyi, filter blur di gambar, peluru dan target Ketapel sesuai level.

## Solvabilitas
- **DR-15:** lihat W1. 108.000 level, rasio minimum 1,579. Jaring pengaman tidak pernah aktif.
- **Ketapel:** lihat K1/K2. Yang bisa dialami pemain (Zona Lebar 1,3, Ngebut 1,25, Tambah Beban +1, Jam Pasir/Jam Rusak ±5/±10, kabut, hint): 99,89% tembakan ideal kena targetnya sendiri, sisa terhalang target lain yang bisa ditembak lebih dulu; pemain sempurna 0 gagal. Kombinasi tak terjangkau (Zona Lebar x1,69, Tambah Beban +2 plus tolerance) menurunkan kebersihan penempatan sampai 23-41% level, tapi hanya di kombinasi yang kartu tidak bisa buat (`maxStacks` 1).
- **`requires` dengan peta sintetis (tes Q):** Whack: `target`/`decoy` hilang atau kosong -> keluar; Ketapel: < 2 kulit -> keluar, 2 kulit tanpa `platforms` -> masuk; Dodge: 2 rintangan -> keluar; Memori: 11 ikon atau `iconGroups` beda panjang atau hilang -> keluar; Tebak Lokasi: 9 place -> keluar. Peta tanpa keempat tema: pool `[tap_timing, simon]`, validator peta lulus; tanpa minigame yang selalu bisa dipakai, validator menolak. 4000 undian pada peta tanpa Whack/Ketapel/Memori: minigame itu tak pernah keluar, enam sisanya merata ± 2 poin.

## Pool dan undian (§10 D)
- Pool Indonesia = 7 id urutan registry. 10.000 undian `last` bergilir: tiap kandidat 16,4-17,2% (tap_timing 16,50, simon 16,49, dodge_runner 16,93, whack_a_mole 16,47, slingshot 16,36, memory_match 17,15, guess_location 16,78), tepat satu tarikan per undian (state RNG dicocokkan dengan satu `next()`).
- Matriks transisi 70.000 undian: sel terburuk 0,60 poin dari 16,67.
- 400 match bot lewat reducer asli (3 seat, semua level): 12.426 percobaan (38% gagal = retry minigame sama), 8.251 undian segar tidak pernah sama dengan minigame terakhir yang dimainkan, retry selalu minigame sama, 3.218 win kedua semuanya minigame beda dari win pertama di region itu; pangsa percobaan per minigame 13,7-14,8% (1/7 = 14,3%).

## Sim (§10 F, G1-G6)
Build `562c73e`, peta Indonesia Standard, pool 7, n = 4000 per sel. Seed 11 semua sel (827 s), seed 23 dan 37 hanya sel casual. Seed 7 = angka Engineer (`sim-final`) untuk pembanding.

| Gerbang | Batas | Seed 11 | Seed 23 | Seed 37 | Margin terkecil |
|---|---|---|---|---|---|
| G1 median casual vs 1/2/3 Easy | [10, 13] | 10,86 / 10,95 / 11,09 | 10,91 / 11,00 / 11,03 | 10,84 / 10,96 / 11,01 | +0,84 dari 10 |
| G1 median casual vs 1/2/3 Normal | [10, 13] | 10,64 / 10,54 / 10,54 | 10,62 / 10,57 / 10,51 | 10,59 / 10,57 / 10,53 | **+0,51 dari 10** |
| G1 p95 (semua 6 sel) | ≤ 18 | 12,4-13,9 | 12,4-14,0 | 12,4-13,9 | +4,0 |
| G2 median casual vs 1/2/3 Hard | [7, 9] | **8,90** / 8,20 / 7,72 | **8,90** / 8,13 / 7,72 | **8,89** / 8,20 / 7,73 | **+0,10 dari 9,0** (1 Hard) |
| G3 casual vs 1 Hard menang | 15-35% | 18,8% | 18,1% | 17,8% | +2,8 poin (seed 7: 16,8% = +1,8) |
| G4 casual vs 3 Hard menang | 3-12% | 10,7% | 10,5% | 10,6% | +1,3 poin (seed 7: 11,1% = +0,9) |
| G5 Hard vs Normal 1v1 | ≥ 65% | 92,8% | n/a | n/a | +27,8 |
| G6 solo casual / attentive / expert | 11,0 / 8,0 / 6,5 ± 0,7 | 10,70 / 8,04 / 6,52 | n/a | n/a | casual +0,40 dari 10,3 |
| Aksi bot ditolak | 0 | 0 | 0 | 0 | - |

**Margin tipis (jangan salah baca):**
1. **Median casual vs 1 Hard 8,89-8,91 di seed 7/11/23/37.** Hampir tidak bervariasi antar seed, jadi bukan derau n=4000: ia dikunci rem `paceTargetMs` Hard dan pool 7 tidak menggesernya. Margin 0,10 menit (6 detik) bersifat **sistematis**; perubahan apa pun pada cooldown, durasi minigame, `afterWinMs` manusia, atau pool menggeser G2 langsung (bots.md §10).
2. Casual vs 3 Hard 10,5-11,1% (batas 12): margin ±1 poin; seed 7 paling dekat.
3. Median casual vs Normal 10,51-10,64: margin 0,5 menit dari batas bawah 10. Casual solo 10,70 (margin 0,4 dari 10,3).
4. **Peringatan model (keputusan PM CP5b):** `afterWinMs` casual dihaluskan 36-50 -> 32-46 s, perubahan model bukan game. G3/G4 sebagian lulus karena itu. Median solo casual 10,70 di model baru vs 10,77 (CP5a): efeknya kecil di sini, tapi G1 lulus dengan margin 0,5 menit hanya selama model itu dipercaya. Validasi hanya dengan pemain nyata (CP6).
5. **Delta CP5b vs angka CP5a di bots.md §10** (tercampur dengan perubahan model manusia `afterWinMs` 36-50 -> 32-46 s, jadi pengaruh pool saja tidak terbaca di sini): G1 median 10,53-11,20 -> 10,51-11,09; G2 8,91 / 8,28 / 7,71 -> 8,90 / 8,20 / 7,72; G3 16,4% -> 16,8-18,8%; G4 8,9% -> 10,5-11,1%; G5 91,2% -> 92,8%; G6 10,77 / 7,82 / 6,40 -> 10,70 / 8,04 / 6,52. Perkiraan Designer (pool 7 menaikkan `D` ±1,8 s per percobaan, median casual Easy/Normal +0,2-0,4 menit) tidak terlihat di median G1 (turun sedikit); arah yang sama dengan pengepasan ulang `afterWinMs`, bukan bukti bahwa pool tidak berpengaruh.

## Fuzz zona dan replay (§10, pool 7, bot pintar)
- **300 match** dengan seat manusia yang memainkan **logika minigame asli** lewat model berderau (bukan tabel peluang): tiap `minigameResult` diganti dengan hasil dan waktu dari level yang dihasilkan untuk snapshot kartu itu. 0 `actionRejected`, 0 warning "modifier diabaikan" (2.985 percobaan dimulai dengan modifier kartu), invarian zona (kartu di tepat satu zona, slot sabotase ≤ 2, fase vs attempt, tidak ada layar kartu saat main, `nextMinigameId` selalu dalam pool) setelah **setiap** aksi, `replay(actionLog)` sama persis dengan state akhir. Percobaan manusia pada logika asli: tebak lokasi 314/431 lulus, ketapel 282/496, cocokkan kartu 307/495, whack 308/317.
- **Fuzz gangguan 120 match** (kartu paksa, tawaran paksa, `debugForceMinigame`, hapus hand, tick panjang): 2.825 aksi suntikan, 0 penolakan dari bot, semua match selesai, replay identik.
- Aliran RNG tetap independen: memilih target p1 tidak menggeser `pickRng` p2.

## Ketapel GPU dan performa
- 45x buka-tutup (lihat A10): konteks WebGL dilepas (`forceContextLoss`), 0 peringatan "Too many active WebGL contexts" (batas Chrome 16; tes lama hanya 10 buka), geometri 14-16 per buka, tekstur 0.
- Beban per frame (hook `minigameGpu()`, 390x844 dpr 2): **draw call 24 / 29 / 47** (easy / medium / hard + 2 extra = 8 target), geometri 15 / 16 / 18, tekstur 0; kanvas 585x1266 px (pixel ratio dibatasi 1,5). Jauh di bawah anggaran biasa HP (< 100 draw call); belum jadi bukti p95.
- Frame time di mesin ini (SwiftShader, ~6 fps) tidak bermakna untuk DR-13; ukur di HP.

## Perlu HP asli / playtest
1. **p95 frame time Ketapel ≤ 33,3 ms** (6-8 target + platform) di HP acuan, tiga kali, awal dan akhir sesi 15 menit (thermal).
2. **Rasa drag Ketapel** (QA-CP5b-03): portrait dan landscape, hard dan medium, batal < 5%, garis bidik 40%/15%, keterbacaan angin; apakah kanvas penuh layar menutupi sudut aman (notch).
3. **Rasa tap Whack** 3x3 dan 4x3 (grid 3 kolom di portrait); ukuran lubang 107 px di 390 lebar sudah cukup besar; latensi `pointerdown` vs `grace` 80 ms.
4. Pass rate pemain kasual percobaan pertama per minigame baru 80/60/40% ± 10 (tuas: Whack `baseLifeMs`, Ketapel `hitRadiusM`, Cocokkan Kartu `previewMs`, Tebak Lokasi `timePerQuestionMs`).
5. Kartu 4x6 di 390 px (kartu 83 px portrait, 67 px landscape terukur di Chrome emulasi; jari nyata); tombol Intip 48 px dan tombol pilihan 56 px tepat di batas: uji tekan salah.
6. **C-1 dan Hard dengan pemain nyata:** model memakai `afterWinMs` hasil pengepasan; jam nyata (median 10-13 menit) dan win rate vs Hard (15-35%) belum terbukti.
7. Rasa efek kartu: Kabut Ketapel (QA-CP5b-05), Zona Lebar di Cocokkan Kartu hard (+30 poin di model), Tambah Beban Whack (QA-CP5b-02), Ngebut Cocokkan Kartu (QA-CP5b-04).
8. Pause manual saat minigame di HP (setelah QA-CP5b-01 diperbaiki).
9. Suara: `AudioContext` dibuat saat pertama dibutuhkan; di iOS Safari harus lewat gestur pengguna (pointerdown di minigame cukup); tidak bisa diuji di sini.

## Kesiapan MVP dan sisa untuk CP6
**Sudah ada dan teruji:** semua 7 minigame dan 20 kartu, pool dan undian, kartu x minigame lewat alur nyata, bot Easy/Normal/Hard dengan gerbang sim, solo vs bot dari Setup sampai Hasil, pause (Esc, tab tersembunyi), layout desktop dan HP di tiga ukuran, tidak ada bocor GPU, replay deterministik 1:1.

**Sisa untuk CP6 (urut perkiraan dampak):**
1. **Perbaiki sebelum playtest:** QA-CP5b-01 (pause HP), QA-CP5b-02 (Tambah Beban Whack), QA-CP5b-03 (skala drag Ketapel; satu baris), keputusan Ngebut Cocokkan Kartu dan Kabut Ketapel (04/05).
2. **Pengaturan (settings):** `reducedFlash` belum terhubung (selalu false), slider shake belum ada, `reducedMotion` hanya dari preferensi sistem; volume SFX hanya konstanta. Spesifikasi A9 tidak bisa diuji sampai ada jalurnya.
3. **Feel:** tidak ada hit-stop di minigame baru (spec §1.4/§6), tidak ada animasi kartu terbang (ditunda CP4b), tidak ada seret kartu ke baris progres atau tombol angka 1-5 (ditunda).
4. **Seni dan audio:** semua ikon/gambar tempat adalah placeholder SVG; prop Ketapel prosedural; SFX sintetis; final art CP6 (keputusan PM).
5. **Sisa polish UI yang sudah dicatat:** QA-CP4b-01/02/03 (picker), QA-CP5a-01 (Tab di Setup), Esc dan fokus awal.
6. **Playtest dan kalibrasi** (daftar HP di atas): pass rate per minigame, C-1, Hard, `afterWinMs` manusia, Hard overflow 10%.
7. **Keamanan pra-multiplayer** (bukan MVP solo): server harus menolak `debug*`, `autoCards`, `chooseCards` per pengirim (keputusan PM); `?minigame=` dan hook `openMinigame` hanya dengan `?debug=1`.
8. **Build MVP:** `npm run build` lulus; ukuran bundle dan waktu muat perlu dicek di HP (three.js dimuat untuk balapan; Ketapel membuat renderer kedua per buka, 45x tanpa bocor).

## Tes yang ditambahkan
- `tests/cp5b-qa.test.ts` (37 tes, ±4 menit): S1 sweep ukuran penuh; S2 fuzz input acak; S3 solvabilitas (DR-15, Ketapel dengan modifier, bolak-balik drag, `requires` sintetis, cek independen Tebak Lokasi); S4 matriks kartu x minigame (struktural + model pemain berderau + Ngebut Cocokkan Kartu closed-loop + efek kabut); S5 pool dan undian; S6 penempatan dan presisi Ketapel (pengukuran); S7 fuzz zona + replay pool 7 dengan manusia pada logika asli.
- `tests/e2e/cp5b-qa.spec.ts` (27 tes x 2 viewport): L layout tiga ukuran; I jalur input nyata (sentuhan CDP, dua jari, Esc saat drag, Tab+Enter, satu tap = satu hit); C kartu lewat alur nyata + efek terlihat + piksel kabut Ketapel; P pause per minigame + tombol Pause HUD (`test.fail` QA-CP5b-01); G 45 buka-tutup Ketapel; O listener; R reduced-motion + kalimat intro.
- Tes `it.fails`/`test.fail` (hijau selama bug ada, merah saat diperbaiki): QA-CP5b-02 (unit), QA-CP5b-01 (e2e, 2 instance).

## Pertanyaan untuk PM
1. QA-CP5b-01: tombol Pause di atas overlay atau tombol di dalam overlay minigame? Berlaku untuk ketujuh minigame; kecil.
2. QA-CP5b-02: tuas mana untuk Tambah Beban Whack (hits +3 per count atau durasi +2 s)? Atau diterima apa adanya sebagai sabotase lemah di medium/hard?
3. QA-CP5b-03: setujui `maxDragPx = 0,25 x max(lebar, tinggi)` (Engineer, perubahan satu baris di `slingView.ts`) sebelum playtest, dan tahan `hitRadiusM` hard 0,8 sampai ada data HP?
4. Ngebut Cocokkan Kartu (04) dan Kabut Ketapel (05): perbaiki sekarang atau tunggu playtest?
5. Margin Hard 0,10 menit: terima sampai playtest (seperti keputusan CP5a), atau beri sedikit ruang (mis. `paceTargetMs` Hard 610 -> 605 s) tanpa menyentuh `BOT_PASS_CHANCE`?
