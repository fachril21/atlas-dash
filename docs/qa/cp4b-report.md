# Laporan QA CP4b: sabotase, target picker, cap 2, Copet, Payung/Cermin, comeback

**Oleh:** 🧪 QA · **Tanggal:** 2026-11-17 · **Acuan:** [cards.md v0.4](../cards.md) §2.2, §2.3, §3.2, §3.4, §8 · [ui-flow.md](../ui-flow.md) §1/§3/§7 · [pm-decisions.md](../pm-decisions.md) (CP4b) · build commit `4125e5d`

## Ringkasan
- **Tidak ada bug logic.** Semua 21 kriteria §8 punya bukti lulus. Fuzz (250 seed × 250 aksi, 4 pemain, 2 bot) tidak menemukan kartu hilang/ganda, replay selalu identik. `src/` tidak diubah.
- **4 temuan UI picker** (3 low menyimpang dari ui-flow §7, 1 medium-dugaan soal tap hilang di HP): tap di luar picker tidak berfungsi (-01), Esc menutup picker sekaligus Detail (-02), tidak ada fokus awal di baris lawan pertama (-03), dan baris picker dibangun ulang tiap ada bot berubah state, rata-rata tiap 2,7 detik dengan 3 bot (-04). Semuanya tercatat sebagai tes "bug terdokumentasi" (lulus selama bug ada, gagal begitu diperbaiki).
- **1 temuan test hygiene (QA-CP4b-05, sudah ada sebelum CP4b):** `tests/dodgeRunner.test.ts` "lanes: every row..." butuh 2,2 s sendirian dan melewati timeout bawaan 5 s saat `npm test` jalan paralel di mesin 4 core bersama (gagal 3 dari 4 run di baseline tanpa file QA-ku). Bukan bug game.
- **Temuan dokumen:** hand maksimal sebenarnya **10**, bukan 9 (cards.md §1 dan ui-flow §6); kriteria §8 butir 16 "tiap slot ±4 poin" tidak bisa dipenuhi di slot 5 pada tier gap 3–4 karena jaminan rare+ (angka di bawah); kalimat alasan redup di §2.2.1 ambigu.
- Keenam interpretasi Engineer **diterima** (verdict per butir di bawah, tidak ada yang ditolak).
- Perlu HP asli: rasa tap picker, keterbacaan toast, teks yang terpotong (mesin tes tidak punya font), safe area, animasi kartu terbang (belum dibangun).

## Hasil run
Mesin ini dipakai bersama agen lain (load average 4,5 di 4 core), jadi angka di bawah memuat dua catatan flake yang sudah dipastikan bukan dari kode CP4b.

- **`npm run typecheck` + `vite build`:** lulus (`✓ built in 339ms`).
- **`npm test` (vitest):** `Tests 362 passed (362)` saat mesin tidak sibuk = 329 baseline + 33 baru (`tests/cp4b-qa.test.ts`, 9 detik sendirian). Pada run paralel yang sibuk, 1 tes lama `dodgeRunner "lanes: every row..."` gagal timeout 5 s (361 lulus + 1 timeout; terjadi 8 dari 12 run: 3 dari 4 run **tanpa** file QA-ku dan 5 dari 8 dengan; lihat QA-CP4b-05).
- **e2e penuh** (`npx playwright test`, desktop + mobile, satu worker) pada build final: `158 passed, 6 skipped, 2 failed (23,4m)` dari 166 test. Dua yang gagal sama-sama mobile dan lulus saat diulang di mesin tenang:
  - `cp3b.spec.ts` simon "more wrong pads..." timeout 90 s (juga gagal di run penuh sebelumnya; lulus 4 dari 4 saat dijalankan sendiri). Polling jam nyata, sensitif beban.
  - `cp4b.spec.ts` picker 3 lawan, "element has no bounding box": baris picker dibangun ulang antara locator dan pengukuran (mekanisme sama dengan QA-CP4b-04). Ulang `cp4b.spec.ts` + `cp4b-qa.spec.ts` bersama di mesin tenang: `53 passed, 3 skipped, 0 failed (5,6m)`.
