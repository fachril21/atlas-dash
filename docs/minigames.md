# Minigame — Spesifikasi MVP

**Status:** designed · **Updated:** 2026-11-16 (v0.4, CP3b: Simon + Hindari Rintangan dilengkapi setara Tap Tepat Waktu; DR-02 undian untuk pool 3, DR-16, DR-17, DR-19, DR-20, DR-44; v0.3 CP3a: DR-02, DR-04, DR-05, DR-17/20/21 untuk Tap Tepat Waktu) · Kembali ke [GDD](gdd.md) · Requirement: R2, R3, R7, M1, M2, K1

7 minigame MVP (R7). Semua angka adalah titik awal untuk playtest. Nilai cooldown (R2) dan jumlah kartu (K1) **tidak** didefinisikan di sini; itu milik race layer ([gdd.md](gdd.md), [cards.md](cards.md)).

## 1. Aturan umum

### 1.1 Alur satu percobaan (dikelola "minigame shell", bukan oleh tiap minigame)
0. **Mulai:** setiap percobaan (termasuk ulang setelah gagal) dimulai oleh pemain menekan **Mulai**, dan hanya bila cooldown pemain sudah habis (DR-05).
1. **Intro** ("aturan 3 detik"): 1 kalimat ≤ 8 kata + 1 animasi ikon yang memperagakan input + hitung mundur. **3 s** untuk percobaan pertama sebuah minigame hasil undian; **1,5 s** untuk percobaan ulang setelah gagal (minigame sama, lihat §1.3). Tidak ada tombol skip.
2. **Main:** timer bar di atas. Minigame selesai lebih awal saat pass terpenuhi, atau saat fail sudah pasti (nyawa habis, salah melebihi batas).
3. **Banner hasil 1,2 s:** "BERHASIL!" / "GAGAL". Lalu kembali ke race layer.

**Pause di dalam minigame:** `pause()` membekukan timer minigame dan semua gerak; shell menutup area main dengan overlay pause (konten tidak terlihat); waktu pause tidak dihitung di `timeTakenMs`. Pause saat intro membekukan hitung mundur intro. (Aturan pause di luar minigame: CP3b, DR-08.)

Durasi dasar 15–30 s. **Clamp oleh race layer:** race layer menjumlah semua `timeDelta` lalu meng-clamp-nya sehingga `durasi dasar + timeDelta` berada di **10–40 s**; minigame menerima `timeDelta` yang sudah di-clamp dan tidak meng-clamp lagi. Contoh Tap Tepat Waktu (dasar 20 s): 2× Jam Rusak (−10) → 10 s; 3× Jam Rusak tidak mungkin (maxStacks 2). Minigame dengan pemetaan `timeDelta` khusus (Hindari Rintangan, Tebak Lokasi) memakai nilai yang sudah di-clamp ini (DR-17).
**Urutan (DR-17):** (1) race layer menjumlah `timeDelta` lalu clamp sehingga dasar + total ∈ 10–40 s; (2) minigame menerapkan pemetaannya ke nilai itu; (3) perpanjangan durasi khusus minigame dari `extraTarget` ditambahkan **sesudahnya** dan tidak di-clamp lagi (Hindari Rintangan +5 s per count, Simon +4 s per count; `extraTarget` total maks +2 per minigame). Contoh per minigame ada di §2–§4.

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
  requires?: (map: MapData) => boolean; // mis. Tebak Lokasi butuh >= 8 places
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
  1. `registry` = daftar minigame yang terdaftar di build, **berurutan tetap** seperti tabel §9 (CP3b: `tap_timing`, `simon`, `dodge_runner`).
  2. `pool` = anggota `registry` yang `requires(map)` bernilai true (atau tidak punya `requires`). `requires` dievaluasi **sekali per peta**, level peta saja; spesifikasi ini tidak punya syarat per region. Urutan `pool` = urutan `registry`.
  3. `last` = `id` minigame terakhir yang **dimainkan** pemain itu (percobaan gagal dihitung), disimpan per pemain sepanjang match dan **tidak** di-reset saat ganti region atau target. Awal match: `last` kosong.
  4. `kandidat` = `pool` tanpa `last`. Bila `kandidat` kosong (pool hanya 1 minigame, atau `last` bukan anggota pool), `kandidat` = `pool`.
  5. Tarik **tepat satu** angka dari stream `minigamePick` pemain itu, dan **selalu** tarik walau `kandidat` hanya 1 (supaya jumlah tarikan = jumlah undian): `pick = kandidat[rng.int(kandidat.length)]`.
  6. Bila `pool` kosong, peta tidak valid (validator peta menolak, pool minimal harus berisi `tap_timing`).
