# Test Plan: Atlas Dash MVP (CP3–CP6)

**Oleh:** 🧪 QA · **Tanggal:** 2026-11-16 · **Status:** draft CP2 · Temuan desain: [design-review.md](design-review.md)

Kriteria di bawah mengikuti dokumen desain v0.2 + keputusan C-2/C-3. Kriteria yang bergantung pada temuan yang belum beres ditandai `⚠DR-xx`; isinya diperbarui setelah temuan itu diputuskan.

## 0. Cara uji (berlaku untuk semua CP)

| Lapisan | Alat | Apa | Kapan jalan |
|---|---|---|---|
| Unit | Vitest (`tests/**/*.test.ts`, env node, sudah ada) | Logic pure: peta, gerak, cooldown, RNG, kartu, scoring minigame, bot | `npm test` tiap perubahan |
| Smoke | Playwright (**belum terpasang**, ditambah di CP3) | Build `vite preview`, 2 project: `desktop` 1280×720 mouse, `mobile` 390×844 `hasTouch` + `isMobile` (Chromium); plus WebKit mobile di CP6 | Tiap CP, sebelum lapor |
| Manual | HP Android acuan + iPhone acuan (⚠DR-13), laptop desktop | Rasa, keterbacaan, performa nyata, playtest | Akhir tiap CP |

Baseline 2026-11-16: `npx vitest run` → 3 file, 24 test lulus (architecture, movement, rng). Test movement lama akan diganti sesuai model target (⚠DR-01).

**Kebutuhan testability dari Engineer (diminta mulai CP3):**
1. URL param `?seed=<n>` (match deterministik) dan `?debug=1`.
2. Hook test hanya di mode debug: `window.__atlasTest = { getState(), dispatch(action), forceMinigameResult(passed), setTimeScale(x), events() }`.
3. Tiap minigame mengekspor `generateLevel(ctx)` + aturan skor pure (⚠DR-20) supaya bisa dites tanpa DOM.
4. `data-testid` di tombol/panel utama (Mulai, target panel, hand slot, kartu penawaran, picker, banner, layar Hasil).
5. Log event match (JSON) yang bisa diekspor dari mode debug, untuk playtest (§7).

**Data uji bersama**
- Seed tetap: `1`, `42`, `1337`, `0xDEADBEEF`, `4294967295` (batas uint32). Sweep: seed `1..500` untuk test properti/fuzz, `1..1000` untuk simulasi match.
- Fixture peta (`tests/fixtures/maps/`): `indonesia` (asli), `minimal-valid` (start→A→finish, 1 cabang tambahan), dan peta rusak satu per aturan: `cycle`, `unknown-edge`, `dead-end`, `start-to-finish`, `finish-outgoing`, `route-too-long`, `route-too-short`, `one-branch`, `few-places` (7 place), `places-4-regions`, `unknown-type`.
- Fixture state: "pemain di Jakarta 1/2 win", "pemain di Toraja", "pemain di Labuan Bajo 1/2 (FINAL)", hand penuh 5, hand kosong, target dengan 2 sabotase pending.

---

## CP3: peta Indonesia, framework minigame + 2–3 minigame pertama, cooldown

**Cakupan:** skema + validasi peta, data Indonesia, model target/2 win, cooldown R2, ganti target, finish otomatis, shell minigame (intro, timer, banner, pause), Tap Tepat Waktu + Simon (+ minigame ketiga bila ada), input pointer, HUD race dasar, layar Hasil dasar. Tanpa kartu. Bot placeholder boleh.

**Prasyarat:** blocker DR-01–DR-06 diputuskan.

### Kriteria penerimaan

