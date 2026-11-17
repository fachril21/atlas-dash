# Minigame — Spesifikasi MVP

**Status:** designed · **Version:** 0.5 · **Updated:** 2026-11-17 (v0.5, CP5b: Whack-a-Mole, Ketapel, Cocokkan Kartu, Tebak Lokasi dilengkapi setara 3 minigame pertama; DR-15, DR-17 (contoh), DR-18, DR-42, DR-44; data bot per minigame di §9; kriteria QA CP5b di §10. v0.4, CP3b: Simon + Hindari Rintangan dilengkapi setara Tap Tepat Waktu; DR-02 undian untuk pool 3, DR-16, DR-17, DR-19, DR-20, DR-44; v0.3 CP3a: DR-02, DR-04, DR-05, DR-17/20/21 untuk Tap Tepat Waktu) · Kembali ke [GDD](gdd.md) · Requirement: R2, R3, R7, M1, M2, K1

7 minigame MVP (R7). Semua angka adalah titik awal untuk playtest. Nilai cooldown (R2) dan jumlah kartu (K1) **tidak** didefinisikan di sini; itu milik race layer ([gdd.md](gdd.md), [cards.md](cards.md)).

## 1. Aturan umum

### 1.1 Alur satu percobaan (dikelola "minigame shell", bukan oleh tiap minigame)
0. **Mulai:** setiap percobaan (termasuk ulang setelah gagal) dimulai oleh pemain menekan **Mulai**, dan hanya bila cooldown pemain sudah habis (DR-05).
1. **Intro** ("aturan 3 detik"): 1 kalimat ≤ 8 kata + 1 animasi ikon yang memperagakan input + hitung mundur. **3 s** untuk percobaan pertama sebuah minigame hasil undian; **1,5 s** untuk percobaan ulang setelah gagal (minigame sama, lihat §1.3). Tidak ada tombol skip.
2. **Main:** timer bar di atas. Minigame selesai lebih awal saat pass terpenuhi, atau saat fail sudah pasti (nyawa habis, salah melebihi batas).
3. **Banner hasil 1,2 s:** "BERHASIL!" / "GAGAL". Lalu kembali ke race layer.

**Pause di dalam minigame:** `pause()` membekukan timer minigame dan semua gerak; shell menutup area main dengan overlay pause (konten tidak terlihat); waktu pause tidak dihitung di `timeTakenMs`. Pause saat intro membekukan hitung mundur intro. (Aturan pause di luar minigame: CP3b, DR-08.)

Durasi dasar 15–30 s. **Clamp oleh race layer:** race layer menjumlah semua `timeDelta` lalu meng-clamp-nya sehingga `durasi dasar + timeDelta` berada di **10–40 s**; minigame menerima `timeDelta` yang sudah di-clamp dan tidak meng-clamp lagi. Contoh Tap Tepat Waktu (dasar 20 s): 2× Jam Rusak (−10) → 10 s; 3× Jam Rusak tidak mungkin (maxStacks 2). Minigame dengan pemetaan `timeDelta` khusus (Hindari Rintangan, Tebak Lokasi) memakai nilai yang sudah di-clamp ini (DR-17).
**Urutan (DR-17):** (1) race layer menjumlah `timeDelta` lalu clamp sehingga dasar + total ∈ 10–40 s; (2) minigame menerapkan pemetaannya ke nilai itu; (3) perpanjangan durasi khusus minigame dari `extraTarget` ditambahkan **sesudahnya** dan tidak di-clamp lagi (Hindari Rintangan +5 s per count, Simon +4 s per count, Ketapel +4 s, Whack-a-Mole +3 s, Cocokkan Kartu +2 s; `extraTarget` total maks +2 per minigame). Contoh per minigame ada di §2–§8. Pengurangan durasi dari `speed` (Ketapel) berlaku di langkah (2), sebelum perpanjangan `extraTarget`.

### 1.2 Interface (TypeScript, dibangun engineer)

```ts
export type Difficulty = 'easy' | 'medium' | 'hard';

// Modifier yang sudah di-resolve oleh race layer dari kartu aktif.
// difficultyShift TIDAK dikirim: race layer sudah menerapkannya ke `difficulty`.
export type MinigameModifier =
  | { kind: 'timeDelta'; seconds: number }   // + atau − detik (Jam Pasir / Jam Rusak)
  | { kind: 'tolerance'; mult: number }      // >1 = lebih toleran (Zona Lebar)
  | { kind: 'speed'; mult: number }          // >1 = lebih cepat (Ngebut)
  | { kind: 'extraTarget'; count: number }   // syarat lulus +count (Tambah Beban)
  | { kind: 'fog' }                          // gangguan visual (Kabut Asap)
  | { kind: 'hint' };                        // bantuan (Teropong)

export interface MinigameContext {
  seed: number;                 // uint32 dari stream `minigameParams` (§1.2.1); SEMUA random lewat PRNG dari seed ini. Dilarang Math.random()
  difficulty: Difficulty;       // difficulty efektif
  modifiers: MinigameModifier[];
  map: MapData;                 // data peta aktif (lihat map-indonesia.md)
  regionId: string;             // region yang sedang diperebutkan (untuk tema)
  inputMode: 'touch' | 'mouse'; // dideteksi dari pointer event terakhir; dua-duanya harus selalu jalan
  settings: { reducedMotion: boolean; reducedFlash: boolean; sfxVolume: number };
}

export interface MinigameResult {
  passed: boolean;
  timeTakenMs: number;          // dari akhir intro sampai selesai, tanpa waktu pause
  progress: number;             // 0..1, seberapa dekat ke syarat lulus (untuk UI & analitik)
  reason: 'success' | 'timeout' | 'failLimit' | 'aborted';
}

export interface MinigameDefinition<Level = unknown, Input = unknown, State = unknown> {
  id: string;                   // 'tap_timing' | 'simon' | ...
  render: '2d' | '3d';
  introKey: string;             // key string kalimat aturan
  requires?: (map: MapData) => boolean; // cek data peta/tema miliknya sendiri (daftar di §9), mis. Tebak Lokasi butuh >= 10 places di >= 7 region
  // PURE (tanpa DOM/three.js, bisa dites di Vitest node):
  generateLevel(ctx: MinigameContext): Level;              // semua parameter run, dari seed + difficulty + modifiers
  initState(level: Level): State;
  step(level: Level, state: State, input: Input | null, tMs: number): State; // aturan main; tMs = waktu main sejak start
  result(level: Level, state: State): MinigameResult | null;                // null = belum selesai
  // Render (memakai hasil generateLevel/step, tidak membuat random sendiri):
  create(container: HTMLElement, ctx: MinigameContext, level: Level): MinigameInstance;
}

export interface MinigameInstance {
  start(): void;                // dipanggil shell setelah intro
  pause(): void;
  resume(): void;
  destroy(): void;              // lepas listener, dispose geometry/texture three.js
  onFinish(cb: (r: MinigameResult) => void): void; // dipanggil tepat sekali
}
```

Aturan kontrak:
- **Deterministik:** seed + difficulty + modifiers yang sama → `generateLevel` menghasilkan level yang sama; urutan input + waktu yang sama → `step`/`result` menghasilkan hasil yang sama.
- **Seed per percobaan:** lihat §1.2.1. Ulang setelah gagal = minigame sama, seed baru = parameter acak baru.
- **Input:** semua pakai Pointer Events (mouse + touch satu jalur). Keyboard opsional untuk desktop (tercantum per minigame). Target sentuh ≥ 48 px CSS.
- **2D** = overlay HTML/CSS (atau canvas 2D) di atas race view yang di-blur. **3D** = scene three.js terpisah yang dirender ke canvas yang sama selama minigame; race scene berhenti render.
- Modifier yang tidak dikenali sebuah minigame diabaikan dengan log warning (tidak crash).

#### 1.2.1 Stream RNG (DR-04, satu-satunya daftar)
Setiap stream adalah PRNG sendiri (mis. mulberry32) dengan seed `hash(matchSeed, playerId, label)`, jadi aksi pemain lain tidak pernah menggeser hasil pemain ini.

