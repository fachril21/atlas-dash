# Atlas Dash: Indonesia — Game Design Document

**Version:** 0.1 · **Updated:** 2026-11-16 · **Status:** designed (MVP) · Sumber requirement: [requirements.md](requirements.md) (LOCKED) · [Features](#feature-index) · [Decisions](#decisions) · [Open questions](#open-questions)

## Summary
Balapan virtual real-time dari **Sabang ke Merauke**. Pemain maju region demi region dengan memenangkan minigame pendek (15–30 detik); tiap kemenangan memberi kartu untuk boost diri sendiri atau sabotase lawan. Pemain pertama yang menaklukkan region finish menang (R1). MVP: solo vs 1–3 bot, preset Standard (~15 menit).

| | |
|---|---|
| Genre dan kamera | Party race + koleksi minigame; race view 3D isometrik (diorama), minigame 2D (overlay HTML/CSS) atau 3D |
| Audiens | Kasual, semua umur, sesi singkat |
| Platform dan input | Browser desktop (mouse/keyboard) + mobile (touch) |
| Sesi | 1 match Standard ≈ 11–15 menit (estimasi di [map-indonesia.md](map-indonesia.md#estimasi-durasi)) |
| Engine | three.js + TypeScript + Vite (locked). Multiplayer nanti: Colyseus |
| Scope | MVP: 1 peta (Indonesia), 7 minigame, 20 kartu, bot Easy/Normal/Hard |
| Referensi | Mario Party (minigame + papan), WarioWare (aturan terbaca dalam 3 detik), Mario Kart (item sabotase + comeback) |

## Pillars
1. **Paham dalam 3 detik.** Setiap minigame dijelaskan dengan 1 kalimat ≤ 8 kata + 1 animasi ikon. Minigame yang butuh tutorial panjang tidak masuk pool.
2. **Selalu ada yang bisa dilakukan.** Saat cooldown, pemain tetap bisa main kartu dan memilih rute. Tidak ada layar tunggu mati lebih dari 3 detik.
3. **Sabotase itu lucu, bukan kejam.** Sabotase hanya mengubah minigame *berikutnya* lawan (R3), dibatasi stack-nya, dan yang tertinggal dapat kartu lebih bagus (R8).
4. **Peta adalah data.** Semua yang spesifik Indonesia (region, landmark, tema, prop) ada di JSON peta; kode tidak boleh menyebut "Sabang" (R4).

## Core loop
```
pilih region tetangga → main minigame region itu → menang: pilih N dari 5 kartu
                                                   → kalah: cooldown → ulang
→ (setelah winsRequired kemenangan) masuk region → pakai kartu (boost/sabotase) → pilih region berikutnya
```
- **Detik:** minigame 15–30 s ([minigames.md](minigames.md)), feedback juice per minigame.
- **Menit:** keputusan rute di titik cabang ([map-indonesia.md](map-indonesia.md)), pemakaian kartu ([cards.md](cards.md)).
- **Match:** rute 5–6 region menuju Merauke, comeback lewat rarity kartu.

## Match flow
```
Splash/Loading → Menu Utama → Setup Bot → Race (loop) → Layar Hasil → Menu Utama / Main Lagi
```
1. **Menu Utama:** Main, Pilih Peta (MVP: hanya Indonesia), Pengaturan.
2. **Setup Bot:** jumlah bot 1–3 (B3), level bot Easy/Normal/Hard (B1, satu level untuk semua bot `[ASSUMPTION]`), preset match (Standard aktif; Short/Long tampil terkunci "Segera"), nama + warna pion.
3. **Race:** semua pion mulai di Sabang (sudah dianggap "dikuasai", tanpa minigame). Loop:
   1. Pilih region tetangga yang terhubung (R6.1: hanya maju, tidak bisa mundur).
   2. Tekan **Mulai** → intro aturan 3 detik → minigame.
   3. **Menang:** +1 win untuk region itu, layar kartu (pilih N dari 5, K1) → buang ke 5 kalau perlu (K1.1). Kalau win sudah = `winsRequired` (default **2**, PM/owner to confirm), pion pindah ke region itu (animasi 2 s).
   4. **Kalah:** cooldown sesuai difficulty efektif (R2: easy 12 s, medium 8 s, hard 4 s), lalu boleh ulang atau ganti target ke region tetangga lain (progres win di target lama hangus).
4. **Layar Hasil:** muncul begitu ada pemain yang menaklukkan Merauke. Urutan posisi lain berdasarkan sisa win menuju finish.

## Aturan menang/kalah
- **Menang:** pemain pertama yang menyelesaikan semua win di region finish (Merauke) (R1). Seri dalam milidetik yang sama: event yang diterima lebih dulu oleh game loop (single-player: urutan proses tick) menang.
- **Kalah:** bot mana pun finish duluan. Match langsung berakhir untuk semua; tidak ada "lanjut sampai semua finish" di MVP `[ASSUMPTION]`.
- **Kalah minigame** bukan kalah match: hanya cooldown + ulang (R2).
- **Peringkat** (untuk layar hasil dan comeback R8): `remainingWins = (jarak terpendek ke finish dalam region × winsRequired) − win di target saat ini`. Lebih kecil = lebih depan.
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
- **Kartu:** Easy memakai kartu acak 30% di tiap kesempatan, target sabotase acak. Normal memakai kartu begitu relevan, sabotase ke pemimpin. Hard menyimpan Payung Tameng/Cermin Balik, menyabotase pemain dengan `remainingWins` terkecil, memakai Tiket Pesawat di region hard. Bot hanya memutuskan sekali tiap 2–4 s (supaya tidak terasa "robot").
- Bot mengikuti aturan yang sama: maks 5 kartu, cooldown, R6.1.

## Feature index

| Feature | Status | Scope | Summary | Docs |
|---|---|---|---|---|
| Minigame framework + 7 minigame | designed | MVP | Interface umum (seed, difficulty, modifiers → pass/fail + waktu), 7 minigame 15–30 s | [minigames.md](minigames.md) |
| Kartu | designed | MVP | 20 kartu data-driven, hand maks 5, rarity + comeback | [cards.md](cards.md) |
| Peta Indonesia + format peta | designed | MVP | Graph 10 region, 3 titik cabang, rute 5–6 region, JSON map-agnostic | [map-indonesia.md](map-indonesia.md) |
| UI flow + HUD | designed | MVP | Semua layar, HUD race, hand kartu, target picker, layout mobile | [ui-flow.md](ui-flow.md) |
| Art style | designed | MVP | Low-poly chibi, warna cerah, diorama mainan | [art-style.md](art-style.md) |
| Bot | designed | MVP | Simulasi hasil minigame per level, rute & kartu | [gdd.md#bot-b1b3](#bot-b1b3) |
| Preset Short/Long | idea | later | Start/finish berbeda per preset di JSON peta | [map-indonesia.md](map-indonesia.md#format-data-peta-map-agnostic) |
| Multiplayer room code (≤4) | idea | later | Colyseus, server authoritative | — |
| Peta Jepang | idea | later | JSON peta kedua | — |

## Milestones
1. **M1, greybox core loop:** graph peta + 2 minigame (Tap Tepat Waktu, Simon) + 8 kartu base + 1 bot Normal · selesai bila: satu match Sabang→Merauke bisa dimainkan sampai layar hasil.
2. **M2, konten MVP:** 7 minigame, 20 kartu, 3 level bot, semua layar UI, mobile layout.
3. **M3, art + juice:** aset low-poly, feedback minigame, audio dasar, playtest tuning cooldown & rarity.

## Decisions

| ID | Date | Decision | Alternatives considered | Why | Affects |
|---|---|---|---|---|---|
| D-001 | 2026-11-16 | Masuk region = menangkan `winsRequired` minigame di region itu; default 2 | 1 win/region (~6–8 menit, terlalu pendek untuk Standard ~15 menit); minigame lebih panjang (melanggar 15–30 s) | Mencapai durasi Standard dengan rute 5–6 region (R5, R6) | peta, durasi, kartu |
| D-002 | 2026-11-16 | Difficulty efektif (setelah kartu) menentukan knob, cooldown (R2) dan N kartu (K1) | Pakai difficulty dasar region untuk cooldown/reward | Satu aturan sederhana; Santai Dulu punya harga (kartu lebih sedikit), Badai punya sisi baik (kartu lebih banyak) | minigame, kartu |
| D-003 | 2026-11-16 | Edge peta berarah (DAG) | Graph tak berarah + cek "no backtrack" di kode | No backtracking (R6.1) dijamin oleh data | format peta |

## Open questions
Daftar lengkap ada di tiap file; yang paling penting (PM/owner to confirm):
1. `winsRequired = 2` per region untuk Standard (D-001). Opsi: (a) 2 [rekomendasi], (b) 1 dan terima match ~8 menit, (c) 1 di region easy, 2 di medium/hard.
2. Requirements menyebut "base 8" kartu tapi tidak menamai kartunya; Designer menetapkan 8 base (5 boost, 3 sabotase) di [cards.md](cards.md).
3. Satu level untuk semua bot vs level per bot. Rekomendasi: satu level (lebih cepat di setup).
4. Match berakhir untuk semua saat ada yang finish (rekomendasi) vs lanjut sampai pemain finish.
5. Orientasi mobile: portrait-first (rekomendasi) vs landscape-only. Lihat [ui-flow.md](ui-flow.md).
- **Risiko:** (a) minigame "aturan 3 detik" gagal dipahami, cek di playtest pertama (target: 8/10 tester lulus percobaan pertama di easy); (b) sabotase menumpuk ke pemain manusia oleh 3 bot, dibatasi maks 2 sabotase pending per target (lihat [cards.md](cards.md)).

## Change log
**0.1 (2026-11-16):** draft pertama MVP (GDD + 5 dokumen fitur).
