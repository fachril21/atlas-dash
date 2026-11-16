# Art Style Guide

**Status:** designed · **Updated:** 2026-11-16 · Kembali ke [GDD](gdd.md) · Requirement: R10 (low-poly chibi, warna cerah, tampilan diorama mainan), R4 (tema mengikuti peta)

## 1. Kerangka teknis

| Hal | Nilai |
|---|---|
| Engine | three.js (WebGL2), aset glTF 2.0 `.glb` dengan kompresi meshopt `[ASSUMPTION]` |
| Kamera race | Isometrik: OrthographicCamera, pitch 35°, yaw 45°; zoom 0,7–1,5× |
| Skala dunia | 1 unit = 1 m. Tile region ±6×6 m, tinggi pion 1,0 m |
| Shading | Flat shading (normal per-face), `MeshStandardMaterial` roughness 0,8, metalness 0; tanpa normal map |
| Tekstur | **Palette texturing**: semua model memakai 1 atlas gradien 256×256 (`palette_<mapId>.png`, sRGB). UV tiap face menunjuk satu sel warna. Tanpa tekstur foto |
| Lampu | 1 DirectionalLight hangat (#FFF1D6, intensitas 2,5, dari kiri-atas 45°) + HemisphereLight (langit #BFE8FF / tanah #F6D7A7, 0,8). Bayangan lembut: PCFSoft, map 2048 desktop / 1024 mobile, hanya untuk pion & landmark |
| Post | Tone mapping ACES, sedikit saturasi +10%. Tilt-shift blur ringan di tepi atas/bawah (desktop saja, matikan di mobile) agar terasa miniatur |
| Budget tris | Pion ≤ 1.500 · prop ≤ 500 · landmark ≤ 3.000 · tile region ≤ 4.000 · total scene race ≤ 80.000 · draw call ≤ 150 (instancing untuk pohon/rumah) |
| Minigame 3D | Budget sendiri ≤ 60.000 tris; aset dipakai ulang dari race (prop, pion) |
| UI 2D | SVG untuk ikon sederhana; PNG 256×256 (alpha asli) untuk ikon kartu & places; teks selalu HTML, tidak dibakar di gambar |

## 2. Sistem visual

- **Bentuk:** chunky, bulat, bevel besar (2–3 segmen). Tidak ada sudut tajam tipis. Proporsi "mainan kayu/plastik".
- **Chibi:** pion & karakter 2–2,5 kepala tinggi, kepala besar, mata titik besar, tanpa mulut detail (ekspresi lewat bentuk mata + alis). Pion = karakter kecil di atas alas bulat (seperti bidak board game) dengan warna pemain di alas & baju.
- **Diorama:** setiap region adalah pulau/tile mengapung di atas laut toska dengan sisi tanah berlapis (strata 2–3 warna) terlihat, seperti potongan diorama. Jalur antar region = jembatan putus-putus / jalur perahu kertas di atas laut, berwarna netral; jalur yang bisa dipilih menyala warna pemain.
- **Silhouette dulu:** landmark tiap region harus dikenali dari siluetnya saja di zoom terjauh (≥ 40 px tinggi di layar mobile).
- **Detail density:** rendah. 3–5 warna per model. Tekstur = warna, bukan noise.
- **Gerak:** semua bergerak memantul (squash & stretch), loop idle 2–4 s: pohon bergoyang, ombak naik-turun, pion bernapas. Kurangi gerak → loop idle mati.

## 3. Palet

Palet global (UI & karakter) + aksen per peta dari `map.theme.palette` ([map-indonesia.md](map-indonesia.md#format-data-peta-map-agnostic)).

| Peran | Warna | Catatan |
|---|---|---|
| Langit | #8FD8FF | gradien ke #DFF6FF di horizon |
| Laut | #2EC4D6 | busa #FFFFFF, laut dalam #1A8FB8 |
| Pasir/tanah | #F6E7B0 / #C98B5A | strata tile |
| Hijau daun | #6CCB5F / #3E9E4F | dua nada |
| Pemain 1–4 | #FF5A5F merah · #3D8BFF biru · #3CC46B hijau · #FFC23D kuning | juga dibedakan bentuk alas: bulat, kotak, segitiga, bintang |
| Boost (UI) | #3CC46B + bingkai bulat | |
| Sabotase (UI) | #FF7A1A + bingkai bergerigi | oranye, bukan merah, agar tidak bentrok dengan pemain 1 |
| Rarity | common #B8C0CC · rare #3D8BFF · epic #A05CFF→#FFC23D | |
| Teks UI | #24324A di atas #FFFFFF / #FFF8EC | kontras ≥ 4,5:1 |

Aksen Indonesia: merah #E8413C + putih (bendera), motif batik sederhana (geometris, 2 warna) hanya untuk bingkai UI & kartu.

## 4. Daftar aset MVP (manifest awal)

| Kelompok | Aset | Jumlah |
|---|---|---|
| Tile region | `tile_beach`, `tile_ricefield`, `tile_city`, `tile_forest`, `tile_mountain`, `tile_sea_karst` | 6 |
| Landmark | `lm_km0`, `lm_maimun`, `lm_jam_gadang`, `lm_monas`, `lm_tugu_jogja`, `lm_tanah_lot`, `lm_tongkonan`, `lm_komodo`, `lm_piaynemo`, `lm_musamus` | 10 |
| Pion | 1 rig chibi, 4 warna (vertex color/material swap), animasi idle, lompat, menang, sedih | 1 rig |
| Prop minigame | becak, bajaj, gerobak bakso, ayam, durian, kelapa, kendi, layangan, ketapel, palu | 10 |
| Karakter 2D | tikus sawah, kucing oren (Whack-a-Mole) — 3 frame: muncul, kena, sembunyi | 2 |
| Ikon | 20 ikon kartu, 13 ikon/ilustrasi places, 6 ikon makanan/budaya, ikon UI (pause, timer, tameng, petir, bintang difficulty) | ±45 |
| Lain | papan laut + awan, confetti sprite, palette atlas | 3 |

Penamaan: `snake_case`, prefix kelompok (`tile_`, `lm_`, `prop_`, `char_`, `icon_`), peta lain memakai id sama dengan isi beda di folder `public/maps/<mapId>/` bila spesifik peta, atau `public/shared/` bila umum.

## 5. Gerbang kualitas
1. **Target visual dulu:** buat 1 tile + 1 landmark + 1 pion (mis. Jakarta + Monas) dan cek di layar HP 390 px dan desktop 1080p sebelum produksi aset lain.
2. Semua aset dari satu sumber gaya: palet atlas yang sama, arah cahaya yang sama, ketebalan bevel yang sama. Aset berikutnya dibuat dengan referensi target yang disetujui, bukan dari aset terakhir.
3. Cek teknis: pivot di dasar-tengah, skala 1 unit = 1 m, normal benar, tris dalam budget, tekstur kelipatan 4 (power of two untuk mipmap). PNG UI harus punya alpha asli (bukan latar kotak-kotak palsu).
4. Ikon & ilustrasi tanpa teks dan tanpa logo/merek.
5. **Provenance:** tiap aset dicatat di manifest (sumber: buatan sendiri / AI-generated / pack berlisensi, lisensi, tanggal). Wajib bila nanti rilis di platform yang menanyakan konten AI.

## Open questions (PM/owner to confirm)
1. Sumber aset 3D MVP: (a) buat sendiri di Blender dengan palette texturing [rekomendasi, konsisten], (b) pack low-poly berlisensi (CC0, mis. Kenney/Quaternius) + recolor ke palet, (c) generator AI 3D + cleanup. (b) tercepat untuk greybox M1.
2. Tilt-shift blur di desktop: (a) ya, ringan [rekomendasi], (b) tidak sama sekali (lebih ringan).
