# UI Flow + HUD

**Status:** designed · **Version:** 0.3.2 · **Updated:** 2026-11-17 (v0.3.2, CP5b: §2 Setup disamakan dengan build (jumlah bot + level saja; nama, warna, preset ditandai nanti), badge tempo untuk Whack-a-Mole di §8; v0.3.1, CP5a: hand maks Buang = 10 di §6; v0.3, CP4b: target picker §7, pause di layar kartu, visibilitas slot DR-33, DR-27) · Kembali ke [GDD](gdd.md) · Requirement: K1, K1.1, K2, R2, R9

## 1. Prinsip
- **Screen stack:** layar penuh di-*replace* (Menu → Setup → Race → Hasil); overlay di-*push* di atas Race (Minigame, Kartu, Buang, Target picker, Pause) dan di-*pop* saat selesai. Hanya layar teratas menerima input, **kecuali tombol Pause**: tombol Pause selalu di atas modal apa pun (Penawaran, Buang, Detail, Target Picker) dan bisa ditekan; pause membekukan semua timer game termasuk timer 15 s layar kartu (keputusan PM, QA-CP4a-03).
- **HUD digerakkan event**, bukan polling: `progressChanged`, `handChanged`, `cooldownStarted/Ended`, `pendingEffectsChanged`, `playerMoved`. Saat HUD dipasang, isi nilai awal sekali.
- **Skala:** UI HTML/CSS di atas canvas three.js. Referensi desktop 1920×1080, mobile 390×844 (portrait). Ukuran pakai `rem` + `clamp()`; tata letak pakai flex/grid yang ditambatkan ke sudut/tepi, bukan posisi piksel.
- **Safe area:** semua elemen penting di dalam `env(safe-area-inset-*)`; `viewport-fit=cover`.
- **Aksesibilitas minimum:** teks ≥ 16 px CSS mobile / ≥ 18 px desktop; kontras teks ≥ 4,5:1; target sentuh ≥ 48×48 px; boost vs sabotase dibedakan warna **dan** bentuk/ikon (boost: bingkai bulat + panah atas; sabotase: bingkai bergerigi + ikon petir); fokus keyboard terlihat (Tab/Enter/Esc) di desktop.
- **Bahasa:** semua teks via string key (ID dulu, EN nanti); container menyesuaikan panjang teks.

## 2. Alur layar

```
Splash/Loading ─▶ Menu Utama ─▶ Setup Bot ─▶ Race ─────────────▶ Hasil ─▶ Menu Utama / Main Lagi (Setup sama)
                     │                       │  push: Pilih Region (inline di peta)
                     ├─▶ Pilih Peta          │  push: Minigame (Intro 3 s → Main → Banner)
                     └─▶ Pengaturan          │  push: Penawaran Kartu ─▶ push: Buang Kartu (bila hand > 5)
                                             │  push: Detail Kartu ─▶ push: Target Picker (sabotase)
                                             └  push: Pause ─▶ Pengaturan / Keluar (konfirmasi)
```

| Layar | Isi | Aksi utama (fokus awal) | Back/Esc |
|---|---|---|---|
| Splash/Loading | Logo "Atlas Dash", bar loading aset peta | — | — |
| Menu Utama | Judul "Atlas Dash: Indonesia", diorama berputar pelan di latar | **Main** | — |
| Pilih Peta | Kartu peta: Indonesia (aktif), Japan (terkunci "Segera") | Indonesia | Menu |
| Pengaturan | Volume musik/SFX, getar, kekuatan shake 0–100%, kurangi gerak, kurangi kilat, bahasa | — | tutup |
| Setup Bot | **Dibangun (CP5a):** jumlah bot 1–3 (stepper − / +, ≥ 44 px) dan level bot Easy/Normal/Hard (segmented, satu level untuk semua bot), tombol **Mulai Balapan** (fokus awal). URL `?bots=` dan `?botLevel=` hanya memilih nilai awal; bila keduanya ada, layar dilewati (tes, tautan). **Ditunda (belum dibangun, bukan bagian CP5/CP6 kecuali PM menarik):** nama + warna pion (4 warna) dan pilihan preset (Standard aktif; Short/Long terkunci); sementara itu pemain selalu memakai nama/warna default dan preset Standard | **Mulai Balapan** | Menu |
| Race | Lihat §3 | Mulai (bila target dipilih) | Pause |
| Minigame | Intro 3 s, area main, timer bar, banner hasil | — (input minigame) | Pause (solo) |
| Penawaran Kartu | 5 kartu, "Pilih N" | Kartu pertama | tidak bisa (wajib pilih N) |
| Buang Kartu | Hand + kartu baru (> 5) | — | tidak bisa sampai ≤ 5 |
| Hasil | Podium 1–4, waktu match, rute tiap pemain di peta mini, kartu terbanyak dipakai | **Main Lagi** | Menu Utama |