- **Spec QA baru** `tests/e2e/cp4b-qa.spec.ts`: 17 test (34 instance desktop + mobile; 3 test khusus keyboard dilewati di mobile = 3 skipped). Empat di antaranya `test.fail` yang mendokumentasikan QA-CP4b-01 sampai -04 (hijau selama bug ada).
- **Skip di suite lama:** 3 (tes keyboard khusus desktop), sama dengan baseline. Total skip sekarang 6 = 3 lama + 3 baru.

## Peta kriteria §8 ke tes

`E` = tes Engineer (`tests/cp4b.test.ts`, `tests/e2e/cp4b.spec.ts`), `Q` = tes QA (`tests/cp4b-qa.test.ts`, `tests/e2e/cp4b-qa.spec.ts`).

| # | Kriteria | Hasil | Tes |
|---|---|---|---|
| 1 | Pool 20 kartu, Payung/Cermin muncul, kartu fase b jalan | Lulus | E "1. pool" (3). Q: statistik 10.000 seed per tier memakai pool 20 |
| 2 | Target valid + label; Copet ke "Penuh"; diri sendiri tidak valid | Lulus | E "2." (5). Q: validitas tidak bergantung Payung/Cermin lawan (info tersembunyi), 3 pengirim berebut slot terakhir |
| 3 | Tanpa target valid: redup + alasan, tetap di hand | Lulus | E "3-4". Q e2e: alasan di detail "Semua lawan penuh" dan "Semua lawan hand kosong", Pakai nonaktif, picker tidak terbuka (desktop + mobile) |
| 4 | Cek ulang saat konfirmasi | Lulus | E "3-4" (picker terbuka lalu target penuh/kosong). Q: pengirim ketiga ditolak `bad-target`, kartu tetap di hand |
| 5 | Q2: cap 2 dari semua sumber; slot dilepas; snapshot menahan slot; Copet tanpa slot | Lulus | E "5". Q: snapshot menahan slot saat target main + sabotase masuk di tengah percobaan (R3) + Gunung melewati target penuh + hasil melepas hanya slot snapshot; Copet pada target main dengan 2 slot tidak menyentuh attempt |
| 6 | R3: berlaku ke percobaan berikutnya/ulang | Lulus | E "6". Q: kartu yang masuk di tengah percobaan bertahan setelah hasil |
| 7 | Cermin/Payung, tiap baris tabel §2.2.3 | Lulus | E "7-8" (9). Q (8 baru): Copet vs Cermin-vs-Cermin (Cermin pengirim tidak habis), pantulan Copet ke pengirim berPayung, stream `copet` pemilik Cermin (50 seed), Gunung campuran Cermin+Payung+biasa urutan seat, Gunung dari pengirim ber-Cermin, pantulan ke pengirim yang sudah punya kartu itu, Payung baru hanya menahan sabotase berikutnya |
| 8 | Kartu pertahanan maks 1 | Lulus | E "7-8". Q: invarian di fuzz (maks 1 per pemain di setiap langkah) |
| 9 | Gunung Meletus | Lulus | E "9" (4). Q: campuran Cermin/Payung/biasa; di fuzz: jumlah instance baru = jumlah target − 1 |
| 10 | Penggabungan, urutan acak, clamp | Lulus | E "10" (5). Q: **semua 120 urutan main** 5 kartu (2 sabotase dari pengirim berbeda + 3 boost) lewat reducer asli memberi attempt identik; clamp Badai+Gunung, +Santai Dulu, cooldown ikut difficulty efektif |
| 11 | DR-24 Macet + Nyawa | Lulus | E "11-12". Q: **semua 24 urutan** Macet+Nyawa+Pelit+Oleh-oleh memberi cooldown dan N sama |
| 12 | Pelit + Oleh-oleh | Lulus | E "11-12". Q: idem (N = 2 di region medium) |
| 13 | Copet RNG, sebaran, instance berpindah | Lulus | E "13-14" (10.000 percobaan ±3 poin). Q: oracle di fuzz (kartu pindah, `handSeq` terbaru, tak ada duplikat) |
| 14 | Copet hand ≤ 5, pantulan ke Buang, hand pengirim kosong | Lulus | E "13-14". Q: pantulan ke pemilik Cermin yang sedang main (hand 6, tanpa layar, lalu Copet kedua membuatnya 5 dan Buang tak pernah muncul) |
| 15 | DR-27 | Lulus | E "15" (4) + e2e Detail dan Buang. Q logic: pantulan masuk ke Buang yang sudah terbuka (butuh naik, tanda tetap, timer tak reset), ke layar Penawaran (hitung saat Ambil), korban dengan penawaran terbuka tapi hand kosong tidak valid, Buang yang ditutup Copet tidak habis waktu belakangan. Q e2e: Picker menutup bila kartunya dicuri dan tetap bila kartu lain; Buang dengan tanda: penghitung dihitung ulang |
| 16 | Comeback | Lulus (dengan catatan butir 16 di bawah) | E "16". Q: statistik per slot, per tier, lewat reducer asli untuk gap 0/1/3/5 (40 seed per tier) |
| 17 | Bot | Lulus | E "17" (9). Q: pass rate bot normal dengan Ngebut+Kabut (−16 poin) terukur 12.000 percobaan; invarian "bot tak pernah punya layar" di fuzz |
| 18 | Pause (UI) | Lulus | E: tombol Pause bisa di-hit-test di atas Offer/Buang/Detail/Picker dan timer beku. Q e2e: picker terbuka + Pause, 3 detik nyata pada ×10 (= 30 detik game): jam, semua pemain dan bot identik; lanjut → picker masih jalan; cooldown beku dengan Detail terbuka |
| 19 | Zona kartu fuzz | Lulus | E: 60 seed. Q: 250 seed × 250 aksi, 4 pemain, 2 bot, oracle per kartu yang dimainkan, state masukan tak pernah diubah, aksi yang ditolak tak mengubah state |
| 20 | Replay | Lulus | E: 3 seed. Q: 150 seed lewat `GameSession` dengan bot + aksi acak + tick terlipat dan tunggu panjang; 120 state fuzz: `tick(a+b)` = `tick(a); tick(b)` |
| 21 | UI 390×844 | Lulus (dengan QA-CP4b-01 sampai -04 sebagai temuan di luar kriteria) | E: picker 3 lawan. Q: picker kasus terburuk (label di baris tidak valid + chip "kartumu"), tanpa terpotong atau tumpang tindih; urutan baris mengikuti peringkat dengan badge "Terdepan"; Buang 6–10 kartu; toast tangkal/pantul/Copet muncul lalu hilang sendiri dan tidak menelan tap (di desktop dan mobile toast tidak menutupi daftar progres); bot menang saat picker terbuka: picker hilang, kartu tetap di hand, logic menolak |

