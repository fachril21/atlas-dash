# Minigame — Spesifikasi MVP

**Status:** designed · **Updated:** 2026-11-16 · Kembali ke [GDD](gdd.md) · Requirement: R2, R3, R7, M1, M2, K1

7 minigame MVP (R7). Semua angka adalah titik awal untuk playtest. Nilai cooldown (R2) dan jumlah kartu (K1) **tidak** didefinisikan di sini; itu milik race layer ([gdd.md](gdd.md), [cards.md](cards.md)).

## 1. Aturan umum

### 1.1 Alur satu percobaan (dikelola "minigame shell", bukan oleh tiap minigame)
1. **Intro 3 detik** ("aturan 3 detik"): 1 kalimat ≤ 8 kata + 1 animasi ikon yang memperagakan input + hitung mundur 3-2-1. Tidak ada tombol skip di percobaan pertama per match; di percobaan ulang minigame yang sama, intro dipersingkat jadi 1,5 s `[ASSUMPTION]`.
2. **Main:** timer bar di atas. Minigame selesai lebih awal saat pass terpenuhi, atau saat fail sudah pasti (nyawa habis, salah melebihi batas).
3. **Banner hasil 1,2 s:** "BERHASIL!" / "GAGAL". Lalu kembali ke race layer.

Durasi dasar 15–30 s. Setelah modifier kartu, durasi di-clamp **10–40 s**.

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
  seed: number;                 // uint32; SEMUA random lewat PRNG dari seed ini (mis. mulberry32). Dilarang Math.random()
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

