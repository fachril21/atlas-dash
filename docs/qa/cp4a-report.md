# Laporan QA CP4a: kartu boost, penawaran, hand/buang, timer

**Oleh:** 🧪 QA · **Tanggal:** 2026-11-16 · **Acuan:** [cards.md v0.3](../cards.md), [ui-flow.md](../ui-flow.md) §4–§6, [pm-decisions.md](../pm-decisions.md) (CP4a), [test-plan.md](test-plan.md) CP4

## Ringkasan
- Tidak ada bug blocker atau high. **3 temuan: 1 medium, 2 low**, plus 3 catatan. `src/` tidak diubah.
- Test baru: `tests/cp4a-qa.test.ts` (32 test, termasuk fuzz 50 seed × 350 aksi dan 2 `it.fails` yang mendokumentasikan bug) dan `tests/e2e/cp4a-qa.spec.ts` (7 test × 2 project).
- `docs/qa/test-plan.md` diperbaiki (lihat bagian terakhir).
- Output nyata ada di bagian "Hasil run".

## Hasil run
`npm test` (vitest run): `Test Files 12 passed (12)`, `Tests 258 passed | 2 expected fail (260)` (228 lama + 30 baru lulus; 2 `it.fails` = bug terdokumentasi).

`npm run build` (typecheck logic + app + test, lalu `vite build`): lulus, `✓ 47 modules transformed`, `✓ built in 324ms`.

E2E penuh (`npx playwright test`, desktop + mobile, satu kali di akhir): `3 skipped`, `109 passed (16.4m)`. Itu 95 lama + 14 baru (`cp4a-qa.spec.ts`: 7 test × 2 project), nol gagal. Spec cp4a dan cp4a-qa sudah termasuk di run ini.

## Kriteria penerimaan CP4a

| # | Kriteria | Hasil | Bukti |
|---|---|---|---|
| 1 | 20 kartu sebagai data; 9 boost aktif (fase a), sabotase + Payung/Cermin tertahan (fase b) | Lulus | `cards.test.ts` data + "phase b cards never played"; fuzz QA |
| 2 | Interpreter efek: snapshot saat Mulai (DR-48), clamp difficulty/durasi, netting, trigger onWin/onFail | Lulus | `cards.test.ts`; QA: 8 pending sekaligus, netting dengan def sabotase hipotetis |
| 3 | Algoritma penawaran §3.1: 5 kartu berbeda, urutan tetap, seed sama = sama, pool kecil, tak ada undi ulang | Lulus | `cards.test.ts` (seed 1..2000); QA: seed beda → penawaran beda; e2e seed 7 vs 8 lewat win asli |
| 4 | Pilih N dari 5 (1/2/3 menurut difficulty efektif, Oleh-oleh +1, clamp) | Lulus | QA: tabel `pickCount` penuh, hard+Oleh = 4, Santai Dulu mengubah N dan cooldown |
| 5 | Hand maks 5, layar buang sampai 9, tak bisa ditutup sebelum ≤ 5, duplikat boleh | Lulus | `cards.test.ts`; QA fuzz: hand ≤ 5 tanpa layar buang, ≤ 9 dengan layar |
| 6 | Timer 15 s game-time, auto-pick (rarity tertinggi, kiri dulu) dan auto-buang (rarity terendah, paling lama dulu), beku saat pause | Lulus | QA: batas 14,95 s / 15 s, tick besar 60 s, `GameSession` paused 100 s, e2e pause layar buang dengan jam nyata |
| 7 | Tidak ada kartu ganda / hilang (zona, id unik) | **Gagal sebagian** (QA-CP4a-02, low) | fuzz: tak ada duplikat; kartu penawaran hilang dari semua zona saat match berakhir |
| 8 | maxStacks, kartu tetap di hand bila lewat batas | Lulus | QA: Jam Pasir ke-3 ditolak, bisa lagi setelah percobaan habis |
| 9 | Trigger habis setelah 1 percobaan (menang/gagal/retry) | Lulus | QA: retry, Nyawa+Jam Pasir, `cardsSpent.effective`, pending bertahan lewat ganti target/Tiket |
| 10 | Tiket Pesawat (DR-31) | Lulus | QA: reset retry/minigame/cooldown, rantai Sabang→Toraja, FINAL ditolak dan kartu tetap, tak ada offer, lawan tak tersentuh |
| 11 | Ojek Kilat (+2 clamp), di FINAL langsung menang tanpa offer | Lulus | QA: FINAL menang dan layar lawan tertutup, fail di FINAL = cooldown normal, 1 offer saja di non-FINAL |
| 12 | Oleh-oleh (+1), di FINAL tak ada penawaran | Lulus | QA: hard + Oleh = 4 → hand 9 → buang 4; Oleh+Ojek di FINAL |
| 13 | Match berakhir saat layar kartu terbuka: layar tutup tanpa kartu | Lulus (perilaku), lihat -02 untuk pembukuan | QA |
| 14 | Determinisme seed sama | Lulus, **kecuali replay dari `actionLog`** (QA-CP4a-01) | QA: state + event log identik byte-per-byte; replay aksi tanpa lipatan tick identik |
| 15 | UI: hand bar + layar buang 9 kartu di 390×844 tanpa tumpang tindih / keluar layar | Lulus | e2e QA (lihat di bawah) |
| 16 | B-1 (data-minigame dibersihkan) | Lulus | `cp4a.spec.ts` |