## Hasil statistik comeback (butir 16), 10.000 seed per tier
Tabel dari `console.log` tes. Kolom = persen common / rare / epic yang terukur, per slot (tabel spec di kanan).

| Tier (gap) | Slot 1 | Slot 5 | Spec | P(≥ 1 rare+) | Rata-rata rare+ | Rata-rata epic |
|---|---|---|---|---|---|---|
| 0 | 75,1 / 22,1 / 2,8 | 75,1 / 22,1 / 2,8 | 75 / 22 / 3 | 76,3% | 1,25 | 0,15 |
| 1–2 | 65,0 / 28,3 / 6,7 | 65,0 / 28,4 / 6,7 | 65 / 28 / 7 | 88,4% | 1,75 | 0,34 |
| 3–4 | 54,9 / 32,3 / 12,8 | **49,8 / 35,9 / 14,3** | 55 / 32 / 13 | 100% | 2,30 | 0,66 |
| ≥ 5 | 44,9 / 35,2 / 19,9 | 43,4 / 36,6 / 20,0 | 45 / 35 / 20 | 100% | 2,76 | 1,00 |

- Slot 1 sampai 4 mengikuti tabel dalam ±1 poin di semua tier. **Slot 5 di tier gap 3–4 menyimpang 5,2 poin (common 49,8 vs 55)**, melewati batas ±4 di kriteria. Penyebabnya bukan bug: jaminan rare+ (§3.1 langkah 3) mengganti slot 5 lebih dulu bila tawaran semuanya common (≈ 5% tawaran di tier itu). Saran ke dokumen: ubah kriteria jadi "slot 1–4 ±4 poin, slot 5 ±7 poin pada tier berjaminan".
- Monoton: rata-rata rare+ dan epic naik di tiap tier; jaminan rare+ 100% di gap ≥ 3 (pool 20, 10.000 seed); tier 0 memang tanpa jaminan (23,7% tawaran tanpa rare+).
- Lewat reducer asli (p2 maju k region, p1 menang sekali): gap terukur 0/1/3/5 untuk k = 0/1/2/3, dan isi penawaran sama persis dengan hasil §3.1 untuk tier itu (40 seed per k).
- Bot (DR-35), normal, medium, Ngebut + Kabut: pass rate terukur 49,0% dari 24.000 percobaan, spec 65 − 16 = 49%. Di tes dipakai 12.000 percobaan dengan toleransi 2 poin (satu kali 4.000 percobaan memberi 50,7%, masih dalam 2 simpangan baku, jadi sampel dinaikkan).

