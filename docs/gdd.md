# Atlas Dash: Indonesia — Game Design Document

**Version:** 0.2 · **Updated:** 2026-11-16 · **Status:** designed (MVP) · Sumber requirement: [requirements.md](requirements.md) (LOCKED) · [Features](#feature-index) · [Decisions](#decisions) · [Open questions](#open-questions)

## Summary
Balapan virtual real-time dari **Sabang ke Merauke**. Pemain maju region demi region dengan memenangkan minigame pendek (15–30 detik); tiap kemenangan memberi kartu untuk boost diri sendiri atau sabotase lawan. Pemain pertama yang **mencapai** region finish menang (R1); finish tidak punya minigame. MVP: solo vs 1–3 bot, preset Standard.

| | |
|---|---|
| Genre dan kamera | Party race + koleksi minigame; race view 3D isometrik (diorama), minigame 2D (overlay HTML/CSS) atau 3D |
| Audiens | Kasual, semua umur, sesi singkat |
| Platform dan input | Browser desktop (mouse/keyboard) + mobile (touch, portrait-first) |
| Sesi | 1 match Standard ≈ 10–11 menit menurut estimasi saat ini (target R5/Q1 ≈ 15 menit, lihat [konflik C-1](#open-questions) dan [map-indonesia.md](map-indonesia.md#5-estimasi-durasi)) |
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
pilih region tetangga → main minigame region itu → menang: pilih N dari 5 kartu
                                                   → kalah: cooldown → ulang
→ (setelah 2 kemenangan) masuk region → pakai kartu (boost/sabotase) → pilih region berikutnya
→ region berikutnya adalah finish? → langsung masuk finish = MENANG
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
3. **Race:** semua pion mulai di Sabang (start, tanpa minigame). Loop:
   1. Pilih region tetangga lewat edge keluar (graph satu arah/DAG, R6.1: hanya maju, tidak bisa mundur).
   2. Tekan **Mulai** → intro aturan 3 detik → minigame.
   3. **Menang:** +1 win untuk region itu, layar kartu (pilih N dari 5, K1; batas 15 s, Q4) → buang ke 5 kalau perlu (K1.1). Setelah **2 win** (Q1), pion pindah ke region itu (animasi 2 s).
   4. **Kalah:** cooldown sesuai difficulty efektif (R2: easy 12 s, medium 8 s, hard 4 s), lalu ulang atau ganti target ke tetangga lain (win parsial di target lama hangus).
   5. **Finish:** region finish (Merauke) **tidak punya minigame**. Begitu pemain menguasai region yang punya edge ke finish, pion otomatis jalan ke finish dan pemain menang.
4. **Layar Hasil:** muncul begitu ada pemain yang mencapai Merauke. Urutan posisi lain berdasarkan `remainingWins`.

## Aturan menang/kalah
- **Menang:** pemain pertama yang mencapai region finish (R1). Karena finish tanpa minigame, "mencapai" = menyelesaikan 2 win di region terakhir sebelum finish. Seri dalam milidetik yang sama: event yang diproses lebih dulu oleh game loop menang.
- **Kalah:** bot mana pun finish duluan. Match langsung berakhir untuk semua pemain.
- **Kalah minigame** bukan kalah match: hanya cooldown + ulang (R2).
- **Peringkat** (untuk layar hasil dan comeback R8): `remainingWins = (jumlah region yang masih harus dimainkan di jalur terpendek ke finish, finish tidak dihitung) × 2 − win di target saat ini`. Lebih kecil = lebih depan.
- **Pause:** di mode solo, pause membekukan semua bot dan timer. (Multiplayer nanti: tidak ada pause.)

## Bot (B1–B3)
Bot tidak memainkan minigame secara visual; hasilnya disimulasikan dengan seed yang sama.
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
| Minigame framework + 7 minigame | designed | MVP | Interface umum (seed, difficulty, modifiers → pass/fail + waktu), 7 minigame 15–30 s | [minigames.md](minigames.md) |
| Kartu | designed | MVP | 20 kartu data-driven (termasuk Copet), hand maks 5, rarity + comeback | [cards.md](cards.md) |
| Peta Indonesia + format peta | designed | MVP | DAG 10 region, 3 titik cabang, rute 5–6 region, finish tanpa minigame, JSON map-agnostic | [map-indonesia.md](map-indonesia.md) |
| UI flow + HUD | designed | MVP | Semua layar, HUD race, hand kartu, target picker, layout mobile | [ui-flow.md](ui-flow.md) |
| Art style | designed | MVP | Low-poly chibi, warna cerah, diorama mainan | [art-style.md](art-style.md) |
| Bot | designed | MVP | Simulasi hasil minigame per level, rute & kartu | [gdd.md](#bot-b1b3) |
| Preset Short/Long | idea | later | Start/finish berbeda per preset di JSON peta | [map-indonesia.md](map-indonesia.md#6-format-data-peta-map-agnostic) |
| Multiplayer room code (≤4) | idea | later | Colyseus, server authoritative | — |
| Peta Jepang | idea | later | JSON peta kedua | — |

## Milestones
1. **M1, greybox core loop:** graph peta + 2 minigame (Tap Tepat Waktu, Simon) + 8 kartu base + 1 bot Normal · selesai bila: satu match Sabang→Merauke bisa dimainkan sampai layar hasil.
2. **M2, konten MVP:** 7 minigame, 20 kartu, 3 level bot, semua layar UI, mobile layout.
3. **M3, art + juice:** aset low-poly, feedback minigame, audio dasar, playtest tuning cooldown, rarity & durasi match.

## Decisions

| ID | Date | Decision | Alternatives considered | Why | Affects |
|---|---|---|---|---|---|
| D-001 | 2026-11-16 | Region dikuasai setelah **2 win**. **Diputuskan owner (Q1).** | 1 win/region; 1 di easy & 2 di medium/hard | Mendekati durasi Standard (R5) dengan rute 5–6 region | peta, durasi, kartu |
| D-002 | 2026-11-16 | Difficulty efektif (setelah kartu) menentukan knob, cooldown (R2) dan N kartu (K1). Diputuskan PM | Pakai difficulty dasar region | Satu aturan; Santai Dulu punya harga, Badai punya sisi baik | minigame, kartu |
| D-003 | 2026-11-16 | Edge peta satu arah (DAG). **Dikonfirmasi PM, sesuai scaffold engineer** | Graph tak berarah + cek di kode | No backtracking (R6.1) dijamin oleh data | format peta |
| D-004 | 2026-11-16 | **Region finish tidak punya minigame; mencapainya = menang.** Dari PM, sesuai scaffold engineer | Finish dimainkan seperti region lain (draft v0.1) | Selaras dengan R1 ("reach") dan kode | peta, durasi, kartu Tiket Pesawat |
| D-005 | 2026-11-16 | Kartu **Copet** (curi 1 kartu acak) masuk sebagai pengecualian R3; menggantikan Sinyal Hilang. Diputuskan owner (Q3) | Patuhi R3 ketat | Owner ingin interaksi hand langsung | kartu |
| D-006 | 2026-11-16 | Maks 2 sabotase pending per target. Diputuskan owner (Q2) | 3; tanpa batas | Anti-keroyok 3 bot | kartu, UI |
| D-007 | 2026-11-16 | Layar pilih/buang kartu dibatasi 15 s lalu auto-pick. Diputuskan owner (Q4) | Tanpa batas waktu | Game real-time | UI, kartu |
| D-008 | 2026-11-16 | Rekomendasi Designer v0.1 lainnya diterima PM (lihat daftar di [Open questions](#open-questions)) | — | — | semua dokumen |
| D-009 | 2026-11-16 | Tiket Pesawat tidak bisa dipakai untuk region yang punya edge ke finish. **PM/owner to confirm** (C-2) | Boleh (bisa menang instan dari 1 region sebelum finish) | Turunan aturan v0.1 "tidak untuk finish" setelah D-004 | kartu |

## Open questions

### Diputuskan (CP2)
- Owner: 2 win per region (Q1/D-001), batas 2 sabotase pending (Q2/D-006), kartu Copet (Q3/D-005), batas 15 s di layar kartu (Q4/D-007).
- PM (rekomendasi Designer diterima, D-008): nama 8 kartu base; Tiket Pesawat tidak untuk finish (lihat D-009 untuk versi baru); difficulty efektif menentukan cooldown & kartu (D-002); ganti target setelah gagal, win parsial hangus; node Sulawesi = Toraja; preset Long nanti ditambah node (bukan `winsRequired`); satu level untuk semua bot; match selesai untuk semua saat ada yang finish; mobile portrait-first; Tebak Lokasi pilihan ganda; ilustrasi places buatan sendiri; aset 3D buatan sendiri di Blender (pack CC0 boleh untuk greybox M1); intro 1,5 s di percobaan ulang; Ketapel tanpa physics engine; tilt-shift ringan di desktop; ikon sabotase pending lawan terlihat; target pass rate playtest 80/60/40%.

### Konflik baru (PM/owner to confirm)
- **C-1 Durasi match.** Dengan finish tanpa minigame (D-004), estimasi Standard turun ke ≈ 10–11 menit (≈ 9 menit untuk pemain jago), di bawah target Q1/R5 ≈ 15 menit. Opsi: (a) biarkan, tuning di playtest M3 (estimasi kasar; pass rate nyata bisa lebih rendah) [rekomendasi]; (b) tambah 1 node di tiap rute (graph jadi 11–12 node, melewati "~9–10" R6); (c) 3 win di region hard.
- **C-2 Tiket Pesawat di region terakhir.** Lihat D-009. Opsi: (a) dilarang di region yang punya edge ke finish [rekomendasi]; (b) boleh.
- **C-3 Layar kartu setelah win terakhir.** Win ke-2 di region final langsung membawa pemain ke finish (menang), jadi pilihan kartunya tidak berguna. Opsi: (a) lewati layar kartu [rekomendasi]; (b) tetap tampil. Lihat [ui-flow.md](ui-flow.md#10-finish).

### Risiko
- (a) Minigame "aturan 3 detik" gagal dipahami: cek di playtest pertama (target 8/10 tester lulus percobaan pertama di easy).
- (b) Copet terasa menyebalkan bila dipakai berkali-kali oleh bot: pantau di playtest; tuas tuning = rarity (sekarang rare) dan perilaku bot.

## Change log
**0.1 (2026-11-16):** draft pertama MVP (GDD + 5 dokumen fitur).
**0.2 (2026-11-16):** CP2: keputusan owner/PM dicatat (D-001, D-003–D-008), finish tanpa minigame, kartu Copet menggantikan Sinyal Hilang, konflik C-1/C-2/C-3 dicatat.
