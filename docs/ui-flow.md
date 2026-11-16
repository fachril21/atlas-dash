# UI Flow + HUD

**Status:** designed · **Updated:** 2026-11-16 · Kembali ke [GDD](gdd.md) · Requirement: K1, K1.1, K2, R2, R9

## 1. Prinsip
- **Screen stack:** layar penuh di-*replace* (Menu → Setup → Race → Hasil); overlay di-*push* di atas Race (Minigame, Kartu, Buang, Target picker, Pause) dan di-*pop* saat selesai. Hanya layar teratas menerima input.
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
| Setup Bot | Nama + warna pion (4 warna), jumlah bot 1–3 (stepper), level bot Easy/Normal/Hard (segmented), preset (Standard aktif; Short/Long terkunci) | **Mulai Balapan** | Menu |
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
- **Progres lawan:** satu baris per pemain: warna pion + nama + bar `1 − remainingWins/total` (`total` = `remainingWins` di start, Indonesia = 8; rumus dan tabel di [map-indonesia.md](map-indonesia.md#jarak-ke-finish-dan-remainingwins-dr-07)) + teks "N win lagi" + ikon status (🎮 sedang main, ⏱ cooldown, 🗺 memilih). Urut berdasarkan posisi. Ikon ⚡ kecil bila pemain itu sedang terkena sabotase pending (terlihat semua, tanpa detail kartu). Pion bot di diorama juga terlihat bergerak.
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
- Kartu yang tidak bisa dipakai saat ini (mis. Kopi Tubruk di luar cooldown, maxStacks penuh) tampil 50% redup dengan alasan di detail ("Hanya saat cooldown").
- Pakai kartu self → animasi kartu terbang ke pion sendiri 0,4 s + ikon pending muncul. Kartu instan langsung berefek.
- Desktop opsional: drag kartu sabotase ke baris progres lawan = pilih target langsung.

## 5. Penawaran Kartu (pilih N dari 5, K1)
- Muncul setelah banner BERHASIL. Judul: "Pilih 2 kartu" (N sesuai difficulty efektif ± kartu Oleh-oleh/Pelit Hadiah).
- 5 kartu terbuka satu per satu (stagger 0,08 s, flip). Tap = tandai (naik + centang), tap lagi = batal. Penghitung "1/2".
- Tombol **Ambil** aktif hanya bila tepat N terpilih. Tidak ada skip (pemain selalu ambil N).
- Bila hand + N > 5 → langsung push **Buang Kartu**.
- Batas waktu 15 s (Q4); habis = sistem memilih otomatis N kartu rarity tertinggi (game real-time, bot tidak menunggu). Bar waktu tipis di atas.

## 6. Buang Kartu (K1.1)
- Menampilkan semua kartu (hand lama + baru, maks 8), kartu baru berlabel "BARU".
- Judul: "Hand penuh! Buang 2 kartu". Tap = tandai buang (kartu miring + ikon tong sampah). Tombol **Buang** aktif bila sisa = 5.
- Batas waktu 15 s; habis = buang otomatis kartu common tertua.

## 7. Target picker sabotase
- Muncul setelah **Pakai** pada kartu sabotase bertarget `opponent`.
- Daftar lawan (kartu besar per lawan, 1 kolom di mobile): warna + nama, posisi (#1–#4), "N win lagi", status (🎮/⏱/🗺), jumlah kartu di hand, slot sabotase pending (●●, maks 2).
- Lawan dengan 2 sabotase pending (Q2): redup, label "Penuh", tidak bisa dipilih. Pengecualian: **Copet** (instan, tidak memakai slot) tetap bisa ke lawan "Penuh", tapi tidak bisa ke lawan dengan hand kosong (label "Hand kosong").
- Copet berhasil: kartu curian terbang dari pion lawan ke hand kamu + toast "Kamu mencopet Teropong dari Bot 2". Kamu dicopet: toast merah "Bot 1 mencopet Teropong darimu" + slot hand yang kosong berkedip.
- Rekomendasi: badge "Terdepan" di lawan peringkat 1 (bantu pemain baru).
- Tap lawan → konfirmasi instan (tanpa dialog kedua) → animasi kartu terbang ke pion lawan di diorama 0,5 s + toast "Jam Rusak → Bot 2". Batal = kembali ke detail kartu, kartu tetap di hand.
- Hasil tertangkal/terpantul tampil sebagai toast: "Bot 2 punya Payung Tameng!" / "Dipantulkan ke kamu!".
- Kartu `all_opponents` (Gunung Meletus): tanpa picker; konfirmasi "Kena semua lawan?" → Ya.
- Saat kamu disabotase: toast merah dari atas "Bot 1 memakai Badai ke kamu" + ikon pending baru berkedip 2×.

## 8. Minigame overlay
- Dibuka dengan transisi zoom ke region target 0,4 s → layar minigame.
- **Intro:** kalimat aturan besar di tengah, animasi ikon, 3-2-1. Badge difficulty + ikon modifier aktif (mis. ⚡ Kabut, ⏳ +5 s) di bawah kalimat agar pemain tahu kenapa terasa beda.
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

Tidak ada open question tersisa. Temuan QA lain untuk UI (DR-12, DR-13, DR-25, DR-27, DR-33, DR-46, DR-48) dikerjakan di CP3b/CP4.
