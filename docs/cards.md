# Kartu — Spesifikasi MVP

**Status:** designed · **Updated:** 2026-11-16 · Kembali ke [GDD](gdd.md) · Requirement: R3, R8, R9, K1, K1.1, K2, K3

20 kartu (K3): 11 boost, 9 sabotase. Kartu adalah **data**; satu interpreter efek menjalankan daftar `ops` (lihat §4). Tabel §2 adalah sumber kebenaran angka; `cards.json` di kode dibuat dari tabel ini.

## 1. Aturan dasar

| Aturan | Nilai |
|---|---|
| Hand maksimal (R9) | 5 kartu. Duplikat kartu yang sama boleh |
| Dapat kartu (K1) | Menang minigame → ditawari 5 kartu acak, pilih N: easy 1 / medium 2 / hard 3 (difficulty **efektif**, D-002 di [GDD](gdd.md#decisions)) |
| Hand > 5 (K1.1) | Layar buang: pilih kartu yang dibuang sampai sisa 5 (boleh membuang kartu yang baru diambil). Tidak bisa ditutup sebelum ≤ 5 |
| Kapan boleh main kartu | Kapan saja selama pemain berada di race view: sebelum menekan Mulai, saat cooldown, saat animasi jalan. **Tidak** saat minigame sendiri berjalan, intro, atau layar kartu/buang |
| Kartu instan | Efek langsung (Kopi Tubruk, Tiket Pesawat) |
| Kartu "minigame berikutnya" | Disimpan sebagai *pending* di pemain target, diterapkan saat minigame berikutnya **dimulai** (setelah tombol Mulai), lalu habis. Bila target sedang main, efek menunggu minigame setelahnya (R3) |
| Target sabotase (K2) | Pemain memilih 1 lawan lewat target picker ([ui-flow.md](ui-flow.md#target-picker-sabotase)). Kartu "semua lawan" tidak butuh picker |
| Batas sabotase per target | Maks **2 kartu sabotase pending** per target dari semua sumber (anti-keroyok 3 bot) `[ASSUMPTION]`. Target yang penuh tampil "Penuh" dan tidak bisa dipilih |
| Batas per kartu | Kolom `maxStacks` = berapa salinan kartu yang sama boleh pending di satu pemain. Lewat batas = kartu tidak bisa dimainkan (tetap di hand) |
| Netting | Modifier sumbu yang sama saling jumlah (Jam Pasir +5 dan Jam Rusak −5 = 0). Difficulty di-clamp easy..hard; durasi di-clamp 10–40 s |
| Info tersembunyi | Kartu di hand lawan tidak terlihat (hanya jumlahnya). Pending boost/defensif hanya terlihat oleh pemiliknya. Pending sabotase terlihat oleh target (ikon di HUD) dan pengirim |

## 2. Daftar kartu

Kolom: **Base** = termasuk 8 kartu base (5 boost, 3 sabotase; K3). **Target**: `self`, `opponent` (pilih 1), `all_opponents`. **Durasi**: `instant`, `next_minigame`, `next_fail`, `next_reward`, `next_sabotage` (defensif, aktif sampai terpakai).

### Boost (11)

| id | Nama | Rarity | Base | Target | Durasi | Efek | maxStacks |
|---|---|---|---|---|---|---|---|
| `jam_pasir` | Jam Pasir | common | ✓ | self | next_minigame | Waktu +5 s | 2 |
| `santai_dulu` | Santai Dulu | rare | ✓ | self | next_minigame | Difficulty −1 tingkat (hard→medium, medium→easy). Ingat: reward kartu & cooldown ikut difficulty efektif | 1 |
| `nyawa_cadangan` | Nyawa Cadangan | common | ✓ | self | next_fail | Bila gagal di minigame berikutnya: tanpa cooldown, langsung ulang | 1 |
| `teropong` | Teropong | common | ✓ | self | next_minigame | Aktifkan `hint` (bantuan khusus tiap minigame, lihat [minigames.md](minigames.md)) | 1 |
| `payung_tameng` | Payung Tameng | rare | ✓ | self | next_sabotage | Menangkal 1 sabotase berikutnya yang mengarah ke kamu (kartu sabotase hangus) | 1 (defensif: maks 1 kartu defensif aktif) |
| `zona_lebar` | Zona Lebar | common | | self | next_minigame | `tolerance` ×1,3 (zona/hitbox lebih besar) | 1 |
| `kopi_tubruk` | Kopi Tubruk | common | | self | instant | Hapus sisa cooldown sekarang. Hanya bisa dimainkan saat cooldown | — |
| `oleh_oleh` | Oleh-oleh | common | | self | next_reward | Kemenangan berikutnya: pilih +1 kartu (maks 5 dari 5) | 1 |
| `ojek_kilat` | Ojek Kilat | rare | | self | next_minigame | Bila menang di minigame berikutnya, dihitung 2 win | 1 |
| `cermin_balik` | Cermin Balik | epic | | self | next_sabotage | Memantulkan 1 sabotase berikutnya ke pengirimnya (kena batas sabotase pengirim; bila pengirim penuh → hanya tertangkal) | 1 (defensif) |
| `tiket_pesawat` | Tiket Pesawat | epic | | self | instant | Langsung masuk ke region target yang sedang dipilih tanpa main minigame (pengecualian "no skipping" R6.1). Tidak dapat kartu. **Tidak bisa** untuk region finish | — |

### Sabotase (9)

| id | Nama | Rarity | Base | Target | Durasi | Efek | maxStacks |
|---|---|---|---|---|---|---|---|
| `jam_rusak` | Jam Rusak | common | ✓ | opponent | next_minigame | Waktu −5 s (di Hindari Rintangan: kecepatan +15%) | 2 |
| `badai` | Badai | rare | ✓ | opponent | next_minigame | Difficulty +1 tingkat | 1 |
| `kabut_asap` | Kabut Asap | common | ✓ | opponent | next_minigame | Aktifkan `fog` | 1 |
| `macet_total` | Macet Total | common | | opponent | next_fail | Bila target gagal di minigame berikutnya: cooldown +6 s | 1 |
| `pelit_hadiah` | Pelit Hadiah | common | | opponent | next_reward | Bila target menang di minigame berikutnya: pilih −1 kartu (min 1) | 1 |
| `ngebut` | Ngebut | rare | | opponent | next_minigame | `speed` ×1,25 | 1 |
| `tambah_beban` | Tambah Beban | rare | | opponent | next_minigame | `extraTarget` +1 (syarat lulus naik) | 1 |
| `sinyal_hilang` | Sinyal Hilang | rare | | opponent | next_minigame | Boost pending target (tipe next_minigame) ditunda ke minigame setelahnya. Tidak memengaruhi kartu defensif & instan | 1 |
| `gunung_meletus` | Gunung Meletus | epic | | all_opponents | next_minigame | Difficulty +1 tingkat ke semua lawan (tiap lawan dicek tameng/cermin & batas sabotasenya sendiri) | 1 |

Rekap rarity: common 10, rare 7, epic 3.

### Urutan resolusi saat minigame dimulai
1. `sinyal_hilang` (menunda boost) → 2. `difficultyShift` dijumlah & di-clamp → 3. modifier lain digabung (timeDelta dijumlah, mult dikalikan) → 4. kirim ke minigame sebagai `MinigameContext` ([minigames.md](minigames.md#12-interface-typescript-dibangun-engineer)).

Saat kartu sabotase dimainkan: cek batas sabotase target → cek `cermin_balik` target → cek `payung_tameng` target → baru masuk pending. (Cermin didahulukan karena lebih langka.)

## 3. Rarity dan comeback (R8)

Penawaran 5 kartu dibuat begini:
1. Untuk tiap slot: undi rarity dengan bobot tier pemain (tabel di bawah), lalu pilih kartu acak seragam di rarity itu.
2. Tidak boleh ada `id` kembar dalam satu penawaran (undi ulang slot itu).
3. Penawaran selalu berisi ≥ 1 boost dan ≥ 1 sabotase (slot terakhir dipaksa bila perlu).
4. RNG kartu memakai generator seeded sendiri (`hash(matchSeed, playerId, 'cards')`), terpisah dari RNG minigame.

**Tier comeback** dihitung saat penawaran dibuat: `gap = remainingWins(pemain) − remainingWins(pemimpin)` (definisi `remainingWins` di [GDD](gdd.md#aturan-menangkalah)).

| Tier | gap (win) | common | rare | epic | Jaminan |
|---|---|---|---|---|---|
| Pemimpin / seri depan | 0 | 75 | 22 | 3 | — |
| Sedikit tertinggal | 1–2 | 65 | 28 | 7 | — |
| Tertinggal | 3–4 | 55 | 32 | 13 | ≥ 1 rare+ |
| Jauh tertinggal | ≥ 5 | 45 | 35 | 20 | ≥ 1 rare+ |

Perkiraan: dengan `winsRequired = 2`, 1 region ≈ 2 win, jadi tier "Tertinggal" ≈ 1,5–2 region di belakang. Angka bobot adalah titik awal untuk playtest.

## 4. Format data (untuk interpreter)

```ts
type CardType = 'boost' | 'sabotage';
type Rarity = 'common' | 'rare' | 'epic';
type CardTarget = 'self' | 'opponent' | 'all_opponents';
type CardDuration = 'instant' | 'next_minigame' | 'next_fail' | 'next_reward' | 'next_sabotage';

type CardOp =
  | { op: 'modifier'; modifier: MinigameModifier }      // dari minigames.md
  | { op: 'difficultyShift'; delta: -1 | 1 }
  | { op: 'cooldownDelta'; seconds: number }            // next_fail
  | { op: 'noCooldown' }                                 // next_fail
  | { op: 'cooldownClear' }                              // instant
  | { op: 'rewardPickDelta'; delta: number }             // next_reward
  | { op: 'winMultiplier'; mult: number }                // next_minigame
  | { op: 'skipRegion' }                                 // instant
  | { op: 'blockSabotage' } | { op: 'reflectSabotage' }  // next_sabotage
  | { op: 'delayBoosts' };                               // next_minigame (sabotase)

interface CardDef {
  id: string; nameKey: string; descKey: string; icon: string;
  type: CardType; rarity: Rarity; base: boolean;
  target: CardTarget; duration: CardDuration; maxStacks: number | null;
  playableWhen?: 'always' | 'cooldown' | 'atRegionSelect';
  ops: CardOp[];
}
```

Contoh:

```json
[
  { "id": "jam_pasir", "type": "boost", "rarity": "common", "base": true,
    "target": "self", "duration": "next_minigame", "maxStacks": 2,
    "ops": [{ "op": "modifier", "modifier": { "kind": "timeDelta", "seconds": 5 } }] },
  { "id": "kopi_tubruk", "type": "boost", "rarity": "common", "base": false,
    "target": "self", "duration": "instant", "maxStacks": null, "playableWhen": "cooldown",
    "ops": [{ "op": "cooldownClear" }] },
  { "id": "gunung_meletus", "type": "sabotage", "rarity": "epic", "base": false,
    "target": "all_opponents", "duration": "next_minigame", "maxStacks": 1,
    "ops": [{ "op": "difficultyShift", "delta": 1 }] }
]
```

Nama dan deskripsi lewat string key (`card.jam_pasir.name`) supaya bisa dilokalkan; peta lain boleh me-reskin nama/ikon kartu lewat `map.cardSkins` (opsional, lihat [map-indonesia.md](map-indonesia.md#format-data-peta-map-agnostic)).

**Invarian yang perlu dites:** tiap instance kartu punya id unik dan ada di tepat satu zona (`offer`, `hand`, `pending`, `discarded`); hand ≤ 5 setiap kali layar buang ditutup; seed sama → penawaran sama.

## Open questions (PM/owner to confirm)
1. **Kartu base 8**: requirements tidak menamai kartunya. Designer memilih Jam Pasir, Santai Dulu, Nyawa Cadangan, Teropong, Payung Tameng (boost) + Jam Rusak, Badai, Kabut Asap (sabotase).
2. **Tidak ada sabotase yang mencuri/membuang kartu** dari hand lawan, karena R3 bilang efek sabotase berlaku di minigame berikutnya. Opsi: (a) patuhi R3 ketat [rekomendasi], (b) izinkan 1 kartu "Copet" (curi 1 kartu acak) sebagai pengecualian.
3. Batas 2 sabotase pending per target. Opsi: (a) 2 [rekomendasi], (b) 3, (c) tanpa batas.
4. Tiket Pesawat dilarang untuk region finish. Opsi: (a) dilarang [rekomendasi, finish harus dimenangkan], (b) boleh.