export interface MinigameDefinition {
  id: string;                   // 'tap_timing' | 'simon' | ...
  render: '2d' | '3d';
  introKey: string;             // key string kalimat aturan
  requires?: (map: MapData) => boolean; // mis. Tebak Lokasi butuh >= 8 places
  create(container: HTMLElement, ctx: MinigameContext): MinigameInstance;
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
- **Deterministik:** seed + difficulty + modifiers yang sama → parameter level yang sama. Bot memakai seed yang sama untuk simulasi.
- **Seed per percobaan:** `seed = hash(matchSeed, playerId, attemptIndex)`. Ulang setelah gagal = seed baru = parameter acak baru.
- **Input:** semua pakai Pointer Events (mouse + touch satu jalur). Keyboard opsional untuk desktop (tercantum per minigame). Target sentuh ≥ 48 px CSS.
- **2D** = overlay HTML/CSS (atau canvas 2D) di atas race view yang di-blur. **3D** = scene three.js terpisah yang dirender ke canvas yang sama selama minigame; race scene berhenti render.
- Modifier yang tidak dikenali sebuah minigame diabaikan dengan log warning (tidak crash).

### 1.3 Pemilihan minigame (M2)
- Diambil acak (seeded) dari pool yang `requires(map)` lolos.
- Tidak boleh sama dengan minigame terakhir yang dimainkan pemain itu.
- Difficulty = difficulty tipe region ([map-indonesia.md](map-indonesia.md#2-tipe-region)), lalu digeser kartu (clamp easy..hard).
- Region start dan finish tidak pernah memanggil minigame (D-004).

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
- `speed` → kalikan semua kecepatan/tempo ×mult.
- `extraTarget` → syarat lulus +count.
- `fog` → overlay kabut putih 45% opacity, berputar pelan, menutupi ±40% area secara acak bergeser (reducedMotion: statis).
- `hint` → bantuan khusus per minigame.

---

## 2. Tap Tepat Waktu (`tap_timing`) — 2D
**Aturan 3 detik:** "Tap saat jarum di zona hijau!" (ikon: jarum lewat zona, jari tap).

- **Input:** tap/klik di mana saja di area main; desktop juga Spasi.
- **Lulus:** kena zona sebanyak `hitsRequired` kali sebelum salah melebihi `missesAllowed` dan sebelum waktu habis. Tap di luar zona = 1 miss. Setelah tiap kena, zona pindah posisi.
- **Durasi:** 20 s.
- **Acak per run:** posisi zona tiap tap (tidak overlap posisi sebelumnya), arah awal jarum, kecepatan ±10%.

| Knob | easy | medium | hard |
|---|---|---|---|
| hitsRequired | 3 | 3 | 3 |
| missesAllowed | 2 | 1 | 0 |
| lebar zona (% bar) | 22% | 15% | 9% |
| kecepatan jarum (lebar bar/s, bolak-balik) | 0,8 | 1,2 | 1,7 |
| zona bergerak | tidak | tidak | ya, 0,15 lebar bar/s |

| Modifier | Efek |
|---|---|
| timeDelta | durasi ± detik |
| tolerance | lebar zona ×mult |
| speed | kecepatan jarum ×mult |
| extraTarget | hitsRequired +count |
| fog | kabut menutupi 2 potong bar (masing-masing 20%), bergeser tiap 2 s |
| hint | zona bersinar + bunyi "tik" 0,15 s sebelum jarum masuk zona |

## 3. Simon (`simon`) — 2D
**Aturan 3 detik:** "Ulangi urutan warnanya!" (ikon: 2 pad menyala, jari menekan).

- **Input:** tap/klik pad; desktop juga tombol 1–6.
- **Lulus:** menyelesaikan ronde dengan panjang `targetLength`. Ronde mulai dari panjang 3, +1 tiap ronde benar. Salah = 1 mistake, ronde diulang dengan urutan sama. Diam > 3 s saat giliran input = 1 mistake.
- **Durasi:** 30 s (waktu playback ikut dihitung).
- **Acak per run:** urutan pad (pad sama boleh berulang, maks 2 kali berturut-turut).
- **Aksesibilitas:** tiap pad punya warna + bentuk + nada berbeda (bukan warna saja).

| Knob | easy | medium | hard |
|---|---|---|---|
| jumlah pad | 4 | 4 | 6 |
| targetLength | 5 | 6 | 7 |
| waktu nyala per langkah | 0,70 s | 0,55 s | 0,40 s |
| mistakesAllowed | 2 | 1 | 0 |

| Modifier | Efek |
|---|---|
| timeDelta | durasi ± detik |
| tolerance | idle timeout 3 s ×mult; mult ≥ 1,3 juga +1 mistakesAllowed |
| speed | waktu nyala ÷mult |
| extraTarget | targetLength +count |
| fog | pad redup 50%, nyala pad 30% lebih lemah |
| hint | tombol "Ulang" muncul: putar ulang urutan ronde ini 1× (sekali per minigame) |

## 4. Hindari Rintangan (`dodge_runner`) — 3D
**Aturan 3 detik:** "Geser kiri-kanan, hindari rintangan!" (ikon: pion pindah jalur, rintangan lewat).

- **Input:** swipe kiri/kanan atau tap separuh kiri/kanan layar; mouse klik separuh kiri/kanan; desktop juga ←/→ atau A/D. 3 jalur; pindah jalur 0,12 s.
- **Lulus:** bertahan sampai waktu habis dengan nyawa > 0. (Ini minigame bertahan: `timeTakenMs` = durasi bila lulus.)
- **Durasi:** 20 s.
- **Acak per run:** pola spawn rintangan (selalu ada minimal 1 jalur kosong per baris), jenis prop.
- **Tema dari peta:** prop rintangan dari `map.minigameThemes.dodge_runner.obstacles` (Indonesia: becak, bajaj, gerobak bakso, ayam, durian). Jalan memakai warna tema region.
- Kamera: belakang-atas 30°, pion chibi di jalur tengah.

| Knob | easy | medium | hard |
|---|---|---|---|
| nyawa | 3 | 2 | 1 |
| kecepatan (m/s) | 6 | 8 | 10 |
| interval spawn baris | 1,2 s | 0,9 s | 0,65 s |
| peluang baris 2-jalur | 0% | 20% | 40% |
| i-frame setelah kena | 1,0 s | 1,0 s | — |

| Modifier | Efek (khusus: minigame bertahan) |
|---|---|
| timeDelta | **tidak** ubah durasi; tiap −1 s → kecepatan +3%, tiap +1 s → kecepatan −3% (supaya Jam Rusak tetap sabotase) |
| tolerance | hitbox pemain ×(1/mult) |
| speed | kecepatan dan interval spawn ×mult |
| extraTarget | nyawa −count (min 1); bila sudah 1, durasi +5 s per count |
| fog | kabut jarak jauh: rintangan baru terlihat 40% lebih dekat |
| hint | bayangan rintangan muncul di jalan 0,5 s lebih awal |

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