### Layout 390×844 (e2e `cp4a-qa.spec.ts`, desktop dan mobile)
- 8 badge pending + 5 kartu hand: tidak ada badge yang menutup tombol Mulai, panel target, daftar progres; semua badge di dalam viewport; Mulai tetap menjadi elemen teratas di titik tengahnya (`elementFromPoint`).
- Layar buang 9 kartu: semua kartu di dalam viewport, tidak ada pasangan yang tumpang tindih, tiap kartu ≥ 48×48, nama kartu tidak terpotong (`scrollWidth`), tombol Buang tidak tertutup dan bisa di-hit.
- Layar penawaran 5 kartu: kartu dan tombol Ambil seluruhnya di dalam viewport tanpa scroll.

## Bug

### QA-CP4a-01 (medium): replay dari `session.actionLog` tidak sama dengan state asli
- **Steps:** jalankan `GameSession` (1 manusia + 1 bot) sampai ada beberapa layar kartu yang habis waktu, lalu `replay(map, initial, session.actionLog.map(l => l.action))` dan bandingkan dengan `session.state`. Tes: `tests/cp4a-qa.test.ts` › "replaying session.actionLog (folded ticks)" (`it.fails`).
- **Expected:** replay identik (log ekspor dan replay dipakai untuk debug dan nanti server).
- **Actual:** state berbeda (p1 di Jakarta vs menang; 41 vs 56 kartu dibuat pada seed 4321). Penyebab: `GameSession.logAction` menggabungkan tick berurutan, sedangkan timeout layar kartu terjadi di dalam `tick`. Pada tick yang digabung, timeout terselesaikan di akhir gabungan, jadi `expiresAtMs` layar buang yang menyusul (+15 s) bergeser dan seluruh jalannya permainan menyimpang. Replay **tanpa** penggabungan tick identik (tes hijau), jadi logika reducer sendiri deterministik.
- **Severity:** medium untuk debug/export log dan persiapan server; tidak terlihat pemain.
- **Saran (untuk Engineer):** jangan gabungkan tick di `actionLog`, atau pecah tick menjadi langkah ≤ `LOGIC_STEP_MS` saat replay, atau selesaikan timeout dengan waktu kedaluwarsa eksak (`expiresAtMs`) bukan waktu tick.
- **Evidence:** `npm test` → "2 expected fail"; log perbandingan di tes.

### QA-CP4a-02 (low): kartu penawaran hilang dari semua zona saat match berakhir
- **Steps:** p1 menang 1 minigame (offer terbuka, 5 kartu), p2 memenangkan match. Tes: "another player winning closes the offer ... zone accounting" (`it.fails`).
- **Expected:** invarian cards.md §4 (tiap instance tepat di 1 zona): 5 kartu offer masuk `discarded`.
- **Actual:** `closeCardScreens` hanya mengisi `offer = null`, 5 instance tidak ada di zona mana pun (`nextCardUid - 1` ≠ jumlah di zona). Tidak terlihat pemain, hanya merusak invarian dan jumlah kartu di log.
- **Severity:** low.

### QA-CP4a-03 (low, desain/UI): tombol Pause tertutup layar penawaran dan layar buang
- **Steps:** buka penawaran (`forceOffer`), hit-test titik tengah `btn-pause`.
- **Actual:** elemen teratas adalah `card-offer` (modal menutup seluruh layar). Pemain solo tidak bisa pause saat 15 s layar kartu. Timer hanya beku bila pause datang dari luar (hook, tab disembunyikan).
- **Expected:** ui-flow §2 hanya menyatakan layar kartu "tidak bisa ditutup"; pause tidak disebut. Perlu keputusan PM: apakah pause boleh di layar kartu (di HP, notifikasi masuk saat 15 s berjalan akan memicu auto-pick).
- **Severity:** low (butuh keputusan, bukan cacat tegas).