| ID | Kriteria (bisa dicek) | Jenis |
|---|---|---|
| `map_indonesia_valid` | Peta Indonesia lolos validasi: 10 region, 12 edge, tanpa siklus, 3 node dengan ≥ 2 edge keluar (sabang, jakarta, toraja) | Unit |
| `map_all_routes_in_range` | Enumerasi semua jalur start→finish = 6 jalur; panjang (finish dihitung) A=6, B=5, C=5, semua dalam `routeLength` 5–6 | Unit |
| `map_rejects_invalid_<case>` | Tiap fixture peta rusak ditolak dengan pesan error yang menyebut aturannya; peta yang ditolak tidak bisa dipilih | Unit |
| `map_no_map_ids_in_code` | Tidak ada id/nama region Indonesia (`sabang`, `merauke`, `jakarta`, …) di `src/**/*.ts` (data JSON dikecualikan) | Unit (grep, seperti `architecture.test.ts`) |
| `map_short_preset_validates` | Preset `short` (start Jakarta) lolos bila diaktifkan di fixture (⚠DR-10) | Unit |
| `race_start_no_minigame` | Semua pion mulai di start dalam fase memilih target; start dan finish tidak pernah memicu minigame (⚠DR-11) | Unit |
| `race_target_adjacent_only` | `selectTarget` hanya diterima untuk edge keluar; non-tetangga, region yang sudah dilewati, dan arah balik ditolak dengan alasan; state tidak berubah | Unit |
| `race_two_wins_to_enter` | Win ke-1 → `winsAtTarget=1`, pion tetap; win ke-2 → pion pindah, `winsAtTarget` reset | Unit |
| `race_cooldown_by_difficulty` | Gagal di easy/medium/hard → cooldown 12/8/4 s game-time; Mulai ditolak sebelum habis, diterima tepat setelahnya (batas ±1 tick) | Unit |
| `race_switch_target_rules` | Ganti target tanpa win parsial: boleh. Dengan win parsial: hanya setelah gagal, dan win parsial jadi 0. Cooldown tetap berjalan setelah ganti (⚠DR-05) | Unit |
| `race_final_auto_finish` | Menguasai Labuan Bajo atau Raja Ampat → `playerFinished` + `gameOver` di tick yang sama; aksi semua pemain ditolak setelahnya (⚠DR-06) | Unit |
| `race_first_finisher_wins` | Dua pemain menyelesaikan region final di tick yang sama → yang diproses lebih dulu menang; hasil sama untuk seed sama | Unit |
| `race_shared_regions` | 2–4 pemain di region/target yang sama tidak saling memblokir | Unit |
| `race_remaining_wins_table` | `remainingWins` cocok dengan tabel nilai per node/target (⚠DR-07); dipakai untuk urutan HUD dan Hasil | Unit |
| `race_deterministic_replay` | Seed + log aksi sama → state akhir identik (deep equal) untuk seed tetap | Unit |
| `rng_streams_independent` | Aksi pemain B tidak mengubah hasil undian minigame pemain A (⚠DR-04) | Unit |
| `mg_pick_rules` | Pemilihan minigame seeded, hanya dari pool yang `requires(map)` lolos, tidak sama dengan minigame terakhir pemain; aturan ulang setelah gagal sesuai DR-02 | Unit |
| `mg_<id>_knobs_match_spec` | Parameter `generateLevel` per difficulty = tabel minigames.md (snapshot data, bukan angka ditulis ulang di test) | Unit |
| `mg_<id>_deterministic` | Seed+difficulty+modifiers sama → level sama; seed beda → level beda (dari 100 seed, ≥ 95 unik) | Unit |
| `mg_<id>_scoring` | Input skrip: pas lulus, pas gagal di batas (`missesAllowed`, `mistakesAllowed`, idle 3 s Simon ⚠DR-19), timeout → `reason` yang benar, `progress` 0..1 | Unit |
| `mg_modifiers_applied` | Tiap modifier diterapkan sesuai tabel minigame; durasi di-clamp 10–40 s; modifier tak dikenal → warning, tidak crash | Unit |
| `mg_on_finish_once` | `onFinish` dipanggil tepat 1× untuk lulus, gagal, timeout, `destroy()` di tengah jalan | Unit (jsdom) |
| `mg_pause_excludes_time` | Pause 5 s di tengah minigame tidak menambah `timeTakenMs` dan tidak menghabiskan timer (⚠DR-08) | Unit |
| `mg_destroy_releases` | Setelah 20 minigame berturut-turut: jumlah listener di `window/document` kembali ke baseline; untuk 3D `renderer.info.memory.geometries/textures` kembali ke baseline | Smoke (debug hook) |
| `mg_intro_rule` | Intro 3 s di percobaan pertama, 1,5 s di percobaan ulang (⚠DR-02); kalimat intro ≤ 8 kata (lint semua string key `intro`) | Unit + Smoke |
| `no_math_random` | `Math.random` tidak dipakai di `src/` kecuali pembuatan `matchSeed` (⚠DR-21) | Unit (grep) |
| `smoke_boot_<viewport>` | App terbuka tanpa error console, canvas tampil, tidak ada scroll horizontal (`scrollWidth ≤ innerWidth`) | Smoke desktop + mobile |
| `smoke_loop_<viewport>` | `?seed=42&debug=1`: pilih tetangga → Mulai → intro → paksa gagal → cooldown tampil dan Mulai nonaktif → habis → paksa lulus 2× → pion pindah | Smoke desktop + mobile |
| `smoke_full_race_<viewport>` | Dengan `forceMinigameResult(true)` dan time scale tinggi, pemain sampai Merauke dan layar Hasil tampil | Smoke desktop + mobile |
| `smoke_input_touch_and_mouse` | Tap Tepat Waktu & Simon bisa dimainkan dengan `page.mouse` (desktop) dan `page.touchscreen.tap` (mobile); 1 tap = 1 aksi (tidak ada dobel pointerdown+click); keyboard Spasi/1–6 di desktop | Smoke |
| `smoke_touch_targets` | Semua elemen interaktif yang terlihat ≥ 48×48 px CSS; tombol Mulai mobile ≥ 56 px tinggi | Smoke |
| `smoke_no_page_gestures` | Area minigame & canvas `touch-action: none`; swipe/drag di mobile tidak menggulir halaman (`scrollY` tetap 0) | Smoke |
| `smoke_layout_safe` | Di 1280×720, 390×844 dan 844×390: HUD, panel target, Mulai berada penuh di dalam viewport dan tidak saling tumpuk (bounding box) (⚠DR-12) | Smoke + screenshot |
| `manual_3s_rule` | 3 orang yang belum pernah main memahami Tap Tepat Waktu & Simon dari intro saja (ditanya "apa yang harus kamu lakukan?" setelah intro) | Manual |
| `manual_perf_race` | Race view 4 pion: p95 frame time ≤ 16,7 ms desktop, ≤ 33,3 ms HP acuan, 60 s; draw call ≤ 150, tris ≤ 80k (`renderer.info`) | Manual + overlay debug |

