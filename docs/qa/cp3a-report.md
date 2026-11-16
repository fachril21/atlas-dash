# Laporan QA CP3a

**Oleh:** 🧪 QA · **Tanggal:** 2026-11-16 · **Build:** CP3a di `main` (tanpa perubahan `src/`)

## Hasil jalan

| Perintah | Hasil |
|---|---|
| `npm test` | 5 file, **82 test lulus** (architecture, map, race, rng, tapTiming) |
| `npm run build` (typecheck + vite build) | lulus; bundle JS 595 kB (gzip 154 kB) |
| `npm run test:e2e` (Playwright 1.56.1, Chromium headless, SwiftShader) | 24 terjadwal: **23 lulus, 1 skip** (tes keyboard khusus desktop, di-skip di mobile), 0 gagal |

Dua perbaikan kecil di tes (bukan bug game) dilakukan setelah run penuh terakhir: tes `smoke_full_race` (path salah menyertakan Merauke sebagai target) dan satu baris sisa di tes pause. Kedua tes itu dijalankan ulang dan lulus di desktop + mobile; run penuh 24-tes tidak diulang setelahnya.

Menjalankan e2e di mesin tanpa pustaka sistem: `PW_CHROMIUM_PATH` (executable) dan `PW_EXTRA_LIBS` (dir library) dibaca `playwright.config.ts`. Di mesin biasa cukup `npx playwright install chromium`. Tanpa font di mesin ini, teks tidak tampil dan span teks berukuran 0, jadi tes memakai `toHaveText` untuk timer cooldown.

## Kriteria penerimaan CP3a

| Kriteria | Status | Bukti |
|---|---|---|
| `map_indonesia_valid`, `map_all_routes_in_range` | LULUS | `tests/map.test.ts` |
| `map_rejects_invalid_<case>` | LULUS | `tests/map.test.ts` (peta rusak dibuat di dalam test; belum ada folder `tests/fixtures/maps/`, tidak dibutuhkan) |
| `map_no_map_ids_in_code`, `no_math_random` | LULUS | `tests/architecture.test.ts` |
| `map_short_preset_validates` | LULUS | `tests/map.test.ts` |
| `race_start_no_minigame`, `race_target_adjacent_only`, `race_two_wins_to_enter` | LULUS | `tests/race.test.ts` + e2e `smoke_loop` (non-tetangga tidak bisa dipilih lewat klik/tap, tetangga bisa) |
| `race_cooldown_by_difficulty` | LULUS (unit) | `tests/race.test.ts`; e2e memastikan timer cooldown tampil dan Mulai nonaktif |
| `race_switch_target_rules` (versi baru: kapan saja, konfirmasi bila ada win parsial) | LULUS | unit + e2e (Batal mempertahankan target/win; Ya pindah dan win jadi 0) |
| `race_final_auto_finish`, `race_first_finisher_wins`, `race_shared_regions`, `race_remaining_wins_table`, `race_deterministic_replay`, `rng_streams_independent` | LULUS | `tests/race.test.ts`, `tests/map.test.ts`, `tests/rng.test.ts` |
| `mg_pick_rules` (seeded, tidak sama dengan yang terakhir, ulang setelah gagal) | LULUS sebagian | race.test.ts mencakup retry + beda dari yang terakhir; pool CP3a hanya 1 minigame, jadi aturan "tidak sama" baru teruji penuh di CP3b |
| `mg_tap_timing_knobs/deterministic/scoring/modifiers` | LULUS | `tests/tapTiming.test.ts` |
| `mg_on_finish_once`, `mg_destroy_releases`, `mg_intro_rule` (3 s / 1,5 s) | LULUS sebagian | intro 3/1,5 s di race.test.ts; `onFinish` sekali dijaga kode (tidak ada test jsdom, env test = node); pelepasan listener 20 minigame belum diukur |
| `mg_pause_excludes_time` | LULUS | e2e: waktu game beku saat pause (di race view dan saat minigame) |
| `smoke_boot` (desktop + mobile) | LULUS | tanpa error console, canvas, 10 label region, tanpa scroll horizontal |
| `smoke_loop` (desktop + mobile) | LULUS | pilih -> Mulai -> intro -> gagal -> cooldown -> 2 win -> pion pindah |
| `smoke_full_race` (desktop + mobile) | LULUS | layar Hasil tampil (2 baris), "Main Lagi" mereset |
| `smoke_input_touch_and_mouse` | LULUS | 1 tap/klik di area main = tepat 1 aksi (tidak dobel); Spasi dan tombol angka bekerja di desktop. Simon belum ada (CP3b) |
| `smoke_touch_targets` | LULUS | semua elemen interaktif yang menerima pointer >= 48x48; Mulai di mobile >= 56 px |
| `smoke_no_page_gestures` | LULUS | `touch-action: none` di canvas dan overlay minigame; swipe tidak menggulir (scrollY 0). Catatan: diuji dengan drag mouse/emulasi, bukan jari asli |
| `smoke_layout_safe` | LULUS | 1280x720, 390x844, 844x390: progress, panel target, Mulai, Pause di dalam viewport dan tidak saling tumpuk |
| Ekspor log debug | LULUS | format `atlas-dash-match-log@1`, seed hex terbaca |
| `manual_3s_rule`, `manual_perf_race` | BELUM DIUJI | perlu manusia / perangkat nyata |

## Bug

Tidak ada bug ditemukan oleh tes otomatis di build ini. Tidak ada kebutuhan perubahan `src/` untuk tes.

Catatan (bukan bug, keterbatasan uji): 
- Label region yang tidak bisa dipilih memakai `pointer-events: none`, jadi klik di atasnya jatuh ke canvas (perilaku benar; tes mengklik koordinatnya).
- Elemen teks tidak punya ukuran tanpa font, jadi cek `toBeVisible` pada teks mentah tidak andal di mesin ini.

## Perlu HP asli / playtest manual

- Rasa Tap Tepat Waktu di HP: latensi tap, jarum 60 fps, getar saat salah, tap beruntun cepat. Headless hanya ~6 fps.
- Aksi `touch` asli: gestur sistem (pull-to-refresh, zoom, tekan lama), safe area notch, rotasi portrait/landscape saat minigame.
- Keterbacaan label region + bintang difficulty di layar kecil, dengan font nyata (di mesin QA tidak ada font).
- Performa race view (p95 frame, draw call, tris) di HP acuan; kebocoran listener/memori setelah banyak minigame.
- Aturan 3 detik: 3 orang baru memahami Tap Tepat Waktu dari intro saja.
- Auto-pause saat tab disembunyikan (`visibilitychange`) dan iOS Safari: tidak bisa diuji headless Chromium.
- Layar Hasil dan tombol di HP: tap "Main Lagi" dengan jari.