## 3. Race view (HUD)

### Desktop (landscape)
```
┌──────────────────────────────────────────────────────────────────────────┐
│ [Progres pemain: 🔴Kamu ▓▓▓▓░░ 6 win lagi · 🔵Bot1 ▓▓▓░░░ · 🟢Bot2 ...] [⏸]│
│                                                                          │
│                      DIORAMA ISOMETRIK (peta + pion)                     │
│        region tetangga yang bisa dipilih: bersinar + panah memantul      │
│                                                                          │
│ [Ikon efek pending di kamu: ⚡Jam Rusak  🛡]           [Panel target:      ]│
│                                                       [Bali • easy • 1/2  ]│
│                                                       [(  MULAI  ) / ⏱ 8 ]│
│        [kartu][kartu][kartu][kartu][kartu]   (hand, tengah bawah)        │
└──────────────────────────────────────────────────────────────────────────┘
```

### Mobile (portrait, default; diputuskan PM)
```
┌──────────────────────┐
│ Progres (4 baris ringkas, bisa diciutkan) ⏸ │
│                      │
│   DIORAMA (60% tinggi)│
│   pinch/drag = geser kamera, tap region = pilih │
│                      │
│ ⚡🛡 efek pending      │
│ [Bali • easy • 1/2]  │
│ [     MULAI / ⏱ 8   ] │  ← tombol lebar penuh, ≥ 56 px tinggi
│ [k][k][k][k][k]       │  ← hand, 5 slot sejajar, tiap ≥ 64×88 px
└──────────────────────┘
```
Landscape di mobile tetap jalan: hand pindah ke kolom kanan, progres ke kiri atas.