---

## CP4: kartu (20), hand/buang, target sabotase, comeback

**Cakupan:** `cards.json`, interpreter efek, penawaran 5 kartu + rarity/tier, pilih N, buang ke 5, timer 15 s, pending/netting, batas Q2, maxStacks, Payung/Cermin, Copet, Tiket Pesawat (C-2), lewati layar kartu setelah win final (C-3), UI hand/detail/picker/toast.

**Prasyarat:** DR-23–DR-31, DR-33 diputuskan.

| ID | Kriteria | Jenis |
|---|---|---|
| `cards_data_matches_spec` | 20 kartu, id unik; 11 boost / 9 sabotase; rarity 10/7/3; 8 base = 5 boost + 3 sabotase; tiap `op` valid untuk `duration`-nya; Copet `usesSabotageSlot=false` | Unit |
| `offer_constraints` | Untuk seed 1..500 dan semua tier: 5 kartu, tidak ada id kembar, ≥ 1 boost, ≥ 1 sabotase, tier "Tertinggal"/"Jauh tertinggal" ≥ 1 rare+; selesai tanpa loop tak berujung (⚠DR-26) | Unit (properti) |
| `offer_distribution` | 20.000 penawaran per tier: proporsi rarity berada dalam ±1,5 pp dari nilai yang **dihitung dari algoritma final** (bukan bobot mentah, karena dedupe & jaminan menggeser distribusi) | Unit |
| `offer_deterministic` | Seed+pemain sama → penawaran sama; RNG kartu tidak terpengaruh RNG minigame | Unit |
| `comeback_tier_boundaries` | gap 0 / 1 / 2 / 3 / 4 / 5 / 8 → tier yang benar | Unit |
| `pick_count_rules` | N = 1/2/3 dari difficulty **efektif**; Oleh-oleh +1 (maks 5); Pelit Hadiah −1 (min 1); keduanya = net 0 | Unit |
| `hand_limit_and_discard` | Hand > 5 → layar Buang wajib; tidak bisa ditutup sebelum = 5; hand ≤ 5 setiap kali layar Buang tutup | Unit + Smoke |
| `card_screen_timeout` | Dengan `page.clock`: 15 s di layar pilih → auto-pick sesuai aturan; 15 s di layar Buang → auto-buang sesuai aturan (⚠DR-25) | Unit + Smoke |
| `card_zones_invariant` | Fuzz 500 seed × 200 aksi acak (pakai, curi, pantul, buang): tiap instance kartu tepat di 1 zona, tidak ada duplikat, total instance konsisten | Unit (properti) |
| `pending_applied_at_start` | Pending diterapkan saat Mulai dan habis setelahnya; kartu ke target yang sedang main menunggu minigame berikutnya; durasi `next_fail`/`next_reward` sesuai DR-23 | Unit |
| `netting_and_clamp` | Jam Pasir + Jam Rusak = 0 s; Santai + Badai = difficulty dasar; 2× Jam Rusak di minigame 15 s → 10 s; 2× Jam Pasir di 30 s → 40 s | Unit |
| `effective_difficulty_drives_rewards` | Santai Dulu di region hard → cooldown 8 s & 2 kartu; Badai di medium → 4 s & 3 kartu (D-002) | Unit |
| `sabotage_cap_two` | Target dengan 2 sabotase pending tidak bisa dipilih ("Penuh") untuk sabotase pending, dari sumber mana pun termasuk pantulan | Unit + Smoke |
| `max_stacks` | Jam Pasir/Jam Rusak maks 2, lainnya 1; lewat batas = kartu tidak bisa dimainkan dan tetap di hand (⚠DR-29) | Unit |
| `defense_payung_cermin` | Payung menangkal 1 sabotase (keduanya habis); Cermin memantulkan ke pengirim; pengirim penuh → hanya tertangkal; maks 1 defensif aktif; pantulan tidak memantul lagi (⚠DR-28) | Unit |
| `gunung_all_opponents` | Kena tiap lawan dengan cek tameng/cermin/batas masing-masing; aturan bila sebagian penuh (⚠DR-29) | Unit |
| `copet_<case>` | Matriks Copet: (1) normal: 1 kartu pindah, seragam (chi-square 6.000 percobaan, hand 5 berbeda); (2) target hand kosong tidak bisa dipilih; (3) semua lawan kosong → Copet redup; (4) target "Penuh" tetap bisa; (5) pencuri hand 5 termasuk Copet → akhir 5; (6) Payung target → keduanya habis, tidak ada yang pindah; (7) Cermin, hand pencuri kosong → gagal, Cermin habis; (8) Cermin, hand target 5 → target ke layar Buang; (9) target sedang minigame → Buang setelah minigame, digabung dengan layar kartu bila menang; (10) kartu yang sedang dibuka di Detail dicopet (⚠DR-27); (11) seed sama → kartu yang dicuri sama | Unit (+ Smoke untuk 10) |
| `tiket_pesawat_rules` | Masuk target terpilih tanpa minigame dan tanpa kartu; **ditolak** untuk Labuan Bajo dan Raja Ampat (punya edge ke finish, C-2); diterima untuk Toraja/Padang/Bali dll.; kondisi cooldown/win parsial sesuai DR-31 | Unit |
| `instant_and_fail_cards` | Kopi Tubruk hanya saat cooldown; Nyawa Cadangan → tanpa cooldown; Macet +6 s; Nyawa+Macet sesuai DR-24; Ojek Kilat → 1 win dihitung 2 (maks `winsRequired`) | Unit |
| `final_win_skips_card_screen` | Win penentu kemenangan (win ke-2 di FINAL, atau win pertama dengan Ojek Kilat) tidak membuka layar kartu (C-3); win ke-1 di FINAL tetap membuka | Unit + Smoke |
| `cards_locked_during_minigame` | Kartu tidak bisa dimainkan saat minigame, intro, layar kartu/buang; boleh sebelum Mulai, saat cooldown, saat animasi jalan | Unit + Smoke |
| `smoke_hand_ui_<viewport>` | 5 slot (kosong = garis putus-putus), Detail Pakai/Batal, kartu redup dengan alasan, picker dengan label "Penuh"/"Hand kosong", toast sabotase/copet tampil | Smoke |
| `smoke_type_not_color_only` | Kartu boost dan sabotase punya bentuk bingkai/ikon berbeda (cek class/ikon), tidak hanya warna | Smoke |
| `manual_card_readability` | 3 tester bisa menjelaskan efek 5 kartu acak hanya dari Detail Kartu | Manual |