## Verdict interpretasi Engineer

| # | Interpretasi | Verdict | Dasar |
|---|---|---|---|
| 1 | Bot auto-pick dan auto-buang seketika di dalam reducer | **Diterima** | Sesuai cards.md §3.2.1 ("seketika, tanpa layar dan timer, deterministik, tanpa RNG"). Fuzz: bot tidak pernah memegang layar di hingga 62.500 langkah (250 seed × 250 aksi). Karena terjadi di dalam reducer, `replay(actionLog)` tetap identik (150 seed dengan bot). Catatan: cabang `autoCards` di `PlaceholderBotController` kini tak terpakai |
| 2 | Pantulan Copet ke pemain yang sedang main menunda layar Buang; hand bisa 6–10 | **Diterima, dokumen perlu koreksi** | Sesuai §2.2.4(6) dan §2.2.5. Batas atas nyata = **10** (hand 5 + pantulan 1 + hard 3 + Oleh-oleh 1), cards.md §1 dan ui-flow §6 masih menulis 9. Layar Buang 10 kartu di 390×844 bisa dipakai (alur nyata lewat minigame): kartu 62×83 px dalam 2 baris, semua di dalam viewport, tidak tumpang tindih, Buang di y 500–548 dari 844, Pause tetap bisa di-hit, 5 kartu ditandai dengan tap lalu Buang berhasil; label BARU di 4 kartu (kartu hasil pantulan tidak berlabel BARU) |
| 3 | Gunung Meletus membuat instance baru untuk tiap target tambahan | **Diterima, tolong dituliskan** | Spec diam. Alasan teknis kuat: uid `pending` harus unik. Kartu "tercipta" (`nextCardUid` naik target−1); invarian zona tetap benar karena dihitung dari `nextCardUid`. Oracle fuzz memastikan jumlah instance baru = target − 1. Saran satu kalimat di §2.2.2 / §4 |
| 4 | Kartu yang terbakar masuk `discarded` milik pengirim | **Diterima** | Dipakai konsisten untuk tangkalan Payung, pantulan terbakar, Copet yang sudah dipakai, dan salinan Gunung tambahan. Tidak ada zona lain yang lebih masuk akal; invarian zona aman. Perlu dituliskan di §2.2.2 langkah 4 |
| 5 | Kata alasan saat semua lawan tidak valid | **Diterima, spec ambigu** | Implementasi: satu alasan seragam → "Semua lawan penuh / sudah kena kartu ini / hand kosong"; tak ada lawan → "Tidak ada lawan"; campuran → "Tidak ada lawan yang bisa dikenai". Cocok dengan tabel §2.2.1, dan dites di UI untuk "penuh" dan "hand kosong". Kalimat spec "(alasan terakhir yang gagal pada lawan peringkat 1; bila beragam, ...)" bisa dibaca dua cara; mohon PM menyederhanakannya menjadi aturan yang dipakai kode |
| 6 | Dua tes CP4a ditulis ulang | **Benar, tidak dilemahkan** | Dites ulang di kode lama: `git archive 0b5344e` + tes `cp4a-qa.test.ts` yang baru → **3 tes gagal di kode lama** (QA-CP4a-01 tick besar, QA-CP4a-02 zona offer, replay `actionLog`) dan lulus di `4125e5d`. "Huge tick": tes lama memuat perilaku lama ("layar buang mendapat 15 s baru") yang dibalik oleh §3.4 v0.4; versi baru memeriksa `expiresAtMs` persis 30.000 dan hasil tick 60 s sama dengan dua tahap. Helper `conquer`: sebelumnya menyelesaikan layar dan mengosongkan hand **semua** pemain, itu menutup penawaran p1 yang justru jadi objek tes; kini hanya pemain yang menaklukkan. Assertion tidak berubah |