### Elemen HUD
- **Progres lawan:** satu baris per pemain: warna pion + nama + bar `1 − remainingWins/total` (`total` = `remainingWins` di start, Indonesia = 8; rumus dan tabel di [map-indonesia.md](map-indonesia.md#jarak-ke-finish-dan-remainingwins-dr-07)) + teks "N win lagi" + ikon status (🎮 sedang main, ⏱ cooldown, 🗺 memilih). Urut berdasarkan posisi. Slot sabotase pending ●●/●○/○○ (terlihat semua pemain; nama kartu hanya terlihat target dan pengirim, DR-33; ikon ⚡ tampil bila ≥ 1 slot terisi). Pion bot di diorama juga terlihat bergerak.
- **Pilih region:** setelah masuk region, tetangga yang valid bersinar dan berlabel (nama + badge difficulty E/M/H berbentuk 1/2/3 bintang). Tap/klik untuk menjadikan target; panel target menampilkan nama, difficulty, win `x/winsRequired`, preview kartu per win. Ganti target boleh kapan saja di race view (juga saat cooldown); bila ada win parsial, tampil konfirmasi "Progres 1/2 akan hilang". Cooldown tetap berjalan setelah ganti target (DR-05).
- **Tombol Mulai / cooldown timer:** satu tombol yang berubah status:
  - *Mulai* (aktif bila target dipilih).
  - *Cooldown:* tombol non-aktif dengan ring progres yang mengecil + angka detik besar ("⏱ 8"). Bergetar halus 1× saat cooldown selesai, lalu kembali "Mulai". Ulang **tidak** otomatis: pemain harus menekan Mulai (DR-05); target yang sama memakai minigame yang sama dengan intro 1,5 s.
  - *Menunggu animasi jalan:* disembunyikan 2 s.
- **Efek pending di diri sendiri:** baris ikon kecil di atas panel target; tap = tooltip nama + efek. Sabotase berbingkai merah bergerigi, boost hijau bulat.

## 4. Hand kartu (maks 5, R9)
- 5 slot tetap; slot kosong tampil garis putus-putus (pemain tahu sisa kapasitas).
- Kartu menampilkan: ikon besar, nama, tipe (bentuk bingkai + warna), rarity (permata: common abu, rare biru, epic ungu-emas berkilau).
- **Tap/klik kartu → Detail Kartu** (popover di atas hand): nama, efek 1 kalimat, durasi ("minigame berikutnya"), tombol **Pakai** dan **Batal**. Desktop: hover memperbesar kartu 1,15×; tombol 1–5 memilih kartu.
- Kartu yang tidak bisa dipakai saat ini (mis. Kopi Tubruk di luar cooldown, maxStacks penuh, sabotase tanpa lawan valid, kartu pertahanan kedua) tampil 50% redup dengan alasan di detail ("Hanya saat cooldown", "Semua lawan penuh", "Sudah ada kartu pertahanan aktif").
- Pakai kartu self → animasi kartu terbang ke pion sendiri 0,4 s + ikon pending muncul. Kartu instan langsung berefek.
- Desktop opsional: drag kartu sabotase ke baris progres lawan = pilih target langsung.

## 5. Penawaran Kartu (pilih N dari 5, K1)
- Muncul setelah banner BERHASIL. Judul: "Pilih 2 kartu" (N sesuai difficulty efektif ± kartu Oleh-oleh/Pelit Hadiah).
- 5 kartu terbuka satu per satu (stagger 0,08 s, flip). Tap = tandai (naik + centang), tap lagi = batal. Penghitung "1/2".
- Tombol **Ambil** aktif hanya bila tepat N terpilih. Tidak ada skip (pemain selalu ambil N).
- Bila hand + N > 5 → langsung push **Buang Kartu**.
- Batas waktu 15 s (Q4); habis = sistem memilih otomatis: kartu yang sudah ditandai tetap, sisanya rarity tertinggi, seri → slot paling kiri (DR-25, [cards.md §3.4](cards.md#34-layar-pilih-dan-layar-buang-timer-15-s-dr-25)). Bar waktu tipis di atas.
- N = difficulty efektif ± Oleh-oleh/Pelit Hadiah, min 1 maks 5 ([cards.md §3.3](cards.md#33-jumlah-pilihan-n)).

## 6. Buang Kartu (K1.1)
- Menampilkan semua kartu (hand lama + baru, maks **10**: hand 5 + hard 3 + Oleh-oleh 1, ditambah 1 kartu pantulan Copet yang masuk saat pemain main minigame, [cards.md §1](cards.md#1-aturan-dasar)), kartu baru berlabel "BARU" (kartu pantulan tidak berlabel). Di mobile 10 kartu dibagi 2 baris (QA 390×844: kartu 62×83 px, tombol Buang di y 500–548, Pause tetap bisa ditekan).
- Judul: "Hand penuh! Buang 2 kartu". Tap = tandai buang (kartu miring + ikon tong sampah). Tombol **Buang** aktif bila sisa = 5.
- Batas waktu 15 s; habis = kartu yang sudah ditandai tetap dibuang, kekurangannya diisi rarity terendah dulu, seri → paling lama di hand, kartu BARU paling akhir (DR-25, [cards.md §3.4](cards.md#34-layar-pilih-dan-layar-buang-timer-15-s-dr-25)).

## 7. Target picker sabotase
Aturan validitas target (satu-satunya definisi): [cards.md §2.2.1](cards.md#221-target-valid-k2-q2-satu-satunya-definisi). Di sini hanya perilaku layar.

**Alur**
1. Detail Kartu sabotase `opponent` → **Pakai**.
   - Bila **tidak ada lawan valid**: tombol Pakai tidak aktif (kartu redup di hand) dengan alasan di detail ("Semua lawan penuh", dst.). Picker tidak pernah dibuka kosong.
   - Bila **hanya 1 lawan di match** dan valid: picker dilewati, Pakai langsung berlaku (toast "Jam Rusak → Bot 1").
   - Selain itu picker terbuka (push di atas Race), juga bila hanya 1 dari 3 lawan yang valid (supaya terlihat kenapa yang lain redup).
2. Picker: daftar lawan (kartu besar per lawan, 1 kolom di mobile): warna + nama, posisi (#1–#4), "N win lagi", status (🎮/⏱/🗺), jumlah kartu di hand, slot sabotase terisi (●●/●○/○○). Badge "Terdepan" di peringkat 1. Fokus awal: lawan valid pertama (peringkat teratas).
3. Lawan tidak valid: redup 50%, tidak bisa dipilih, **label alasan** (prioritas dan teks di cards.md §2.2.1): "Hand kosong" (Copet), "Penuh", "Sudah kena kartu ini". Copet tetap valid ke lawan "Penuh".
4. Tap/klik lawan valid → berlaku **seketika** (tanpa dialog kedua) → kartu terbang ke pion lawan 0,5 s + toast. **Batal / Esc / tap di luar** = kembali ke Detail Kartu, kartu tetap di hand.
5. Desktop: drag kartu ke baris progres lawan = pilih target langsung; baris tidak valid menolak drop dengan toast label yang sama.
6. Kartu `all_opponents` (Gunung Meletus): tanpa picker; konfirmasi menyebut dampak: "Kena 2 dari 3 lawan (Bot 3 penuh)" → Ya / Batal. Tidak ada lawan valid = kartu redup.

**Timer, pause, perubahan saat terbuka**
- Picker **tidak punya timer**. Jam game tetap berjalan (cooldown, bot); tidak ada auto-pilih.
- **Pause boleh** di picker (dan di Detail, Penawaran, Buang), mengikuti keputusan PM: tombol Pause tetap di atas modal dan membekukan semua timer game ([cards.md §3.4](cards.md#34-layar-pilih-dan-layar-buang-timer-15-s-dr-25)).
- State lawan bisa berubah selama picker terbuka (jadi penuh, hand kosong). Baris diperbarui lewat event; validasi diulang saat tap. Bila gagal: toast "Bot 2: Penuh", baris redup, picker tetap terbuka, kartu tidak terpakai. Bila semua baris jadi tidak valid: picker menutup dengan toast "Tidak ada lawan yang bisa dikenai".
- Match berakhir (`playerFinished`) saat picker terbuka: picker menutup tanpa efek.
- Lawan adalah bot: picker dan kartu bekerja sama persis (bot tak punya layar; efek bot lihat cards.md §3.2.1).

**Umpan balik**
- Info slot: semua pemain melihat jumlah slot sabotase terisi tiap pemain; nama kartu hanya terlihat oleh target dan pengirim (DR-33). Di picker, slot lawan tampil sebagai ●/○ saja; kartu yang kamu kirim ke lawan itu tampil sebagai ikon kecil bernama di barisnya.
- Hasil tertangkal/terpantul: toast "Bot 2 punya Payung Tameng! Kartumu hangus" / "Dipantulkan ke kamu!" / "Dipantulkan, tapi tertangkal" (pantulan ke pengirim yang penuh).
- Copet berhasil: kartu curian terbang dari pion lawan ke hand kamu + toast "Kamu mencopet Teropong dari Bot 2". Kamu dicopet: toast merah "Bot 1 mencopet Teropong darimu" + slot hand yang kosong berkedip. Dicopet saat Detail/Picker untuk kartu itu terbuka: popover menutup dengan toast "Kartumu dicopet: X". Dicopet saat layar Buang terbuka: jumlah wajib buang dihitung ulang, layar menutup otomatis bila tidak perlu buang lagi, timer tidak direset (cards.md §2.2.5).
- Saat kamu disabotase: toast merah dari atas "Bot 1 memakai Badai ke kamu" + ikon pending baru berkedip 2×.

## 8. Minigame overlay
- Dibuka dengan transisi zoom ke region target 0,4 s → layar minigame.
- **Intro:** kalimat aturan besar di tengah, animasi ikon, 3-2-1. Badge difficulty + ikon modifier aktif (mis. ⚡ Kabut, ⏳ +5 s) di bawah kalimat agar pemain tahu kenapa terasa beda. Di Hindari Rintangan dan Whack-a-Mole, `timeDelta` tidak mengubah durasi, jadi badge-nya "⏳ tempo −15%" (Jam Pasir) / "⏳ tempo +15%" (Jam Rusak), bukan "+5 s"; di Tebak Lokasi badge "⏳ waktu per soal +1,3 s" (nilai nyata dibulatkan 0,1 s); di Ketapel/Cocokkan Kartu "⏳ ±N s" biasa ([cards.md §5](cards.md#5-pemetaan-boost-ke-minigame-yang-sudah-dibangun-cp4a)).
- **Saat main:** timer bar penuh-lebar di atas (di dalam safe area), indikator progres syarat lulus di kiri atas ("2/3"), tombol pause di kanan atas (solo saja). Tidak ada HUD race lain.
- 2D: overlay HTML penuh layar dengan latar diorama di-blur. 3D: scene sendiri.
- **Banner hasil** 1,2 s → BERHASIL → Penawaran Kartu; GAGAL → kembali ke Race dengan cooldown berjalan (Nyawa Cadangan: tanpa cooldown, tombol Mulai langsung aktif; tetap harus ditekan).

## 9. Catatan mobile
- Kunci zoom browser saat main (`touch-action: none` di canvas dan area minigame; `user-scalable=no` hanya di layar game), cegah pull-to-refresh dan tekan-lama memunculkan menu.
- Mintakan fullscreen (Fullscreen API) saat tekan **Mulai Balapan** bila didukung; iOS Safari: abaikan dengan aman.
- Diorama: drag 1 jari = geser, pinch = zoom (batas 0,7–1,5×), tombol "pusatkan ke pionku". Kamera otomatis mengikuti pion saat jalan.
- Getar (Vibration API) hanya untuk sabotase masuk & gagal, bisa dimatikan.
- Saat tab disembunyikan (`visibilitychange`) di mode solo: auto-pause.
- Performa target: 60 fps desktop, ≥ 30 fps HP menengah; UI tetap responsif saat scene 3D berat.

## 10. Finish
- Region yang punya edge ke finish diberi label "FINAL" di diorama dan di panel target ("Menang 2× di sini = juara").
- **Momen menang = event logic `playerFinished`** saat win ke-2 di region final dicatat (DR-06). Sejak event itu semua input dikunci (semua pemain, termasuk hand kartu dan tombol Mulai); minigame/layar lain yang sedang terbuka milik pemain lain ditutup tanpa hasil.
- Lalu (kosmetik saja): banner BERHASIL → layar kartu dilewati (C-3, diputuskan PM) → pion jalan otomatis ke Merauke 2 s → confetti + bendera → layar Hasil.
- Bila bot yang memicu `playerFinished`: toast "Bot 2 sampai Merauke!" 1,5 s → layar Hasil (match berakhir untuk semua).

## Keputusan (CP2)
1. Owner: batas waktu 15 s untuk Penawaran Kartu & Buang Kartu dengan pilihan otomatis (Q4).
2. PM: mobile portrait-first, landscape didukung; ikon ⚡ sabotase pending lawan terlihat semua pemain; layar kartu dilewati setelah win penentu kemenangan (C-3).
3. PM (CP3a): ganti target boleh saat cooldown, cooldown tetap jalan, ulang lewat Mulai (DR-05); input dikunci sejak `playerFinished` (DR-06).

Tidak ada open question tersisa untuk dokumen ini (usulan CP4b yang ditandai ★ ada di [cards.md §6–§7](cards.md#7-pertanyaan-terbuka-untuk-pm)). CP4a: DR-25 dan DR-48 dikerjakan; CP4b: DR-27 dan DR-33 dikerjakan (§7, [cards.md §2.2.5](cards.md#225-copet-saat-target-punya-layarpopover-terbuka-dr-27)). Temuan lain untuk UI (DR-12, DR-13, DR-46) dikerjakan di CP3b/CP6.