---

## CP5: bot (3 level), sisa minigame

**Cakupan:** bot Easy/Normal/Hard (rute, kartu, simulasi hasil), setup 1–3 bot, sisa minigame (Hindari Rintangan 3D, Whack-a-Mole, Ketapel 3D, Cocokkan Kartu, Tebak Lokasi), pause membekukan bot.

**Prasyarat:** DR-15, DR-18, DR-32, DR-34–DR-37 diputuskan.

| ID | Kriteria | Jenis |
|---|---|---|
| `bot_pass_rates` | 10.000 simulasi per level × difficulty: rasio lulus dalam ±1,5 pp dari tabel GDD; modifier ±8 pp per jenis (⚠DR-35), clamp 5–98% | Unit |
| `bot_attempt_time` | Waktu percobaan dalam rentang tabel × durasi efektif (⚠DR-34) | Unit |
| `bot_route_policy` | Easy: acak di antara tetangga (semua muncul dalam 200 seed); Normal: `remainingWins` terkecil, tie sesuai DR-36; Hard: expected time terkecil sesuai rumus | Unit |
| `bot_card_policy` | Easy 30%/kesempatan, target acak; Normal sabotase ke pemimpin; Hard simpan Payung/Cermin, Copet ke hand terbanyak, Tiket di region hard **kecuali** region FINAL (C-2); keputusan tiap 2–4 s | Unit |
| `bot_obeys_rules` | Simulasi 1.000 match (3 bot, tiap level, seed 1..1000): bot tidak pernah melanggar R6.1, hand ≤ 5, batas Q2, cooldown; jumlah aksi bot yang ditolak = 0 | Unit (simulasi) |
| `sim_match_terminates` | Semua 1.000 match berakhir dengan pemenang dalam ≤ 60 menit game-time; tidak ada state macet | Unit (simulasi) |
| `sim_match_report` | Output laporan: median/p10/p90 durasi per level bot, pemakaian rute A/B/C, kartu terpakai per id (dipakai di §7 dan C-1) | Unit (simulasi, tidak gagal, hanya laporan) |
| `setup_bot_count_level` | Setup 1–3 bot, satu level untuk semua; nilai di luar rentang ditolak | Unit + Smoke |
| `mg_<id>_*` (5 minigame baru) | Sama seperti CP3: knob, determinisme, scoring, modifier, `onFinish` sekali, destroy | Unit |
| `mg_dodge_specifics` | `timeDelta` −5 s → kecepatan +15%, durasi tetap; `extraTarget` di nyawa 1 → +5 s; selalu ada ≥ 1 jalur kosong per baris (500 seed) | Unit |
| `mg_whack_decoy_fail` | Pukulan decoy melebihi batas → gagal langsung; jumlah spawn cukup untuk lulus (⚠DR-15) | Unit |
| `mg_slingshot_drag` | Drag < 5% = batal tanpa memakai peluru; drag maks 25% tinggi layar = 100% kekuatan; peluru habis → gagal | Unit + Smoke |
| `mg_memory_shuffle` | Fisher-Yates seeded; tiap ikon tepat 2×; ikon dari data peta saja | Unit |
| `mg_guess_location_data` | Soal hanya dari `map.places`, jawaban = `place.regionId`, tanpa soal kembar per minigame, `requires` menolak peta dengan < 8 place atau < 5 region | Unit |
| `mg_3d_budget` | Hindari Rintangan & Ketapel: tris ≤ 60k, p95 frame ≤ 33,3 ms di HP acuan | Manual + overlay |
| `pause_freezes_bots` | Pause/`visibilitychange` hidden: posisi, cooldown, dan timer bot tidak berubah selama 10 s pause | Unit + Smoke |
| `smoke_full_match_vs_bots_<viewport>` | `?seed=42&debug=1`, 3 bot Hard, time scale tinggi, `forceMinigameResult` acak seeded → layar Hasil dengan podium 1–4 | Smoke desktop + mobile |