- **Akibat:** pool 1 minigame → itu terus. Pool 2 → selang-seling ketat. Pool 3 (CP3b) → tiap undian memilih 1 dari 2 minigame lain, tiap kandidat peluang 50%; tiga minigame yang sama tidak mungkin muncul dua kali berturut-turut. Win ke-2 di sebuah region selalu memakai minigame berbeda dari win ke-1.
- **Contoh:** `last = simon` → `kandidat = [tap_timing, dodge_runner]`, tarikan 0 → `tap_timing`, tarikan 1 → `dodge_runner`. Setelah gagal di `tap_timing`, ulang memakai `tap_timing` lagi tanpa tarikan. Bila Tebak Lokasi masuk pool (CP5) tapi peta tidak lolos `requires`, ia tidak ada di `pool` dan `kandidat` tidak berubah.
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
- `speed` → kalikan semua kecepatan/tempo ×mult. Tempo berupa **durasi** (waktu nyala, waktu muncul) dibagi mult; tempo berupa **interval/jeda** (spawn, jeda antar langkah) juga dibagi mult. Prinsip: mult > 1 selalu membuat minigame lebih sibuk, tidak pernah lebih sepi (DR-16).
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

- **Input:** tap/klik lubang.
- **Lulus:** jumlah pukulan benar ≥ `hitsRequired` sebelum waktu habis, dan pukulan ke decoy ≤ `decoyHitsAllowed` (lewat batas = fail langsung).
- **Durasi:** 20 s.
- **Acak per run:** urutan lubang, kapan decoy muncul, durasi muncul ±15%.
- **Tema dari peta:** karakter target & decoy dari `map.minigameThemes.whack_a_mole` (Indonesia: target "tikus sawah" chibi, decoy kucing oren).

| Knob | easy | medium | hard |
|---|---|---|---|
| grid lubang | 3×3 | 3×3 | 4×3 |
| hitsRequired | 10 | 14 | 18 |
| waktu muncul | 1,2 s | 0,9 s | 0,7 s |
| muncul bersamaan (maks) | 1 | 2 | 3 |
| proporsi decoy | 0% | 15% | 25% |
| decoyHitsAllowed | — | 2 | 1 |

| Modifier | Efek |
|---|---|
| timeDelta | durasi ± detik |
| tolerance | area hit lubang ×mult; waktu muncul ×mult |
| speed | waktu muncul ÷mult |
| extraTarget | hitsRequired +3 per count |
| fog | 2 lubang acak tertutup kabut tiap 3 s (target di bawahnya tetap bisa dipukul) |
| hint | lubang berikutnya bergetar 0,3 s sebelum karakter muncul |

## 6. Ketapel (`slingshot`) — 3D
**Aturan 3 detik:** "Tarik, bidik, lepas! Jatuhkan targetnya!" (ikon: tarik ketapel, batu terbang, target jatuh).

- **Input:** tekan-tahan di ketapel (atau di mana saja di separuh bawah layar), drag ke belakang untuk arah + kekuatan, lepas untuk tembak. Mouse sama (drag). Jarak drag maks = 25% tinggi layar = kekuatan 100%. Drag < 5% = batal (tidak menghabiskan peluru).
- **Lulus:** jatuhkan `targetsRequired` target dengan maks 6 peluru, sebelum waktu habis. Peluru habis dan target belum cukup = fail.
- **Durasi:** 30 s.
- **Acak per run:** posisi target di diorama (menara balok, atap, pohon), arah & kekuatan angin, jalur target bergerak.
- **Tema dari peta:** target = `map.minigameThemes.slingshot.targets` (Indonesia: kelapa, kendi, layang-layang).
- Fisika: proyektil parabola sederhana + angin konstan; target jatuh bila terkena (tidak perlu physics engine penuh untuk MVP).

| Knob | easy | medium | hard |
|---|---|---|---|
| targetsRequired / jumlah target | 3 / 4 | 4 / 5 | 5 / 6 |
| peluru | 6 | 6 | 6 |
| garis bidik (dari panjang lintasan) | 100% | 40% | 15% |
| angin (m/s, samping) | 0 | ±1 | ±2 |
| target bergerak | 0 | 1 | 2 (0,8 m/s) |

| Modifier | Efek |
|---|---|
| timeDelta | durasi ± detik |
| tolerance | hitbox target ×mult |
| speed | kecepatan target bergerak ×mult; angin ×mult |
| extraTarget | targetsRequired +count (jumlah target ikut +count) |
| fog | kabut di latar tengah: target jauh 50% transparan |
| hint | garis bidik 100% + indikator angin berupa panah |