| Stream | `label` | Dipakai untuk |
|---|---|---|
| Pemilihan minigame | `minigamePick` | undian minigame per target (§1.3); satu tarikan per undian |
| Parameter minigame | `minigameParams:<targetId>:<attemptIndex>` | `ctx.seed` satu percobaan |
| Penawaran kartu | `cards` | 5 kartu tawaran ([cards.md](cards.md#3-rarity-dan-comeback-r8)) |
| Simulasi bot | `bot` | lulus/gagal + waktu bot (milik bot itu) |
| Copet / pantulan | `copet` | kartu yang dicuri; milik pemain yang mencuri (pada pantulan: milik pemilik Cermin Balik) |

- `attemptIndex` = jumlah percobaan pemain itu **pada target ini** sebelum percobaan sekarang (mulai 0), dihitung kumulatif per (pemain, target) dan tidak di-reset bila pemain ganti target lalu kembali.
- `Math.random()` hanya boleh dipakai sekali: membuat `matchSeed` saat match baru (DR-21). Semua random lain lewat stream di atas.

### 1.3 Pemilihan minigame (M2) dan percobaan ulang (DR-02)
- **Kapan diundi:** (a) saat target baru dipilih (region baru, atau ganti target), (b) tepat setelah sebuah win diproses (win ke-1 → ke-2 di target yang sama). **Tidak** diundi setelah gagal: percobaan berikutnya pada target yang sama = **minigame sama**, seed baru (`attemptIndex` + 1), intro 1,5 s. Hasil undian tidak ditampilkan di UI sebelum pemain menekan Mulai (supaya ganti target tidak bisa dipakai untuk "mengocok" minigame).
- **Algoritma undian (CP3b, DR-02; satu-satunya definisi):**
  1. `registry` = daftar minigame yang terdaftar di build, **berurutan tetap** seperti tabel §9 (CP3b: `tap_timing`, `simon`, `dodge_runner`; CP5b menambah di belakang: `whack_a_mole`, `slingshot`, `memory_match`, `guess_location`). Urutan ini tidak boleh berubah; undian bergantung padanya.
  2. `pool` = anggota `registry` yang `requires(map)` bernilai true (atau tidak punya `requires`). `requires` dievaluasi **sekali per peta**, level peta saja; spesifikasi ini tidak punya syarat per region. Urutan `pool` = urutan `registry`.
  3. `last` = `id` minigame terakhir yang **dimainkan** pemain itu (percobaan gagal dihitung), disimpan per pemain sepanjang match dan **tidak** di-reset saat ganti region atau target. Awal match: `last` kosong.
  4. `kandidat` = `pool` tanpa `last`. Bila `kandidat` kosong (pool hanya 1 minigame, atau `last` bukan anggota pool), `kandidat` = `pool`.
  5. Tarik **tepat satu** angka dari stream `minigamePick` pemain itu, dan **selalu** tarik walau `kandidat` hanya 1 (supaya jumlah tarikan = jumlah undian): `pick = kandidat[rng.int(kandidat.length)]`.
  6. Bila `pool` kosong, peta tidak valid (validator peta menolak, pool minimal harus berisi `tap_timing`).
- **Akibat:** pool 1 minigame → itu terus. Pool 2 → selang-seling ketat. Pool 3 (CP3b) → tiap undian memilih 1 dari 2 minigame lain, tiap kandidat peluang 50%; tiga minigame yang sama tidak mungkin muncul dua kali berturut-turut. **Pool 7 (CP5b, Indonesia) → tiap undian memilih 1 dari 6 minigame lain, tiap kandidat 1/6 (16,7%).** Win ke-2 di sebuah region selalu memakai minigame berbeda dari win ke-1.
- **Contoh:** `last = simon` → `kandidat = [tap_timing, dodge_runner]`, tarikan 0 → `tap_timing`, tarikan 1 → `dodge_runner` (pool 3). Pool 7, `last = slingshot` → `kandidat` = 6 lainnya menurut urutan registry. Setelah gagal di `tap_timing`, ulang memakai `tap_timing` lagi tanpa tarikan. Bila sebuah minigame tidak lolos `requires` pada peta aktif (mis. peta tanpa tema `slingshot`), ia tidak ada di `pool` dan `kandidat` tidak berubah.
- Difficulty = difficulty tipe region target ([map-indonesia.md](map-indonesia.md#2-tipe-region)), lalu digeser kartu (clamp easy..hard).
- Region start dan finish tidak pernah memanggil minigame (D-004); difficulty tipe region mereka diabaikan.

### 1.4 Feedback (game feel, dipakai semua minigame)

| Event | Tier | Isi |
|---|---|---|
| Aksi benar (tap kena, pad benar, pasangan cocok, target jatuh) | small–medium | SFX "ting" (pitch naik tiap combo +1 semitone, maks +6), pop scale 1.3→1.0 ease-out-back 0,18 s, 6–10 partikel confetti warna tema |
| Aksi salah / kena rintangan | small | SFX "bonk", shake trauma 0,2 (decay 1,2/s), flash merah tipis 0,1 s (reducedFlash: outline merah saja), vibrasi 40 ms di mobile bila didukung |
| Lulus | large | Hit-stop 0,1 s, confetti 30 partikel, banner "BERHASIL!" overshoot, fanfare 1,2 s |
| Gagal | medium | Layar desaturasi 0,3 s, banner "GAGAL" jatuh dengan bounce, SFX "wah-wah" pendek |
| Timer < 5 s | — | Timer bar berdenyut 2×/s + tik-tok; tidak ada shake |

Batas: hit-stop ≤ 0,15 s, flash ≤ 3×/detik, shake bisa diatur 0–100% di Pengaturan; `reducedMotion` mematikan shake dan zoom.

### 1.5 Pemetaan modifier umum
Setiap minigame mendefinisikan arti tiap modifier di tabelnya. Default bila tidak disebut:
- `timeDelta` → ubah durasi total.
- `tolerance` → perbesar zona/hitbox target pemain ×mult.
- `speed` → kalikan semua kecepatan/tempo ×mult. Tempo berupa **durasi** (waktu nyala, waktu muncul) dibagi mult; tempo berupa **interval/jeda** (spawn, jeda antar langkah) juga dibagi mult. Prinsip: mult > 1 selalu membuat minigame lebih sibuk, tidak pernah lebih sepi (DR-16). **Uji prinsip per minigame:** bila menaikkan frekuensi spawn justru memberi lebih banyak peluang (Whack-a-Mole), tempo dinaikkan lewat durasi tampil, bukan frekuensi; alasan tertulis di tabel minigame itu.
- `extraTarget` → syarat lulus +count.
- `fog` → overlay kabut putih 45% opacity, berputar pelan, menutupi ±40% area secara acak bergeser (reducedMotion: statis).
- `hint` → bantuan khusus per minigame.

---

## 2. Tap Tepat Waktu (`tap_timing`) — 2D
**Aturan 3 detik:** "Tap saat jarum di zona hijau!" (ikon: jarum lewat zona, jari tap).

- **Input:** tap/klik (pointerdown) di mana saja di area main; desktop juga Spasi (keydown, tanpa auto-repeat). Waktu input = timestamp event, bukan waktu frame berikutnya.
- **Aturan kena:** posisi jarum `p` (0..1, pusat jarum) pada waktu input; kena bila `zoneStart ≤ p ≤ zoneStart + zoneWidth` (batas inklusif). Selain itu = 1 miss.
- **Input lock:** 0,25 s setelah setiap tap (kena atau miss), input berikutnya diabaikan (bukan miss), supaya double-tap tidak jadi 2 miss.
- **Lulus:** kena zona sebanyak `hitsRequired` kali sebelum waktu habis. **Gagal** (`failLimit`) segera saat miss > `missesAllowed`; **gagal** (`timeout`) bila waktu habis. Setelah tiap kena, zona pindah ke posisi berikutnya dari daftar level. Jarum terus bergerak (tidak di-reset).
- **Durasi:** 20 s.
- **`progress`** = kena / `hitsRequired`. **`timeTakenMs`** = waktu saat kena terakhir (lulus) atau saat gagal.
- **Acak per run (semua di `generateLevel`):** daftar posisi zona (`hitsRequired` + 2 cadangan untuk extraTarget), masing-masing seluruhnya di dalam bar, `zoneStart` ∈ [0,05; 0,95 − zoneWidth], dan pusatnya berjarak ≥ 0,25 dari pusat zona sebelumnya; posisi awal jarum 0 atau 1 (arah ke tengah); faktor kecepatan ×U(0,9; 1,1) sekali per run.
- **Gerak jarum:** bolak-balik (memantul di 0 dan 1) dengan kecepatan tetap `needleSpeed` (lebar bar/s). Di hard, zona ikut bergerak bolak-balik di dalam batas [0,05; 0,95] dengan `zoneMoveSpeed`, arah awal acak.
- **Level (output `generateLevel`):** `{ durationMs, hitsRequired, missesAllowed, zoneWidth, needleSpeed, zoneMoveSpeed, zoneStarts[], needleStart, zoneDir, hint, fog[] }`.

| Knob | easy | medium | hard |
|---|---|---|---|
| hitsRequired | 3 | 3 | 3 |
| missesAllowed | 2 | 1 | 0 |
| lebar zona (% bar) | 22% | 15% | 9% |
| kecepatan jarum (lebar bar/s, bolak-balik) | 0,8 | 1,2 | 1,7 |
| zoneMoveSpeed (lebar bar/s) | 0 | 0 | 0,15 |

| Modifier | Efek |
|---|---|
| timeDelta | durasi ± detik (sudah di-clamp race layer, §1.1) |
| tolerance | lebar zona ×mult, maks 0,40 |
| speed | `needleSpeed` dan `zoneMoveSpeed` ×mult |
| extraTarget | hitsRequired +count (maks +2) |
| fog | kabut menutupi 2 potong bar (masing-masing 20%), pindah ke posisi acak berikutnya tiap 2 s (posisi dari `generateLevel`); kabut tidak pernah menutupi lebih dari 50% lebar zona. reducedMotion: kabut tidak berpindah |
| hint | zona bersinar + bunyi "tik" 0,15 s sebelum jarum masuk zona |

Di CP3a belum ada kartu, jadi `modifiers` selalu kosong; tabel di atas berlaku mulai CP4.

## 3. Simon (`simon`) — 2D
**Aturan 3 detik:** "Ulangi urutan warnanya!" (ikon: 2 pad menyala, jari menekan).

- **Input:** tap/klik pad (pointerdown; waktu input = timestamp event); desktop juga tombol 1–`padCount` (keydown, tanpa auto-repeat) dan R untuk "Ulang" (hint). Input hanya dihitung di fase **input**; saat playback atau jeda ronde, tap diabaikan (bukan mistake). Tap di luar pad diabaikan. Dua pointer bersamaan diproses berurutan menurut timestamp, masing-masing 1 input.
- **Pad:** `padCount` pad id 0..5; 4 pad = grid 2×2, 6 pad = grid 2×3 (portrait), tiap pad ≥ 48 px. Warna + bentuk + nada berbeda (bukan warna saja): 0 merah ●, 1 biru ■, 2 kuning ▲, 3 hijau ◆, 4 ungu ★, 5 oranye ⬢. Pad yang ditekan pemain menyala ≥ 0,15 s dengan nadanya.
- **Struktur ronde:** `sequence` (dibuat sekali di `generateLevel`, panjang = `targetLength`). Ronde `r` (mulai 0) memakai awalan `sequence[0 .. startLength + r)`. Alur satu ronde: jeda `roundDelayMs` (0,8 s) → **playback** (tiap langkah: nyala `flashMs`, lalu jeda `gapMs`) → **input** (pemain mengetik awalan dari langkah pertama). Ronde baru: `r + 1`.
- **Cek input:** langkah ke-`i` benar bila pad = `sequence[i]`. Salah = 1 mistake. **Idle:** bila tidak ada input selama `idleTimeoutMs` (3 s) sejak fase input mulai atau sejak input benar terakhir, itu juga 1 mistake (DR-19).
- **Setelah mistake** (salah atau idle, perlakuan sama): bunyi "bonk" + feedback, lalu ronde yang sama diulang dari awal (jeda 0,8 s, playback ulang urutan yang sama, input mulai dari langkah pertama). Mistake dihitung kumulatif sepanjang run, tidak di-reset antar ronde. **Gagal (`failLimit`)** segera saat `mistakes > mistakesAllowed` (hard: mistake pertama langsung gagal; tidak ada playback ulang).
- **Lulus:** semua ronde selesai sampai `targetLength` (input terakhir benar). **Gagal (`timeout`)** bila waktu habis sebelum itu. Input dengan `tMs ≥ durationMs` diabaikan; input terakhir yang benar pada `tMs < durationMs` tetap lulus.
- **Durasi:** 30 s, dihitung dari akhir intro; jeda ronde dan playback ikut dihitung. Pause membekukan semuanya, termasuk timer idle.
- **`progress`** = ronde selesai / total ronde (`targetLength − startLength + 1`). **`timeTakenMs`** = waktu input benar terakhir (lulus) atau waktu gagal.
- **Acak per run (semua di `generateLevel`):** `sequence` ditarik berurutan dari PRNG (jadi awalan sama untuk seed sama walau panjang berbeda): tiap langkah `rng.int(padCount)`; bila 2 langkah sebelumnya pad yang sama, tarik ulang dari pad lain (pad sama maks 2 berturut-turut). Hanya urutan yang acak; semua knob lain tetap.
- **Level (output `generateLevel`):** `{ durationMs, padCount, startLength, targetLength, sequence[], flashMs, gapMs, roundDelayMs, idleTimeoutMs, mistakesAllowed, replayAvailable, fog }`.

| Knob | easy | medium | hard |
|---|---|---|---|
| jumlah pad | 4 | 4 | 6 |
| startLength | 3 | 3 | 3 |
| targetLength | 4 | 5 | 6 |
| flashMs (waktu nyala per langkah) | 700 | 550 | 400 |
| gapMs (jeda antar langkah) | 150 | 150 | 150 |
| mistakesAllowed | 2 | 1 | 0 |
| roundDelayMs / idleTimeoutMs | 800 / 3000 | 800 / 3000 | 800 / 3000 |

**Anggaran waktu (alasan `targetLength` 4/5/6, bukan 5/6/7 seperti v0.2):** dengan 30 s, 7 langkah terakhir hard tidak muat. Perkiraan pemain kasual, input ≈ 0,60 / 0,50 / 0,45 s per langkah (easy/medium/hard): easy 3→4 = 7 langkah × 0,85 + 7 × 0,60 + 2 × 0,8 ≈ **11,8 s** (dua mistake pada ronde 4 menambah ≈ 13 s → ≈ 25 s); medium 3→5 = 12 × 0,70 + 12 × 0,50 + 3 × 0,8 ≈ **16,8 s** (+1 mistake di ronde 5 ≈ 23,6 s); hard 3→6 = 18 × 0,55 + 18 × 0,45 + 4 × 0,8 ≈ **21,2 s**. Semuanya muat di 30 s dengan sisa. Hard + 2× Jam Rusak (20 s) sengaja nyaris mustahil; dipantau di playtest.

| Modifier | Efek |
|---|---|
| timeDelta | durasi ± detik (sudah di-clamp race layer, §1.1). Contoh: 2× Jam Rusak → 20 s; 2× Jam Pasir → 40 s |
| tolerance | `idleTimeoutMs` ×mult (maks 6000); mult ≥ 1,3 juga `mistakesAllowed` +1 (sekali, tidak bertumpuk) |
| speed | `flashMs` ÷mult (min 200) dan `gapMs` ÷mult (min 80); `roundDelayMs` tetap |
| extraTarget | `targetLength` +count (maks +2) dan durasi +4 s per count (di luar clamp, §1.1) |
| fog | pad idle redup 50%, nyala pad 30% lebih lemah; nada tetap penuh (tidak mengubah aturan) |
| hint | `replayAvailable`: tombol "Ulang" (≥ 48 px) muncul di fase input; menekannya memutar ulang awalan ronde ini dengan tempo normal, lalu input mulai dari langkah pertama dan timer idle mulai ulang. Tidak dihitung mistake; sekali per minigame |

Di CP3b belum ada kartu, jadi `modifiers` selalu kosong; tabel modifier berlaku mulai CP4. `requires`: tidak ada (tidak memakai tema peta, DR-44).

## 4. Hindari Rintangan (`dodge_runner`) — 3D
**Aturan 3 detik:** "Geser kiri-kanan, hindari rintangan!" (ikon: pion pindah jalur, rintangan lewat).

- **Dunia:** 3 jalur (−1, 0, +1), pion mulai di jalur 0. Rintangan datang dalam **baris**; tiap baris menutup 1 atau 2 jalur dan **selalu menyisakan ≥ 1 jalur kosong**. Seluruh aturan tabrakan berbasis **waktu** (bukan posisi 3D), jadi bisa dites di Vitest node; kecepatan (m/s) hanya menentukan jarak visual `jarak = kecepatan × waktu`.
- **Input (semua menghasilkan `{ dir: −1 | +1, tMs }` ke `step`):**
  - Tap/klik: separuh kiri layar = −1, separuh kanan = +1. Swipe (pointer bergeser horizontal ≥ 24 px dan |dx| > |dy|): arah swipe.
  - **Satu gestur = tepat 1 pindah.** Gestur diputuskan pada yang lebih dulu: pergeseran ≥ 24 px (swipe), pointerup, atau 100 ms ditahan tanpa geser (tap). `tMs` = waktu keputusan itu. Pengenalan gestur ada di lapisan render; `step` hanya menerima `dir`.
  - Desktop: ←/→ atau A/D (keydown, tanpa auto-repeat). `touch-action: none` di area main.
  - Tiap pindah menggeser jalur target ±1 (dijepit −1..+1). Tween visual `laneChangeMs` = 120 ms; **jalur logis** pemain berganti pada `tMs + 60 ms`. Pindah beruntun diizinkan (tiap pindah dihitung terhadap jalur target terakhir); tidak ada input lock.
- **Tabrakan:** baris `k` punya waktu lewat `tHitMs`. Baris adalah **kena** bila di suatu waktu dalam `[tHitMs − hw, tHitMs + hw]` jalur logis pemain ∈ jalur tertutup baris itu (`hw` = `hitHalfWindowMs` = 150 ms). Baris dinilai saat `tMs ≥ tHitMs + hw`, dari riwayat pindah (timestamp), jadi hasil tidak bergantung frame rate. Kena = nyawa −1, lalu **i-frame** `iFrameMs`: baris yang jendelanya mulai di dalam i-frame tidak dihitung kena. Nyawa 0 = **gagal (`failLimit`)** saat itu juga.
- **Lulus:** bertahan sampai `durationMs` dengan nyawa > 0 (`reason: 'success'`; `'timeout'` tidak dipakai di minigame bertahan). Baris hanya dibuat bila `tHitMs + hw ≤ durationMs`, jadi tidak ada baris yang belum dinilai saat waktu habis.
- **`progress`** = `min(1, tMs / durationMs)`. **`timeTakenMs`** = `durationMs` bila lulus; bila gagal = waktu nyawa habis.
- **Durasi:** 20 s dari akhir intro (+ perpanjangan `extraTarget`, lihat tabel). Baris pertama lewat di `firstRowMs` = 2000 ms, lalu satu baris per `intervalMs`.
- **Acak per run (semua di `generateLevel`, ditarik berurutan per baris):** apakah baris 2-jalur (peluang tabel), jalur kosong (`rng.int(3)`), prop tiap jalur tertutup (`obstacles[rng.int(n)]`). **Aturan adil:** bila baris `k−1` dan `k` sama-sama 2-jalur, jalur kosong keduanya harus berjarak ≤ 1 jalur (pemain tidak perlu pindah 2 jalur dalam 1 interval); bila tidak, jalur kosong baris `k` diundi ulang dari jalur yang memenuhi.
- **Tema dari peta:** prop rintangan dari `map.minigameThemes.dodge_runner.obstacles` (Indonesia: becak, bajaj, gerobak bakso, ayam, durian). Jalan memakai warna tema region. `requires`: `obstacles` berisi ≥ 3 id (DR-44).
- Kamera: belakang-atas 30°, pion chibi di jalur tengah. Jarak lihat `visibleDistanceM` = 40 m.
- **Level (output `generateLevel`):** `{ durationMs, lives, iFrameMs, speedMps, intervalMs, firstRowMs, hitHalfWindowMs, laneChangeMs, rows[], visibleDistanceM, hintLeadMs }`, dengan `rows[i] = { tHitMs, blocked: number[], props: string[] }`.

| Knob | easy | medium | hard |
|---|---|---|---|
| nyawa | 3 | 2 | 1 |
| kecepatan (m/s, visual) | 6 | 8 | 10 |
| interval spawn baris (`intervalMs`) | 1200 | 900 | 650 |
| peluang baris 2-jalur | 0% | 20% | 40% |
| i-frame setelah kena (`iFrameMs`) | 1000 | 1000 | 0 (nyawa 1, tidak berlaku) |
| jumlah baris pada 20 s, `M` = 1 (`⌊(durasi − hw − firstRow) ÷ interval⌋ + 1`) | 15 | 20 | 28 |

**Pengali tempo `M`** (menggabungkan `speed` dan `timeDelta`, DR-16): `M = speedMult × (1 − 0,03 × Σ timeDelta detik)`, lalu dijepit ke **0,70–1,50**. Kecepatan efektif = kecepatan × `M`; `intervalMs` efektif = `intervalMs` ÷ `M` (baris datang **lebih sering** saat M > 1, jarak antar baris dalam meter tetap); `firstRowMs` tidak berubah. Mis. Ngebut ×1,25 di medium: 10 m/s, interval 720 ms.

| Modifier | Efek (khusus: minigame bertahan) |
|---|---|
| timeDelta | **tidak** ubah durasi; masuk ke `M`: tiap −1 s → +3%, tiap +1 s → −3% (supaya Jam Rusak tetap sabotase). Contoh (dasar 20 s, nilai sudah di-clamp §1.1): 1× Jam Rusak (−5) → `M` 1,15; 2× Jam Rusak (−10) → 1,30, durasi tetap 20 s |
| tolerance | `hitHalfWindowMs` ÷mult (min 60 ms) dan `iFrameMs` ×mult |
| speed | masuk ke `M` (kecepatan ×mult, **interval spawn ÷mult**) |
| extraTarget | nyawa −count (min 1); sisa count yang tidak terserap (nyawa sudah 1) menjadi durasi +5 s per count (di luar clamp §1.1). Contoh: hard +2 → nyawa 1, durasi 30 s; medium +2 → nyawa 1, durasi 25 s; easy +2 → nyawa 1, 20 s |
| fog | `visibleDistanceM` ×0,6 (24 m): rintangan baru terlihat 40% lebih dekat |
| hint | `hintLeadMs` = 500: bayangan baris muncul di jalan 0,5 s lebih awal (visual saja, tidak ubah aturan) |

Di CP3b belum ada kartu, jadi `modifiers` selalu kosong; tabel modifier berlaku mulai CP4. Cek konsistensi: 1× Jam Rusak = `M` 1,15 cocok dengan kartu ("kecepatan +15%", [cards.md](cards.md)).

## 5. Whack-a-Mole (`whack_a_mole`) — 2D
**Aturan 3 detik:** "Pukul yang muncul, jangan kucingnya!" (ikon: palu memukul karakter, kucing dicoret).

- **Model:** seluruh jadwal karakter dibuat sekali di `generateLevel`; aturan berbasis **waktu** (bukan frame, tanpa random saat main), jadi bisa dites di Vitest node. Spawn `k` = `{ tMs, hole, kind: 'target' | 'decoy', lifeMs }`. Karakter terlihat dan bisa dipukul selama `[tMs, tMs + lifeMs + graceMs)`; `graceMs` = 80 ms adalah kelonggaran latensi sentuh (secara visual karakter sudah turun).
- **Input:** tap/klik lubang (pointerdown; waktu = timestamp event) → `{ hole }`. Desktop opsional: papan tombol mengikuti letak grid: baris 1 `1 2 3 4`, baris 2 `Q W E R`, baris 3 `A S D F` (grid 3×3 memakai 3 kolom kiri). Tap di lubang kosong **diabaikan** (bukan salah). Dua pointer bersamaan diproses berurutan menurut timestamp. Tanpa input lock. Lubang ≥ 64 px; grid 4×3 di portrait ditata 3 kolom × 4 baris (indeks lubang tetap).
- **Pukulan kena** bila ada karakter hidup di lubang itu pada `tMs` input dan belum dipukul. Target: `hits + 1`, karakter hilang + "ting". Decoy: `decoyHits + 1`, karakter hilang + "bonk". Karakter yang tidak dipukul turun sendiri tanpa penalti. Spawn baru di lubang yang masih berisi karakter hidup (hanya mungkin bila waktu tampil diperpanjang kartu) menghapus karakter lama tanpa penalti.
- **Lulus:** `hits ≥ hitsRequired` pada `tMs < durationMs` (selesai segera). **Gagal (`failLimit`)** segera saat `decoyHits > decoyHitsAllowed`. **Gagal (`timeout`)** bila waktu habis.
- **Durasi:** 20 s dari akhir intro (+3 s per `extraTarget`). **`progress`** = min(1, `hits` / `hitsRequired`). **`timeTakenMs`** = waktu pukulan penentu (lulus), pukulan decoy fatal, atau `durationMs`.
- **Acak per run (semua di `generateLevel`, urutan tarikan tetap; DR-15):**
  1. Jumlah slot `S = ⌊(durationMs − firstSpawnMs − baseLifeMs) ÷ spawnIntervalMs⌋ + 1`; slot `k` mulai di `firstSpawnMs + k × spawnIntervalMs`. Jadwal hanya bergantung pada `difficulty` dan durasi (`extraTarget`), tidak pada modifier lain.
  2. `nDecoy = ⌊S × decoyRatio⌋`. Slot decoy: kocok slot 3..S−1 (Fisher-Yates seeded, `i` turun, `rng.int(0, i)`) lalu ambil `nDecoy` pertama. Tiga slot pertama selalu target (pemanasan).
  3. Per slot berurutan: `hole = allowed[rng.int(0, allowed.length − 1)]` dengan `allowed` = lubang yang tidak berisi karakter hidup pada `tMs` slot (dihitung dengan `baseLifeMs`) dan bukan lubang slot sebelumnya; lalu `lifeFactor = 0,85 + 0,30 × rng.next()` (±15%). Dua tarikan per slot.
  4. `fog[]` **terakhir** (jadwal tidak bergeser oleh kabut): tiap 3000 ms satu jendela `{ tMs, holes: 2 lubang berbeda }`; selalu ditarik walau `fog` mati.
  5. `lifeMs` tiap spawn = `clamp(baseLifeMs × lifeFactor × min(tolerance, 1,5) ÷ M, 350, 2500)`; `M` = pengali tempo (di bawah).
- **Jaminan lulus-mungkin (DR-15):** jumlah spawn target `S − nDecoy ≥ ⌈1,5 × hitsRequired⌉` untuk semua difficulty, dengan atau tanpa `extraTarget` (tabel di bawah). Jaring pengaman di `generateLevel`: bila tidak terpenuhi (data diubah), `hitsRequired` diturunkan ke `⌊(S − nDecoy) ÷ 1,5⌋` dan dicatat warning. Karena spawn tidak bergantung pada modifier tempo, jaminan tidak bisa dipatahkan kartu.
- **Tema dari peta:** karakter dari `map.minigameThemes.whack_a_mole` (`target`, `decoy`; Indonesia: tikus sawah chibi, kucing oren). `requires`: kedua key ada. Target dan decoy dibedakan **siluet + lencana ✕ merah di decoy + bunyi berbeda**, bukan warna saja.
- **Level (output `generateLevel`):** `{ durationMs, gridCols, gridRows, hitsRequired, decoyHitsAllowed, graceMs, hintLeadMs, spawns[], fog[] }`, dengan `spawns[i] = { tMs, hole, kind, lifeMs }`.

| Knob | easy | medium | hard |
|---|---|---|---|
| grid lubang (kolom × baris) | 3×3 | 3×3 | 4×3 |
| hitsRequired | 8 | 15 | 19 |
| `baseLifeMs` (waktu muncul dasar) | 1100 | 900 | 700 |
| `spawnIntervalMs` (jeda antar spawn) | 1250 | 650 | 480 |
| `firstSpawnMs` | 700 | 700 | 700 |
| proporsi decoy / `decoyHitsAllowed` | 0% / — | 15% / 2 | 25% / 1 |
| spawn `S` pada 20 s | 15 | 29 | 39 |
| decoy / **target spawn** `T` | 0 / 15 | 4 / 25 | 9 / 30 |
| batas jaminan `⌈1,5 × hitsRequired⌉` | 12 | 23 | 29 |
| rasio dibutuhkan `hitsRequired / T` | 53% | 60% | 63% |
| muncul bersamaan (turunan `⌈baseLife ÷ interval⌉`) | 1 | 2 | 2 |

Dengan `extraTarget` (hits +2 dan durasi +3 s per count): count 1 → easy 10 hits / T 17, medium 17 / 29, hard 21 / 35; count 2 → easy 12 / T 20, medium 19 / 33, hard 23 / 39; semuanya di atas ⌈1,5 × hits⌉ (15 / 26 / 32 dan 18 / 29 / 35). (Perubahan dari v0.4: hard maksimal 2 karakter bersamaan, bukan 3, karena jeda 480 ms; `waktu muncul` 1,2 s easy → 1,1 s.)

**Pengali tempo `M`** (sama dengan §4): `M = speedMult × (1 − 0,03 × Σ timeDelta detik)`, dijepit **0,70–1,50**; efek hanya pada `lifeMs`.

| Modifier | Efek (khusus: jadwal spawn tetap, hanya waktu tampil yang berubah) |
|---|---|
| timeDelta | **tidak** ubah durasi; masuk ke `M`: tiap −1 s → +3%, tiap +1 s → −3% (Jam Rusak −5 s → `lifeMs` ÷1,15; Jam Pasir +5 s → `lifeMs` ×1,18). Alasan: durasi lebih pendek dengan jadwal tetap bisa membuat target tak mungkin tercapai (DR-15); tempo tetap menjaga jaminan |
| tolerance | `lifeMs` ×mult (maks ×1,5) dan area sentuh lubang diperlebar sampai tepi sel (render) |
| speed | masuk ke `M` (`lifeMs` ÷mult). **Jeda spawn tidak ikut dibagi**: lebih banyak spawn di windows yang sama justru memberi lebih banyak peluang pukul, jadi Ngebut akan terasa sebagai boost (DR-16) |
| extraTarget | `hitsRequired` +2 per count, durasi +3 s per count (di luar clamp §1.1); `decoyHitsAllowed` tidak berubah |
| fog | 2 lubang tertutup kabut tiap 3 s (`fog[]`); karakter di bawahnya tetap bisa dipukul tapi tidak terlihat. Aturan tidak berubah; reducedMotion: kabut tidak berpindah |
| hint | `hintLeadMs` = 300: lubang bergetar 0,3 s sebelum karakter muncul (render; tidak ubah aturan) |

Contoh (medium, 1× Jam Rusak −5 s + Ngebut ×1,25): `M = 1,25 × 1,15 = 1,4375`, `lifeMs` rata-rata 900 ÷ 1,4375 ≈ 626 ms; durasi tetap 20 s; jadwal spawn sama persis dengan tanpa kartu.

**Aksesibilitas dan feel:** reducedMotion: karakter muncul/hilang dengan fade 80 ms (tanpa gerak naik-turun); reducedFlash: pukulan decoy memakai outline merah, bukan flash. Aksi benar: tier small (pop 1,3→1,0, confetti 6), decoy: bonk + shake 0,2 (§1.4). Tiap lubang punya `aria-label` "Lubang N" dan status "ada tikus"/"ada kucing" (live region ringkas, tidak per frame). Keyboard: grid tombol di atas; fokus keyboard terlihat.

## 6. Ketapel (`slingshot`) — 3D
**Aturan 3 detik:** "Tarik, bidik, lepas! Jatuhkan targetnya!" (ikon: tarik ketapel, batu terbang, target jatuh).

**Tanpa physics engine (keputusan CP2):** lintasan peluru adalah **rumus parabola tertutup** + hanyut angin konstan; tabrakan dicek dengan sampel waktu tetap, jadi hasil satu tembakan sepenuhnya ditentukan saat dilepas, tidak bergantung frame rate, dan bisa dites di Vitest node. "Jatuhnya" target adalah **animasi berskrip** (di render), bukan simulasi.

- **Koordinat (meter):** x kanan, y atas, z menjauh dari penembak. Penembak di `(0, 1,2, 0)`. Konstanta: gravitasi `g` = 14 (kartun, tembakan 1,1–2,0 s), `pitchDeg` = 40 (tetap), kecepatan `v = vMin + (vMax − vMin) × power` dengan `vMin` 12, `vMax` 22 m/s, `yawMaxDeg` = 25, radius peluru 0,15 m.
- **Lintasan** (waktu `t` detik sejak lepas, yaw `ψ`): `x = vh·sinψ·t + angin·t`, `y = 1,2 + v·sin40°·t − ½·g·t²`, `z = vh·cosψ·t`, dengan `vh = v·cos40°`. Penerbangan berakhir saat `y ≤ 0` (akar positif), maks `flightMaxMs` 3000.
- **Tabrakan:** sampel tiap 5 ms dari lepas; kena target pertama (yang belum jatuh) yang jaraknya ke pusat ≤ `hitRadiusM + 0,15`. Pusat target bergerak dihitung di waktu absolut `tRelease + t` (gelombang segitiga di bawah). Satu peluru menjatuhkan maks 1 target.
- **Input (semua menghasilkan `{ yawDeg, power }` ke `step`; fungsi murni `aimFromDrag` di logic):** tekan-tahan di ketapel atau di mana saja di separuh bawah layar, drag ke bawah/samping, lepas untuk tembak (mouse sama; Pointer Events). Panjang drag `d`; `maxDragPx` = 25% tinggi layar. `d < 20% × maxDragPx` (= 5% tinggi layar) → **batal**, peluru tidak terpakai. `power = min(1, d ÷ maxDragPx)` (0,20–1,00). Arah tembak = **berlawanan** dengan drag: `yawDeg = −clamp(atan2(dx, dy), ±25°)` untuk `dy > 0` (drag ke bawah); drag ke atas diperlakukan sebagai yaw maksimum searah `−dx`. Garis bidik hidup selama drag (panjang menurut knob). Drag bisa dibatalkan dengan menggeser kembali ke < 5% atau tombol Esc. **Keyboard (desktop):** ←/→ ubah yaw 1° per tekan (tahan = 30°/s), ↑/↓ ubah power 1% (tahan = 30%/s), Spasi/Enter tembak, Esc kembali ke nilai awal; garis bidik tampil selama menyetel. Awal tiap bidikan: yaw 0, power 50%.
- **Ritme tembakan:** satu peluru terbang pada satu waktu. Setelah mendarat ada `reloadMs` = 400. Input saat peluru terbang atau reload **diabaikan** (peluru tidak terpakai, bukan salah). Input dengan `tMs ≥ durationMs` diabaikan; tembakan yang dilepas sebelum `durationMs` tetap dinilai penuh (hasil bisa keluar setelah `durationMs`, maks 3 s, timer bar menunggu di 0).
- **Lulus:** `targetsDown ≥ targetsRequired`, dinilai saat peluru mendarat (`reason: 'success'`). **Gagal (`failLimit`)** begitu mustahil: peluru tersisa (termasuk yang terbang) `< targetsRequired − targetsDown`, atau peluru habis. **Gagal (`timeout`)** bila `tMs ≥ durationMs` tanpa peluru terbang dan belum lulus.
- **Durasi:** 30 s dari akhir intro. **`progress`** = `targetsDown / targetsRequired`. **`timeTakenMs`** = waktu pendaratan peluru penentu (lulus), saat gagal dipastikan, atau `durationMs`.
- **Target:** bola dengan skin dari `map.minigameThemes.slingshot.targets` duduk di atas **platform** diorama dari `…slingshot.platforms` (Indonesia: menara balok, atap genteng, pohon kelapa; bila `platforms` tidak ada, pakai balok generik). Tinggi platform = `y` target. Target yang kena **jatuh berskrip**: 700 ms (`fallMs`), miring 90° searah kecepatan peluru, `y` → tanah dengan ease-in + 1 pantulan kecil 12 cm, platform kehilangan bagian atas; tidak ada fisika. Pass dihitung saat pendaratan, bukan setelah animasi.
- **Acak per run (semua di `generateLevel`, urutan tarikan tetap) dan jaminan solvabel:** target **dibuat dari tembakan ideal**, jadi selalu ada bidikan yang mengenainya.
  1. `windSign = rng.int(0, 1)` (selalu ditarik); `windMps = ±magnitude × (windSign ? 1 : −1)`.
  2. Untuk tiap target `i` = 0..N−1, sampai 10 percobaan: `ideal.yawDeg = −18 + 36 × rng.next()`, `ideal.power = 0,45 + 0,45 × rng.next()`, `ideal.tFrac = 0,55 + 0,30 × rng.next()`, `skin = rng.int(0, targets.length − 1)`, `platform = rng.int(0, platforms.length − 1)` (atau 0), `phase = rng.next()`. Pusat target = posisi lintasan ideal (termasuk angin) pada `tFrac × T`. Terima bila jarak (bidang x-z) ke pusat target lain ≥ 4,0 m; percobaan ke-10 diterima apa adanya. Hasilnya tinggi `y` ≥ 2 m dan jarak `z` kira-kira 11–26 m.
  3. Target indeks `0 .. movingCount−1` **bergerak**: bolak-balik sepanjang x di sekitar pusat (setengah lintasan `halfM` = 1,5 m, kecepatan `moveSpeedMps`), offset(t) = gelombang segitiga: `s = kecepatan × t_detik + phase × 4 × halfM`, `u = s mod (4 × halfM)`, offset = `u < 2·halfM ? u − halfM : 3·halfM − u`. Target diam bila `movingCount` 0. Target bergerak yang kena berhenti di titik kena.
  4. Tembakan ideal disimpan di `level.targets[i].ideal` (**hanya untuk tes dan bot, tidak ditampilkan**): menembak `ideal` mengenai target `i` bila ia diam; untuk target bergerak, mengenai bila dilepas saat offset-nya ≈ 0 (≈ 53% waktu dalam `hitRadiusM` 0,8).
- **Level (output `generateLevel`):** `{ durationMs, bullets, targetsRequired, hitRadiusM, aimLineFrac, windMps, moveSpeedMps, movingCount, reloadMs, fallMs, fogDepthM, hitPreview, targets[] }`, dengan `targets[i] = { skin, platform, center {x,y,z}, halfM, phase, ideal {yawDeg, power, tFrac} }`. Fungsi murni lain: `aimFromDrag`, `simulateShot(level, aim, tReleaseMs)` → `{ flightMs, hitIndex | null }` (dipakai render untuk garis bidik dan `hint`, dan step untuk hasil).

| Knob | easy | medium | hard |
|---|---|---|---|
| targetsRequired / jumlah target | 3 / 4 | 4 / 5 | 5 / 6 |
| peluru | 6 | 6 | 6 |
| `hitRadiusM` (radius tabrak, lebih besar dari ukuran visual target ±0,5 m) | 1,5 | 1,1 | 0,8 |
| garis bidik (porsi panjang lintasan yang tampil) | 100% | 40% | 15% |
| angin samping `|windMps|` (m/s; indikator panah + angka selalu tampil) | 0 | 1 | 2 |
| target bergerak (`movingCount` @ `moveSpeedMps`) | 0 | 1 @ 0,6 | 2 @ 0,8 |

Anggaran waktu: satu siklus = bidik ≥ 1 s + terbang 1,1–2,0 s + reload 0,4 s ≈ 3–4 s, jadi 6 peluru ≈ 18–24 s dari 30 s.

| Modifier | Efek |
|---|---|
| timeDelta | durasi ± detik (sudah di-clamp race layer, §1.1). Contoh: 1× Jam Rusak → 25 s; 2× → 20 s (6 peluru nyaris tak muat, disengaja) |
| tolerance | `hitRadiusM` ×mult (maks 2,2 m) |
| speed | `moveSpeedMps` ×mult, `|windMps|` ×mult (maks 3), dan durasi `max(min(d, 15 s), d ÷ mult)` (Ngebut ×1,25 → 30 s jadi 24 s; hanya Ngebut yang memperpendek, tidak pernah di bawah 15 s). Pengurangan durasi membuat Ngebut berarti juga di easy yang tanpa angin dan tanpa target bergerak |
| extraTarget | jumlah target +count, `targetsRequired` +count, **peluru +count**, durasi +4 s per count (di luar clamp §1.1). Contoh hard +2: 8 target, 7 harus jatuh, 8 peluru, 38 s |
| fog | render: target dengan `z ≥ fogDepthM` (20 m) 50% transparan, siluet tetap digaris tepi; aturan tidak berubah |
| hint | `aimLineFrac` = 100% dan garis bidik **menjadi hijau** + target berdenyut bila bidikan sekarang mengenai target (dihitung `simulateShot`); angin tetap tampil seperti biasa |

**Aksesibilitas dan feel:** garis bidik dan panah angin tidak bergantung warna (garis putus-putus + angka m/s; hint hijau diberi ikon ✓); kamera belakang-atas, tidak berguncang saat membidik; tembakan: ayunan ketapel 120 ms, peluru dengan jejak; target jatuh = tier medium (hit-stop 0,05 s, 8 partikel; reducedMotion: tanpa hit-stop dan tanpa zoom); meleset ke tanah = "bonk" kecil tanpa shake. Mobile: area drag separuh bawah layar, ketapel besar ≥ 96 px, tidak ada elemen yang perlu pinch. Tes performa: p95 frame time ≤ 33,3 ms di HP acuan dengan 6 target + platform (DR-13); `destroy()` melepas geometri/tekstur.

## 7. Cocokkan Kartu (`memory_match`) — 2D
**Aturan 3 detik:** "Buka dua kartu, cari pasangannya!" (ikon: 2 kartu terbuka, sama, lalu hilang).

- **Input:** tap/klik kartu (pointerdown; waktu = timestamp event) → `{ card: index }`; tombol "Intip" (hint) → `{ peek: true }`. Desktop: papan kartu `role="grid"`, panah memindah fokus, Enter/Spasi membuka kartu (fokus keyboard terlihat). Area kartu ≥ 64 px. Tap pada kartu yang sudah terbuka/cocok **diabaikan**.
- **Fase preview:** `previewMs` pertama dari waktu main, semua kartu terbuka, input diabaikan (label "Hafalkan!"). **Preview tidak dihitung dalam `durationMs`**: timer bar mulai setelah preview; waktu nyata = `previewMs + durationMs`. `step` memakai `playMs = tMs − previewMs`.
- **Aturan buka:** kartu tertutup yang di-tap → terbuka (logika seketika; animasi putar `flipMs` = 200 ms hanya visual). Kartu ke-2 yang dibuka dibandingkan **seketika**: `faceId` sama → pasangan **cocok** (kartu redup/hilang, tidak bisa dibuka lagi); beda → **salah**, keduanya tetap terbuka sampai `closeAtMs = tMs + mismatchDelayMs` lalu menutup. **Peek-ahead:** bila saat jeda salah pemain mengetap kartu tertutup lain, kedua kartu salah menutup seketika dan kartu itu terbuka sebagai kartu pertama pasangan baru (jeda tidak memaksa menunggu). Tidak ada batas jumlah salah.
- **Lulus:** semua pasangan cocok pada `playMs < durationMs` (`reason: 'success'`). **Gagal:** hanya `timeout` (tidak ada `failLimit`). Input dengan `playMs ≥ durationMs` diabaikan.
- **Durasi:** 30 s (`durationMs`, +2 s per `extraTarget`), di luar preview. **`progress`** = pasangan cocok / `pairs`. **`timeTakenMs`** = `tMs` (termasuk preview) saat pasangan terakhir cocok, atau saat waktu habis.
- **Data peta (DR-18):** wajah kartu = `map.minigameThemes.memory_match.icons` (id ikon) dengan `iconGroups` **paralel** (`iconGroups[i]` = label kelompok warna `icons[i]`, mis. "cokelat"). Ikon sekelompok = "kartu mirip" (warna sama, siluet beda). `requires`: `icons.length ≥ 12` (cukup untuk 12 pasangan) dan `iconGroups.length === icons.length`. Ini satu-satunya minigame yang boleh menampilkan landmark sebagai ikon murni (tidak ada pertanyaan); untuk itu Indonesia memasukkan 8 ikon landmark ke daftar ikon (§ data di [map-indonesia.md](map-indonesia.md#63-indonesia-isi-mvp)).
- **Acak per run (semua di `generateLevel`, urutan tarikan tetap):**
  1. Kocok indeks `0..n−1` daftar ikon (Fisher-Yates seeded, `i` turun, `rng.int(0, i)`) → `order`.
  2. Pilih `pairs` ikon **bergiliran per kelompok**: `groups` = kelompok menurut kemunculan pertama di `order`; putaran `r` = 0,1,…: untuk tiap kelompok berurutan ambil anggota ke-`r` (menurut `order`) bila ada, sampai `pairs` terkumpul. Akibatnya pasangan mirip muncul hanya bila `pairs` > jumlah kelompok (turunan, bukan knob: Indonesia punya 6 kelompok → easy 0, medium 2, hard 4 kelompok yang berisi 2 ikon).
  3. Dek = tiap ikon terpilih 2 kali, kocok seluruhnya (Fisher-Yates seeded) → `cards[]` menurut indeks posisi.
- **Grid (DR-18):** `cols` = 3 bila `pairs` = 6, selain itu 4; `rows = ⌈2·pairs ÷ cols⌉`; baris terakhir yang tidak penuh dipusatkan. 6 → 3×4, 7 → 4×4 (baris akhir 2), 8 → 4×4, 9 → 4×5 (akhir 2), 10 → 4×5, 11 → 4×6 (akhir 2), 12 → 4×6. Mobile portrait ≥ 64 px per kartu di 390 px lebar (4 kolom: ±78 px). Landscape boleh mentranspose; indeks posisi tidak berubah.
- **Level (output `generateLevel`):** `{ durationMs, previewMs, pairs, cols, rows, cards[], flipMs, mismatchDelayMs, peekAvailable, peekMs, fog }`, dengan `cards[i]` = id ikon.

| Knob | easy | medium | hard |
|---|---|---|---|
| pasangan (grid) | 6 (3×4) | 8 (4×4) | 10 (4×5) |
| `previewMs` | 2000 | 1000 | 0 |
| `mismatchDelayMs` | 800 | 700 | 600 |
| `flipMs` | 200 | 200 | 200 |
| `durationMs` | 30000 | 30000 | 30000 |
| kartu mirip (turunan, peta Indonesia) | 0 | 2 | 4 |

Anggaran waktu: pemain kasual ≈ 1,0–1,6 s per percobaan pasang termasuk jeda salah, rata-rata ≈ 1,6 percobaan per pasangan (easy ≈ 9–10 percobaan ≈ 14 s; medium ≈ 13 ≈ 20 s; hard ≈ 17–18 ≈ 27 s dari 30 s). Hard dengan 2× Jam Rusak (20 s) sengaja nyaris mustahil; dipantau di playtest.

| Modifier | Efek |
|---|---|
| timeDelta | `durationMs` ± detik (sudah di-clamp race layer, §1.1; preview tidak ikut). Contoh: 2× Jam Pasir → 40 s |
| tolerance | `previewMs += min(3000, 1000 × (mult − 1) ÷ 0,3)` (×1,3 → +1 s). Berlaku juga di hard (preview 0 → 1 s): Zona Lebar di hard jadi boost besar, dipantau di playtest |
| speed | `mismatchDelayMs` ÷mult (min 250), `flipMs` ÷mult (min 80), dan `previewMs` dasar ÷mult (sebelum bonus `tolerance` ditambahkan) |
| extraTarget | `pairs` +count (grid tabel di atas) dan durasi +2 s per count (di luar clamp §1.1). Contoh hard +2: 12 pasangan 4×6, 34 s |
| fog | render: wajah kartu terbuka 60% kontras + blur 2 px; aturan tidak berubah; tidak mengaburkan kartu cocok |
| hint | tombol "Intip" (≥ 48 px), **sekali per minigame**: semua kartu yang belum cocok terbuka `peekMs` = 1000 ms; input diabaikan selama itu, kartu terbuka sebelumnya menutup, timer **tetap berjalan** (Intip menghabiskan 1 s). Tidak dihitung salah |

**Aksesibilitas dan feel:** wajah dibedakan oleh **siluet ikon**, bukan warna saja (ikon sekelompok warna dirancang berbeda bentuk); tiap kartu punya `aria-label` (nama ikon saat terbuka, "kartu tertutup N" saat tertutup) dan live region mengumumkan "cocok"/"salah". reducedMotion: kartu berganti dengan crossfade 80 ms, tanpa putar. Cocok: tier small (pop 1,3→1,0, "ting" naik semitone per combo, 6 partikel); salah: tanpa shake (jeda salah sudah cukup menghukum), "bonk" pelan; lulus: tier large (§1.4).

## 8. Tebak Lokasi (`guess_location`) — 2D
**Aturan 3 detik:** "Tempat ini ada di mana?" (ikon: gambar landmark, tanda tanya, pilihan).

- **Input:** tap/klik salah satu tombol pilihan region (pointerdown pada tombol; `{ choice: index }`). Tombol ≥ 56 px tinggi, **1 kolom di mobile**, 2×2 di desktop. Desktop: tombol `1`–`4` memilih (nomor tampil di tombol), Tab/Enter juga bisa. Setelah menjawab, input dikunci selama jeda.
- **Alur satu soal:** soal ditampilkan pada `qStartMs`; batas `qStartMs + timePerQuestionMs`. Jawab sebelum batas → benar/salah; lewat batas tanpa jawaban → salah (`timeout` soal, jawaban benar ditampilkan). Umpan balik jeda `gapMs` = 500 ms: tombol benar hijau + ✓, tombol yang dipilih salah merah + ✗ (bentuk + warna), lalu soal berikut mulai di `qStartMs' = (waktu jawab atau batas soal) + gapMs`. Input dengan `tMs ≥ batas` diabaikan (soal itu salah).
- **Lulus:** `correct ≥ correctRequired`, **selesai segera** pada jawaban yang mencapainya (`reason: 'success'`). **Gagal (`failLimit`)** segera saat `correct + soal tersisa < correctRequired`. **Gagal (`timeout`)** tidak terpisah: soal yang habis waktu dihitung salah, jadi akhirnya `failLimit`.
- **Durasi (DR-42):** `durationMs = questions × timePerQuestionMs + (questions − 1) × gapMs` (batas atas; selesai lebih cepat bila menjawab cepat): easy 3×8 + 1,0 = **25,0 s**, medium 4×6 + 1,5 = **25,5 s**, hard 5×5 + 2,0 = **27,0 s** (tulis "25–27 s"). **`progress`** = `correct / correctRequired`. **`timeTakenMs`** = waktu jawaban penentu (lulus), saat gagal dipastikan.
- **Data dari peta aktif (wajib):** soal dari `map.places[]`; jawaban benar = `place.regionId`; pilihan salah = region lain di peta yang sama; teks pilihan = `map.regions[].name`. Tidak ada daftar lokasi di kode. **`requires` (DR-44): `places.length ≥ 10` dan `places` tersebar di ≥ 7 region** (cukup untuk 7 soal dengan region berbeda; Indonesia: 13 place di 10 region). Place di region start/finish boleh jadi soal.
- **Petunjuk per difficulty:** easy = gambar + `place.name`; medium = gambar + `place.hint`; hard = gambar saja. Bahasa dari `place.name[lang]` / `hint[lang]` (fallback `id`). `alt` gambar: easy/medium memakai teks yang sudah tampil; hard: "Gambar tempat (tanpa teks petunjuk)" (alt tidak boleh membocorkan jawaban).
- **Acak per run (semua di `generateLevel`, urutan tarikan tetap):** (1) kocok `places` (Fisher-Yates seeded, `i` turun, `rng.int(0, i)`); (2) pilih soal berurutan dari hasil kocokan: lintasan pertama hanya place yang `regionId`-nya belum dipakai soal ini, lintasan kedua mengisi sisanya bila region kurang → **tidak ada place berulang dalam satu run, region berbeda bila mungkin**; (3) tiap soal berurutan: kandidat pengecoh = semua region selain jawaban benar, dikocok (Fisher-Yates), lalu **urut stabil naik menurut jumlah kemunculan region itu sebagai pilihan di soal-soal sebelumnya** (utamakan region yang belum muncul), ambil `choiceCount − 1` pertama; `choices` = [benar, …pengecoh] dikocok (Fisher-Yates); `hintRemoved = rng.int(0, choiceCount − 2)` (indeks pengecoh yang dihapus bila `hint`; **selalu ditarik** supaya kartu tidak menggeser urutan acak). Pilihan lintas-minigame ("belum pernah keluar di match ini") **dihapus di v0.5**: `generateLevel` murni dari `seed + difficulty + modifiers` dan tidak punya riwayat match; ★ opsi di laporan PM.
- **Level (output `generateLevel`):** `{ durationMs, questions, correctRequired, timePerQuestionMs, gapMs, choiceCount, clueMode: 'nameAndImage' | 'hintAndImage' | 'imageOnly', items[], hintActive, fogBlurPx }`, dengan `items[i] = { placeId, correctRegionId, choices: regionId[], hintRemovedIndex }` (indeks di `choices`).

| Knob | easy | medium | hard |
|---|---|---|---|
| questions / correctRequired | 3 / 2 | 4 / 3 | 5 / 4 |
| pilihan per soal | 3 | 4 | 4 |
| waktu per soal | 8 s | 6 s | 5 s |
| `gapMs` | 500 | 500 | 500 |
| petunjuk | gambar + nama | gambar + `hint` | gambar saja |
| peluang tebak buta (referensi) | 33% | 25% | 25% |

**Waktu per soal efektif (DR-17):** `timePerQuestionMs = clamp(round((base + timeDelta ÷ questionsDasar) × tolerance ÷ speed), 3000, 10000)`, `questionsDasar` = jumlah soal difficulty itu **sebelum** `extraTarget`, `timeDelta` dalam detik sudah di-clamp race layer. Contoh: medium + 1× Jam Rusak (−5): 6 − 5÷4 = 4,75 s → 4×4,75 + 1,5 = 20,5 s; ditambah `extraTarget` +1: 5 soal, butuh 4, tetap 4,75 s → 25,75 s. Hard + 2× Jam Rusak (−10): 5 − 2 = 3,0 s → 5×3 + 2 = 17 s. Easy + 2× Jam Pasir (+10): 8 + 3,33 = 11,33 → dijepit 10 s → 3×10 + 1 = 31 s.

| Modifier | Efek |
|---|---|
| timeDelta | dibagi rata ke `timePerQuestionMs` (rumus di atas; min 3 s per soal) |
| tolerance | `timePerQuestionMs` ×mult (maks 10 s) |
| speed | `timePerQuestionMs` ÷mult (min 3 s) |
| extraTarget | `questions` +count dan `correctRequired` +count (maks 7 soal; butuh ≥ 7 region di `places`); durasi total ikut naik, di luar clamp §1.1 |
| fog | gambar blur 6 px yang memudar ke 0 dalam 2 s tiap soal (`fogBlurPx` = 6; reducedMotion: blur statis 3 px). Teks pilihan tidak pernah dikaburkan; aturan tidak berubah |
| hint | hapus 1 pilihan salah (`hintRemovedIndex`) di setiap soal; easy jadi 2 pilihan (50%) |

**Aksesibilitas dan feel:** timer per soal berupa bar + angka detik (bukan warna saja), berdenyut di < 2 s; hasil jawaban memakai ✓/✗ + warna; semua pilihan fokusable keyboard. Jawaban benar: tier small (pop, "ting"); salah: bonk kecil tanpa shake; soal habis waktu: bar berkedip 1× (reducedFlash: tanpa kedip).

---

## 9. Ringkasan

Urutan baris = **urutan registry** (§1.3 langkah 1; dilarang berubah). `baseDurationMs` = nilai di `MinigameLogic` (dipakai clamp `timeDelta` race layer dan simulasi bot).

| # | id | Minigame | Render | `baseDurationMs` | `durationMs` dari `generateLevel` (tanpa modifier) | Tipe lulus | `requires(map)` (DR-44) |
|---|---|---|---|---|---|---|---|
| 1 | `tap_timing` | Tap Tepat Waktu | 2D | 20000 | 20 s | 3 kena, batas miss | — |
| 2 | `simon` | Simon | 2D | 30000 | 30 s | capai panjang urutan | — |
| 3 | `dodge_runner` | Hindari Rintangan | 3D | 20000 | 20 s | bertahan | `minigameThemes.dodge_runner.obstacles` ≥ 3 id |
| 4 | `whack_a_mole` | Whack-a-Mole | 2D | 20000 | 20 s | jumlah pukulan, batas decoy | `…whack_a_mole.target` dan `.decoy` ada |
| 5 | `slingshot` | Ketapel | 3D | 30000 | 30 s | target jatuh, batas peluru | `…slingshot.targets` ≥ 2 id (`platforms` opsional) |
| 6 | `memory_match` | Cocokkan Kartu | 2D | 30000 | 30 s (+ preview 2/1/0 s di luar durasi) | semua pasangan | `…memory_match.icons` ≥ 12 dan `iconGroups` sepanjang `icons` |
| 7 | `guess_location` | Tebak Lokasi | 2D | 26000 | 25,0 / 25,5 / 27,0 s | jumlah jawaban benar | `places` ≥ 10 di ≥ 7 region |

Rata-rata `durationMs` pool 7 ≈ 25,1 s (pool 3: 23,3 s); `estDurationMs` bot (25000) tetap.

### Data bot per minigame (bots.md §3, §8)
Bot tidak memainkan minigame; hasilnya diundi dari tabel bot ([bots.md §3](bots.md#3-simulasi-percobaan-dr-34-dr-35)). Untuk 4 minigame baru:

| Hal | Aturan |
|---|---|
| Peluang lulus | **Sama untuk semua minigame**: `BOT_PASS_CHANCE[level][difficulty efektif]` ± 8 poin per jenis modifier (netting). Tidak ada peluang khusus per minigame. |
| Durasi efektif `D` | `D = level.durationMs + (level.previewMs ?? 0)` dari `generateLevel(ctx)` dengan modifier bot yang sama dengan pemain: Whack 20 s (+3 s per `extraTarget`); Ketapel 30 s (setelah `speed` dan `extraTarget`); Cocokkan Kartu 30 s + preview; Tebak Lokasi 25,0 / 25,5 / 27,0 s (setelah `timeDelta` per soal dan `extraTarget`). |
| Waktu lulus / gagal | `D × U(passTimeFrac[level])` / `D × U(0,4–1,0)`; **tidak ada** minigame bertahan baru: `SURVIVAL_MINIGAMES` tetap `{ dodge_runner }`. |
| Alasan | Pemain manusia memang selesai lebih cepat dari `D` saat lulus (Whack, Tebak Lokasi selesai begitu syarat terpenuhi; Ketapel saat peluru penentu mendarat), dan rentang `passTimeFrac` meniru itu. |
| Efek pool 7 pada simulasi | `D` rata-rata naik ≈ 1,8 s per percobaan (23,3 → 25,1 s). Perkiraan Designer (belum disimulasikan): median casual solo +0,2–0,4 mnt; median melawan Hard hampir tetap (dikunci rem); lihat §10 F. |

## Keputusan (CP2, diputuskan PM)
1. Intro diperpendek ke 1,5 s pada percobaan ulang minigame yang sama.
2. Tebak Lokasi berbasis pilihan ganda nama region (bukan tap di mini-map). Places di region finish tetap boleh jadi soal.
3. Ketapel tanpa physics engine (skrip jatuh).
4. Target pass rate untuk tuning: easy 80%, medium 60%, hard 40% pada pemain kasual percobaan pertama.

## Keputusan (CP5b, usulan Designer; PM boleh mengubah, ★ = butuh perhatian)
1. **DR-15 (Whack):** knob `spawnIntervalMs` ditambahkan; jaminan `target spawn ≥ ⌈1,5 × hitsRequired⌉` (§5). `timeDelta` dan `speed` di Whack **hanya mengubah waktu tampil** (jadwal tetap), supaya Jam Rusak/Ngebut tetap sabotase dan jaminan tak bisa dipatahkan.
2. **DR-18 (Cocokkan Kartu):** knob "kartu mirip" **dihapus** dan menjadi turunan dari `iconGroups`; data peta ditambah `iconGroups` paralel dan 14 ikon; grid untuk 6–12 pasangan ditetapkan.
3. **Tebak Lokasi:** `requires` naik jadi ≥ 10 place di ≥ 7 region (butuh 7 soal region-berbeda bila `extraTarget` +2). Preferensi "belum pernah keluar di match ini" dihapus (generator murni tidak punya riwayat match). ★ Bila PM ingin variasi lintas-percobaan, opsi: kirim `ctx.seenPlaceIds` dari race layer (menyentuh reducer + kontrak `MinigameContext`); rekomendasi Designer: tidak sekarang.
4. **Ketapel:** model tanpa physics engine = rumus parabola + sampel 5 ms; kontrol `{ yaw, power }` dari drag; target dibangkitkan dari tembakan ideal (selalu solvabel); `extraTarget` juga menambah peluru dan +4 s; `speed` memperpendek durasi (min 15 s) supaya Ngebut berarti di easy.
5. **Ketapel sentuhan** (★ playtest): batas tabrak `hitRadiusM` 1,5/1,1/0,8 m adalah tuas utama pass rate; ukuran visual target ±0,5 m lebih kecil dari area tabrak.

## 10. Kriteria penerimaan CP5b (untuk QA)
Lingkup: `whack_a_mole`, `slingshot`, `memory_match`, `guess_location`, dan pool 7. Logic dites di Vitest node (seed tetap, hasil dicatat); render di Playwright desktop + mobile; hal yang butuh HP asli ditandai **HP**. Angka acuan = tabel §5–§9.

### A. Umum (tiap minigame baru)
1. **Murni:** `generateLevel`, `initState`, `step`, `result` tanpa DOM/three.js/`Math.random`/`Date`/`performance.now` (grep + jalan di node).
2. **Determinisme:** 1000 seed × 3 difficulty × set modifier {kosong, tiap jenis tunggal (6), keenam sekaligus, 20 kombinasi acak}: dua panggilan → `deepEqual`; urutan array modifier diacak → level identik; seed berbeda → level berbeda di ≥ 99% pasangan. Aturan urutan tarikan (§5–§8) dites: kabut tidak menggeser jadwal Whack; `hint` tidak menggeser soal Tebak Lokasi.
3. **Tabel knob:** nilai di `level` per difficulty sama dengan tabel dokumen (tes berparameter, tanpa angka tertanam di tes selain tabel).
4. **Enam modifier:** satu tes per jenis dengan contoh angka dokumen; modifier tak dikenal diabaikan dengan warning; **tes registry:** minigame tidak boleh masuk registry bila salah satu dari enam jenis tak terpetakan (cards.md §5).
5. **Pemain sempurna (skrip) lulus:** 2000 seed × 3 difficulty: tanpa modifier **100%**, dan dengan tiap modifier tunggal **100%** (termasuk 2× Jam Rusak); kombinasi ekstrem (2× Jam Rusak + Tambah Beban×2 + Ngebut + Kabut) ≥ 95%, kegagalan didaftar (boleh karena dokumen menandainya "nyaris mustahil"). **Pemain diam** (nol input) selalu gagal dengan alasan: Whack `timeout`, Ketapel `timeout`, Cocokkan Kartu `timeout`, Tebak Lokasi `failLimit`.
6. **Batas hasil (off-by-one 1 ms):** pass/fail tepat di batas dites per minigame (daftar di B).
7. `progress` ∈ [0,1] dan tidak turun; `timeTakenMs` ≤ `durationMs` (pengecualian: Ketapel hingga +3000 ms, Cocokkan Kartu + `previewMs`); `result` tidak pernah null setelah selesai dan dipanggil tepat sekali oleh shell.
8. **Pause:** `pause()` membekukan semuanya: Whack tidak spawn, peluru Ketapel membeku di udara, jeda salah Cocokkan Kartu dan timer per soal Tebak Lokasi membeku; konten tertutup overlay; `timeTakenMs` tanpa waktu pause.
9. **Mobile dan desktop:** layout utuh tanpa scroll horizontal di 1280×720, 390×844, 844×390; target sentuh: lubang Whack ≥ 64 px, kartu ≥ 64 px, tombol pilihan Tebak ≥ 56 px, tombol Intip ≥ 48 px; mouse dan sentuhan satu jalur Pointer Events; keyboard sesuai tiap bagian; `reducedMotion` mematikan putar/naik-turun/zoom/hit-stop dan `reducedFlash` mengganti kilat merah dengan outline; kalimat intro ≤ 8 kata; hit-stop ≤ 0,15 s.
10. **Siklus hidup:** 10× `create/start/destroy` berurutan: tidak ada listener tersisa; untuk Ketapel jumlah geometri/tekstur di `renderer.info` kembali ke nilai awal. **HP:** p95 frame time Ketapel ≤ 33,3 ms (DR-13).

### B. Per minigame
**Whack-a-Mole (§5)**
- W1 (DR-15): 5000 seed × 3 difficulty × `extraTarget` 0/1/2: target spawn `T ≥ ⌈1,5 × hitsRequired⌉`; nilai `S`/decoy/`T` tanpa extra = 15/0/15, 29/4/25, 39/9/30 persis; jaring pengaman (`hitsRequired` diturunkan) tidak pernah aktif dengan data resmi.
- W2: tiga slot pertama target; jumlah decoy = `⌊S × rasio⌋`; tidak ada dua spawn berurutan di lubang sama; lubang spawn tidak berisi karakter hidup (hidup dihitung dengan `baseLifeMs`); `lifeFactor` ∈ [0,85; 1,15]; `lifeMs` ∈ [350, 2500]; muncul bersamaan maks 1/2/2.
- W3: `speed` dan `timeDelta` tidak mengubah `spawns[].tMs/hole/kind` maupun `durationMs`; `M` dijepit 0,70–1,50; 1× Jam Rusak → `lifeMs` ÷1,15; 1× Jam Pasir → ×1,176; contoh kartu §5 (medium, Jam Rusak + Ngebut → ≈ 626 ms rata-rata) ± 2 ms.
- W4 (batas): pukulan di `tMs + lifeMs + graceMs − 1` kena, di `+ graceMs` tidak; decoy ke-`allowed + 1` → `failLimit` seketika; `hits` = `hitsRequired` pada `tMs < durationMs` → lulus, pada `≥ durationMs` → diabaikan; tap lubang kosong tidak mengubah state.
- W5 (render): keyboard `1 2 3 4 / Q W E R / A S D F` memukul lubang yang sesuai; 4×3 di portrait tampil 3×4 tanpa mengubah indeks; target vs decoy dapat dibedakan tanpa warna (siluet + ✕).

**Ketapel (§6)**
- K1 (solvabel): 5000 seed × 3 difficulty: `simulateShot(level, ideal_i)` mengenai target `i` untuk semua target diam (≥ 99,5% pasangan; sisanya mengenai target lain lebih dulu), dan pemain skrip yang menembak ulang bidikan ideal (menunggu offset ≈ 0 untuk target bergerak) menjatuhkan `targetsRequired` target dalam `durationMs` pada **100%** seed tanpa modifier.
- K2: jarak antar pusat target ≥ 4,0 m di ≥ 95% level (sisanya = percobaan ke-10, dicatat); `y ≥ 2 m`; `z` 8–30 m; `|windMps|` = 0/1/2 (×`speed`, maks 3), tanda 50/50 ± 3 poin dari 5000 seed.
- K3 (tak bergantung frame): `simulateShot` dengan sampel 5 ms vs 1 ms → `hitIndex` sama di ≥ 99,9% dari 20.000 tembakan acak; tabrakan tidak pernah menembus target (`hitRadiusM + 0,15` ≥ 0,95 m vs langkah ≤ 0,11 m).
- K4: `aimFromDrag`: `d < 20% × maxDragPx` → batal; `power` ∈ [0,20; 1,00]; yaw dijepit ±25° dan berlawanan arah drag; drag ke atas → yaw maksimum.
- K5 (batas): tembakan di `durationMs − 1` dinilai penuh dan bisa lulus setelah `durationMs`; di `≥ durationMs` diabaikan; input saat terbang atau reload tidak memakai peluru; lulus dinilai saat pendaratan; gagal seketika saat `peluru tersisa < targetsRequired − targetsDown`; peluru habis = `failLimit`; `speed`: durasi `max(min(d, 15 s), d ÷ mult)` (30 s × 1,25 → 24 s; 10 s tetap 10 s); `extraTarget` +2 hard → 8 target / 7 harus jatuh / 8 peluru / 38 s.
- K6 (render): drag sentuh dan mouse menembak; drag < 5% membatalkan tanpa memakai peluru; keyboard (←/→/↑/↓/Spasi/Esc) membidik; panjang garis bidik 100/40/15% ± 5%; `hint` membuat garis hijau saat bidikan mengenai; animasi jatuh target selesai ≤ 800 ms dan **tidak mengubah** hitungan lulus (lulus dicatat saat pendaratan); panah dan angka angin tampil di semua difficulty yang berangin; di bawah `reducedMotion` tanpa hit-stop dan tanpa zoom.

**Cocokkan Kartu (§7)**
- M1: tiap ikon terpilih muncul tepat 2 kali; `cards.length = 2 × pairs`; tiap ikon dari daftar peta; posisi sebuah ikon tetap seragam atas 12.000 seed (χ² df=11 < 31,3).
- M2 (DR-18): jumlah kelompok berisi ≥ 2 ikon (Indonesia, 6 kelompok) = `max(0, pairs − 6)`: easy 0, medium 2, hard 4, `extraTarget` +2 di hard (12 pasangan) → 6; urutan pilihan bergiliran per kelompok; grid 6..12 pasangan sesuai tabel (7/9/11: baris akhir 2 kartu dipusatkan); peta dengan `icons` < 12 atau `iconGroups` tak sepanjang → tidak masuk pool.
- M3 (aturan): kartu ke-2 dibandingkan seketika; jeda salah `mismatchDelayMs` lalu menutup; **peek-ahead** menutup keduanya seketika dan membuka kartu ke-3 sebagai pertama; tap kartu terbuka/cocok diabaikan; tap saat preview diabaikan; waktu nyata = `previewMs + durationMs`; pasangan terakhir di `playMs = durationMs − 1` lulus, di `≥ durationMs` tidak.
- M4 (modifier): `tolerance` ×1,3 → preview +1 s (hard 0 → 1 s); ×2,0 → +3 s (batas); `speed` ×1,25 → `mismatchDelayMs` 800 → 640 dan `previewMs` 2000 → 1600 (+ bonus `tolerance`); `hint`: Intip hanya sekali, 1000 ms, timer berjalan, input diabaikan selama itu; `extraTarget` +2 → +4 s.
- M5 (render): 4×6 muat di 390×844 tanpa scroll dengan kartu ≥ 64 px; keyboard grid (panah + Enter/Spasi); `reducedMotion` memakai crossfade; tiap kartu punya `aria-label`.

**Tebak Lokasi (§8)**
- T1 (data peta): tidak ada nama place/region di `src/logic/minigames/guessLocation.ts` atau render (grep terhadap semua `places[].name`); peta sintetis dengan place berbeda menghasilkan soal dari place itu.
- T2 (`requires`): peta sintetis: 9 place → tidak ada di pool; 10 place di 6 region → tidak ada; 10 di 7 → ada; Indonesia (13 place, 10 region) → ada; tanpa `guess_location` pool tetap valid dan undian tidak menarik ID-nya.
- T3: soal tanpa place berulang dalam satu run; region berbeda bila `questions` ≤ jumlah region ber-place (5000 seed, extra 0/1/2); `choices` memuat jawaban benar tepat sekali, tanpa duplikat, panjang = `choiceCount`; posisi jawaban benar seragam per slot ± 3 poin (12.000 seed); `hintRemovedIndex` bukan jawaban benar.
- T4: pengecoh mengutamakan region yang belum muncul: untuk tiap run, selisih kemunculan terbesar − terkecil di antara region yang pernah jadi pilihan ≤ 2; tarikan acak `hintRemoved` selalu terjadi (hasil level sama dengan/tanpa `hint` kecuali field `hintActive`).
- T5 (durasi, DR-42): `durationMs` tanpa modifier = 25.000 / 25.500 / 27.000; rumus `timePerQuestionMs` dengan contoh dokumen (4,75 s; 3,0 s; 10 s); selalu ∈ [3000, 10000]; `extraTarget` +2 → 5/6/7 soal dan butuh 4/5/6.
- T6 (aturan): selesai seketika saat `correct ≥ correctRequired`; `failLimit` seketika saat `correct + sisa < correctRequired`; jawaban di `qStartMs + timePerQuestionMs − 1` benar, di `+ 0` (batas) diabaikan = salah; soal berikut mulai `gapMs` setelah jawaban/batas; input saat jeda diabaikan.
- T7 (render): tombol ≥ 56 px, 1 kolom di mobile, tombol 1–4 di desktop; hint hard tidak membocorkan nama di `alt`; ✓/✗ tampil bersama warna; blur `fog` tidak menutupi teks pilihan.

### C. Bot (bots.md §3, §11 #3)
11. Untuk 4 minigame baru: pass rate bot = `BOT_PASS_CHANCE` ± 1,5 poin per (level × difficulty) pada 12.000 percobaan; dengan satu modifier tiap jenis ± 8 poin (clamp 5–98%); `D` dari `generateLevel` (Whack 20 s, Ketapel 30 s, Cocokkan Kartu 30 s + preview, Tebak Lokasi 25,0/25,5/27,0 s); `SURVIVAL_MINIGAMES` = `{ dodge_runner }`; dua tarikan `bot` per percobaan tidak berubah.

### D. Pool dan undian
12. `minigamePool(indonesia)` = 7 id menurut urutan registry §9. 10.000 undian dengan `last` bergilir: tidak pernah sama dengan `last`; tiap dari 6 kandidat 16,7% ± 1,5 poin; tepat satu tarikan `minigamePick` per undian; peta tanpa tema `slingshot` (atau tanpa `memory_match`, dst.) → minigame itu tidak ada di pool dan sisanya tetap diundi benar; win ke-2 di region selalu minigame berbeda.

### E. Kartu × minigame
13. Matriks 11 boost + 9 sabotase × 4 minigame baru: tidak ada warning "modifier tak dikenal"; semua contoh angka di §5–§8 dan di [cards.md §5](cards.md#5-pemetaan-kartu-ke-minigame-cp4a-cp5b) direproduksi (mis. Jam Pasir di Whack: `lifeMs` ×1,176; di Tebak Lokasi: waktu per soal +1,25 s medium; Zona Lebar di Cocokkan Kartu: preview +1 s); tes kembar: urutan kartu dimainkan diacak → hasil sama (cards.md §2.3).

### F. Simulasi dengan 7 minigame di pool (gerbang)
14. Jalankan ulang simulasi bots.md §11 #13–#14 pada build CP5b (peta Indonesia, preset Standard, pool 7). **Gerbang yang harus tetap lulus** (aturan terbaru, [pm-decisions.md](pm-decisions.md)):
   - **C-1** (Easy dan Normal saja): `casual` + 1/2/3 bot Easy atau Normal: median ∈ [10, 13] menit dan p95 ≤ 18 menit (p5 hanya dicatat).
   - **Hard:** median `casual` + 1/2/3 bot Hard ∈ [7, 9] menit; `casual` vs 1 Hard menang 15–35% dan vs 3 Hard 3–12%, diukur pada **n ≥ 4000** per sel; Hard vs Normal 1 lawan 1 menang ≥ 65% (tanpa batas atas).
   - Kalibrasi: median solo `casual` / `attentive` / `expert` = 11,0 / 8,0 / 6,5 ± 0,7 menit (setel `afterWinMs` profil manusia bila meleset).
   - Band lain (casual vs Easy/Normal, attentive, expert, Normal vs Easy) **hanya dilaporkan**.
   - Nol `actionRejected` dari bot di 2000 match; `npm run sim` selesai dalam batas CI (bots.md §11 #17).
15. **Laporan delta:** tabel median/p5/p95/win % per sel CP5b berdampingan dengan angka CP5a (bots.md §10) dan selisihnya. Perkiraan Designer (belum disimulasikan): `D` rata-rata +1,8 s per percobaan → median `casual` Easy/Normal +0,2–0,4 mnt (tetap di [10, 13]); median vs Hard hampir tetap karena dikunci rem, **tapi margin ke 9,0 hanya 0,09 mnt** (CP5a), jadi sel `casual` vs 1 Hard adalah yang paling mungkin patah.
16. **Urutan tuning bila gerbang patah** (kelanjutan keputusan PM CP5a): (a) `paceTargetMs` Hard dalam jendela 600–620 s lalu `afterWinMs`; (b) `afterWinMs` profil manusia untuk kalibrasi; (c) sisi manusia: cooldown atau knob durasi minigame baru; **bukan** `BOT_PASS_CHANCE`. Perubahan di (c) dicatat sebagai keputusan PM.

### G. Playtest CP6 (bukan gerbang CP5b, dicatat)
- Pass rate pemain kasual percobaan pertama per minigame baru: 80/60/40% ± 10 poin. Tuas urutan pertama bila meleset: Whack `baseLifeMs`; Ketapel `hitRadiusM`; Cocokkan Kartu `previewMs`; Tebak Lokasi `timePerQuestionMs`.
- **HP:** rasa tap Whack (3×3 dan 4×3), rasa drag Ketapel (area separuh bawah, batal < 5%), keterbacaan angin dan garis bidik, kartu 4×6 di 390 px, tombol pilihan Tebak Lokasi.