---

## CP6: polish, cek mobile, playtest, build MVP

**Cakupan:** juice/feedback, audio dasar, aksesibilitas, mobile nyata (iOS Safari, Android Chrome), performa, playtest, build produksi.

| ID | Kriteria | Jenis |
|---|---|---|
| `build_prod` | `npm run build` lulus (typecheck + vite build); smoke CP3–CP5 lulus terhadap `vite preview` build itu | Smoke |
| `a11y_text_contrast` | Teks ≥ 16 px mobile / ≥ 18 px desktop (cek computed style); kontras ≥ 4,5:1 (axe-core di Playwright) pada Menu, Setup, Race, Kartu, Picker, Hasil | Smoke |
| `a11y_keyboard_focus` | Desktop: semua layar bisa dijalankan dengan Tab/Enter/Esc, fokus terlihat, fokus awal sesuai tabel ui-flow §2, fokus tidak keluar dari overlay | Smoke |
| `a11y_reduced_settings` | Shake 0% → offset kamera 0; `reducedMotion` mematikan shake, zoom, loop idle; `reducedFlash` mengganti flash dengan outline | Unit + Smoke |
| `feel_limits` | Hit-stop ≤ 0,15 s dan time scale kembali 1,0 (termasuk 2 event berselang 30 ms); flash ≤ 3×/detik; trauma shake kembali 0 dalam 1/decay s | Unit |
| `feel_events_fire` | Tiap event di tabel minigames.md §1.4 (benar, salah, lulus, gagal, timer < 5 s) memicu feedback-nya (log feedback di mode debug) | Smoke |
| `manual_feel_check` | Tester menilai tiap minigame: "benar/salah terasa jelas?" (ya/tidak), tidak ada yang merasa pusing | Manual |
| `perf_desktop` | p95 frame ≤ 16,7 ms di laptop acuan, race view + tiap minigame 3D, VSync dicatat | Manual |
| `perf_mobile_thermal` | HP acuan, sesi 15 menit: p95 frame awal dan akhir ≤ 33,3 ms; tidak ada hitch > 100 ms saat minigame 3D pertama dibuka | Manual |
| `perf_no_leak` | Setelah 1 match penuh + 1 "Main Lagi": geometri/tekstur three.js dan heap kembali ±10% dari baseline | Smoke (debug hook) + Manual |
| `mobile_real_devices` | iOS Safari + Android Chrome: safe area notch, rotasi portrait↔landscape tanpa kehilangan state, tidak ada pull-to-refresh/zoom/menu tekan-lama, fullscreen aman di iOS, audio jalan setelah tap pertama, auto-pause saat pindah app | Manual |
| `smoke_webkit_mobile` | Smoke CP3–CP5 versi mobile di WebKit Playwright | Smoke |
| `playtest_targets` | Lihat §7: angka diukur dan dilaporkan; keputusan keep/retune per minigame tercatat | Manual |
| `match_length_target` | Median durasi match pemain kasual vs 3 bot Normal sesuai target C-1 (**angka menunggu owner**, ⚠DR-22) | Manual + simulasi |