## 7. Cocokkan Kartu (`memory_match`) — 2D
**Aturan 3 detik:** "Buka dua kartu, cari pasangannya!" (ikon: 2 kartu terbuka, sama, lalu hilang).

- **Input:** tap/klik kartu.
- **Lulus:** semua pasangan cocok sebelum waktu habis.
- **Durasi:** 30 s.
- **Acak per run:** isi dan posisi kartu (shuffle Fisher-Yates seeded).
- **Tema dari peta:** gambar kartu dari `map.places[].icon` dan `map.minigameThemes.memory_match.icons` (Indonesia: landmark + makanan: rendang, sate, nasi goreng, dst.). Ini satu-satunya minigame yang boleh menampilkan landmark sebagai ikon murni (tidak ada pertanyaan).

| Knob | easy | medium | hard |
|---|---|---|---|
| pasangan (grid) | 6 (3×4) | 8 (4×4) | 10 (4×5) |
| preview semua kartu di awal | 2,0 s | 1,0 s | 0 s |
| jeda sebelum kartu salah tertutup | 0,8 s | 0,7 s | 0,6 s |
| kartu mirip (warna sama, ikon beda) | 0 pasang | 1 pasang | 2 pasang |

| Modifier | Efek |
|---|---|
| timeDelta | durasi ± detik |
| tolerance | preview +1 s per 0,3 di atas 1,0 |
| speed | jeda tertutup ÷mult; kartu terbuka berputar ÷mult |
| extraTarget | +1 pasangan per count |
| fog | gambar kartu terbuka hanya 60% kontras & sedikit blur |
| hint | sekali per minigame: tombol "Intip" membuka semua kartu 1 s |

## 8. Tebak Lokasi (`guess_location`) — 2D
**Aturan 3 detik:** "Tempat ini ada di mana?" (ikon: gambar landmark, tanda tanya, pilihan).

- **Input:** tap/klik salah satu tombol pilihan region (tombol besar, 1 kolom di mobile).
- **Lulus:** jawaban benar ≥ `correctRequired` dari `questions` soal. Salah atau waktu soal habis = soal berikutnya. Fail dipastikan lebih awal bila sisa soal tidak cukup.
- **Durasi:** `questions × timePerQuestion` + jeda 0,5 s antar soal ≈ 24–27 s.
- **Data dari peta aktif (wajib):** soal diambil dari `map.places[]`; jawaban benar = `place.regionId`, pilihan salah = region lain di peta yang sama, diutamakan region yang belum muncul di soal ini. Teks pilihan = `map.regions[].name`. Tidak ada daftar lokasi di kode. `requires`: peta punya ≥ 8 place yang tersebar di ≥ 5 region.
- **Acak per run:** soal (tanpa pengulangan dalam satu minigame, dan diutamakan yang belum pernah keluar di match ini untuk pemain itu), urutan pilihan.

| Knob | easy | medium | hard |
|---|---|---|---|
| questions / correctRequired | 3 / 2 | 4 / 3 | 5 / 4 |
| pilihan per soal | 3 | 4 | 4 |
| waktu per soal | 8 s | 6 s | 5 s |
| petunjuk yang ditampilkan | gambar + nama tempat | gambar + `place.hint` | gambar saja |

| Modifier | Efek |
|---|---|
| timeDelta | dibagi rata ke waktu per soal (min 3 s per soal) |
| tolerance | waktu per soal ×mult |
| speed | waktu per soal ÷mult |
| extraTarget | questions +count dan correctRequired +count |
| fog | gambar blur 6 px yang memudar dalam 2 s tiap soal |
| hint | hapus 1 pilihan salah di setiap soal |

---

## 9. Ringkasan

| Minigame | Render | Durasi | Tipe lulus |
|---|---|---|---|
| Tap Tepat Waktu | 2D | 20 s | 3 kena, batas miss |
| Simon | 2D | 30 s | capai panjang urutan |
| Hindari Rintangan | 3D | 20 s | bertahan |
| Whack-a-Mole | 2D | 20 s | jumlah pukulan, batas decoy |
| Ketapel | 3D | 30 s | target jatuh, batas peluru |
| Cocokkan Kartu | 2D | 30 s | semua pasangan |
| Tebak Lokasi | 2D | 24–27 s | jumlah jawaban benar |

## Keputusan (CP2, diputuskan PM)
1. Intro diperpendek ke 1,5 s pada percobaan ulang minigame yang sama.
2. Tebak Lokasi berbasis pilihan ganda nama region (bukan tap di mini-map). Places di region finish tetap boleh jadi soal.
3. Ketapel tanpa physics engine (skrip jatuh).
4. Target pass rate untuk tuning: easy 80%, medium 60%, hard 40% pada pemain kasual percobaan pertama.
