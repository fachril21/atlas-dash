# Atlas Dash: Indonesia — Game Design Document

**Version:** 0.3 · **Updated:** 2026-11-16 · **Status:** designed (MVP) · Sumber requirement: [requirements.md](requirements.md) (LOCKED) · Keputusan PM: [pm-decisions.md](pm-decisions.md) · [Features](#feature-index) · [Decisions](#decisions) · [Open questions](#open-questions)

## Summary
Balapan virtual real-time dari **Sabang ke Merauke**. Pemain maju region demi region dengan memenangkan minigame pendek (15–30 detik); tiap kemenangan memberi kartu untuk boost diri sendiri atau sabotase lawan. Pemain pertama yang **mencapai** region finish menang (R1); finish tidak punya minigame. MVP: solo vs 1–3 bot, preset Standard.

| | |
|---|---|
| Genre dan kamera | Party race + koleksi minigame; race view 3D isometrik (diorama), minigame 2D (overlay HTML/CSS) atau 3D |
| Audiens | Kasual, semua umur, sesi singkat |
| Platform dan input | Browser desktop (mouse/keyboard) + mobile (touch, portrait-first) |
| Sesi | Target Standard: **median ≈ 10–13 menit**, dituning di playtest (C-1, diputuskan owner). Estimasi sekarang ≈ 10–11 menit ([map-indonesia.md](map-indonesia.md#5-estimasi-durasi)) |
| Engine | three.js + TypeScript + Vite (locked). Multiplayer nanti: Colyseus |
| Scope | MVP: 1 peta (Indonesia), 7 minigame, 20 kartu, bot Easy/Normal/Hard |
| Referensi | Mario Party (minigame + papan), WarioWare (aturan terbaca dalam 3 detik), Mario Kart (item sabotase + comeback) |

## Pillars
1. **Paham dalam 3 detik.** Setiap minigame dijelaskan dengan 1 kalimat ≤ 8 kata + 1 animasi ikon. Minigame yang butuh tutorial panjang tidak masuk pool.
2. **Selalu ada yang bisa dilakukan.** Saat cooldown, pemain tetap bisa main kartu dan memilih rute. Tidak ada layar tunggu mati lebih dari 3 detik.
3. **Sabotase itu lucu, bukan kejam.** Sabotase mengubah minigame *berikutnya* lawan (R3; satu pengecualian: Copet), maks 2 sabotase pending per target (Q2), dan yang tertinggal dapat kartu lebih bagus (R8).
4. **Peta adalah data.** Semua yang spesifik Indonesia (region, landmark, tema, prop) ada di JSON peta; kode tidak boleh menyebut "Sabang" (R4).

## Core loop
```
pilih region tetangga (target) → tekan Mulai → main minigame target
   → menang: pilih N dari 5 kartu → (win ke-2) pion pindah ke target
   → kalah: cooldown → tekan Mulai → minigame sama, seed baru
→ pakai kartu (boost/sabotase) → pilih target berikutnya
→ win ke-2 di region final (punya edge ke finish) = MENANG
```
- **Detik:** minigame 15–30 s ([minigames.md](minigames.md)), feedback juice per minigame.
- **Menit:** keputusan rute di titik cabang ([map-indonesia.md](map-indonesia.md)), pemakaian kartu ([cards.md](cards.md)).
- **Match:** rute 5–6 region (termasuk finish) menuju Merauke, comeback lewat rarity kartu.

## Match flow
```
Splash/Loading → Menu Utama → Setup Bot → Race (loop) → Layar Hasil → Menu Utama / Main Lagi
```
1. **Menu Utama:** Main, Pilih Peta (MVP: hanya Indonesia), Pengaturan.
2. **Setup Bot:** jumlah bot 1–3 (B3), satu level bot Easy/Normal/Hard untuk semua bot (B1), preset match (Standard aktif; Short/Long tampil terkunci "Segera"), nama + warna pion.
3. **Race:** semua pion mulai di Sabang (start, tanpa minigame). State gerak per pemain: `nodeId`, `targetId`, `winsAtTarget` (detail: [map-indonesia.md §1](map-indonesia.md#aturan-gerak-r61-dr-01-dr-05-dr-06-diterapkan-oleh-data--race-layer)). Loop:
   1. Pilih region tetangga lewat edge keluar sebagai target (graph satu arah/DAG, R6.1: hanya maju, tidak bisa mundur).
   2. Tekan **Mulai** → intro → minigame. Minigame diundi saat target dipilih dan setelah tiap win (tidak sama dengan yang terakhir); setelah gagal, minigame sama dengan seed baru dan intro 1,5 s (DR-02, [minigames.md §1.3](minigames.md#13-pemilihan-minigame-m2-dan-percobaan-ulang-dr-02)).
   3. **Menang:** `winsAtTarget + 1`, layar kartu (pilih N dari 5, K1; batas 15 s, Q4) → buang ke 5 kalau perlu (K1.1). Setelah **2 win** (Q1), pion pindah ke target (animasi 2 s).
   4. **Kalah:** cooldown sesuai difficulty efektif (R2: easy 12 s, medium 8 s, hard 4 s). Cooldown milik pemain: boleh ganti target selama cooldown, tapi sisa cooldown tetap berjalan; win parsial di target lama hangus. Setelah cooldown habis, ulang **harus** lewat tombol Mulai (DR-05).
   5. **Finish:** region finish (Merauke) **tidak punya minigame**. Win ke-2 di region final (region dengan edge ke finish) = menang (lihat aturan di bawah).
4. **Layar Hasil:** muncul setelah event `playerFinished`. Urutan posisi lain berdasarkan `remainingWins`.

## Aturan menang/kalah
- **Menang (R1, DR-06):** saat logic mencatat win ke-2 di region final, logic memancarkan event `playerFinished`; pemain itu juara. Sejak event itu semua input semua pemain dikunci. Animasi jalan ke finish (2 s) murni kosmetik. Bila dua pemain menyelesaikan region final di tick yang sama, event yang diproses lebih dulu oleh game loop menang.
- **Kalah:** bot mana pun memicu `playerFinished` duluan. Match langsung berakhir untuk semua pemain.
- **Kalah minigame** bukan kalah match: hanya cooldown + ulang (R2).
- **`remainingWins`** (DR-07; dipakai HUD, peringkat, comeback R8, bot), dengan `W` = `winsRequired` (2), `n` = `nodeId`, `t` = `targetId`, `w` = `winsAtTarget`, `playDist(x)` = region yang masih harus dimainkan dari `x` ke finish lewat jalur terpendek (`x` dan finish tidak dihitung):
  - tanpa target atau `w = 0`: `remainingWins = W × playDist(n)`
  - dengan target: `remainingWins = min(W × playDist(t) + (W − w), W × playDist(n))`
  - pemain yang sudah memicu `playerFinished`: 0.
  - **`total` HUD** = `remainingWins` di start (Indonesia: 8). Tabel nilai per node: [map-indonesia.md](map-indonesia.md#jarak-ke-finish-dan-remainingwins-dr-07).
  - **Peringkat:** juara = #1; sisanya urut `remainingWins` naik; seri → yang lebih dulu mencapai nilai `remainingWins`-nya sekarang di atas.
- **Pause:** di mode solo, pause membekukan semua bot dan timer. (Multiplayer nanti: tidak ada pause.)

## Bot (B1–B3)
Bot tidak memainkan minigame secara visual; hasilnya diundi dari stream RNG `bot` milik bot itu ([minigames.md §1.2.1](minigames.md#121-stream-rng-dr-04-satu-satunya-daftar)).
- **Peluang lulus** per difficulty efektif (easy / medium / hard):

| Level bot | easy | medium | hard | Waktu per percobaan |
|---|---|---|---|---|
| Easy | 70% | 50% | 30% | 85–100% durasi |
| Normal | 85% | 65% | 45% | 70–95% durasi |
| Hard | 92% | 80% | 65% | 55–85% durasi |

  Modifier kartu memengaruhi bot lewat difficulty efektif (`difficultyShift`) dan ±8 poin persen per modifier lain (boost +, sabotase −), clamp 5–98%.
- **Rute:** Easy acak di antara tetangga; Normal pilih rute dengan `remainingWins` terkecil; Hard memperhitungkan peluang lulusnya (expected time terkecil).
- **Kartu:** Easy memakai kartu acak 30% di tiap kesempatan, target sabotase acak. Normal memakai kartu begitu relevan, sabotase ke pemimpin. Hard menyimpan Payung Tameng/Cermin Balik, menyabotase pemain dengan `remainingWins` terkecil, memakai Copet ke lawan dengan hand terbanyak, memakai Tiket Pesawat di region hard. Bot hanya memutuskan sekali tiap 2–4 s.
- Bot mengikuti aturan yang sama: maks 5 kartu, cooldown, R6.1, batas sabotase.

## Feature index

| Feature | Status | Scope | Summary | Docs |
|---|---|---|---|---|
| Minigame framework + 7 minigame | designed | MVP | Interface umum (seed, difficulty, modifiers → pass/fail + waktu), `generateLevel` pure, stream RNG, 7 minigame 15–30 s | [minigames.md](minigames.md) |
| Kartu | designed | MVP | 20 kartu data-driven (termasuk Copet), hand maks 5, rarity + comeback | [cards.md](cards.md) |
| Peta Indonesia + format peta | designed | MVP | DAG 10 region, 3 titik cabang, rute 5–6 region, finish tanpa minigame, JSON map-agnostic di `public/maps/<id>/` | [map-indonesia.md](map-indonesia.md) |
| UI flow + HUD | designed | MVP | Semua layar, HUD race, hand kartu, target picker, layout mobile | [ui-flow.md](ui-flow.md) |
| Art style | designed | MVP | Low-poly chibi, warna cerah, diorama mainan | [art-style.md](art-style.md) |
| Bot | designed | MVP | Simulasi hasil minigame per level, rute & kartu | [gdd.md](#bot-b1b3) |
| Preset Short/Long | idea | later | Start/finish berbeda per preset di JSON peta | [map-indonesia.md](map-indonesia.md#6-format-data-peta-map-agnostic) |
| Multiplayer room code (≤4) | idea | later | Colyseus, server authoritative | — |
| Peta Jepang | idea | later | JSON peta kedua | — |

## Rencana checkpoint
Sumber kebenaran: [checkpoints.md](checkpoints.md). (Milestone lama M1–M3 dihapus karena bentrok dengan id requirement M1/M2, DR-39.) Ringkas, isi desain per checkpoint:

| CP | Isi desain yang dipakai | Selesai bila |
|---|---|---|
| CP3a | Peta Indonesia, aturan gerak (target + 2 win), cooldown/ulang, framework minigame + Tap Tepat Waktu, stream RNG | Race pertama di peta asli dengan 1 minigame |
| CP3b | Sisa temuan QA should-fix; Simon + Hindari Rintangan (3D) | Framework minigame 2D + 3D terbukti |
| CP4 | 20 kartu, hand/buang, target sabotase, comeback | Loop kartu lengkap |
| CP5 | Bot 3 level, sisa minigame | Match penuh solo vs bot |
| CP6 | Polish, cek mobile, playtest (durasi median ≈ 10–13 menit), build MVP | MVP siap dimainkan |

## Decisions

| ID | Date | Decision | Alternatives considered | Why | Affects |
|---|---|---|---|---|---|
| D-001 | 2026-11-16 | Region dikuasai setelah **2 win**. **Diputuskan owner (Q1).** | 1 win/region; 1 di easy & 2 di medium/hard | Durasi Standard dengan rute 5–6 region | peta, durasi, kartu |
| D-002 | 2026-11-16 | Difficulty efektif (setelah kartu) menentukan knob, cooldown (R2) dan N kartu (K1). Diputuskan PM | Pakai difficulty dasar region | Satu aturan; Santai Dulu punya harga, Badai punya sisi baik | minigame, kartu |
| D-003 | 2026-11-16 | Edge peta satu arah (DAG), tanpa `twoWay`. Dikonfirmasi PM (DR-03) | Graph tak berarah + cek di kode | No backtracking (R6.1) dijamin oleh data | format peta |
| D-004 | 2026-11-16 | Region finish tidak punya minigame; mencapainya = menang. Diputuskan PM | Finish dimainkan seperti region lain (draft v0.1) | Selaras dengan R1 ("reach") | peta, durasi, kartu Tiket Pesawat |
| D-005 | 2026-11-16 | Kartu Copet (curi 1 kartu acak) sebagai pengecualian R3; menggantikan Sinyal Hilang. Diputuskan owner (Q3) | Patuhi R3 ketat | Owner ingin interaksi hand langsung | kartu |
| D-006 | 2026-11-16 | Maks 2 sabotase pending per target. Diputuskan owner (Q2) | 3; tanpa batas | Anti-keroyok 3 bot | kartu, UI |
| D-007 | 2026-11-16 | Layar pilih/buang kartu dibatasi 15 s lalu auto-pick. Diputuskan owner (Q4) | Tanpa batas waktu | Game real-time | UI, kartu |
| D-008 | 2026-11-16 | Rekomendasi Designer v0.1 lainnya diterima PM | — | — | semua dokumen |
| D-009 | 2026-11-16 | Tiket Pesawat tidak bisa dipakai untuk region final (punya edge ke finish). **Diputuskan PM (C-2)** | Boleh | Mencegah menang instan | kartu |
| D-010 | 2026-11-16 | Tidak ada penawaran kartu setelah win penentu kemenangan. **Diputuskan PM (C-3)** | Tetap tampil | Kartu tidak berguna lagi | UI, kartu |
| D-011 | 2026-11-16 | Model gerak: `nodeId` + `targetId` + `winsAtTarget`, 2 win di target lalu pindah. Diputuskan PM (DR-01) | Masuk dulu lalu main (scaffold lama) | Sesuai desain v0.2 | logic, test |
| D-012 | 2026-11-16 | Gagal → minigame sama, seed baru, intro 1,5 s; menang/target baru → undi ulang, tidak sama dengan terakhir (dilewati bila pool 1). Diputuskan PM (DR-02) | Selalu undi ulang | Ulang terasa adil dan bisa dipelajari | minigame |
| D-013 | 2026-11-16 | Stream RNG bernama `hash(matchSeed, playerId, label)`; `attemptIndex` per (pemain, target); `Math.random()` hanya untuk `matchSeed`. Diputuskan PM (DR-04, DR-21) | Satu RNG bersama | Determinisme per pemain | semua logic |
| D-014 | 2026-11-16 | Ganti target boleh saat cooldown, cooldown tetap jalan; ulang butuh tekan Mulai. Diputuskan PM (DR-05) | Cooldown batal saat ganti target; ulang otomatis | Tidak bisa kabur dari cooldown | logic, UI |
| D-015 | 2026-11-16 | Menang = event logic `playerFinished` (win ke-2 di region final); animasi kosmetik; input dikunci sejak event. Diputuskan PM (DR-06) | Menang saat pion tiba (setelah animasi) | Satu timestamp untuk test dan server | logic, UI |
| D-016 | 2026-11-16 | Rumus `remainingWins` dengan `min(...)`, `total` = nilai di start, tie-break waktu (DR-07) | Jalur terpendek − win parsial (v0.2, salah untuk target di jalur panjang) | Benar untuk semua target | HUD, comeback, bot |
| D-017 | 2026-11-16 | Target Standard = median ≈ 10–13 menit, dituning di playtest. **Diputuskan owner (C-1)** | ≈ 15 menit dengan node tambahan atau 3 win di hard | Graph 10 node tetap | durasi, CP6 |
| D-018 | 2026-11-16 | Milestone M1–M3 diganti rencana checkpoint CP3a–CP6 (DR-39) | Pertahankan M1–M3 | Satu rencana, tanpa bentrok id requirement | GDD |

## Open questions
Semua keputusan CP2–CP3a tercatat di [Decisions](#decisions) dan [pm-decisions.md](pm-decisions.md). Temuan QA should-fix/nit yang belum dikerjakan dijadwalkan di CP3b/CP4/CP5/CP6 sesuai kolom CP di [qa/design-review.md](qa/design-review.md). Di CP3b sudah dikerjakan untuk Simon dan Hindari Rintangan: DR-16, DR-17, DR-19, DR-20, DR-44, plus aturan undian pool 3 minigame (DR-02, [minigames.md §1.3](minigames.md#13-pemilihan-minigame-m2-dan-percobaan-ulang-dr-02)). Satu hal menunggu PM:

### DR-09: cooldown vs pilar "tidak ada tunggu mati > 3 detik" (PM to confirm)
**Masalah:** sebelum CP4 tidak ada kartu, jadi di cooldown 12 s (region easy) pemain hanya bisa memutar kamera dan mengganti target. Itu tunggu mati > 3 s dan bertentangan dengan Pillar 2. Cooldown (R2) sendiri tidak boleh dihapus, dan **semua** nilai ≥ 4 s melanggar kalimat "> 3 detik" secara harfiah (hard = 4 s), jadi hanya mengubah angka tidak cukup.

| Opsi | Isi | Menjaga R2 | Dampak |
|---|---|---|---|
| A. Pilar diukur, angka tetap | Ubah Pillar 2 jadi terukur: "Saat cooldown, race view tetap interaktif (kamera, lihat lawan, ganti target, main kartu). Tidak ada layar yang memblokir semua input." Cooldown tetap 12/8/4 s | Ya (12/8/4) | Hanya teks dokumen. Tunggu 12 s di easy tetap ada, tapi tidak "mati". Playtest mengukur "waktu tanpa pilihan" |
| B. A + rapatkan selisih cooldown | Opsi A, dan ubah titik awal cooldown jadi **8 / 6 / 4 s** (easy/medium/hard) | Ya (8 > 6 > 4, tetap berbanding terbalik) | Menyentuh angka R2 "starting point" (requirements), `COOLDOWN_MS` di kode dan test, dan estimasi durasi map-indonesia §5 (match sedikit lebih singkat bila ada gagal). Tunggu terpanjang 8 s |
| C. A + latihan saat cooldown | Opsi A, dan saat cooldown pemain boleh memainkan **ronde latihan** minigame yang sama tanpa hadiah dan tanpa efek (Mulai tetap menunggu cooldown) | Ya | Fitur baru (UI + minigame jalan dua kali), terlalu besar untuk CP3b/CP4; kandidat CP6 atau pasca-MVP |

**Rekomendasi: B.** Opsi A saja jujur tapi tidak mengurangi rasa menunggu 12 s di easy yang sering terjadi di CP3b; B memotong 4 s tunggu di easy tanpa melanggar R2, dan dari CP4 kartu (Kopi Tubruk, sabotase, Tiket) mengisi waktu itu. C disimpan sebagai ide. Tidak diterapkan sebelum PM konfirmasi.

### Risiko
- (a) Minigame "aturan 3 detik" gagal dipahami: cek di playtest pertama (target 8/10 tester lulus percobaan pertama di easy).
- (b) Copet terasa menyebalkan bila dipakai berkali-kali oleh bot: pantau di playtest; tuas tuning = rarity (sekarang rare) dan perilaku bot.

## Change log
**0.1 (2026-11-16):** draft pertama MVP (GDD + 5 dokumen fitur).
**0.2 (2026-11-16):** CP2: keputusan owner/PM dicatat (D-001, D-003–D-008), finish tanpa minigame, kartu Copet menggantikan Sinyal Hilang, konflik C-1/C-2/C-3 dicatat.
**0.3.1 (2026-11-16):** CP3b: Open questions memuat DR-09 (3 opsi, PM to confirm; belum diterapkan); spec Simon + Hindari Rintangan dan aturan undian pool 3 di minigames.md v0.4.
**0.3 (2026-11-16):** CP3a: DR-01–DR-07, DR-38, DR-39 dan C-1 diterapkan (D-009–D-018); milestone diganti rencana checkpoint.
