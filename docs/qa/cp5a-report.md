# Laporan QA CP5a: bot pintar (Easy/Normal/Hard), filter observasi, Setup, simulator

**Oleh:** 🧪 QA · **Tanggal:** 2026-11-17 · **Acuan:** [bots.md v0.1](../bots.md) §2-§11 · [cards.md v0.5](../cards.md) · [pm-decisions.md](../pm-decisions.md) (bagian CP5a) · commit `524f506`. `src/` tidak diubah.

## Ringkasan
- **Tidak ada bug logic.** 0 aksi bot ditolak di 2000 match baru (seed lain dari Engineer), di 150 match dengan gangguan acak (kartu dibagikan paksa, tawaran paksa, tick panjang), dan di simulator seed 7 (~32.000 match). Invarian zona kartu terjaga setelah tiap aksi. Replay `actionLog` identik di 60 match; pause membeku tepat saat bot sedang berpikir/menahan diri.
- **Informasi tersembunyi: tidak ketemu kebocoran.** Tes baru memberi controller state yang dirusak (semua kolom "tidak boleh" diacak tiap poll) selama 36 match penuh: log aksi dan state akhir identik. Ada tes kekuatan: bot yang sengaja mengintip seed/hand lawan terdeteksi (8 dari 8 match menyimpang).
- **Gerbang sim seed 7 (n=1000):** semua gerbang yang jadi gerbang lulus (C-1 Easy/Normal, median Hard [7, 9], casual vs 1 dan 3 Hard, Hard vs Normal ≥ 65%). **Tapi margin Hard tipis**, lihat tabel margin: casual vs 1 Hard menang 14,0 / 15,2 / 15,2 / 18,3% di empat seed lain (batas bawah 15%), rata-rata delapan run ≈ 15,7% (2 dari 8 run di bawah 15%). Pada n=1000 sel ini gagal di seperempat sampai sepertiga seed. Median vs 1 Hard 8,89-8,92 (batas 9,0).
- **Temuan UI (low):** QA-CP5a-01, Tab di layar Setup keluar dari kartu ke tombol Pause / Export / region peta di belakangnya, dan Enter di Pause membuka overlay pause di atas Setup. Tidak ada kerusakan state. Dicatat sebagai `test.fail` (hijau selama bug ada).
- **QA-CP4b-04 dan -05 terbukti fixed** (bagian bawah).
- **Dog-pile pada pemimpin manusia: moderat.** Manusia yang memimpin menerima sekitar 1,1 sabotase per menit dari 3 bot Normal/Hard (p90 per match 1,6/menit, maks 2,35), kedua slot penuh 14% waktu memimpin. Rinci di bawah.
- Delapan interpretasi Engineer: **semua diterima** (dua dengan catatan: #2 dan #3). Saran pembaruan bots.md di bagian akhir.
- Dua hal yang butuh keputusan/HP asli: kalibrasi `afterWinMs` manusia (C-1 hanya membuktikan model, bukan pemain nyata) dan rasa Hard (casual hanya menang ~16% lawan 1 Hard).

## Hasil run
- **`npm run typecheck`:** lulus (logic, app, tes).
- **`npm test` (vitest):** `Tests 415 passed (415)` = 404 baseline + 11 baru di `tests/bots-qa.test.ts` (sekitar 45 detik sendirian). 
- **`npm run sim -- --n 1000 --seed 7`:** 158 detik, `rejected bot actions: 0`. Angka mentah di bawah.
- **E2E penuh** (`npx playwright test`, desktop + mobile, 1 worker): `196 passed, 11 skipped, 1 failed (26,8 mnt)` dari 208 test. Satu gagal = tes QA-ku sendiri (mobile, "the human row never shows an activity"): ia membaca state dan atribut DOM dalam dua panggilan terpisah, jadi HUD yang baru digambar satu frame kemudian (±160 ms di renderer perangkat lunak) terbaca sebagai "bot main tapi masih berpikir". Bukan bug game; tes diperbaiki (state dan DOM dibaca dalam satu `evaluate`, selisih hanya dihitung bila bot sudah main sejak sampel 250 ms sebelumnya) dan lulus 3 dari 3 ulang di desktop + mobile. 11 skip = 6 lama + 5 baru (tes khusus keyboard dilewati di mobile, tes khusus HP dilewati di desktop). Suite Engineer: 0 gagal, tidak ada flake beban
- **Spec QA baru** `tests/e2e/cp5a-qa.spec.ts`: 15 tes (30 instance desktop + mobile; 5 dilewati karena khusus keyboard atau khusus HP). Dua tes `test.fail` untuk QA-CP5a-01/-01b.

## Peta kriteria §11 ke tes
`E` = tes Engineer (`tests/bots.test.ts`, `tests/e2e/cp5a.spec.ts`), `Q` = tes QA (`tests/bots-qa.test.ts`, `tests/e2e/cp5a-qa.spec.ts`), `S` = simulator.

| # | Kriteria | Hasil | Tes |
|---|---|---|---|
| 1 | Nol penolakan, hand ≤ 5 saat diam, slot ≤ 2, 1 kartu pertahanan, fuzz zona | Lulus | E 600 match. Q: **2000 match seed baru** (campuran level + 3 profil manusia + level campur dalam satu match), invarian zona tiap aksi (619.754 event, 64.570 kartu dimainkan, 20 dari 20 kartu pernah dimainkan); fuzz gangguan 150 match / 2889 aksi suntikan (hand sampai 10, tawaran paksa, tick 15 s), 0 penolakan dari bot dan semua match selesai. S: 0 ditolak |
| 2 | Replay, seed sama = aksi sama | Lulus | E 5 match. Q 60 match semua campuran level; 12 pasang seed sama/beda |
| 3 | Simulasi percobaan (pass rate, waktu, 2 tarikan) | Lulus (E) | E 6 tes. Tidak diulang QA; suite hijau |
| 4 | Jeda reaksi | Lulus | E. Q: setelah gagal, jeda Mulai terhadap **akhir cooldown** tidak pernah di bawah `thinkMs` min (Easy 1550 ms, Normal 1050, Hard 550 ms dari 274 / 151 / 88 percobaan ulang) |
| 5 | Rem | Lulus | E. Q: 300 match, tiap `attemptStarted` bot dicek: tidak ada yang mulai saat memimpin dan di depan jadwal (>3000 start) |
| 6 | Info tersembunyi | Lulus, tanpa kebocoran | E 500 state + 200 poll + scan sumber. Q: **36 match penuh** dengan controller buta (log aksi + state akhir identik, 8.706 aksi); tes kekuatan (bot pengintip terdeteksi); probe kolom yang sengaja dipertahankan (jenis sabotase pending lawan): 2.859 kartu ditukar, 3.660 keputusan identik |
| 7 | Rute | Lulus (E) | E 5 tes |
| 8-12 | Penawaran, kartu Easy/Normal/Hard, maks stack | Lulus (E) | E. Q: statistik overflow (interpretasi 2) di bawah |
| 13 | Win rate dan C-1 (1000 match/sel) | Gerbang lulus, margin Hard tipis | S seed 7 + 4 seed + gradien pace |
| 14 | Kalibrasi manusia referensi | Lulus | S: median solo 10,77 / 7,82 / 6,40 (target 11,0 / 8,0 / 6,5 ± 0,7) |
| 15 | Satu keputusan per 2-4 s | Lulus (E) | E |
| 16 | Pause | Lulus | E. Q unit: 6 match, 277 pause tepat saat bot "thinking" (213) atau "braking" (64), state + log aksi + activity beku, hasil akhir identik dengan tanpa pause. Q e2e: pause 2,5 s dengan jam nyata, state identik, indikator identik |
| 17 | Performa | Lulus | 2000 match campuran 2-4 seat + invarian: 13,7 s. Sim ~32.000 match: 158 s |

## Angka sim seed 7 (n = 1000 per sel)
Solo (manusia referensi): casual 10,77 mnt (p5 7,27, p95 14,41), attentive 7,82, expert 6,40. Semua dalam ± 0,7 dari target.

Manusia vs bot (win % manusia; waktu match median / p5 / p95 menit). Gerbang: C-1 Easy/Normal median [10, 13] dan p95 ≤ 18; Hard median [7, 9]; casual vs Hard di band; sisanya report-only.

| Manusia | Bot | Win % | Band §10 | Median | p5 | p95 | Gerbang waktu | Catatan |
|---|---|---|---|---|---|---|---|---|
| casual | 1 Easy | 87,5 | 75-90 | 11,06 | 7,6 | 13,9 | lulus | |
| casual | 2 Easy | 79,3 | - | 11,20 | 7,7 | 13,5 | lulus | |
| casual | 3 Easy | 77,9 | 50-75 | 11,08 | 7,8 | 13,4 | lulus | band report-only: di atas 2,9 poin |
| casual | 1 Normal | 68,6 | 35-55 | 10,58 | 7,5 | 12,8 | lulus | report-only: di atas 13,6 poin |
| casual | 2 Normal | 57,1 | - | 10,58 | 7,7 | 12,5 | lulus | |
| casual | 3 Normal | 46,5 | 8-22 | 10,53 | 7,7 | 12,3 | lulus | report-only: di atas 24,5 poin |
| casual | 1 Hard | 16,4 | 15-35 | 8,91 | 7,6 | 9,7 | lulus | **tipis**, lihat margin |
| casual | 2 Hard | 13,0 | - | 8,28 | 7,2 | 9,1 | lulus | |
| casual | 3 Hard | 8,9 | 3-12 | 7,71 | 7,1 | 9,0 | lulus | |
| attentive | 1 / 3 Easy | 99,6 / 98,7 | 90-99 / 85-97 | 7,97 / 8,16 | | | | report-only: di atas |
| attentive | 1 / 3 Normal | 93,2 / 78,9 | 60-80 / 25-45 | 7,95 / 8,12 | | | | report-only: di atas jauh |
| attentive | 1 / 3 Hard | 66,4 / 44,8 | 35-55 / 12-25 | 7,70 / 7,57 | | | | report-only: di atas |
| expert | 1 / 3 Easy | 100,0 / 99,6 | 97-100 / 95-100 | 6,48 / 6,53 | | | | dalam band |
| expert | 1 / 3 Normal | 97,1 / 88,0 | 80-92 / 45-65 | 6,49 / 6,58 | | | | report-only: di atas |
| expert | 1 / 3 Hard | 87,7 / 64,2 | 55-75 / 25-45 | 6,50 / 6,44 | | | | report-only: di atas |

p5 casual 7,1-7,8 mnt di semua sel (< 8, report-only per keputusan PM; tidak bisa di atas p5 solo casual 7,27).

Bot vs bot (win % bot pertama): Hard vs Normal **91,2%** (gerbang ≥ 65%, lulus), Normal vs Easy **88,1%** (75-90, lulus), Hard vs Easy 99,5-99,9% (info).

## Margin: seberapa tipis gerbangnya
Reproduksi independen dengan seed lain (skrip QA di luar repo, memakai `runCell` yang sama; 4 seed x 1000 match; urutan = seed 11 / 12 / 13 / 14):

| Sel | Win % | Median | p95 | Gerbang | Margin |
|---|---|---|---|---|---|
| casual vs 1 Hard | 14,0 / 15,2 / 15,2 / 18,3 (seed 7: 16,4; PM: 15,9; seed 21, 22: 16,0 / 14,9) | 8,92 / 8,91 / 8,90 / 8,91 | 9,6-9,7 | win 15-35, median [7, 9] | **win: rata-rata delapan run 15,7%, batas 15%: 0,7 poin, 2 dari 8 run di bawah (14,0 dan 14,9). Median: 0,09 mnt dari batas 9** |
| casual vs 2 Hard | 13,5 / 12,4 / 13,2 / 13,5 | 8,40 / 8,14 / 8,09 / 8,12 | 9,1-9,2 | median [7, 9] | 0,6-0,9 mnt |
| casual vs 3 Hard | 10,0 / 10,3 / 10,6 / 9,9 | 7,71-7,72 | 9,0 | win 3-12, median [7, 9] | win: 1,4-2,1 poin dari 12 |
| casual vs 1 Normal | 69,7 / 65,7 / 68,6 / 69,4 | 10,61-10,74 | 12,8-12,9 | median [10, 13], p95 ≤ 18 | 0,6 mnt dari 10 |
| casual vs 3 Normal | 45,4 / 43,7 / 49,6 / 47,6 | 10,54-10,57 | 12,3-12,4 | idem | 0,54 mnt dari 10 |
| casual vs 1 Easy | 86,4 / 86,7 / 85,8 / 87,0 | 10,93-11,13 | 13,8-14,0 | idem | 0,9 mnt dari 10 |
| casual vs 3 Easy | 76,9 / 79,1 / 79,4 / 78,6 | 10,99-11,10 | 13,2-13,3 | idem | 1,0 mnt dari 10 |
| Hard vs Normal | 93,4 / 92,7 / 90,2 / 91,4 | 8,91-8,95 | | ≥ 65% | 25 poin |
| Normal vs Easy | 88,3 / 86,0 / 87,6 / 87,5 | 12,37-12,39 | | 75-90 | 1,7-4 poin dari 90 |

Kesimpulan margin:
1. **Median waktu stabil** (selisih antar seed ≤ 0,02 mnt di sel Hard): ditentukan rem dan jeda, bukan keberuntungan. Aman terhadap noise, tapi hanya 0,09 mnt dari batas 9,0 di sel 1 Hard.
2. **Win casual vs 1 Hard berisik** (galat baku 1,15 poin pada n=1000; nilai benar sekitar 15,7%). Gerbang "15-35" di n=1000 akan gagal di sebagian seed walau kodenya tidak berubah. Saran: gerbang diukur di n ≥ 4000 atau band bawah dicatat sebagai "15 ± 1,2".
3. **Gradien `paceTargetMs` Hard** (2 seed x 1000, casual vs 1 / 3 Hard; win % rata-rata dan median):

| pace (s) | vs 1 Hard win % | median | vs 3 Hard win % | median |
|---|---|---|---|---|
| 560 | 10,1 | 8,21 | 6,7 | 7,10 |
| 590 | 13,8 | 8,63 | 8,0 | 7,46 |
| **610** | **15,5** | **8,90** | **10,0** | **7,71** |
| 630 | 17,8 | 9,19 | 11,9 | 7,96 |
| 660 | 25,4 | 9,58 | 14,2 | 8,33 |

Jendela yang memenuhi semua gerbang sekaligus hanya sekitar **600-620 s** (di bawah ~600 win vs 1 Hard < 15%; di atas ~620 median vs 1 Hard > 9,0 dan win vs 3 Hard mendekati 12%). 610 memang di tengah, tapi jendelanya hanya ± 10 s lebar. Perubahan kecil di bagian lain (cooldown, durasi minigame, `afterWinMs` manusia) akan menggesernya.

## Dog-pile pada pemimpin manusia (★4)
Pengukuran (250 match per baris, manusia referensi + 3 bot sama level; "memimpin" = `remainingWins` ≤ semua lawan; dihitung tiap `sabotagePlayed` yang diarahkan ke p1, termasuk yang diblok Payung / dipantul Cermin / Copet):

| Manusia vs 3 bot | Porsi waktu memimpin | Sabotase per menit (saat memimpin) | Per match p50 / p90 / maks | Kedua slot penuh | Satu slot atau lebih | Win manusia |
|---|---|---|---|---|---|---|
| expert vs Normal | 91% | **1,16** | 1,13 / 1,60 / 2,00 | 14,4% | 45,8% | 90,0% |
| expert vs Hard | 84% | **1,12** | 1,14 / 1,56 / 2,35 | 13,5% | 47,1% | 68,4% |
| casual vs Normal | 63% | 0,70 | 0,68 / 1,12 / 1,65 | 9,2% | 36,1% | 50,4% |
| casual vs Hard | 31% | 0,54 | 0,41 / 1,15 / 1,77 | 7,0% | 32,6% | 10,8% |
| expert vs Easy (pembanding) | 97% | 1,07 | 1,08 / 1,39 / 1,71 | 14,2% | 47,1% | 99,6% |

Hasil sabotase untuk expert vs Normal: 1280 mendarat, 338 dicopet, 203 diblok, 52 dipantul (dari 1882). Slot tidak pernah lebih dari 2 (cap berjalan).

Bacaan: pemimpin manusia kira-kira dikenai satu sabotase tiap 50-55 detik dari tiga bot, dan dua slot penuh tidak sampai seperenam waktu. Itu **bukan dog-pile yang menindas**; bot Easy (acak) hampir sama banyaknya (1,07/menit), jadi pemilihan target "pemimpin" bukan penyebab utama, melainkan frekuensi kartu. Tuas ★4 (`copetMinGapMs`, `cardGapMs`, `gunungMinValid`) tidak perlu diubah sekarang. Rasa sebenarnya (apakah 1 sabotase/menit terasa adil di layar yang sudah ramai) harus dinilai di playtest.

## Verdict delapan interpretasi Engineer
| # | Interpretasi | Verdict | Alasan / bukti |
|---|---|---|---|
| 1 | Normal `routeMistake` memilih di antara tetangga **bukan terbaik** | **Diterima** | Kalau "acak seperti Easy" dibaca harfiah (termasuk tetangga terbaik), peluang salah efektif hanya 15% × (1 − 1/k) = 7,5% untuk k = 2, jadi "terpendek 85% ± 3" (§11 #7) gagal. Pembacaan Engineer persis menghasilkan 85%. Perbarui kalimat §5 |
| 2 | Aturan luapan boleh memainkan kartu bernilai rendah secara boros | **Diterima, catatan** | Diukur (120 match: 60 dengan 2 bot Normal, 60 dengan 2 bot Hard, manusia attentive): Normal 11 dari 1270 kartu (0,9%), Hard 131 dari 1308 (10,0%). Kartu luapan Hard: teropong 40, zona_lebar 40, nyawa_cadangan 26, jam_pasir 18, ojek_kilat 3, santai_dulu 2, copet 1, tiket 1. Kopi Tubruk "boros" (tanpa cooldown): 0. Jadi yang "terbuang" hanya boost kecil di region mudah; alternatifnya kartu itu dibuang di layar buang berikutnya, jadi hasilnya tidak lebih buruk. Catatan: porsi Hard 10% berarti "Hard menyimpan boost untuk region sulit" (§7 #6) kurang benar di praktik; kalau PM ingin Hard lebih hemat, naikkan `overflowHand` Hard ke 5 |
| 3 | Observasi memuat jenis sabotase pending milik lawan | **Diterima, catatan** | Menyimpang dari tabel §2 ("nama kartu sabotase milik pihak lain tidak boleh"), tapi validator butuh "Sudah kena kartu ini" dan itu kebocoran yang disengaja (cards.md §1). Tidak dieksploitasi: keputusan hanya memakai `sabotageSlotsUsed` dan validator (scan sumber), dan probe QA menukar 2.859 jenis kartu pending lawan di 40 match: 3.660 keputusan identik. Catatan: manusia hanya melihat label untuk kartu yang sedang dipegangnya; bot punya daftar penuh. Perbarui §2 |
| 4 | `p_next` memakai difficulty efektif setelah pending | **Diterima** | Konsisten dengan §3 #1 (tabel pass chance per difficulty **efektif**). Efek: setelah Santai Dulu terpasang `p_next` naik jadi tidak menumpuk boost; saat bot disabotase `p_next` turun jadi Hard memakai boost ("atau sedang disabotase" di §7 #6) |
| 5 | Copet diurutkan setelah Badai | **Diterima** | §7.2 tidak menyebut posisi Copet ("aturan terpisah"); nilai Copet = Badai = 6. Tidak ada efek terukur pada hasil |
| 6 | Gunung (Hard) butuh ≥ 2 target valid, atau 1 lawan, atau gap ≥ 3 | **Diterima** | Persis tabel §7.2 Hard; kodenya `valid >= gunungMinValid \|\| (valid >= 1 && (opponents === 1 \|\| gap >= 3))` |
| 7 | `dodge_runner` lulus = 100% durasi | **Diterima** | Sama dengan minigame manusia: `dodgeRunner.ts` menulis `timeTakenMs: level.durationMs` saat sukses. Konsisten dan sesuai §3 #3 |
| 8 | Pada kegagalan `thinkMs` dimulai setelah cooldown | **Diterima** | Persis tabel §3 ("setelah cooldown habis"). Terukur: Mulai tidak pernah lebih cepat dari `thinkMs` min setelah cooldown berakhir. Akibatnya bot menunggu cooldown + think (manusia cepat bisa mulai tepat saat cooldown habis); itu sengaja dan sudah masuk kalibrasi |

Tambahan di luar daftar: aksi baru **`chooseCards`** diterima. Validasi dicek (jumlah salah, uid ganda, uid asing, tanpa layar: semua `actionRejected`); catatan untuk server nanti: `chooseCards` melewati timer 15 s dan penandaan, jadi seperti `autoCards` ia harus tetap divalidasi per pengirim. Nilai `pace` Normal 840 s / Hard 610 s dan `afterWinMs` manusia referensi (casual 36-50 s, attentive 27,5-39,5, expert 21,5-31,5) diterima sebagai hasil kalibrasi; lihat kekhawatiran C-1 di bawah.

## QA-CP4b-04 dan -05
- **QA-CP4b-04 (picker dibangun ulang):** fixed. `CardsUi.renderPicker` sekarang membangun picker sekali per kartu lalu memperbarui per node; tes `cp4b-qa.spec.ts` "QA-CP4b-04" sudah bukan `test.fail`. Hasil di run penuh: `cp4b-qa.spec.ts` lulus di desktop dan mobile pada run penuh (bukan lagi `test.fail`). Tap nyata di HP masih belum terkonfirmasi (butuh perangkat).
- **QA-CP4b-05 (timeout dodge):** fixed. `dodgeRunner.test.ts` dua tes berat diberi timeout 30 s; di suite penuh `npm test` lulus (415/415) tanpa flake. Dua tes e2e cp3b simon mobile diberi ruang waktu; hasil di run penuh: kedua tes lulus di run penuh (mobile ikut).

## Bug dan temuan
### QA-CP5a-01 (low, desktop keyboard): Tab keluar dari kartu Setup
- **Steps:** buka tanpa `?bots` (layar Setup), tekan Tab beberapa kali. Tes: `cp5a-qa.spec.ts` "QA-CP5a-01" (`test.fail`) dan "QA-CP5a-01b".
- **Expected:** fokus berputar hanya di dalam kartu (minus, plus, Easy, Normal, Hard, Mulai Balapan); elemen di belakang modal tidak bisa difokus.
- **Actual:** urutan fokus terukur `setup-start > btn-pause > BUTTON > BUTTON > btn-export-log > BODY > region-medan > region-padang > setup-bots-minus ...`. Menekan Enter di `btn-pause` membuka overlay pause **di atas** Setup (01b). Enter di region peta tidak memilih target (dijaga), jadi tidak ada kebocoran aksi.
- **Severity:** low. Pemain keyboard biasanya menekan Enter di tombol Mulai yang sudah terfokus. Tidak merusak state; tombol Mulai menyetel ulang pause.
- **Saran (Engineer):** `inert` pada `#hud` anak lain dan canvas selama Setup terbuka (atau focus trap), sama untuk modal lain di polishing CP6.

### Yang tidak ketemu
- Tidak ada aksi bot yang ditolak, tidak ada kartu hilang/ganda, tidak ada match macet (semua selesai, tidak ada `timedOut`).
- Tidak ada kebocoran info di jalur kontroller (`wakeAtMs`/`activity` hanya membaca state sendiri; scan sumber Engineer + harness QA).
- Setup di layar 390x844, 320x568 dan 844x390 (landscape): semua kontrol di dalam viewport dan ≥ 44 x 44 px. Double tap pada Mulai Balapan: satu match, tap kedua tidak memilih apa pun di belakangnya.
- Setup: URL `?bots`/`?botLevel` salah ketik di-clamp (9 → 3, 0 → 1, abc → 3, level asing → normal); Pause → Keluar membuka Setup dengan pilihan terakhir dan jam tertahan; "Main Lagi" memakai setup yang sama.
- Indikator berpikir: baris manusia tidak pernah punya activity; bot yang sedang main tidak menampilkannya; bot pemimpin yang menahan diri menampilkan "menahan diri" + gelembung di pion dan padam saat bot mulai lagi; pause membekukan semuanya.

### Catatan dokumen / desain (bukan bug)
1. ui-flow §2 Setup menyebut nama + warna pion dan preset; layar yang dibangun hanya jumlah bot dan level. Wajar untuk CP5a, tapi ui-flow perlu ditandai "sebagian".
2. **Kalibrasi C-1 adalah kalibrasi model.** `casual` memakai `afterWinMs` 36-50 s (bots.md §9 menulis 20-34 s). Setengah lebih dari waktu 10,8 menit casual adalah jeda antar-win yang diasumsikan (8 x ~43 s ≈ 5,7 mnt). Gerbang C-1 [10, 13] jadi hanya membuktikan bahwa model sesuai angka itu; kalau pemain kasual nyata lebih cepat dari ~43 s antar win, C-1 pecah (tuas manusia ada di keputusan PM ★1). **Butuh data playtest CP6 untuk angka ini.**
3. Bot Normal dan Hard tidak sekuat desain untuk attentive/expert (expert menang 97% vs 1 Normal, 64% vs 3 Hard). Itu sudah diputuskan report-only. Catatan saja: "Hard sebagai tantangan" nyata hanya bagi casual.
4. Median waktu vs Hard (8,9) hanya 0,09 mnt dari batas 9 karena rem Hard mengikuti jadwal, bukan keberuntungan; jadi bila nanti `afterWinMs` casual diubah, gerbang ini bergeser langsung.

## Saran pembaruan bots.md (belum dikerjakan oleh siapa pun)
- §3 / §12: aksi atom `chooseCards` (nama final, pengganti `pickCards`/`discardCards`).
- §5: kalimat `routeMistake` Normal ("acak di antara tetangga selain yang terbaik").
- §2: tambah baris "jenis kartu sabotase pending milik lawan: terlihat hanya lewat validator".
- §7.2: posisi Copet (setelah Badai).
- §8: `paceTargetMs` Normal 840000 / Hard 610000; §9: `afterWinMs` manusia 36000-50000 / 27500-39500 / 21500-31500.
- §10: gerbang baru dari PM (median Hard [7, 9], Hard vs Normal ≥ 65%, p5 report-only) dan angka terukur di laporan ini.

## Mutation / kekuatan tes
- Harness kebocoran diuji dengan bot pengintip (membaca `matchSeed` atau hand lawan): menyimpang di 8 dari 8 match (syarat ≥ 6).
- Tes pause diuji pada saat yang paling berisiko (213 pause saat "thinking", 64 saat "braking"); tidak ada selisih.
- Tidak ada mutasi pada `src/` (aturan peran).

## Butuh HP asli atau playtest
- Rasa sentuh Setup (stepper, segmented) dan tap picker setelah perbaikan QA-CP4b-04.
- Keterbacaan gelembung "berpikir" di pion dan label "menahan diri" di layar kecil; apakah bot yang menunggu 18-34 s setelah menang terasa "hidup" atau "macet" (Engineer sudah menambah indikator; perlu penilaian manusia).
- Rasa Hard: casual menang ±16% vs 1 Hard dan ±10% vs 3 Hard; apakah itu "tantangan" atau "frustrasi".
- Rasa dog-pile: ~1 sabotase/menit ke pemimpin; apakah toast dan kartu bot terbaca.
- Teks terpotong di Setup (mesin ini tanpa font), safe area, kalibrasi `afterWinMs` manusia nyata (C-1), dan apakah pemain kasual memang butuh ~43 s antar win.

## Berkas
- `tests/bots-qa.test.ts` (11 tes), `tests/e2e/cp5a-qa.spec.ts` (15 tes x 2 viewport).
- Skrip margin (di luar repo, scratchpad sesi): `margins.ts`; angka dipindahkan ke laporan ini.
