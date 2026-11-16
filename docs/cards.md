# Kartu — Spesifikasi MVP

**Status:** designed · **Updated:** 2026-11-16 (v0.3, CP4a: DR-16, DR-23, DR-25, DR-26, DR-30, DR-31, DR-40, DR-48; penawaran boost-only) · Kembali ke [GDD](gdd.md) · Requirement: R3 (+ pengecualian Copet), R8, R9, K1, K1.1, K2, K3, Q2, Q4

20 kartu (K3): 11 boost, 9 sabotase. Kartu adalah **data**; satu interpreter efek menjalankan daftar `ops` (lihat §4). Tabel §2 adalah sumber kebenaran angka; `cards.json` di kode dibuat dari tabel ini.

**Pembagian rilis CP4:**
- **CP4a:** semua 20 kartu didefinisikan sebagai data + interpreter efek, penawaran pilih-N-dari-5, hand maks 5 + layar buang, timer 15 s, dan **hanya kartu boost (self) yang aktif**. Penawaran hanya berisi boost (§3.2).
- **CP4b:** sabotase, target picker, batas 2, Copet, Payung/Cermin, bobot comeback. Daftar tugasnya di §7.

## 1. Aturan dasar

| Aturan | Nilai |
|---|---|
| Hand maksimal (R9) | 5 kartu. Duplikat kartu yang sama boleh |
| Dapat kartu (K1) | Menang minigame → ditawari 5 kartu acak, pilih N: easy 1 / medium 2 / hard 3 (difficulty **efektif**, D-002 di [GDD](gdd.md#decisions)). Rumus N lengkap di §3.3 |
| Batas waktu layar kartu (Q4) | Layar pilih dan layar buang masing-masing 15 s, lalu auto-pick (aturan pasti di §3.4) |
| Hand > 5 (K1.1) | Layar buang: pilih kartu yang dibuang sampai sisa 5 (boleh membuang kartu yang baru diambil). Tidak bisa ditutup sebelum ≤ 5. Hand maks sebelum buang = 5 + N maks 4 = **9** (hard 3 + Oleh-oleh 1) |
| Kapan boleh main kartu | Kapan saja selama pemain berada di race view: sebelum menekan Mulai, saat cooldown, saat animasi jalan (pengecualian: Tiket Pesawat, lihat barisnya). **Tidak** saat minigame sendiri berjalan, intro, atau layar kartu/buang |
| Kartu instan | Efek langsung (Kopi Tubruk, Tiket Pesawat, Copet) |
| Kartu "minigame berikutnya" | Disimpan sebagai *pending* di pemain target. **Snapshot per percobaan (DR-48):** saat pemain menekan **Mulai**, semua pending `next_minigame` miliknya diterapkan ke percobaan itu. Setelah percobaan selesai (menang atau gagal) kartu itu **habis**, dengan atau tanpa efek bersyarat (§1.1). Kartu yang dimainkan saat cooldown ikut ke percobaan ulang (snapshot baru). Bila target sedang main, efek menunggu minigame setelahnya (R3) |
| Target sabotase (K2) | Pemain memilih 1 lawan lewat target picker ([ui-flow.md](ui-flow.md#7-target-picker-sabotase)). Kartu "semua lawan" tidak butuh picker. **CP4b** |
| Batas sabotase per target (Q2) | Maks **2 kartu sabotase pending** per target dari semua sumber. Target yang penuh tampil "Penuh" dan tidak bisa dipilih untuk sabotase pending. Copet bukan pending (instan), jadi tidak memakai slot ini dan tetap boleh ke target "Penuh". **CP4b** |
| Batas per kartu | Kolom `maxStacks` = berapa salinan kartu yang sama boleh pending di satu pemain. Lewat batas = kartu tidak bisa dimainkan (tetap di hand) |
| Netting | Modifier sumbu yang sama saling jumlah (Jam Pasir +5 dan Jam Rusak −5 = 0). Difficulty di-clamp easy..hard; durasi di-clamp 10–40 s |
| Info tersembunyi | Kartu di hand lawan tidak terlihat (hanya jumlahnya). Pending boost/defensif hanya terlihat oleh pemiliknya. Pending sabotase: lihat DR-33 di §7 |

### 1.1 Durasi dan syarat (DR-23, satu-satunya definisi)
Hanya ada tiga durasi: `instant`, `next_minigame`, `next_sabotage`. Kartu bersyarat memakai kolom **Syarat** (`onFail` / `onWin`), bukan durasi sendiri:

- `next_minigame` **tanpa** syarat: efek berlaku selama percobaan berikutnya; habis saat percobaan selesai.
- `next_minigame` **+ `onFail`** (Nyawa Cadangan, Macet Total): efek hanya terjadi bila percobaan berikutnya **gagal**. Bila menang, kartu tetap **habis tanpa efek**.
- `next_minigame` **+ `onWin`** (Oleh-oleh, Ojek Kilat, Pelit Hadiah): efek hanya terjadi bila percobaan berikutnya **menang**. Bila gagal, kartu tetap **habis tanpa efek**.
- `next_sabotage`: defensif, aktif sampai menangkal 1 sabotase (tidak terkait percobaan). CP4b.
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
| `payung_tameng` | Payung Tameng | rare | ✓ | self | next_sabotage | — | b | Menangkal 1 sabotase berikutnya yang mengarah ke kamu (kartu sabotase hangus) | 1 (defensif: maks 1 kartu defensif aktif) |
| `zona_lebar` | Zona Lebar | common | | self | next_minigame | — | a | `tolerance` ×1,3 (zona/hitbox/jeda idle lebih longgar; arti per minigame di §5) | 1 |
| `kopi_tubruk` | Kopi Tubruk | common | | self | instant | — | a | Hapus sisa cooldown sekarang. Hanya bisa dimainkan saat cooldown | — |
| `oleh_oleh` | Oleh-oleh | common | | self | next_minigame | onWin | a | Bila kamu **menang** di minigame berikutnya: pilih +1 kartu (maks 5 dari 5). Bila gagal: habis tanpa efek. Di region FINAL tidak ada penawaran (C-3), jadi tanpa efek (peringatan di detail, §2.1) | 1 |
| `ojek_kilat` | Ojek Kilat | rare | | self | next_minigame | onWin | a | Bila kamu **menang** di minigame berikutnya, dihitung 2 win (1 penawaran kartu saja, N sesuai difficulty). Bila gagal: habis tanpa efek | 1 |
| `cermin_balik` | Cermin Balik | epic | | self | next_sabotage | — | b | Memantulkan 1 sabotase berikutnya ke pengirimnya (kena batas sabotase pengirim; bila pengirim penuh → hanya tertangkal) | 1 (defensif: maks 1 kartu defensif aktif; redup bila Payung aktif) |
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

### Copet: aturan lengkap (CP4b)
1. **Kapan:** kapan saja kamu di race view (aturan umum). Boleh mengincar target yang sedang main minigame; minigame target tidak terganggu (hand memang tidak dipakai saat minigame).
2. **Kartu yang dicuri:** 1 kartu acak seragam dari hand target (stream `copet` milik pencuri; pada pantulan Cermin Balik: stream `copet` milik pemilik Cermin, DR-47). Hanya kartu di hand; efek pending target tidak tersentuh.
3. **Hand target kosong:** target tidak bisa dipilih di picker (label "Hand kosong"). Bila semua lawan kosong, Copet tidak bisa dimainkan (redup, alasan di detail kartu). Kartu tidak pernah terbuang sia-sia.
4. **Hand pencuri penuh:** tidak mungkin meluap. Copet keluar dari hand dulu (ke zona `limbo`) sebelum mencuri, jadi hand pencuri ≤ 4 lalu jadi ≤ 5.
5. **Payung Tameng target:** menangkal Copet; Copet dan Payung Tameng sama-sama habis, tidak ada kartu berpindah.
6. **Cermin Balik target:** memantulkan: target mencuri 1 kartu acak dari hand pencuri (setelah Copet keluar dari hand). Bila hand pencuri kosong, pantulan gagal tanpa efek; Cermin Balik tetap habis. Bila hand target sudah 5 dan menerima kartu ke-6: target langsung masuk layar Buang Kartu (15 s), atau, bila sedang minigame, setelah minigame selesai (digabung dengan layar kartu bila ia menang).
7. **Batas sabotase (Q2):** Copet tidak memakai slot pending (instan).
8. **Info:** pencuri dan target sama-sama melihat kartu mana yang pindah (toast + animasi kartu terbang). Lawan lain hanya melihat "Bot 1 mencopet Bot 2".

### Urutan resolusi saat Mulai ditekan (snapshot percobaan)
1. Ambil semua pending `next_minigame` pemain (DR-48). 2. `difficultyShift` dijumlah & di-clamp. 3. Modifier lain digabung (timeDelta dijumlah lalu di-clamp sehingga durasi dasar + total ∈ 10–40 s, mult dikalikan). 4. Kirim ke minigame sebagai `MinigameContext` ([minigames.md](minigames.md#12-interface-typescript-dibangun-engineer)). 5. Setelah hasil: terapkan efek bersyarat yang syaratnya terpenuhi (`onFail`: cooldown, `onWin`: win dan N kartu), lalu pindahkan semua kartu snapshot ke `discarded`.

Saat kartu sabotase dimainkan (CP4b): cek batas sabotase target (kecuali Copet) → cek `cermin_balik` target → cek `payung_tameng` target → baru masuk pending (atau, untuk Copet, langsung dieksekusi). Cermin dicek dulu karena bila Cermin dan Payung bisa sama-sama aktif urutannya harus pasti; karena maks 1 kartu defensif aktif per pemain (DR-40), kasus itu sebenarnya tidak terjadi dan urutan hanya jaga-jaga.

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

### 3.2 Aturan CP4a (boost-only) dan tier comeback (CP4b)
**CP4a:**
- `pool` = kartu fase `a` = **9 boost** (tanpa Payung Tameng dan Cermin Balik, karena belum ada sabotase yang bisa ditangkal; lihat keputusan di §8).
- **Bobot:** semua pemain memakai baris "Pemimpin / seri depan": common 75 / rare 22 / epic 3. Tidak ada perhitungan `gap`/tier; kode memanggil `tierWeights(player)` yang di CP4a selalu mengembalikan baris itu, supaya CP4b hanya mengganti fungsi itu.
- **Degradasi jaminan:** "≥ 1 boost dan ≥ 1 sabotase" otomatis berubah jadi "pool tanpa sabotase → langkah 2 dilewati"; semua penawaran boost semua. Jaminan "≥ 1 rare+" tidak aktif (baris base tanpa jaminan).
- Dengan 9 kartu (common 6, rare 2, epic 1) dan 5 slot, rarity yang habis keluar dari undian (langkah 1b) dan penawaran selalu 5 kartu berbeda. Perkiraan kasar ≈ 70–75% penawaran memuat ≥ 1 rare+ (hitungan 1 − 0,75⁵ dikoreksi habisnya stok; belum disimulasikan, cek di tes distribusi).
- Offer boleh mengandung kartu yang situasional (mis. Kopi Tubruk); itu bagian dari pilihan.

**CP4b (belum aktif):** `pool` = 20 kartu, bobot tier `gap = remainingWins(pemain) − remainingWins(pemimpin)` ([GDD](gdd.md#aturan-menangkalah)):

| Tier | gap (win) | common | rare | epic | Jaminan |
|---|---|---|---|---|---|
| Pemimpin / seri depan | 0 | 75 | 22 | 3 | — |
| Sedikit tertinggal | 1–2 | 65 | 28 | 7 | — |
| Tertinggal | 3–4 | 55 | 32 | 13 | ≥ 1 rare+ |
| Jauh tertinggal | ≥ 5 | 45 | 35 | 20 | ≥ 1 rare+ |

Angka bobot adalah titik awal untuk playtest.

### 3.3 Jumlah pilihan N
`N = clamp(Nbase(difficulty efektif) + Σ rewardPickDelta, 1, min(5, ukuran offer))`, dengan `Nbase` = 1/2/3 dan `rewardPickDelta` Oleh-oleh = +1, Pelit Hadiah = −1 (CP4b). Contoh: hard + Oleh-oleh = 4 dari 5. Tidak ada penawaran setelah win penentu kemenangan (C-3).

### 3.4 Layar pilih dan layar buang: timer 15 s (DR-25)
- **Auto-pick (layar pilih habis waktu):** kartu yang sudah ditandai tetap dipilih. Kekurangannya diisi dari kartu yang belum ditandai: rarity tertinggi dulu; seri → slot paling kiri dulu. Penawaran lalu diproses normal (ke layar buang bila hand > 5).
- **Auto-buang (layar buang habis waktu):** kartu yang sudah ditandai tetap dibuang. Kekurangannya diisi dari yang belum ditandai: rarity **terendah** dulu; seri → kartu yang **paling lama di hand** dulu; kartu baru dari penawaran ini dibuang paling akhir. "Paling lama di hand" = nomor urut masuk hand terkecil (`handSeq`, naik 1 tiap kartu masuk hand; kartu dari satu pick diberi nomor menurut urutan slot kiri ke kanan).
- Timer dibekukan oleh pause ([gdd.md](gdd.md#aturan-menangkalah)). Hasil auto-pick/auto-buang sama persis untuk state yang sama (tidak memakai RNG).

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

**Invarian yang perlu dites:** tiap instance kartu punya id unik dan ada di tepat satu zona (`offer`, `hand`, `limbo`, `pending`, `discarded`; kartu snapshot tetap di `pending` sampai percobaan selesai, lalu `discarded`); hand ≤ 5 setiap kali layar buang ditutup; seed sama → penawaran sama; penawaran tak punya id kembar dan berukuran min(5, |pool|); kartu bersyarat selalu habis setelah 1 percobaan; Copet memindahkan instance tanpa menduplikasi (CP4b).

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
- Penawaran CP4a boost-only dengan bobot baris "Pemimpin". **Menunggu PM:** Payung Tameng dan Cermin Balik dikeluarkan dari pool CP4a (§8).

## 7. Backlog CP4b
Tidak dikerjakan di CP4a, dicatat supaya tidak hilang:
- **DR-24:** Nyawa Cadangan + Macet Total sama-sama `onFail`: usul QA, hitung cooldown dasar + Macet, lalu Nyawa menghapus semuanya (Nyawa menang), keduanya habis.
- **DR-27 (Copet vs layar kartu terbuka):** Copet atau pantulan Cermin bisa mengambil kartu yang sedang dibuka target di Detail Kartu/Target Picker, atau mengubah jumlah yang harus dibuang di layar Buang. **Belum diputuskan, tidak diselesaikan sekarang.** Usul QA sebagai bahan: main kartu atomik di logic, popover ditutup dengan toast bila kartunya hilang, jumlah buang dihitung ulang, layar Buang menutup Detail/Picker dulu.
- **DR-28** (pantulan tidak bisa dipantulkan lagi, kena batas Q2 dan `maxStacks`), **DR-29** (kapan Gunung boleh dimainkan; label "Sudah kena kartu ini"), **DR-33** (visibilitas pending: semua melihat jumlah slot, hanya target+pengirim melihat nama), **DR-32** (comeback untuk bot, pilihan bot), bobot comeback (§3.2), cap 2, Copet, Payung/Cermin.
- DR-47 (stream RNG pantulan) sudah tertulis di Copet butir 2.

## 8. Keputusan yang dibutuhkan dari PM
**Payung Tameng dan Cermin Balik di penawaran CP4a.** Keduanya boost (self) tetapi hanya berguna melawan sabotase, yang baru ada di CP4b. Di CP4a menjadi kartu mati.
| Opsi | Isi | Dampak |
|---|---|---|
| A (rekomendasi) | Keluar dari pool CP4a (`phase: 'b'`), tetap terdefinisi sebagai data | Pool 9 kartu, tak ada pilihan sia-sia, tes penawaran sudah mencakup pool kecil |
| B | Tetap di pool CP4a | Pool 11 (common 6, rare 3, epic 2), tanpa perubahan algoritma, tapi pemain bisa mengambil kartu tak berguna (dan Cermin epic = slot langka terbuang) |