## Bug dan temuan

Severity: low semua. Tidak ada blocker, high, atau medium.

### QA-CP4b-01 (low): tap di luar picker tidak melakukan apa pun
- **Steps:** buka Detail kartu sabotase → Pakai (picker terbuka) → tap area di luar kartu picker.
- **Expected (ui-flow §7 butir 3):** kembali ke Detail, kartu tetap di hand.
- **Actual:** tidak terjadi apa-apa; hanya tombol Batal yang menutup. Tes: `cp4b-qa.spec.ts` "QA-CP4b-01" (`test.fail`).
- **Severity:** low (Batal berfungsi; kebiasaan mobile).

### QA-CP4b-02 (low): Esc di picker menutup picker dan Detail sekaligus
- **Expected (ui-flow §7 butir 4):** Esc = kembali ke Detail.
- **Actual:** `closeCardPopovers()` menutup rantai penuh (picker, konfirmasi, Detail). Tombol Batal sudah benar (kembali ke Detail). Tes: "QA-CP4b-02" (`test.fail`, desktop).
- **Severity:** low.

### QA-CP4b-03 (low, aksesibilitas): tidak ada fokus awal di picker
- **Expected (ui-flow §7 butir 2):** fokus awal pada lawan valid pertama (teratas), supaya Tab/Enter/gamepad langsung bekerja.
- **Actual:** `document.activeElement` bukan baris picker. Tes: "QA-CP4b-03" (`test.fail`, desktop). Catatan: DOM di-patch tiap frame, jadi perbaikannya harus menjaga fokus saat HTML diganti.
- **Severity:** low.

### QA-CP4b-04 (medium-dugaan, mobile): baris picker dibangun ulang tiap ada bot berubah state, tap yang kebetulan bersamaan bisa hilang
- **Steps:** buka picker dengan 3 bot yang berjalan. Beri tanda pada node `picker-row-bot1`, tunggu sampai satu bot berubah state (mulai main, pindah target, selesai). Tes: `cp4b-qa.spec.ts` "QA-CP4b-04" (`test.fail`).
- **Expected:** node baris tetap sama (hanya teks/atribut yang diperbarui), supaya sentuhan yang sedang berlangsung tetap menghasilkan `click`.
- **Actual:** `CardsUi.patch()` mengganti `innerHTML` seluruh picker bila string HTML berubah (isi baris memuat status, "N win lagi", jumlah kartu, slot). Terukur dengan `MutationObserver`: **15 pembangunan ulang dalam 40,9 detik game** (satu per 2,7 detik) dengan 3 bot. Sentuhan jari ≈ 100–150 ms, jadi perkiraan kasar 4–5% tap di picker bertepatan dengan pembangunan ulang. Pada sentuhan seperti itu `pointerdown` jatuh ke node lama yang sudah dibuang dan browser tidak mengirim `click`. Itu belum dibuktikan sebagai tap hilang nyata (Playwright mengirim tap dalam satu langkah); **butuh konfirmasi di HP**. Bukti tidak langsung: tes Engineer picker mobile gagal 1 kali dengan "no bounding box" karena baris diganti di tengah pengukuran.
- **Severity:** medium bila terkonfirmasi (tap hilang diam-diam, tanpa umpan balik, di layar yang dipakai tiap sabotase), low bila tidak. Tidak merusak state.
- **Saran (Engineer):** perbarui picker per baris (ubah `textContent`/atribut node yang ada), atau tahan pembangunan ulang selama ada sentuhan aktif (`pointerdown` tanpa `pointerup`); sama untuk tombol Pakai di Detail. Tombol hand ada di rantai yang sama (diperbarui bila playability berubah).

