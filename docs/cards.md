# Kartu — Spesifikasi MVP

**Status:** designed · **Updated:** 2026-11-17 (v0.5, CP5a: koreksi hand maks 10, Gunung per target, kartu terbakar ke `discarded` pengirim, alasan redup §2.2.1 sesuai build, toleransi §8 #16, `autoCards` ditolak server; strategi bot pindah ke [bots.md](bots.md). v0.4, CP4b: DR-24, DR-27, DR-28, DR-29, DR-32, DR-33, DR-35 (bagian bot), DR-47; target picker, cap 2, urutan Cermin/Payung, Copet, bobot comeback, kriteria QA di §8) · Kembali ke [GDD](gdd.md) · Requirement: R3 (+ pengecualian Copet), R8, R9, K1, K1.1, K2, K3, Q2, Q4

20 kartu (K3): 11 boost, 9 sabotase. Kartu adalah **data**; satu interpreter efek menjalankan daftar `ops` (lihat §4). Tabel §2 adalah sumber kebenaran angka; `cards.json` di kode dibuat dari tabel ini.

**Pembagian rilis CP4:**
- **CP4a:** semua 20 kartu didefinisikan sebagai data + interpreter efek, penawaran pilih-N-dari-5, hand maks 5 + layar buang, timer 15 s, dan **hanya kartu boost (self) yang aktif**. Penawaran hanya berisi boost (§3.2).
- **CP4b (spesifikasi di dokumen ini):** sabotase, target picker, batas 2, Copet, Payung/Cermin (fase `b` masuk pool penawaran), bobot comeback, bot ikut menerima penawaran. Resolusi: §2.2, §2.3, §3.2. Kriteria QA: §8.

## 1. Aturan dasar

| Aturan | Nilai |
|---|---|
| Hand maksimal (R9) | 5 kartu. Duplikat kartu yang sama boleh |
| Dapat kartu (K1) | Menang minigame → ditawari 5 kartu acak, pilih N: easy 1 / medium 2 / hard 3 (difficulty **efektif**, D-002 di [GDD](gdd.md#decisions)). Rumus N lengkap di §3.3 |
| Batas waktu layar kartu (Q4) | Layar pilih dan layar buang masing-masing 15 s, lalu auto-pick (aturan pasti di §3.4) |
| Hand > 5 (K1.1) | Layar buang: pilih kartu yang dibuang sampai sisa 5 (boleh membuang kartu yang baru diambil). Tidak bisa ditutup sebelum ≤ 5. Hand maks yang bisa tampil di layar Buang = **10**: hand 5 + N maks 4 (hard 3 + Oleh-oleh 1) = 9, ditambah 1 kartu hasil pantulan Copet yang masuk saat pemain sedang main minigame (§2.2.4 butir 6, layar Buang ditunda). Layar Buang 10 kartu terverifikasi QA bisa dipakai di 390×844 (2 baris) |
| Kapan boleh main kartu | Kapan saja selama pemain berada di race view: sebelum menekan Mulai, saat cooldown, saat animasi jalan (pengecualian: Tiket Pesawat, lihat barisnya). **Tidak** saat minigame sendiri berjalan, intro, atau layar kartu/buang |
| Kartu instan | Efek langsung (Kopi Tubruk, Tiket Pesawat, Copet) |
| Kartu "minigame berikutnya" | Disimpan sebagai *pending* di pemain target. **Snapshot per percobaan (DR-48):** saat pemain menekan **Mulai**, semua pending `next_minigame` miliknya diterapkan ke percobaan itu. Setelah percobaan selesai (menang atau gagal) kartu itu **habis**, dengan atau tanpa efek bersyarat (§1.1). Kartu yang dimainkan saat cooldown ikut ke percobaan ulang (snapshot baru). Bila target sedang main, efek menunggu minigame setelahnya (R3) |
| Target sabotase (K2) | Pemain memilih 1 lawan lewat target picker ([ui-flow.md §7](ui-flow.md#7-target-picker-sabotase)). Siapa yang valid: §2.2.1. Kartu `all_opponents` tanpa picker. Tidak bisa menyabotase diri sendiri |
| Batas sabotase per target (Q2) | Maks **2 kartu sabotase** di zona `pending` milik satu target, dari semua pengirim (termasuk pantulan). Slot terisi sejak kartu masuk `pending` sampai kartu habis; kartu yang sedang dipakai percobaan berjalan (snapshot) tetap menahan slot sampai hasil percobaan. Target penuh = **tidak valid**: kartu **tidak bisa dimainkan** ke dia dan **tidak hangus**. Copet instan, tidak memakai slot, tetap valid ke target "penuh". Pengecualian hangus: pantulan (§2.2.3) |
| Batas per kartu | Kolom `maxStacks` = berapa salinan kartu yang sama boleh pending di satu pemain. Lewat batas = untuk boost: kartu tidak bisa dimainkan (tetap di hand); untuk sabotase: target itu tidak valid (§2.2.1) |
| Kartu pertahanan | Maks 1 kartu pertahanan aktif per pemain (Payung Tameng atau Cermin Balik; DR-40). Bila sudah ada, kartu pertahanan lain redup: "Sudah ada kartu pertahanan aktif" (tidak hangus) |
| Netting | Modifier sumbu yang sama saling jumlah (Jam Pasir +5 dan Jam Rusak −5 = 0). Difficulty di-clamp easy..hard; durasi di-clamp 10–40 s. Urutan penggabungan: §2.3 |
| Info tersembunyi (DR-33) | Hand lawan: hanya jumlah kartu terlihat. Pending **sabotase**: semua pemain melihat **jumlah slot terisi** (0/1/2) tiap pemain; **nama kartu** hanya terlihat oleh target dan pengirim. Pending boost dan kartu pertahanan aktif hanya terlihat pemiliknya. Satu pengecualian sengaja: picker menandai "Sudah kena kartu ini" bila target punya salinan kartu itu pending dari pengirim mana pun (§2.2.1); ini membocorkan 1 fakta kecil demi kartu tidak terbuang |

### 1.1 Durasi dan syarat (DR-23, satu-satunya definisi)
Hanya ada tiga durasi: `instant`, `next_minigame`, `next_sabotage`. Kartu bersyarat memakai kolom **Syarat** (`onFail` / `onWin`), bukan durasi sendiri:

- `next_minigame` **tanpa** syarat: efek berlaku selama percobaan berikutnya; habis saat percobaan selesai.
- `next_minigame` **+ `onFail`** (Nyawa Cadangan, Macet Total): efek hanya terjadi bila percobaan berikutnya **gagal**. Bila menang, kartu tetap **habis tanpa efek**.
- `next_minigame` **+ `onWin`** (Oleh-oleh, Ojek Kilat, Pelit Hadiah): efek hanya terjadi bila percobaan berikutnya **menang**. Bila gagal, kartu tetap **habis tanpa efek**.
- `next_sabotage`: defensif, aktif sampai menangkal atau memantulkan 1 sabotase (tidak terkait percobaan; tetap aktif sampai akhir match bila tak pernah kena). Tidak memakai slot sabotase (Q2). CP4b.
- "Percobaan berikutnya" = percobaan yang dimulai (Mulai ditekan) **setelah** kartu dimainkan. Kartu tidak pernah menjangkau mundur ke percobaan yang baru saja gagal (mis. Nyawa Cadangan yang dimainkan saat cooldown berlaku untuk percobaan ulang, bukan yang baru gagal).
- Kartu bersyarat yang habis tanpa efek tetap menghabiskan satu percobaan: ini harga kartu. Slot sabotase (Q2) dilepas saat kartu habis.

## 2. Daftar kartu

Kolom: **Base** = termasuk 8 kartu base (5 boost, 3 sabotase; K3). **Target**: `self`, `opponent` (pilih 1), `all_opponents`. **Durasi**: lihat §1.1. **Fase**: `a` = muncul di penawaran CP4a, `b` = mulai CP4b.

### Boost (11)

| id | Nama | Rarity | Base | Target | Durasi | Syarat | Fase | Efek | maxStacks |
|---|---|---|---|---|---|---|---|---|---|
| `jam_pasir` | Jam Pasir | common | ✓ | self | next_minigame | — | a | Waktu +5 s. Di Hindari Rintangan durasi tetap, tempo −15% (lihat §5) | 2 |
| `santai_dulu` | Santai Dulu | rare | ✓ | self | next_minigame | — | a | Difficulty −1 tingkat (hard→medium, medium→easy). Reward kartu & cooldown ikut difficulty efektif. Sudah easy = tanpa efek, kartu habis (DR-30, §2.1) | 1 |
| `nyawa_cadangan` | Nyawa Cadangan | common | ✓ | self | next_minigame | onFail | a | Bila kamu **gagal** di minigame berikutnya: tanpa cooldown; tombol Mulai langsung aktif (ulang tetap butuh tekan Mulai, DR-05; percobaan ulang mengambil snapshot pending baru, DR-48). Bila menang: kartu habis tanpa efek | 1 |
| `teropong` | Teropong | common | ✓ | self | next_minigame | — | a | Aktifkan `hint` (bantuan khusus tiap minigame, lihat [minigames.md](minigames.md) dan §5) | 1 |
| `payung_tameng` | Payung Tameng | rare | ✓ | self | next_sabotage | — | b | Menangkal 1 sabotase berikutnya yang mengarah ke kamu, termasuk Copet (kartu sabotase hangus, Payung habis; §2.2.3) | 1 (defensif: maks 1 kartu defensif aktif; redup bila Cermin aktif) |
| `zona_lebar` | Zona Lebar | common | | self | next_minigame | — | a | `tolerance` ×1,3 (zona/hitbox/jeda idle lebih longgar; arti per minigame di §5) | 1 |
| `kopi_tubruk` | Kopi Tubruk | common | | self | instant | — | a | Hapus sisa cooldown sekarang. Hanya bisa dimainkan saat cooldown | — |
| `oleh_oleh` | Oleh-oleh | common | | self | next_minigame | onWin | a | Bila kamu **menang** di minigame berikutnya: pilih +1 kartu (maks 5 dari 5). Bila gagal: habis tanpa efek. Di region FINAL tidak ada penawaran (C-3), jadi tanpa efek (peringatan di detail, §2.1) | 1 |
| `ojek_kilat` | Ojek Kilat | rare | | self | next_minigame | onWin | a | Bila kamu **menang** di minigame berikutnya, dihitung 2 win (1 penawaran kartu saja, N sesuai difficulty). Bila gagal: habis tanpa efek | 1 |
| `cermin_balik` | Cermin Balik | epic | | self | next_sabotage | — | b | Memantulkan 1 sabotase berikutnya ke pengirimnya. Pantulan tidak bisa dipantulkan atau ditangkal lagi, kena batas Q2 dan `maxStacks` pengirim; bila pengirim penuh → hangus (§2.2.3) | 1 (defensif: maks 1 kartu defensif aktif; redup bila Payung aktif) |
| `tiket_pesawat` | Tiket Pesawat | epic | | self | instant | — | a | Langsung masuk ke region target yang sedang dipilih tanpa main minigame (pengecualian "no skipping" R6.1). Tidak dapat kartu. Aturan main: §2.1. **Tidak bisa** dipakai bila target punya edge ke finish (region FINAL), karena finish tanpa minigame (D-004) membuatnya jadi menang instan (D-009/C-2) | — |

### Sabotase (9) — aktif mulai CP4b (semua fase `b`)

| id | Nama | Rarity | Base | Target | Durasi | Syarat | Efek | maxStacks |
|---|---|---|---|---|---|---|---|---|
| `jam_rusak` | Jam Rusak | common | ✓ | opponent | next_minigame | — | Waktu −5 s. Di Hindari Rintangan durasi tetap, tempo `M` ×1,15 (kecepatan ×1,15 dan jeda antar baris ÷1,15, [minigames.md §4](minigames.md#4-hindari-rintangan-dodge_runner--3d)) | 2 |
| `badai` | Badai | rare | ✓ | opponent | next_minigame | — | Difficulty +1 tingkat | 1 |
| `kabut_asap` | Kabut Asap | common | ✓ | opponent | next_minigame | — | Aktifkan `fog` | 1 |
| `macet_total` | Macet Total | common | | opponent | next_minigame | onFail | Bila target **gagal** di percobaan berikutnya: cooldown +6 s. Bila menang: habis tanpa efek dan slot dilepas | 1 |
| `pelit_hadiah` | Pelit Hadiah | common | | opponent | next_minigame | onWin | Bila target **menang** di percobaan berikutnya: pilih −1 kartu (min 1). Bila gagal: habis tanpa efek | 1 |
| `ngebut` | Ngebut | rare | | opponent | next_minigame | — | `speed` ×1,25: semua tempo lebih sibuk, tidak pernah lebih sepi (kecepatan ×1,25, interval/jeda ÷1,25; Hindari Rintangan lewat `M` ×1,25; [minigames.md §1.5](minigames.md#15-pemetaan-modifier-umum)) | 1 |
| `tambah_beban` | Tambah Beban | rare | | opponent | next_minigame | — | `extraTarget` +1 (syarat lulus naik) | 1 |
| `copet` | Copet | rare | | opponent | instant | — | Curi 1 kartu **acak** dari hand target ke hand kamu (pengecualian R3, D-005). Aturan lengkap di bawah | — |
| `gunung_meletus` | Gunung Meletus | epic | | all_opponents | next_minigame | — | Difficulty +1 tingkat ke semua lawan (tiap lawan dicek tameng/cermin & batas sabotasenya sendiri) | 1 |

Rekap rarity (20 kartu): common 10, rare 7, epic 3. Rekap boost fase `a` (9 kartu, tanpa Payung dan Cermin): common 6, rare 2, epic 1.

**Kenapa Sinyal Hilang yang diganti (v0.2):** paling situasional, paling rumit diterangkan dalam 1 kalimat, dan satu-satunya kartu yang butuh urutan resolusi khusus. Rarity-nya (rare) diwarisi Copet.

### 2.1 Aturan main per kartu boost (CP4a)
- **Santai Dulu / Badai di batas (DR-30):** kartu tetap boleh dimainkan (pemain bisa mengganti target). Saat target sudah terpilih dan difficulty-nya sudah di batas, detail kartu menampilkan peringatan "Tidak berefek di region easy". Efek di-clamp saat Mulai; kartu habis walau tanpa efek.
- **Oleh-oleh di region FINAL:** detail kartu menampilkan peringatan "Region FINAL tidak memberi kartu". Kartu tetap boleh dimainkan dan habis.
- **Tiket Pesawat (DR-31):** `playableWhen: 'hasTarget'`: boleh hanya bila (1) sebuah target sudah terpilih dan (2) target itu bukan region FINAL. Boleh saat cooldown (sisa cooldown dihapus), boleh saat ada win parsial (win parsial hangus karena pion pindah), **tidak** saat animasi jalan (pemain belum punya target). Kartu redup dengan alasan: "Pilih region tujuan dulu" / "Tidak bisa ke region FINAL". Pending boost lain tetap ada. Setelah pion pindah: `targetId` kosong, minigame baru diundi saat target berikutnya dipilih.
- **Kopi Tubruk:** `playableWhen: 'cooldown'`; redup di luar cooldown dengan alasan "Hanya saat cooldown". Tidak bersangkut paut dengan Nyawa Cadangan (bila Nyawa aktif, gagal tidak menghasilkan cooldown).
- **Ojek Kilat:** `winsAtTarget += 2`, di-clamp ke `winsRequired`. Di region FINAL berarti 1 win sudah menang (kartu rare yang sengaja kuat; dipantau di playtest).

### 2.2 Resolusi sabotase (CP4b)

#### 2.2.1 Target valid (K2, Q2; satu-satunya definisi)
Lawan `T` valid untuk kartu sabotase `C` bila **semua** ini benar (dihitung dari state saat itu; tidak pernah memakai info tersembunyi seperti Payung/Cermin lawan):

| # | Syarat | Label bila gagal (prioritas label: baris teratas yang gagal) |
|---|---|---|
| 1 | `T` bukan pemain yang memainkan kartu, dan match belum berakhir | — (tidak ditampilkan) |
| 2 | Hanya Copet: hand `T` ≥ 1 kartu | "Hand kosong" |
| 3 | Bukan Copet: slot sabotase `T` < 2 (Q2) | "Penuh" |
| 4 | Bukan Copet: jumlah salinan `C.id` di `pending` `T` < `C.maxStacks` | "Sudah kena kartu ini" |

- **Kartu bisa dimainkan** (tidak redup) bila ≥ 1 lawan valid. Bila tidak ada: kartu redup 50%, tetap di hand, dengan alasan di detail (aturan seperti dibangun): bila **semua** lawan gagal karena alasan yang **sama** → "Semua lawan penuh" / "Semua lawan sudah kena kartu ini" / "Semua lawan hand kosong" (Copet); bila tidak ada lawan sama sekali → "Tidak ada lawan"; bila alasannya **campuran** → "Tidak ada lawan yang bisa dikenai".
- **Tanpa target valid = tidak bisa dimainkan, bukan hangus.** Kartu tidak pernah terbuang karena tidak ada sasaran.
- **Gunung Meletus** (`all_opponents`): bisa dimainkan bila ≥ 1 lawan valid (syarat 1, 3, 4 per lawan, DR-29). Lawan tidak valid dilewati (tidak kena, tidak menghabiskan Payung/Cermin mereka). Konfirmasi menyebut dampaknya: "Kena 2 dari 3 lawan (Bot 3 penuh)".
- **Kapan syarat dicek:** (a) saat menentukan redup/tidak, (b) saat picker terbuka (baris redup/tidak), (c) **sekali lagi saat konfirmasi di logic**. Bila (c) gagal (mis. target baru penuh sejak picker dibuka): tidak ada yang berubah, kartu tetap di hand, picker menampilkan toast "Bot 2: Penuh" dan baris itu redup.
- **Satu lawan di match:** picker dilewati; **Pakai** langsung berlaku ke lawan itu bila valid ([ui-flow.md §7](ui-flow.md#7-target-picker-sabotase)).

#### 2.2.2 Langkah memainkan kartu sabotase (atomik, satu langkah logic)
1. Validasi (kartu ada di hand pemain, target valid per §2.2.1, bukan layar kartu/minigame). Gagal → tidak ada perubahan.
2. Kartu pindah `hand → limbo`.
3. Untuk tiap target, berurutan menurut **urutan seat naik** (hanya relevan untuk Gunung):
   a. Target punya `cermin_balik` aktif → **pantul** (§2.2.3), Cermin habis.
   b. Selain itu, target punya `payung_tameng` aktif → **tangkal**: kartu sabotase hangus, Payung habis.
   c. Selain itu → kartu masuk `pending` target (Copet: dieksekusi langsung, §2.2.4).
4. Kartu yang sudah tidak punya tujuan (ditangkal/hangus/Copet selesai) → `discarded` **milik pengirim** kartu (juga untuk salinan Gunung tambahan yang ditangkal dan pantulan yang terbakar). Tidak ada zona lain.

**Gunung Meletus (instance per target):** instance asli dari hand dipakai untuk target pertama (urutan seat); untuk **tiap target tambahan** logic membuat **instance baru** (`uid` baru, `defId` sama, `source` = pengirim) supaya `uid` di `pending` tetap unik dan tiap instance berada di tepat satu zona. Jumlah instance baru = jumlah target − 1; ini bukan pelanggaran invarian zona.
Cermin dicek sebelum Payung hanya demi urutan pasti; karena maks 1 kartu pertahanan aktif (DR-40), keduanya tidak pernah aktif bersamaan pada satu pemain.

#### 2.2.3 Pantulan dan tangkalan (DR-28), tabel interaksi
| Situasi | Hasil |
|---|---|
| Target punya Payung | Kartu hangus, Payung habis. Tidak ada efek, tidak ada slot terpakai |
| Target punya Cermin | Cermin habis. Kartu mendarat di **pengirim** sebagai pending (sumber = pemilik Cermin) |
| **Cermin vs Cermin** (pengirim juga punya Cermin) | Pantulan **tidak** dipantulkan lagi; Cermin pengirim **tidak habis** dan tidak dicek |
| Pengirim punya Payung | Pantulan **tidak** ditangkal; Payung pengirim tidak habis |
| Pengirim penuh (Q2) atau `maxStacks` tercapai | Pantulan hangus (toast "Dipantulkan, tapi tertangkal"). Cermin tetap habis |
| Payung vs Copet | Copet hangus, Payung habis, tidak ada kartu berpindah |
| Cermin vs Copet | Pemilik Cermin mencuri dari hand pengirim (§2.2.4 butir 5) |
| Gunung dipantulkan oleh >1 lawan | Tiap lawan diproses menurut urutan seat; salinan pertama mendarat di pengirim, sisanya hangus karena `maxStacks` 1 pengirim |
| Pantulan mendarat, lalu pengirim main kartu lain | Normal; pantulan adalah pending biasa |

#### 2.2.4 Copet: aturan lengkap (instan, pengecualian R3)
1. **Kapan:** di race view (aturan umum). Boleh mengincar target yang sedang main minigame atau punya layar kartu terbuka; minigame target tidak terganggu.
2. **Kartu yang dicuri:** 1 kartu dari **hand** target, **seragam acak**: urutkan hand target menurut `handSeq` naik, lalu `rng.int(jumlah)` dari stream `copet` milik **pencuri** (pada pantulan: stream `copet` milik **pemilik Cermin**, DR-47). Tipe/rarity tidak berbobot. Tidak menyentuh `pending`, `offer`, `limbo`, `discarded`, dan kartu pencuri sendiri. Instance yang dicuri berpindah (id tetap, bukan salinan) dengan `handSeq` baru (terbaru di hand pencuri).
3. **Hand target kosong:** target tidak valid (§2.2.1 syarat 2). Dicek ulang saat konfirmasi.
4. **Hand pencuri penuh:** tidak mungkin meluap: Copet keluar dari hand dulu (`limbo`), jadi hand pencuri ≤ 4 sebelum menerima 1 kartu.
5. **Pantulan:** pemilik Cermin mencuri 1 kartu dari hand **pengirim** (Copet sudah di `limbo`, jadi tidak ikut terpilih). Hand pengirim kosong → pantulan tanpa efek, Cermin tetap habis.
6. **Hand penerima jadi > 5** (hanya terjadi pada pantulan): penerima langsung masuk layar Buang (15 s) di race view; bila sedang minigame: setelah minigame selesai (digabung dengan layar kartu bila menang, jumlah dihitung ulang saat itu). Bot (tanpa layar) memakai auto-buang §3.4 seketika.
7. **Info:** pencuri dan target melihat nama kartu yang pindah (toast + kartu terbang). Pemain lain: "Bot 1 mencopet Bot 2".

#### 2.2.5 Copet saat target punya layar/popover terbuka (DR-27)
Semua perubahan hand terjadi atomik di logic; UI hanya bereaksi pada event `handChanged`.
| Layar target | Aturan |
|---|---|
| Detail Kartu atau Target Picker untuk kartu `X` yang dicuri | Popover/picker menutup, toast "Kartumu dicopet: X", tidak ada kartu terpakai. Popover untuk kartu lain tidak terganggu |
| Layar Penawaran (pilih N) | Kartu penawaran di zona `offer`, tidak bisa dicuri. Hand berubah saja; kebutuhan buang dihitung saat **Ambil** (hand + N), bukan saat layar dibuka |
| Layar Buang (hand 6–9) | Semua kartu di layar ada di `hand`, semuanya bisa dicuri. Jumlah wajib buang = `max(0, hand − 5)` dihitung ulang; tandai buang yang menunjuk kartu hilang dilepas; bila jumlah jadi 0 layar menutup otomatis dengan toast "Kamu dicopet, tidak perlu buang lagi". Bila kartu ditambah (pantulan), jumlah naik. **Timer 15 s tidak direset** |
| Sedang minigame | Hand berubah di belakang layar; diurus saat kembali ke race view |
| Layar Buang pemain yang memainkan Copet | Tidak terjadi: kartu tidak bisa dimainkan saat layar kartu terbuka |

### 2.3 Menggabungkan efek dalam satu percobaan

**Snapshot saat Mulai ditekan** (DR-48; sabotase dan boost digabung, urutan penggabungan tidak mengubah hasil karena semua operasi komutatif):
1. Ambil semua pending `next_minigame` milik pemain (urut menurut `pendingSeq` hanya untuk tampilan).
2. `difficultyShift` = jumlah semua delta (Badai +1, Gunung +1, Santai Dulu −1), baru di-clamp easy..hard. Hasilnya difficulty efektif.
3. Modifier lain digabung per jenis: `timeDelta` dijumlah lalu di-clamp sehingga durasi dasar + total ∈ 10–40 s; `speed`, `tolerance` dikalikan; `extraTarget` dijumlah; `fog`, `hint` = nyala bila ≥ 1 kartu. Pemetaan per minigame mengikuti [minigames.md](minigames.md).
4. Kirim ke minigame sebagai `MinigameContext` ([minigames.md](minigames.md#12-interface-typescript-dibangun-engineer)).
5. **Setelah hasil, urutan efek bersyarat:**
   - Menang: (a) `winMultiplier` (Ojek) → `winsAtTarget` (clamp `winsRequired`); (b) bila ada penawaran: N = `clamp(Nbase(difficulty efektif) + Σ rewardPickDelta, 1, min(5, |offer|))` (Oleh-oleh +1 dan Pelit Hadiah −1 saling hapus); (c) `onFail` dibuang tanpa efek.
   - Gagal: cooldown = cooldown dasar(difficulty efektif) + Σ `cooldownDelta` (Macet +6); **bila ada `noCooldown` (Nyawa Cadangan) di snapshot, cooldown = 0 dan Nyawa menang** (DR-24). Contoh: gagal di medium dengan Macet + Nyawa = 6 + 6 → 0; keduanya habis. `onWin` dibuang tanpa efek.
   - Semua kartu snapshot → `discarded`, slot sabotase dilepas.
6. Sabotase yang dimainkan **setelah** Mulai ditekan (target sedang intro/main) masuk `pending` biasa dan berlaku ke percobaan berikutnya (R3; termasuk percobaan ulang).
7. Pending sabotase tidak hilang karena Tiket Pesawat atau ganti target; hanya habis lewat percobaan, Payung/Cermin (sebelum masuk), atau akhir match.

Contoh (Tap Tepat Waktu, durasi dasar 20 s): pending Badai (+1), Jam Rusak (−5), Ngebut (×1,25), Tambah Beban (+1), Kabut, plus boost Jam Pasir (+5), Santai Dulu (−1), Zona Lebar (×1,3), Teropong. Hasil: difficulty +1−1 = 0 (tetap dasar), `timeDelta` −5+5 = 0 (20 s), `speed` ×1,25, `tolerance` ×1,3, `extraTarget` +1, `fog` nyala, `hint` nyala. Tes kembarnya: urutan kartu dimainkan diacak, hasil sama.

## 3. Penawaran kartu (R8, K1)

### 3.1 Algoritma (DR-26, satu-satunya definisi)
**Input:** `pool` (kartu yang boleh muncul: lihat §3.2), `W` = bobot rarity (§3.2), `rng` = stream `cards` pemain ([minigames.md §1.2.1](minigames.md#121-stream-rng-dr-04-satu-satunya-daftar)). Semua kartu di `pool` diurutkan tetap menurut urutan baris §2 (supaya seed sama → hasil sama). `sisa` = kartu di `pool` yang belum ada di penawaran.

**Langkah, berurutan, tanpa undi ulang:**
1. `offer = []`. Ulangi untuk slot 1..5:
   a. Bila `sisa` kosong: berhenti (penawaran lebih pendek dari 5).
   b. Rarity yang masih punya kartu di `sisa` = `R`. Bobotnya = `W[r]` untuk `r ∈ R` (rarity tanpa kartu sisa dibuang dari undian, bobot yang tersisa dinormalisasi). Tarik rarity: 1 tarikan `rng.float()`.
   c. Pilih kartu seragam dari `sisa` yang berrarity itu: 1 tarikan `rng.int(n)`.
   d. Tambahkan ke `offer`.
   *Dedupe dijamin oleh konstruksi (kartu yang sudah terambil keluar dari `sisa`), jadi tidak ada undi ulang dan langkah 1 selalu selesai dalam ≤ 10 tarikan.*
2. **Jaminan tipe** (hanya bila `pool` berisi **kedua** tipe; bila hanya satu tipe, langkah ini dilewati): bila `offer` tidak punya boost atau tidak punya sabotase (tipe `T` yang hilang): ganti **slot 5** dengan kartu bertipe `T` dari `sisa` (rarity ditarik seperti 1b, dibatasi pada kartu `T`). Semua 5 slot bertipe sama, jadi slot 5 selalu boleh diganti. Bila `sisa` tidak punya kartu `T`: lewati.
3. **Jaminan rare+** (hanya bila tier mensyaratkan, §3.2): bila `offer` tidak punya rare/epic: periksa slot 5 → 1; slot pertama yang bisa diganti oleh kartu rare/epic **bertipe sama** dari `sisa` diganti (rarity ditarik dari bobot `W` rare dan epic saja, dinormalisasi). Penggantian bertipe sama menjaga jaminan tipe. Bila tidak ada slot yang bisa: jaminan dilepas, `offer` tetap.
4. Kembalikan `offer` (urutan slot = urutan tampil kiri ke kanan).

Langkah 2 dan 3 masing-masing paling banyak satu penggantian, jadi seluruh algoritma terhingga. Tes wajib: `pool` hanya epic habis, `pool` < 5 kartu, seed sama → `offer` sama, tak ada `id` kembar.

### 3.2 Aturan CP4a (boost-only, sudah dibangun) dan tier comeback (CP4b)
**CP4a (digantikan oleh blok CP4b di bawah; dipertahankan sebagai riwayat dan acuan tes lama):**
- `pool` = kartu fase `a` = **9 boost** (tanpa Payung Tameng dan Cermin Balik, karena belum ada sabotase yang bisa ditangkal; keputusan PM opsi A, §6).
- **Bobot:** semua pemain memakai baris "Pemimpin / seri depan": common 75 / rare 22 / epic 3. Tidak ada perhitungan `gap`/tier; kode memanggil `tierWeights(player)` yang di CP4a selalu mengembalikan baris itu, supaya CP4b hanya mengganti fungsi itu.
- **Degradasi jaminan:** "≥ 1 boost dan ≥ 1 sabotase" otomatis berubah jadi "pool tanpa sabotase → langkah 2 dilewati"; semua penawaran boost semua. Jaminan "≥ 1 rare+" tidak aktif (baris base tanpa jaminan).
- Dengan 9 kartu (common 6, rare 2, epic 1) dan 5 slot, rarity yang habis keluar dari undian (langkah 1b) dan penawaran selalu 5 kartu berbeda. Perkiraan kasar ≈ 70–75% penawaran memuat ≥ 1 rare+ (hitungan 1 − 0,75⁵ dikoreksi habisnya stok; belum disimulasikan, cek di tes distribusi).
- Offer boleh mengandung kartu yang situasional (mis. Kopi Tubruk); itu bagian dari pilihan.

**CP4b (aktif):** `pool` = semua 20 kartu (fase `a` dan `b`; Payung Tameng dan Cermin Balik masuk). `tierWeights(player)` sekarang menghitung tier. Algoritma §3.1 tidak berubah.

**Mengukur "tertinggal" (R8):**
`gap(p) = remainingWins(p) − min(remainingWins(q) untuk semua pemain q, termasuk p dan bot)`.
- `remainingWins` rumus [GDD](gdd.md#aturan-menangkalah) (jarak rute ke finish dalam satuan win; tabel per node di [map-indonesia.md](map-indonesia.md#jarak-ke-finish-dan-remainingwins-dr-07)).
- Dihitung **sekali, pada tick win dicatat** (setelah `winsAtTarget` dan perpindahan pion dari win itu, sebelum layar kartu dibuka), memakai state semua pemain pada tick itu. Hasilnya dipakai untuk satu penawaran itu; tidak dihitung ulang saat layar terbuka. Tidak ada penawaran setelah win penentu (C-3), jadi `gap` tak perlu mengurus pemain yang sudah menang.
- Pemimpin = pemain dengan `remainingWins` terkecil; seri semuanya `gap` 0. `gap` tidak peduli rute yang dipilih, hanya jarak yang tersisa.

**Tabel bobot (angka tepat; dasar baris atas = baris CP4a yang sama):**

| Tier | gap (win) | common | rare | epic | Jaminan rare+ (§3.1 langkah 3) |
|---|---|---|---|---|---|
| Pemimpin / seri depan | 0 | 75 | 22 | 3 | tidak |
| Sedikit tertinggal | 1–2 | 65 | 28 | 7 | tidak |
| Tertinggal | 3–4 | 55 | 32 | 13 | ya |
| Jauh tertinggal | ≥ 5 | 45 | 35 | 20 | ya |

Contoh Indonesia (total 8 win; 1 region = 2 win): empat pemain di `remainingWins` 8, 8, 6, 4 → gap 4, 4, 2, 0 → tier Tertinggal, Tertinggal, Sedikit tertinggal, Pemimpin. Gap ≥ 5 berarti ≥ 2,5 region di belakang (hanya muncul bila pemain gagal berkali-kali atau lawan memakai Tiket Pesawat).

**Aturan tambahan:**
- Berlaku **sama untuk bot** (DR-32): `tierWeights(bot)` memakai `gap` bot itu.
- Bobot adalah bobot per rarity (bukan per kartu); rarity yang stoknya habis keluar dari undian lalu dinormalisasi (§3.1 langkah 1b).
- Jaminan tipe (≥ 1 boost dan ≥ 1 sabotase) aktif lagi karena pool berisi keduanya. Jaminan tidak memperhitungkan apakah sabotase bisa dimainkan saat ini.
- Titik awal untuk playtest; `gap` ≥ 5 dan ≥ 3 adalah tuas tuning pertama.

### 3.2.1 Bot di CP4b (DR-32)
**CP5:** strategi bot memilih N, membuang, dan memainkan kartu (juga pemilihan target) ada di [bots.md](bots.md) §6–§7; bagian di bawah tetap berlaku untuk aturan penerimaan dan efek ke peluang lulus.

Bot **belum memainkan kartu** (CP5) tetapi sudah memenuhi aturan penerimaan dan jadi sasaran:
- **Penawaran:** tiap win bot yang bukan win penentu menghasilkan penawaran dengan `tierWeights(bot)` dari stream `cards` bot. Pilih N dan buang **seketika** (tanpa layar dan timer) memakai aturan auto-pick dan auto-buang §3.4 (deterministik, tanpa RNG). Hand bot tetap ≤ 5. Strategi pilihan bot Easy/Normal/Hard (acak vs prioritas) adalah CP5.
- **Dikenai sabotase:** bot punya slot sabotase (Q2) dan pending seperti pemain. Saat bot memulai percobaan (snapshot), efek dihitung ke peluang lulus ([gdd.md Bot](gdd.md#bot-b1b3)): `difficultyShift` lewat difficulty efektif; modifier lain **per jenis setelah netting** ±8 poin persen (DR-35): `timeDelta` > 0, `tolerance`, `hint` = +8; `timeDelta` < 0, `speed`, `extraTarget`, `fog` = −8; clamp 5–98%. `Macet Total` (cooldown +6 saat gagal) dan `Pelit Hadiah` (N −1 saat menang) berlaku normal.
- **Copet ke bot:** valid bila hand bot ≥ 1 (hand bot terisi dari penawaran di atas). Bot tidak punya Payung/Cermin sebelum CP5.

### 3.3 Jumlah pilihan N
`N = clamp(Nbase(difficulty efektif) + Σ rewardPickDelta, 1, min(5, ukuran offer))`, dengan `Nbase` = 1/2/3 dan `rewardPickDelta` Oleh-oleh = +1, Pelit Hadiah = −1 (CP4b). Contoh: hard + Oleh-oleh = 4 dari 5. Tidak ada penawaran setelah win penentu kemenangan (C-3).

### 3.4 Layar pilih dan layar buang: timer 15 s (DR-25)
- **Auto-pick (layar pilih habis waktu):** kartu yang sudah ditandai tetap dipilih. Kekurangannya diisi dari kartu yang belum ditandai: rarity tertinggi dulu; seri → slot paling kiri dulu. Penawaran lalu diproses normal (ke layar buang bila hand > 5).
- **Auto-buang (layar buang habis waktu):** kartu yang sudah ditandai tetap dibuang. Kekurangannya diisi dari yang belum ditandai: rarity **terendah** dulu; seri → kartu yang **paling lama di hand** dulu; kartu baru dari penawaran ini dibuang paling akhir. "Paling lama di hand" = nomor urut masuk hand terkecil (`handSeq`, naik 1 tiap kartu masuk hand; kartu dari satu pick diberi nomor menurut urutan slot kiri ke kanan).
- **Pause (keputusan PM, QA-CP4a-03):** pause **boleh** di layar Penawaran, Buang, Detail Kartu, dan Target Picker. Tombol Pause tetap di atas modal (bisa ditekan dan di-hit-test). Pause membekukan semua timer game-time, termasuk timer 15 s (sisa waktu tersimpan, lanjut dari sisa itu), bot, dan cooldown. Picker tidak punya timer sendiri; yang beku hanya jam game. Konten kartu tetap tampil di bawah overlay Pause (mode solo).
- **Waktu kedaluwarsa eksak (QA-CP4a-01):** layar punya `expiresAtMs = openedAtMs + 15000` pada jam game. Timeout diproses **pada `expiresAtMs`**, bukan pada waktu tick yang menangkapnya, sehingga tick besar atau tick yang digabung tidak mengubah hasil. Layar berikutnya dalam rantai (Penawaran → Buang) memiliki `openedAtMs = expiresAtMs` layar sebelumnya bila sebelumnya habis waktu, atau waktu aksi pemain bila ia menekan Ambil. Replay `actionLog` harus menghasilkan state identik.
- Hasil auto-pick/auto-buang sama persis untuk state yang sama (tidak memakai RNG).
- **Akhir match:** kartu di layar penawaran yang terbuka dipindah `offer → discarded` (QA-CP4a-02), sehingga tiap instance tetap di tepat satu zona.
- **Aksi khusus server (keputusan PM, QA follow-up CP4b):** sebelum multiplayer, server **menolak dari klien** semua aksi `debug*` **dan** `autoCards` (klien bisa memaksa auto-pick lebih awal dari 15 s). Server sendiri yang mengeluarkan `autoCards` saat timeout. Di solo, bot dan timer lokal masih boleh memakainya.

## 4. Format data (untuk interpreter)

```ts
type CardType = 'boost' | 'sabotage';
type Rarity = 'common' | 'rare' | 'epic';
type CardTarget = 'self' | 'opponent' | 'all_opponents';
type CardDuration = 'instant' | 'next_minigame' | 'next_sabotage';   // next_fail/next_reward dihapus (DR-23)
type CardTrigger = 'onFail' | 'onWin';                                // hanya untuk next_minigame bersyarat
type CardPhase = 'a' | 'b';                                           // fase rilis CP4; pool CP4a = fase 'a'

type CardOp =
  | { op: 'modifier'; modifier: MinigameModifier }      // dari minigames.md
  | { op: 'difficultyShift'; delta: -1 | 1 }
  | { op: 'cooldownDelta'; seconds: number }            // onFail
  | { op: 'noCooldown' }                                 // onFail
  | { op: 'cooldownClear' }                              // instant
  | { op: 'rewardPickDelta'; delta: number }             // onWin
  | { op: 'winMultiplier'; mult: number }                // onWin
  | { op: 'skipRegion' }                                 // instant
  | { op: 'blockSabotage' } | { op: 'reflectSabotage' }  // next_sabotage
  | { op: 'stealRandomCard'; count: 1 };                 // instant (Copet)

interface CardDef {
  id: string; nameKey: string; descKey: string; icon: string;
  type: CardType; rarity: Rarity; base: boolean; phase: CardPhase;
  target: CardTarget; duration: CardDuration; trigger?: CardTrigger; maxStacks: number | null;
  playableWhen?: 'always' | 'cooldown' | 'hasTarget';   // 'atRegionSelect' diganti 'hasTarget' (DR-31)
  usesSabotageSlot?: boolean;   // default true untuk sabotase non-instan; false untuk Copet
  ops: CardOp[];
}
```

Contoh:

```json
[
  { "id": "jam_pasir", "type": "boost", "rarity": "common", "base": true, "phase": "a",
    "target": "self", "duration": "next_minigame", "maxStacks": 2,
    "ops": [{ "op": "modifier", "modifier": { "kind": "timeDelta", "seconds": 5 } }] },
  { "id": "nyawa_cadangan", "type": "boost", "rarity": "common", "base": true, "phase": "a",
    "target": "self", "duration": "next_minigame", "trigger": "onFail", "maxStacks": 1,
    "ops": [{ "op": "noCooldown" }] },
  { "id": "ojek_kilat", "type": "boost", "rarity": "rare", "base": false, "phase": "a",
    "target": "self", "duration": "next_minigame", "trigger": "onWin", "maxStacks": 1,
    "ops": [{ "op": "winMultiplier", "mult": 2 }] },
  { "id": "kopi_tubruk", "type": "boost", "rarity": "common", "base": false, "phase": "a",
    "target": "self", "duration": "instant", "maxStacks": null, "playableWhen": "cooldown",
    "ops": [{ "op": "cooldownClear" }] },
  { "id": "tiket_pesawat", "type": "boost", "rarity": "epic", "base": false, "phase": "a",
    "target": "self", "duration": "instant", "maxStacks": null, "playableWhen": "hasTarget",
    "ops": [{ "op": "skipRegion" }] },
  { "id": "gunung_meletus", "type": "sabotage", "rarity": "epic", "base": false, "phase": "b",
    "target": "all_opponents", "duration": "next_minigame", "maxStacks": 1,
    "ops": [{ "op": "difficultyShift", "delta": 1 }] },
  { "id": "copet", "type": "sabotage", "rarity": "rare", "base": false, "phase": "b",
    "target": "opponent", "duration": "instant", "maxStacks": null, "usesSabotageSlot": false,
    "ops": [{ "op": "stealRandomCard", "count": 1 }] }
]
```

Nama dan deskripsi lewat string key (`card.jam_pasir.name`) supaya bisa dilokalkan; peta lain boleh me-reskin nama/ikon kartu lewat `map.cardSkins` (opsional, lihat [map-indonesia.md](map-indonesia.md#6-format-data-peta-map-agnostic)).

**Invarian yang perlu dites:** tiap instance kartu punya id unik dan ada di tepat satu zona (`offer`, `hand`, `limbo`, `pending`, `discarded`; kartu snapshot tetap di `pending` sampai percobaan selesai, lalu `discarded`); hand ≤ 5 setiap kali layar buang ditutup; seed sama → penawaran sama; penawaran tak punya id kembar dan berukuran min(5, |pool|); kartu bersyarat selalu habis setelah 1 percobaan; Copet memindahkan instance tanpa menduplikasi (CP4b); Gunung Meletus membuat tepat (target − 1) instance baru (§2.2.2).

## 5. Pemetaan boost ke minigame yang sudah dibangun (CP4a)

Tiga minigame di registry: Tap Tepat Waktu (TT), Simon (SM), Hindari Rintangan (HR). Sumber arti modifier: [minigames.md](minigames.md) §2–§4. Semua kartu boost fase `a` terpetakan; tidak ada celah.

| Kartu | Lewat | Tap Tepat Waktu | Simon | Hindari Rintangan |
|---|---|---|---|---|
| Jam Pasir (+5 s) | `timeDelta` | durasi 20→25 s | durasi 30→35 s | durasi **tetap**; `M` ×0,85 (tempo −15%): kecepatan ×0,85, jeda baris ÷0,85 |
| Santai Dulu | `difficultyShift` | race layer, minigame menerima difficulty baru | sama | sama |
| Nyawa Cadangan | `noCooldown` (onFail) | race layer, tak menyentuh minigame | sama | sama |
| Teropong | `hint` | zona bersinar + "tik" 0,15 s sebelum jarum masuk | tombol "Ulang" (sekali per minigame) | bayangan baris 0,5 s lebih awal |
| Zona Lebar (×1,3) | `tolerance` | lebar zona ×1,3 (maks 0,40) | `idleTimeoutMs` ×1,3 (3000→3900) dan `mistakesAllowed` +1 (karena mult ≥ 1,3) | `hitHalfWindowMs` ÷1,3 (150→115 ms), `iFrameMs` ×1,3 (hard tetap 0) |
| Kopi Tubruk | `cooldownClear` | race layer | race layer | race layer |
| Oleh-oleh | `rewardPickDelta` (onWin) | race layer | race layer | race layer |
| Ojek Kilat | `winMultiplier` (onWin) | race layer | race layer | race layer |
| Tiket Pesawat | `skipRegion` | tanpa minigame | tanpa minigame | tanpa minigame |
| Payung Tameng, Cermin Balik | `blockSabotage`/`reflectSabotage` | tak ada pemetaan; fase `b` | — | — |

Catatan:
- **Jam Pasir di Hindari Rintangan** tidak menambah waktu bertahan; ia memperlambat tempo. Teks kartu dan badge intro harus menyebut ini (ui-flow §8: badge "⏳ tempo −15%" di HR, "⏳ +5 s" di TT/SM). Dua Jam Pasir = `M` 0,70 (batas bawah).
- **Zona Lebar di Simon hard:** `mistakesAllowed` 0→1 mengubah hard sangat longgar. Dipantau di playtest; tuas: pakai `idleTimeoutMs` saja tanpa +1 mistake (ubah di minigames.md, bukan di kartu).
- Jam Pasir ×2 di Simon = 40 s (batas atas clamp, lolos).

**Minigame yang belum dibangun (CP5) dan aturan cadangan:** semua 7 minigame MVP sudah punya definisi 6 modifier di [minigames.md §2–§8](minigames.md#2-tap-tepat-waktu-tap_timing--2d), jadi tidak ada hint tanpa definisi. Minigame yang belum dibangun tidak ada di registry dan tak pernah diundi, sehingga kartu tidak bisa terbuang di sana. Aturan agar celah tidak muncul nanti: sebuah minigame **tidak boleh masuk registry** sebelum tabel modifiernya memetakan keenam jenis (`timeDelta`, `tolerance`, `speed`, `extraTarget`, `fog`, `hint`). Bila tetap ada modifier tak dikenal (bug data), ia diabaikan dengan log warning ([minigames.md §1.2](minigames.md#12-interface-typescript-dibangun-engineer)) dan kartu tetap habis (aturan tunggal §1.1).

## 6. Keputusan
### CP2
- Diputuskan owner: batas 2 sabotase pending (Q2), Copet ditambahkan sebagai pengecualian R3 (Q3), layar kartu 15 s (Q4).
- Diputuskan PM: nama 8 kartu base; difficulty efektif menentukan N kartu; Tiket Pesawat dilarang untuk region yang punya edge ke finish (C-2/D-009); tidak ada penawaran kartu setelah win penentu kemenangan (C-3).

### CP4a (usulan Designer, menunggu PM bila ditandai)
- DR-23: semua kartu bersyarat habis setelah 1 percobaan, menang atau gagal (rekomendasi QA).
- DR-26: dedupe lewat konstruksi, tanpa undi ulang.
- DR-25: tie-break auto-pick/auto-buang (§3.4).
- Penawaran CP4a boost-only dengan bobot baris "Pemimpin". **Diputuskan PM (opsi A):** Payung Tameng dan Cermin Balik `phase: 'b'`, masuk pool di CP4b.

### CP4b (usulan Designer; PM boleh mengubah, ditandai ★ bila butuh perhatian)
- DR-24: Nyawa Cadangan menang atas Macet Total; keduanya habis (§2.3).
- DR-27: semua perubahan hand atomik; popover/picker menutup dengan toast; jumlah buang dihitung ulang; timer 15 s tidak direset (§2.2.5).
- DR-28: pantulan tidak dipantulkan/ditangkal lagi; kena Q2 dan `maxStacks` pengirim; kelebihan hangus (§2.2.3).
- DR-29: Gunung bisa dimainkan bila ≥ 1 lawan valid; label "Sudah kena kartu ini" (§2.2.1).
- DR-33: semua melihat jumlah slot; nama kartu hanya target+pengirim; pengecualian label "Sudah kena kartu ini" (§1).
- ★ Slot sabotase ditahan sampai percobaan selesai (kartu snapshot ikut dihitung); target yang sedang main dengan 2 sabotase aktif tampil "Penuh".
- ★ Tanpa target valid kartu tidak bisa dimainkan (bukan hangus); picker dilewati bila hanya 1 lawan di match.
- ★ Bot menerima penawaran dan auto-pick di CP4b (agar Copet dan Q2 bisa diuji vs bot); bot belum memainkan kartu (§3.2.1).
- Comeback: `gap` dalam `remainingWins` terhadap yang terkecil, bobot §3.2 (angka tidak berubah dari v0.3).
- DR-32 (bagian CP4b) dan DR-35 (bagian bot-sasaran) diselesaikan di §3.2.1. Strategi bot memilih/memakai kartu tetap CP5.

## 7. Pertanyaan terbuka (untuk PM)
1. **Bot menerima penawaran di CP4b** (★): rekomendasi ya, auto-pick sederhana. Alternatif: bot tanpa hand sampai CP5 (Copet tak bisa dimainkan ke bot, uji lewat `debugGrantCard`).
2. **Picker dilewati bila 1 lawan**: rekomendasi ya (1 ketukan kurang). Alternatif: selalu tampil picker.
3. **Kebocoran "Sudah kena kartu ini"** (§1): rekomendasi terima. Alternatif: tanpa label, kartu hangus bila target sudah di `maxStacks` (lebih menyebalkan).

## 8. Kriteria penerimaan CP4b (untuk QA)
Tiap butir harus lulus lewat tes logic (Vitest) kecuali ditandai UI (Playwright).
1. **Pool:** penawaran memakai 20 kartu; Payung Tameng dan Cermin Balik bisa muncul; kartu fase `b` dimainkan benar.
2. **Target valid (§2.2.1):** lawan penuh, hand kosong (Copet), dan `maxStacks` tercapai tidak valid dengan label yang tepat; Copet valid ke lawan "Penuh"; diri sendiri tidak pernah valid.
3. **Tanpa target valid:** kartu redup dengan alasan, tetap di hand, tidak ada perubahan state bila dipaksa lewat aksi; bukan hangus.
4. **Cek ulang saat konfirmasi:** target menjadi penuh/kosong antara picker dibuka dan konfirmasi → tidak ada perubahan, kartu tetap di hand.
5. **Q2:** target punya maks 2 sabotase pending dari semua sumber; slot dilepas setelah percobaan selesai; kartu snapshot menahan slot sampai hasil; Copet tidak memakai slot.
6. **R3:** sabotase yang dimainkan saat target sedang intro/main berlaku ke percobaan berikutnya, bukan yang berjalan; berlaku juga ke percobaan ulang.
7. **Cermin/Payung (§2.2.3):** tiap baris tabel punya tes, termasuk Cermin vs Cermin (Cermin pengirim tidak habis), pantulan ke pengirim penuh (hangus, Cermin habis), pantulan ke pengirim berPayung (Payung tidak habis), Payung vs Copet, Cermin vs Copet dengan hand pengirim kosong.
8. **Kartu pertahanan maks 1:** kartu pertahanan kedua redup dan tidak hangus.
9. **Gunung Meletus:** lawan tidak valid dilewati dan Payung/Cermin mereka tidak terpakai; urutan seat; pantulan Gunung dari 2 lawan → pengirim kena 1.
10. **Penggabungan (§2.3):** contoh Tap Tepat Waktu menghasilkan nilai yang tertulis; urutan main kartu diacak → hasil identik; difficulty di-clamp setelah dijumlah (Badai + Gunung → hard; Badai + Santai Dulu → netral).
11. **DR-24:** gagal dengan Macet + Nyawa → cooldown 0, kedua kartu habis; gagal dengan Macet saja → cooldown dasar + 6; menang dengan Macet → habis tanpa efek dan slot lepas.
12. **Pelit Hadiah + Oleh-oleh:** saling hapus; N tetap di [1, min(5, |offer|)].
13. **Copet RNG:** seed sama → kartu curian sama; sebaran uniform atas hand 5 kartu (10.000 percobaan, tiap kartu 20% ± 3 poin); instance berpindah tanpa duplikat; `handSeq` baru; stream `copet` pantulan milik pemilik Cermin.
14. **Copet hand:** hand pencuri ≤ 5 setelah mencuri; hand target 5 + pantulan → layar Buang; hand pengirim kosong → pantulan tanpa efek.
15. **DR-27:** Copet saat target punya Detail/Picker/Buang/Penawaran terbuka mengikuti tabel §2.2.5; layar Buang menutup otomatis saat wajib buang jadi 0; timer tidak direset.
16. **Comeback:** `tierWeights` mengembalikan baris tabel §3.2 persis untuk gap 0, 1, 2, 3, 4, 5, 9; `gap` dihitung pada tick win dengan memakai semua pemain; jaminan rare+ 100% di tier gap ≥ 3 (10.000 seed, pool 20); rata-rata jumlah rare+ per penawaran naik monoton menurut tier; sebaran rarity per slot dalam ± 4 poin dari bobot untuk slot 1–4, dan ± 7 poin untuk slot 5 (pada tier berjaminan, gap ≥ 3, jaminan rare+ §3.1 langkah 3 mengganti slot 5 lebih dulu; terukur QA: common 49,8% vs 55% di gap 3–4).
17. **Bot:** menerima penawaran dengan bobot tier-nya, hand ≤ 5, tidak memainkan kartu; sabotase pending dipakai di percobaan bot (peluang lulus ±8 per jenis, clamp 5–98%); Macet dan Pelit berlaku pada bot; bot bisa jadi target Copet bila hand ≥ 1.
18. **Pause (UI):** tombol Pause bisa diklik di atas layar Penawaran, Buang, Detail, Picker; pause membekukan timer 15 s (sisa tetap utuh setelah jeda 100 s), bot, dan cooldown.
19. **Zona kartu:** fuzz (aksi sabotase, Copet, pantulan, layar kartu) menjaga tiap instance di tepat satu zona; akhir match memindah kartu `offer` ke `discarded` (QA-CP4a-02).
20. **Replay:** `replay(actionLog)` menghasilkan state identik dengan sesi asli, termasuk timeout layar kartu pada tick besar/tergabung (QA-CP4a-01).
21. **UI 390×844 (Playwright):** picker dengan 3 lawan, label, dan tombol Batal tidak tumpang tindih dan semua target sentuh ≥ 48 px; toast Copet/tangkal/pantul muncul dan hilang sendiri.
