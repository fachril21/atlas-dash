# Peta Indonesia + Format Data Peta

**Status:** designed · **Updated:** 2026-11-16 (v0.2, CP2) · Kembali ke [GDD](gdd.md) · Requirement: R1, R4, R5, R6, R6.1, M2, Q1

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

### Aturan gerak (R6.1, diterapkan oleh data + race layer)
- Pemain berdiri di region yang sudah dikuasai. Ia memilih **satu region tetangga** (edge keluar) sebagai target, lalu memainkan minigame target itu. Setelah `winsRequired` win (**2**, diputuskan owner Q1), pion masuk ke target.
- **Masuk finish:** bila region tempat pemain berdiri punya edge ke finish, pion otomatis jalan ke finish (animasi 2 s) tanpa minigame → pemain menang. (Di peta Indonesia, Labuan Bajo dan Raja Ampat hanya terhubung ke Merauke.) Aturan umum untuk peta lain: edge ke finish selalu dipilih otomatis, karena selalu yang terbaik.
- Tidak ada edge balik → tidak bisa mundur. Tidak bisa melompati region kecuali dengan kartu Tiket Pesawat ([cards.md](cards.md); tidak boleh untuk region yang punya edge ke finish, D-009).
- Setelah gagal, pemain boleh **ganti target** ke tetangga lain dari region yang sama; win parsial di target lama hangus (diputuskan PM).
- Banyak pemain boleh berada/mengincar region yang sama; tiap pemain main minigame sendiri.

## 2. Tipe region

| Tipe | Difficulty (M2) | Cooldown gagal (R2) | Kartu per win (K1) | Nuansa visual |
|---|---|---|---|---|
| `pantai` | easy | 12 s | 1 | pasir, kelapa, air toska |
| `sawah` | easy | 12 s | 1 | petak hijau bertingkat |
| `kota` | medium | 8 s | 2 | gedung kotak warna-warni, jalan |
| `hutan` | medium | 8 s | 2 | pohon bulat, savana, satwa |
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

**Konflik C-1 (PM/owner to confirm):** estimasi ini di bawah target Standard ≈ 15 menit (R5/Q1). Rekomendasi: biarkan graph seperti ini dan tuning di playtest M3 (pass rate nyata, durasi minigame, cooldown); estimasi ini kasar. Alternatif: tambah 1 node di tiap rute (graph 11–12 node, melewati "~9–10" R6), atau 3 win di region hard. Detail di [GDD](gdd.md#open-questions).

## 6. Format data peta (map-agnostic)

Satu file per peta: `public/maps/<mapId>/map.json` `[ASSUMPTION: path final ditentukan engineer]`. Kode **tidak boleh** berisi id region, nama, atau aset khusus peta; semuanya dari file ini (R4).

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
  places: Array<{                      // untuk Tebak Lokasi & Cocokkan Kartu
    id: string; name: Record<string, string>; regionId: string;
    image: string; icon: string; hint: Record<string, string>;
  }>;
  minigameThemes: Record<string, Record<string, string | string[]>>; // per minigame id
  cardSkins?: Record<string, { nameKey?: string; icon?: string }>;     // opsional
}
```

### 6.2 Validasi saat load (gagal = peta tidak bisa dipilih, error jelas di console)
1. Semua `edges` menunjuk region yang ada; graph tidak punya siklus (DAG).
2. Untuk tiap preset aktif: setiap region yang terjangkau dari `start` bisa mencapai `finish` (tidak ada jalan buntu), `finish` tidak punya edge keluar, `start` tidak punya edge masuk, dan **setiap** jalur start→finish punya panjang (start tidak dihitung, finish dihitung) dalam `routeLength`. Tidak boleh ada edge langsung `start → finish`.
3. Ada ≥ 2 region dengan ≥ 2 edge keluar (titik cabang, R6).
4. `places` ≥ 8 dan tersebar di ≥ 5 region (syarat Tebak Lokasi), tiap `regionId` valid.
5. Tiap `region.type` ada di `regionTypes`; tiap minigame di pool punya entri `minigameThemes` yang dibutuhkannya.

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
    "slingshot":     { "targets": ["prop_kelapa", "prop_kendi", "prop_layangan"] },
    "memory_match":  { "icons": ["icons/rendang.png", "icons/sate.png", "icons/nasi_goreng.png", "icons/bakso.png", "icons/es_kelapa.png", "icons/wayang.png"] }
  }
}
```

Preset Short/Long hanya contoh agar sistem bisa diuji; tidak dipakai di MVP (R5). `short` (start Jakarta) punya jalur 3–4 region (termasuk finish). `long` di contoh ini masih memakai graph yang sama dan hanya placeholder; keputusan PM: Long nanti mendapat node tambahan (durasi diatur panjang rute, R5), bukan `winsRequired` lebih besar.

### 6.4 Menambah peta Jepang nanti
Cukup file `public/maps/japan/map.json` baru dengan `regionTypes` sendiri (mis. `onsen` easy, `kota` medium, `gunung` hard), `regions` (mis. Hokkaido → Okinawa), `places`, `minigameThemes` (rintangan: sepeda, rickshaw), dan palet. Tidak ada perubahan kode selain menambah entri di daftar peta. Model GLB baru (`tile_*`, `lm_*`, `prop_*`) mengikuti [art-style.md](art-style.md).

## Keputusan (CP2)
- Owner: 2 win per region (Q1).
- PM: edge satu arah/DAG dan finish tanpa minigame (sesuai scaffold engineer, D-003/D-004); ganti target setelah gagal, win parsial hangus; Toraja sebagai node Sulawesi; Long nanti ditambah node; `places` berupa ilustrasi low-poly buatan sendiri.

## Open questions (PM/owner to confirm)
1. **C-1 Durasi:** estimasi Standard ≈ 10–11 menit setelah D-004, di bawah ≈ 15 menit (lihat §5).
2. **C-2 Tiket Pesawat di region terakhir** (D-009): rekomendasi dilarang untuk region yang punya edge ke finish.