### QA-CP4b-05 (low, test hygiene, sudah ada sebelum CP4b): tes dodge terlalu dekat dengan timeout
- **Steps:** `npx vitest run --exclude tests/cp4b-qa.test.ts` di mesin 4 core yang dipakai bersama.
- **Actual:** "lanes: every row has 1 or 2 blocked lanes... (500 seeds)" 2,2 s sendirian, 5,1–5,5 s saat paralel; gagal 3 dari 4 run di baseline. Dengan file QA-ku suite juga ikut kena bila mesin sibuk, lulus bila sepi.
- **Saran (Engineer):** beri timeout eksplisit (mis. 20.000 ms) atau kecilkan jumlah seed. Tes e2e `cp3b` simon mobile juga sensitif beban (timeout 90 s, 2 dari 2 run penuh yang sibuk).

### Catatan dokumen (bukan bug)
1. Hand maks sebelum buang = 10 (§1, ui-flow §6).
2. Butir 16: slot 5 ±7 poin pada tier gap ≥ 3 (lihat tabel).
3. §2.2.1 kalimat alasan "lawan peringkat 1".
4. Gunung: salinan instance baru; kartu terbakar masuk `discarded` pengirim.
5. ui-flow §4 dan §7 butir 5: drag kartu ke baris progres (opsional di spec) belum dibangun; tombol angka 1–5 memilih kartu (§4) juga tidak ada. Bukan bagian kriteria §8.
6. `autoCards` dan `debug*` diterima reducer dari siapa pun. PM sudah mencatat `debug*`; `autoCards` juga perlu ditolak dari klien di server nanti (pemain bisa memaksa auto-pick lebih awal dari 15 s).
7. Aksi manusia di UI diantre dan diproses satu per langkah logic (20 Hz). Saat jam game dibekukan penuh (`setTimeScale(0)`), klik di UI tidak berlaku sampai jam jalan lagi. Ini perilaku sengaja (sama saat Pause) dan relevan untuk penulis tes.

## Mutation check
Enam mutan disuntikkan ke salinan `src/` di folder scratch (bukan di repo) dan dijalankan terhadap tes QA: (1) Cermin pengirim ikut habis, (2) cap slot 3, (3) kartu snapshot tidak menahan slot, (4) timer layar Buang di-reset saat dicuri, (5) validitas target membaca Payung lawan, (6) pantulan Copet memakai stream pengirim. Semua tertangkap (mutan 4 oleh tes Engineer karena sisi korban; tes QA mencakup sisi pemilik Cermin).

## Yang masih butuh HP asli / perangkat nyata
- Rasa tap pada picker dan Buang 10 kartu (kartu 62×83 px sudah ≥ 48 px, tapi akurasi jempol belum diukur), 2 baris kartu dengan jari besar.
- **Teks:** mesin tes tidak punya font, jadi pemotongan/pembungkusan teks nama kartu, label "Sudah kena kartu ini", dan toast tidak terverifikasi. Cek di HP: label panjang di baris picker, 3 toast bertumpuk, judul Buang.
- Safe area (notch, home indicator) untuk picker, Buang, dan toast; kontras toast merah/hijau.
- Animasi kartu terbang (0,4/0,5 s), kedip slot, getar sabotase masuk: tidak ada di build, tidak bisa dites.
- Performa layar Buang 10 kartu di HP menengah (DOM di-patch tiap frame), dan fps saat 3 toast + picker.
- Pause saat pindah aplikasi (auto-pause `visibilitychange`) dengan picker terbuka.
- Rasa permainan (playtest): bot belum memakai kartu sampai CP5, jadi pengalaman **disabotase** hanya bisa dicoba lewat hook debug. Yang bisa dinilai sekarang: kapan tombol Copet/Gunung terasa menyenangkan melawan bot, keterbacaan alasan redup, dan apakah tier comeback terasa (rare+ 76% di pemimpin vs 100% di gap ≥ 3).

## File
- Tes logic: `tests/cp4b-qa.test.ts`
- Tes e2e: `tests/e2e/cp4b-qa.spec.ts`
- Laporan ini: `docs/qa/cp4b-report.md`