---

## 7. Protokol playtest MVP (CP6)

**Pertanyaan utama:** apakah 1 match Standard terasa pas durasinya, minigame dipahami dalam 3 detik, dan kartu dipakai (bukan diabaikan)?

**Peserta:** 6–8 pemain kasual yang belum pernah main + 2 pemain berpengalaman. Perangkat campur (≥ 3 di HP).

**Sesi (± 35 menit per orang):**
1. Tanpa penjelasan apa pun. Match 1: 3 bot **Normal**, seed tetap per tester (dicatat).
2. Match 2: 3 bot **Easy** atau **Hard** (bergantian antar tester).
3. Wawancara 3 pertanyaan: bagian paling seru? paling membingungkan? kartu mana yang terasa tidak adil?
4. Pengamat mencatat: kebingungan setelah intro, momen menunggu tanpa bisa berbuat apa-apa, reaksi saat disabotase/dicopet.

**Yang diukur (dari log event debug, bukan ingatan):**

| Metrik | Target awal | Tindakan bila meleset |
|---|---|---|
| Durasi match (median, p90), per level bot | ⚠ target C-1 dari owner | Tuning sesuai tuas yang disetujui owner (cooldown, durasi minigame, struktur peta) |
| Pass rate percobaan pertama per minigame × difficulty | easy 80% / medium 60% / hard 40% (±10 pp) | Meleset > 15 pp → retune 1 knob, ulangi |
| Pass rate keseluruhan per difficulty | sama | — |
| Paham dari intro (easy, percobaan pertama) | ≥ 8/10 tester lulus (GDD risiko a) | < 6/10 → ganti kalimat/animasi intro; tetap gagal → keluarkan dari pool |
| Percobaan per region, total waktu cooldown per match | dicatat | Cooldown > 25% durasi match → turunkan cooldown |
| Layar kartu: waktu rata-rata, jumlah auto-pick/auto-buang karena 15 s | auto < 20% | > 20% → UI kartu terlalu lambat dibaca |
| Kartu dipakai per id (manusia vs bot), kartu tak pernah dipakai | tiap kartu dipakai ≥ 1× di seluruh sesi | Kartu 0× → cek keterbacaan/kekuatan |
| Sabotase diterima per pemain, Copet per match | dicatat | Keluhan "Copet menyebalkan" ≥ 3 tester → turunkan rarity atau ubah bot (GDD risiko b) |
| Rute yang dipilih (A/B/C, Medan/Padang) | tidak ada rute > 70% | Rute dominan → atur ulang difficulty node |
| Waktu tanpa input yang mungkin (DR-09) | tidak ada blok > 3 s di luar cooldown | Temukan layar penyebab |
| Posisi akhir manusia vs level bot | Normal: manusia menang 30–60% | Terlalu mudah/sulit → ubah tabel peluang bot |

**Keputusan per minigame setelah playtest:** keep (target terpenuhi), retune (ubah 1 knob, uji lagi), atau kill (gagal aturan 3 detik setelah 1 retune). Dicatat di laporan playtest bersama seed dan log mentah.

## 8. Yang dibutuhkan dari keputusan C-1 (owner)

1. **Angka target** durasi Standard dan toleransinya (mis. median 10–13 menit atau 15 ± 2 menit).
2. **Profil pengukuran:** pemain kasual vs 3 bot Normal (usulan QA), diukur di playtest dan di simulasi CP5 (`sim_match_report`).
3. **Tuas yang boleh dipakai** bila meleset: cooldown, durasi minigame, `winsRequired` per tipe, atau node peta (opsi b menyentuh R6 "~9–10 node").
4. Kapan diputuskan: paling lambat sebelum CP6 dimulai, supaya `match_length_target` bisa lulus/gagal. CP3–CP5 tidak terhalang.
