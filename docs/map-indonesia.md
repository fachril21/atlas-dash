# Peta Indonesia + Format Data Peta

**Status:** designed · **Version:** 0.4 · **Updated:** 2026-11-17 (v0.4, CP5b: `places` dan `minigameThemes` untuk Whack-a-Mole, Ketapel, Cocokkan Kartu, Tebak Lokasi; `requires` per minigame di §6.2 #5; v0.3, CP3a) · Kembali ke [GDD](gdd.md) · Requirement: R1, R4, R5, R6, R6.1, M2, Q1

## 1. Graph region

10 node, 3 titik cabang (Sabang, Jakarta, Toraja), 6 rute. **Panjang rute** = jumlah region yang dilewati setelah start, **termasuk finish**: semua rute 5–6 region (R6).
- **Start (Sabang):** tidak ada minigame; semua pion mulai di sini.
- **Finish (Merauke):** **tidak ada minigame; mencapainya = menang** (R1, D-004, sesuai scaffold engineer). Jadi jumlah region yang *dimainkan* per rute = panjang rute − 1 (4–5).
- **Edge satu arah (DAG):** graph berarah tanpa siklus; tidak ada edge balik (D-003, sesuai scaffold engineer).

```
                         ┌─▶ Medan (kota, M) ──┐
 Sabang (START) ─────────┤                     ├─▶ Jakarta (kota, M) ─┬─▶ Yogyakarta (sawah, E) ─▶ Bali (pantai, E) ─┐
                         └─▶ Padang (gunung, H)┘                      │                                          ▼
                                                                      │                              Labuan Bajo (hutan, M) ─▶ Merauke (FINISH, tanpa minigame)
                                                                      │                                          ▲                       ▲
                                                                      └─▶ Toraja (gunung, H) ──────────────────────┤                       │
                                                                                     └──────────▶ Raja Ampat (laut, H) ──────────────────┘
```

Edge berarah (DAG, D-003): `sabang→medan`, `sabang→padang`, `medan→jakarta`, `padang→jakarta`, `jakarta→yogyakarta`, `jakarta→toraja`, `yogyakarta→bali`, `bali→labuan_bajo`, `toraja→labuan_bajo`, `toraja→raja_ampat`, `labuan_bajo→merauke`, `raja_ampat→merauke`.

### Aturan gerak (R6.1, DR-01, DR-05, DR-06; diterapkan oleh data + race layer)
State gerak per pemain: `nodeId` (region yang sudah dikuasai, awal = start), `targetId` (tetangga yang diincar, atau `null`), `winsAtTarget` (0..`winsRequired`).
- Pemain berdiri di `nodeId`. Ia memilih **satu region tetangga** (edge keluar) sebagai `targetId`, lalu menekan Mulai dan memainkan minigame target itu. Setiap win: `winsAtTarget + 1`. Saat `winsAtTarget = winsRequired` (**2**, diputuskan owner Q1): `nodeId = targetId`, `targetId = null`, `winsAtTarget = 0`, pion jalan ke region itu.
- **Region final** = region yang punya edge ke finish (Indonesia: Labuan Bajo, Raja Ampat). **Menang (DR-06):** tepat saat logic mencatat win ke-2 di region final, logic memancarkan event `playerFinished`; itu momen kemenangan. Sejak event itu semua input semua pemain dikunci. Animasi pion jalan ke finish (2 s) murni kosmetik dan tidak memengaruhi siapa juara. Finish sendiri tidak punya minigame (D-004).
- **Ganti target:** boleh kapan saja pemain di race view dan tidak sedang minigame, **termasuk saat cooldown**. `winsAtTarget` di target lama hangus (jadi 0). **Cooldown milik pemain, bukan target:** sisa cooldown tetap berjalan setelah ganti target (tidak bisa dipakai untuk kabur dari cooldown).
- **Ulang setelah gagal:** setelah cooldown habis, pemain harus menekan **Mulai** lagi; tidak ada mulai otomatis.
- Tidak ada edge balik → tidak bisa mundur. Tidak bisa melompati region kecuali dengan kartu Tiket Pesawat ([cards.md](cards.md); tidak boleh untuk region final, D-009).
- Banyak pemain boleh berada/mengincar region yang sama; tiap pemain main minigame sendiri.

### Jarak ke finish dan `remainingWins` (DR-07)
`playDist(n)` = jumlah region yang masih harus **dimainkan** dari region `n` ke finish lewat jalur terpendek (`n` sendiri dan finish tidak dihitung). Rumus `remainingWins` ada di [GDD](gdd.md#aturan-menangkalah). Nilai untuk Indonesia (`winsRequired` = 2), dipakai sebagai data test:

| Node | `playDist` | `remainingWins` saat berdiri di node tanpa win parsial |
|---|---|---|
| sabang | 4 | 8 (= `total` HUD) |
| medan, padang | 3 | 6 |
| jakarta | 2 | 4 |
| yogyakarta | 2 | 4 |
| toraja | 1 | 2 |
| bali | 1 | 2 |
| labuan_bajo, raja_ampat | 0 | 0 (sudah menang) |
| merauke | — | — (finish) |

Contoh dengan win parsial: di Jakarta, target Toraja, 1 win → min(2×1 + 1, 2×2) = **3**. Di Jakarta, target Yogyakarta, 1 win → min(2×2 + 1, 2×2) = **4** (jalur Yogyakarta lebih panjang, jadi win parsial di sana tidak mengurangi). Di Bali, target Labuan Bajo, 1 win → min(0 + 1, 2) = **1**.

## 2. Tipe region

| Tipe | Difficulty (M2) | Cooldown gagal (R2) | Kartu per win (K1) | Nuansa visual |
|---|---|---|---|---|
| `pantai` | easy | 8 s | 1 | pasir, kelapa, air toska |
| `sawah` | easy | 8 s | 1 | petak hijau bertingkat |
| `kota` | medium | 6 s | 2 | gedung kotak warna-warni, jalan |
| `hutan` | medium | 6 s | 2 | pohon bulat, savana, satwa |
| `gunung` | hard | 4 s | 3 | puncak bersalju/berkabut, tebing |
| `laut` | hard | 4 s | 3 | pulau karst kecil di laut dalam |

(Cooldown dan kartu mengikuti difficulty *efektif* setelah kartu, D-002.)

## 3. Region

| id | Nama | Tipe | Difficulty | Peran |
|---|---|---|---|---|
| `sabang` | Sabang | pantai | — | START |
| `medan` | Medan | kota | medium | cabang 1, opsi aman |
| `padang` | Padang | gunung | hard | cabang 1, opsi berisiko |
| `jakarta` | Jakarta | kota | medium | titik temu semua pemain |
| `yogyakarta` | Yogyakarta | sawah | easy | rute Jawa–Nusa |
| `bali` | Bali | pantai | easy | rute Jawa–Nusa |
| `toraja` | Toraja | gunung | hard | cabang 3 |
| `labuan_bajo` | Labuan Bajo | hutan | medium | titik temu rute A & C |
| `raja_ampat` | Raja Ampat | laut | hard | rute B |
| `merauke` | Merauke | hutan (hanya visual) | — | FINISH, tanpa minigame |

## 4. Rute dan trade-off

Setelah cabang 1 (Medan atau Padang) dan Jakarta, ada 3 rute ke Merauke:

| Rute | Region setelah Jakarta | Panjang rute (dimainkan) | Profil difficulty setelah Jakarta | Kartu setelah Jakarta | Cocok untuk |
|---|---|---|---|---|---|
| **A — Jawa–Nusa** | Yogyakarta → Bali → Labuan Bajo → Merauke | 6 (5) | E, E, M | 8 | Pemain aman: peluang lulus tinggi, tapi cooldown panjang bila gagal dan kartu sedikit |
| **B — Timur Jauh** | Toraja → Raja Ampat → Merauke | 5 (4) | H, H | 12 | Pemain jago: rute terpendek, cooldown pendek, kartu paling banyak (lebih banyak sabotase) |
| **C — Silang** | Toraja → Labuan Bajo → Merauke | 5 (4) | H, M | 10 | Tengah: satu region hard lalu medium; bisa "kabur" ke Labuan Bajo setelah Toraja |

Cabang 1: **Medan** (M, 4 kartu) vs **Padang** (H, 6 kartu, cooldown 4 s). Panjang sama, bedanya risiko vs hadiah.

Kartu dihitung `winsRequired (2) × N per win`, plus 4 atau 6 dari cabang 1 dan 4 dari Jakarta. Di region terakhir sebelum finish, hanya win pertama yang memberi kartu (berguna untuk sabotase/defensif); win kedua langsung membawa pemain ke finish, jadi layar kartunya dilewati ([ui-flow.md](ui-flow.md#10-finish), C-3). Kolom "Kartu setelah Jakarta" di atas belum memperhitungkan ini; kartu yang benar-benar diterima: A 6, B 9, C 8.

Catatan desain:
- **Jakarta** adalah titik temu wajib: pemain bisa melihat posisi satu sama lain, momen sabotase paling ramai.
- **Labuan Bajo** adalah titik temu kedua (A dan C), memberi kesempatan menyalip lewat C.
- Region terakhir (Labuan Bajo atau Raja Ampat) adalah "final" sebenarnya: siapa pun yang menyelesaikan 2 win di sana menang. Momen sabotase paling penting terjadi di sini.
- Pacing rute A: M/H → M → E → E → M (istirahat di tengah, naik lagi di final). Rute B: M/H → M → H → H (puncak di final; risiko tinggi, cooldown 4 s).
- Tidak ada rute yang mendominasi untuk semua pemain (lihat §5): C tercepat untuk pemain kasual, A paling stabil (variansi terendah), B tercepat untuk pemain dengan peluang lulus hard ≥ 60%.

## 5. Estimasi durasi

Asumsi `[ASSUMPTION]`: 1 percobaan = intro 3 s + rata-rata 22 s main + hasil 2 s = 27 s; peluang lulus pemain kasual easy 80% / medium 60% / hard 40%; pilih kartu 6 s per win; jalan 3 s per region.

| Difficulty | Waktu rata-rata per win | Per region (2 win) |
|---|---|---|
| easy | 27/0,8 + 0,25×12 + 6 ≈ 43 s | ≈ 86 s |
| medium | 27/0,6 + 0,67×8 + 6 ≈ 56 s | ≈ 112 s |
| hard | 27/0,4 + 1,5×4 + 6 ≈ 80 s | ≈ 159 s |

Finish tanpa minigame (D-004), jadi hanya region yang dimainkan yang dihitung; jalan 3 s per region termasuk langkah ke finish.

| Rute (via Medan) | Estimasi murni | + overhead kartu/sabotase ~20% |
|---|---|---|
| A | 112+112+86+86+112 + 18 ≈ 526 s | ≈ 10,5 menit |
| B | 112+112+159+159 + 15 ≈ 557 s | ≈ 11,1 menit |
| C | 112+112+159+112 + 15 ≈ 510 s | ≈ 10,2 menit |

Pemain jago (hard 60%: ≈ 107 s/region) di rute B ≈ 9 menit. Lewat Padang (bukan Medan) +47 s untuk pemain kasual.

**Target durasi (C-1, diputuskan owner):** Standard = **median ≈ 10–13 menit**, dituning di playtest (CP6). Graph ini tetap (10 node); estimasi di atas (≈ 10–11 menit) masuk rentang. Tuas tuning: pass rate lewat knob minigame, cooldown (R2), durasi minigame (15–30 s). Asumsi waktu di tabel ini akan diperbarui di CP6 (DR-14).

## 6. Format data peta (map-agnostic)

Satu file per peta: **`public/maps/<mapId>/map.json`** (final, DR-03). Kode **tidak boleh** berisi id region, nama, atau aset khusus peta; semuanya dari file ini (R4). Skema ini satu-satunya skema peta (DR-03): `regions`, `position {x, z}`, `presets` dengan satu `finish`, graph DAG. **Tidak ada `twoWay`**: setiap edge satu arah; jalan dua arah tidak ada di game ini.

### 6.1 Skema

```ts
interface MapData {
  schemaVersion: 1;
  id: string;                         // "indonesia"
  name: Record<string, string>;       // { id: "Indonesia", en: "Indonesia" } → judul "Atlas Dash: Indonesia"
  theme: {
    palette: { sky: string; sea: string; ground: string; accent: string; accent2: string };
    music: string;                    // key audio
    boardModel?: string;              // GLB dasar laut/papan
  };
  regionTypes: Record<string, {
    difficulty: 'easy' | 'medium' | 'hard';
    name: Record<string, string>;
    tileModel: string;                // GLB pulau/diorama per tipe
  }>;
  regions: Array<{
    id: string; name: Record<string, string>; type: string;   // key ke regionTypes
    position: { x: number; z: number };                       // koordinat papan 0..100 × 0..40
    landmarkModel?: string;                                   // prop ikonik di atas tile
  }>;
  edges: Array<{ from: string; to: string }>;                 // satu arah: from → to (DAG)
  presets: Record<'short' | 'standard' | 'long', {
    enabled: boolean;
    start: string;                    // tanpa minigame, titik mulai semua pion
    finish: string;                   // tanpa minigame; mencapainya = menang
    winsRequired: number;
    routeLength: { min: number; max: number }; // region yang dilewati setelah start, TERMASUK finish
  }>;
  places: Array<{                      // untuk Tebak Lokasi (soal) dan ikon kartu Cocokkan Kartu
    id: string; name: Record<string, string>; regionId: string;
    image: string;                    // ilustrasi soal Tebak Lokasi (webp, rasio 4:3)
    icon: string;                     // ikon kecil landmark (png, dipakai juga di daftar ikon memory_match bila disebut di sana)
    hint: Record<string, string>;     // petunjuk teks level medium; tidak boleh menyebut nama place/region
  }>;
  minigameThemes: Record<string, Record<string, string | string[]>>; // per minigame id; key per minigame di bawah
  // dodge_runner:  { obstacles: string[] }                          // ≥ 3 id prop
  // whack_a_mole:  { target: string; decoy: string }                // id karakter
  // slingshot:     { targets: string[]; platforms?: string[] }      // ≥ 2 skin target; platform diorama opsional
  // memory_match:  { icons: string[]; iconGroups: string[] }        // iconGroups[i] = kelompok warna icons[i], sepanjang icons
  // tap_timing, simon, guess_location: tidak punya tema (guess_location memakai places)
  cardSkins?: Record<string, { nameKey?: string; icon?: string }>;     // opsional
}
```

### 6.2 Validasi saat load (gagal = peta tidak bisa dipilih, error jelas di console)
1. Semua `edges` menunjuk region yang ada; graph tidak punya siklus (DAG).
2. Untuk tiap preset aktif, dicek pada subgraph yang terjangkau dari `start` (edge yang masuk ke `start` diabaikan, sehingga preset Short yang mulai di Jakarta tetap valid): setiap region terjangkau bisa mencapai `finish` (tidak ada jalan buntu), `finish` tidak punya edge keluar, tidak ada edge langsung `start → finish`, dan **setiap** jalur start→finish punya panjang (start tidak dihitung, finish dihitung) dalam `routeLength`.
3. Ada ≥ 2 region dengan ≥ 2 edge keluar (titik cabang, R6).
4. Tiap `places[].regionId` valid dan `id` place unik. (Jumlah minimum place dicek oleh `requires` Tebak Lokasi di butir 5, bukan penolakan peta: peta kecil tetap valid, hanya tanpa Tebak Lokasi.)
5. Tiap `region.type` ada di `regionTypes`. **Setiap minigame memeriksa data miliknya lewat `requires(map)` (DR-44); minigame yang gagal tidak masuk pool, peta tidak ditolak** (peta ditolak hanya bila pool kosong atau tidak memuat `tap_timing`, minigames.md §1.3):

   | Minigame | `requires` |
   |---|---|
   | `tap_timing`, `simon` | tidak ada |
   | `dodge_runner` | `minigameThemes.dodge_runner.obstacles` ≥ 3 id |
   | `whack_a_mole` | `minigameThemes.whack_a_mole.target` dan `.decoy` ada |
   | `slingshot` | `minigameThemes.slingshot.targets` ≥ 2 id (`platforms` opsional, bila tidak ada pakai platform generik) |
   | `memory_match` | `minigameThemes.memory_match.icons` ≥ 12 id dan `iconGroups.length === icons.length` |
   | `guess_location` | `places.length ≥ 10` dan place tersebar di ≥ 7 region berbeda (7 soal dengan region berbeda bila `extraTarget` +2; sebelumnya ≥ 8 di ≥ 5, minigames.md v0.5) |
6. Semua file aset yang disebut (`image`, `icon`, `icons[]`, id karakter/prop) harus ada; id model/prop yang tidak ditemukan membuat minigame terkait gagal `requires` dengan log (bukan crash).

### 6.3 Indonesia (isi MVP)

```json
{
  "schemaVersion": 1,
  "id": "indonesia",
  "name": { "id": "Indonesia", "en": "Indonesia" },
  "theme": {
    "palette": { "sky": "#8FD8FF", "sea": "#2EC4D6", "ground": "#F6E7B0", "accent": "#E8413C", "accent2": "#FFFFFF" },
    "music": "music_indonesia_race"
  },
  "regionTypes": {
    "pantai": { "difficulty": "easy",   "name": { "id": "Pantai" }, "tileModel": "tile_beach" },
    "sawah":  { "difficulty": "easy",   "name": { "id": "Sawah" },  "tileModel": "tile_ricefield" },
    "kota":   { "difficulty": "medium", "name": { "id": "Kota" },   "tileModel": "tile_city" },
    "hutan":  { "difficulty": "medium", "name": { "id": "Hutan" },  "tileModel": "tile_forest" },
    "gunung": { "difficulty": "hard",   "name": { "id": "Gunung" }, "tileModel": "tile_mountain" },
    "laut":   { "difficulty": "hard",   "name": { "id": "Laut" },   "tileModel": "tile_sea_karst" }
  },
  "regions": [
    { "id": "sabang",      "name": { "id": "Sabang" },      "type": "pantai", "position": { "x": 2,  "z": 6 },  "landmarkModel": "lm_km0" },
    { "id": "medan",       "name": { "id": "Medan" },       "type": "kota",   "position": { "x": 12, "z": 10 }, "landmarkModel": "lm_maimun" },
    { "id": "padang",      "name": { "id": "Padang" },      "type": "gunung", "position": { "x": 15, "z": 22 }, "landmarkModel": "lm_jam_gadang" },
    { "id": "jakarta",     "name": { "id": "Jakarta" },     "type": "kota",   "position": { "x": 34, "z": 30 }, "landmarkModel": "lm_monas" },
    { "id": "yogyakarta",  "name": { "id": "Yogyakarta" },  "type": "sawah",  "position": { "x": 43, "z": 34 }, "landmarkModel": "lm_tugu_jogja" },
    { "id": "bali",        "name": { "id": "Bali" },        "type": "pantai", "position": { "x": 53, "z": 35 }, "landmarkModel": "lm_tanah_lot" },
    { "id": "toraja",      "name": { "id": "Toraja" },      "type": "gunung", "position": { "x": 58, "z": 20 }, "landmarkModel": "lm_tongkonan" },
    { "id": "labuan_bajo", "name": { "id": "Labuan Bajo" }, "type": "hutan",  "position": { "x": 62, "z": 34 }, "landmarkModel": "lm_komodo" },
    { "id": "raja_ampat",  "name": { "id": "Raja Ampat" },  "type": "laut",   "position": { "x": 80, "z": 12 }, "landmarkModel": "lm_piaynemo" },
    { "id": "merauke",     "name": { "id": "Merauke" },     "type": "hutan",  "position": { "x": 96, "z": 32 }, "landmarkModel": "lm_musamus" }
  ],
  "edges": [
    { "from": "sabang", "to": "medan" },      { "from": "sabang", "to": "padang" },
    { "from": "medan", "to": "jakarta" },     { "from": "padang", "to": "jakarta" },
    { "from": "jakarta", "to": "yogyakarta" },{ "from": "jakarta", "to": "toraja" },
    { "from": "yogyakarta", "to": "bali" },   { "from": "bali", "to": "labuan_bajo" },
    { "from": "toraja", "to": "labuan_bajo" },{ "from": "toraja", "to": "raja_ampat" },
    { "from": "labuan_bajo", "to": "merauke" },{ "from": "raja_ampat", "to": "merauke" }
  ],
  "presets": {
    "short":    { "enabled": false, "start": "jakarta", "finish": "merauke", "winsRequired": 2, "routeLength": { "min": 3, "max": 4 } },
    "standard": { "enabled": true,  "start": "sabang",  "finish": "merauke", "winsRequired": 2, "routeLength": { "min": 5, "max": 6 } },
    "long":     { "enabled": false, "start": "sabang",  "finish": "merauke", "winsRequired": 2, "routeLength": { "min": 5, "max": 6 } }
  },
  "places": [
    { "id": "tugu_km0",      "regionId": "sabang",      "name": { "id": "Tugu Kilometer Nol" }, "hint": { "id": "Titik paling barat negeri ini" },      "image": "places/tugu_km0.webp",      "icon": "icons/tugu_km0.png" },
    { "id": "istana_maimun", "regionId": "medan",       "name": { "id": "Istana Maimun" },      "hint": { "id": "Istana kuning Kesultanan Deli" },      "image": "places/istana_maimun.webp", "icon": "icons/istana_maimun.png" },
    { "id": "jam_gadang",    "regionId": "padang",      "name": { "id": "Jam Gadang" },         "hint": { "id": "Menara jam besar di dataran tinggi" }, "image": "places/jam_gadang.webp",    "icon": "icons/jam_gadang.png" },
    { "id": "rumah_gadang",  "regionId": "padang",      "name": { "id": "Rumah Gadang" },       "hint": { "id": "Atap runcing seperti tanduk kerbau" }, "image": "places/rumah_gadang.webp",  "icon": "icons/rumah_gadang.png" },
    { "id": "monas",         "regionId": "jakarta",     "name": { "id": "Monas" },              "hint": { "id": "Tugu tinggi berpuncak emas" },         "image": "places/monas.webp",         "icon": "icons/monas.png" },
    { "id": "tugu_jogja",    "regionId": "yogyakarta",  "name": { "id": "Tugu Yogyakarta" },    "hint": { "id": "Tugu putih di tengah perempatan" },    "image": "places/tugu_jogja.webp",    "icon": "icons/tugu_jogja.png" },
    { "id": "malioboro",     "regionId": "yogyakarta",  "name": { "id": "Malioboro" },          "hint": { "id": "Jalan belanja penuh andong" },         "image": "places/malioboro.webp",     "icon": "icons/malioboro.png" },
    { "id": "tanah_lot",     "regionId": "bali",        "name": { "id": "Tanah Lot" },          "hint": { "id": "Pura di atas batu karang laut" },      "image": "places/tanah_lot.webp",     "icon": "icons/tanah_lot.png" },
    { "id": "tongkonan",     "regionId": "toraja",      "name": { "id": "Tongkonan" },          "hint": { "id": "Rumah adat beratap seperti perahu" },  "image": "places/tongkonan.webp",     "icon": "icons/tongkonan.png" },
    { "id": "komodo",        "regionId": "labuan_bajo", "name": { "id": "Pulau Komodo" },       "hint": { "id": "Rumah kadal terbesar di dunia" },      "image": "places/komodo.webp",        "icon": "icons/komodo.png" },
    { "id": "pulau_padar",   "regionId": "labuan_bajo", "name": { "id": "Pulau Padar" },        "hint": { "id": "Bukit dengan tiga teluk berbeda warna" }, "image": "places/pulau_padar.webp", "icon": "icons/pulau_padar.png" },
    { "id": "piaynemo",      "regionId": "raja_ampat",  "name": { "id": "Piaynemo" },           "hint": { "id": "Gugusan pulau karst di laut biru" },   "image": "places/piaynemo.webp",      "icon": "icons/piaynemo.png" },
    { "id": "musamus",       "regionId": "merauke",     "name": { "id": "Musamus" },            "hint": { "id": "Rumah semut setinggi orang dewasa" },  "image": "places/musamus.webp",       "icon": "icons/musamus.png" }
  ],
  "minigameThemes": {
    "dodge_runner":  { "obstacles": ["prop_becak", "prop_bajaj", "prop_gerobak_bakso", "prop_ayam", "prop_durian"] },
    "whack_a_mole":  { "target": "char_tikus_sawah", "decoy": "char_kucing_oren" },
    "slingshot":     { "targets": ["prop_kelapa", "prop_kendi", "prop_layangan"], "platforms": ["prop_menara_balok", "prop_atap_genteng", "prop_pohon_kelapa"] },
    "memory_match":  {
      "icons":      ["icons/rendang.png", "icons/sate.png", "icons/nasi_goreng.png", "icons/bakso.png", "icons/es_kelapa.png", "icons/wayang.png",
                     "icons/tugu_jogja.png", "icons/monas.png", "icons/istana_maimun.png", "icons/tanah_lot.png", "icons/piaynemo.png", "icons/komodo.png",
                     "icons/tongkonan.png", "icons/jam_gadang.png"],
      "iconGroups": ["cokelat", "cokelat", "cokelat", "kuning", "hijau", "merah",
                     "putih", "kuning", "kuning", "biru", "biru", "hijau",
                     "merah", "putih"]
    }
  }
}
```

**Data minigame CP5b (ringkasan untuk Engineer dan Art):**
- **Tebak Lokasi:** 13 `places` di 10 region lolos `requires` (≥ 10 di ≥ 7). Tiap region punya ≥ 1 place sehingga 7 soal region-berbeda selalu mungkin. Kunci bahasa `name`/`hint` mengikuti fallback `id` (DR-45). `hint` tidak boleh memuat nama place atau region; aturan data untuk peta baru.
- **Whack-a-Mole:** `target` dan `decoy` masing-masing 1 karakter (siluet berbeda, 1 pose idle + 1 pose dipukul); tidak perlu daftar karakter lain.
- **Ketapel:** 3 skin target + 3 platform. Platform diskalakan vertikal ke tinggi target (2–6 m), jadi harus berupa model yang tetap utuh bila ditarik (menara balok bertumpuk, batang pohon, atap di tiang).
- **Cocokkan Kartu:** 14 ikon dalam 6 kelompok warna: cokelat 3 (rendang, sate, nasi goreng), kuning 3 (bakso, monas, istana maimun), hijau 2 (es kelapa, komodo), merah 2 (wayang, tongkonan), biru 2 (tanah lot, piaynemo), putih 2 (tugu jogja, jam gadang). Ikon sekelompok **harus berbeda siluet**, bukan hanya warna (aksesibilitas). Kelompok menentukan "kartu mirip" turunan 0/2/4 pada 6/8/10 pasangan (minigames.md §7). Ikon landmark memakai file ikon place yang sama (`icons/<place>.png`), tidak ada aset ganda.
- **Peta baru (Jepang dst.):** wajib menyertakan semua key tema di atas bila ingin 7 minigame lengkap; key yang hilang hanya mengeluarkan minigame itu dari pool, tidak merusak peta.

Preset Short/Long hanya contoh agar sistem bisa diuji; tidak dipakai di MVP (R5). `short` (start Jakarta) punya jalur 3–4 region (termasuk finish). `long` di contoh ini masih memakai graph yang sama dan hanya placeholder; keputusan PM: Long nanti mendapat node tambahan (durasi diatur panjang rute, R5), bukan `winsRequired` lebih besar.

### 6.4 Menambah peta Jepang nanti
Cukup file `public/maps/japan/map.json` baru dengan `regionTypes` sendiri (mis. `onsen` easy, `kota` medium, `gunung` hard), `regions` (mis. Hokkaido → Okinawa), `places`, `minigameThemes` (rintangan: sepeda, rickshaw), dan palet. Tidak ada perubahan kode selain menambah entri di daftar peta. Model GLB baru (`tile_*`, `lm_*`, `prop_*`) mengikuti [art-style.md](art-style.md).

## Keputusan (CP2)
- Owner: 2 win per region (Q1).
- PM: edge satu arah/DAG dan finish tanpa minigame (sesuai scaffold engineer, D-003/D-004); ganti target setelah gagal, win parsial hangus; Toraja sebagai node Sulawesi; Long nanti ditambah node; `places` berupa ilustrasi low-poly buatan sendiri.

- CP3a: model gerak target + 2 win (DR-01), cooldown tetap jalan saat ganti target + ulang lewat Mulai (DR-05), menang di event logic `playerFinished` (DR-06), skema peta final tanpa `twoWay` di `public/maps/<id>/` (DR-03), rumus `remainingWins` + tabel node (DR-07), target durasi median ≈ 10–13 menit (owner, C-1), Tiket Pesawat dilarang di region final (PM, C-2).

- CP5b (usulan Designer): `places` tidak lagi menolak peta; syarat jumlah dipindah ke `requires` Tebak Lokasi dan dinaikkan ke ≥ 10 di ≥ 7 region; `iconGroups` paralel di tema `memory_match` (14 ikon, 6 kelompok, DR-18); `platforms` opsional di tema `slingshot`; tabel `requires` per minigame di §6.2 #5 (DR-44). Validator di kode perlu disesuaikan (butir 4 dan 5 berubah).

Tidak ada open question tersisa di dokumen ini. Temuan QA lain untuk peta (DR-43–DR-45) dikerjakan di CP3b.