### Catatan (bukan bug)
1. `cardsSpent.effective` bernilai `true` untuk semua kartu tak bersyarat, juga Santai Dulu di region easy (tanpa efek). Hanya label event; UI belum memakainya.
2. Hand bisa tertinggal > 5 (sampai 9) di layar Hasil bila match berakhir saat layar buang terbuka. Tidak berdampak karena match selesai (diterima PM: layar tertutup tanpa kartu).
3. Hook `debugGrantCard` saat layar buang terbuka menimpa `discard` (tanda hilang, timer direset) dan saat offer terbuka bisa membuka offer + discard bersamaan. Hanya debug; reducer menerima `debug*` di build mana pun (sudah dicatat PM untuk multiplayer).

## Review test Engineer (`tests/cards.test.ts`, `tests/e2e/cp4a.spec.ts`)
Sesuai cards.md v0.3 dan umumnya kuat. Celah dan asersi lemah:
1. **Tidak ada fuzz zona** padahal test-plan `card_zones_invariant` meminta 500 seed × 200 aksi. Ditambahkan (50 seed × 350 aksi, termasuk aksi ilegal dan tick 14,999/15 s). Menemukan QA-CP4a-02 saat pembukuan diperiksa.
2. Tes "match berakhir menutup layar" hanya memeriksa `offer == null` dan hand 0, tidak memeriksa pembukuan kartu offer.
3. Tiket Pesawat: `expect(remainingWins).toBeLessThan(P(s).remainingWins + 1)` terlalu longgar (lolos bila tidak berubah). Diperkuat di tes QA: `remainingWins == winsRequired × playDist(medan)`.
4. Tidak ada tes `GameSession`/pause di level logic untuk layar buang, tick besar (rantai offer → buang dalam satu tick), maupun replay log.
5. e2e pause hanya untuk layar penawaran; layar buang dan jam nyata ditambahkan.
6. Layout 390×844: Engineer memeriksa 2 baris dan kartu ≥ 48; tidak memeriksa tumpang tindih antar-kartu, teks terpotong, tombol Buang tertutup, 8 badge pending, dan layar penawaran 5 kartu. Ditambahkan; semua lulus.
7. Tidak ada tes double-submit (Ambil dua kali, timeout berpacu dengan Ambil). Ditambahkan (unit + e2e).
8. Determinisme end-to-end lewat win asli di browser (seed URL) tidak ada; ditambahkan.
9. Baris `test-plan.md` yang basi (cooldown 12/8/4, Santai Dulu hard = 8 s) diperbaiki.

## Perbaikan `docs/qa/test-plan.md`
- `race_cooldown_by_difficulty`: 12/8/4 → 8/6/4 s.
- `effective_difficulty_drives_rewards`: Santai Dulu di hard → cooldown **6 s** dan 2 kartu (bukan 8 s).
- Baseline tes diperbarui; ditambah catatan pembagian CP4a/CP4b dan baris mana yang baru berlaku di CP4b; `pending_applied_at_start` tak lagi menyebut `next_fail`/`next_reward`.

## Yang masih butuh HP asli
- Ketukan kartu di hand dan layar buang dengan jari nyata (ukuran sentuh 48–68 px, tap meleset, kartu 60 px lebar di layar buang 5 kolom): headless hanya mengukur kotak.
- Keterbacaan nama kartu 11 px dan deskripsi di layar penawaran (font tidak terpasang di mesin QA, jadi tes memakai data/ukuran, bukan render teks).
- Animasi flip penawaran dan kartu terbang pada perangkat menengah; `prefers-reduced-motion`.
- Safe-area (notch, home indicator) untuk hand bar di iPhone; ketinggian hand bar vs bar alamat browser seluler.
- Rasa timer 15 s dan auto-pick (apakah cukup untuk membaca 5 kartu), serta Pause saat layar kartu (QA-CP4a-03).
- Teks "tempo −15%" dan peringatan Santai Dulu/Oleh-oleh terbaca oleh pemain baru (`manual_card_readability`).
- Pemantauan playtest yang sudah ditandai PM: Ojek Kilat di FINAL, Zona Lebar di Simon hard.
