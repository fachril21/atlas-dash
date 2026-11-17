# Bot Pintar — Spesifikasi (CP5a, disinkronkan dengan build)

**Status:** designed · **Version:** 0.2 · **Updated:** 2026-11-17 (v0.2, CP5b: disinkronkan dengan build CP5a dan keputusan PM; aksi `chooseCards`, `routeMistake` di antara tetangga bukan terbaik, observasi memuat jenis sabotase pending lawan, Copet setelah Badai, pace Normal 840 s / Hard 610 s, `afterWinMs` manusia referensi baru, gerbang baru C-1 / Hard, catatan luapan; data bot per minigame baru) · Kembali ke [GDD](gdd.md) · Requirement: B1, B2, B3, R2, R6.1, R8, Q2, C-1 · Menyelesaikan DR-32, DR-34, DR-35, DR-36, DR-37

Semua angka adalah titik awal. Angka bertanda "analitis" dihitung dengan tangan dari rumus §10, bukan disimulasikan. Nilai yang **sudah disetel di build CP5a** (QA simulasi, diterima PM) ada di §8–§10 dan di `src/logic/botProfiles.ts`; kode menang bila ada selisih. Pass chance dasar per level **tidak berubah** dari yang sudah dibangun (`BOT_PASS_CHANCE`).

## 1. Prinsip
1. **Bot memainkan aturan yang sama dengan manusia** (B2): aksi lewat `GameAction` yang sama, memakai validator yang sama dengan UI (`canStartAttempt`, `selectableTargets`, playability kartu, target valid cards.md §2.2.1). Nol aksi ditolak reducer (`actionRejected`) dari bot.
2. **Kecerdasan = pilihan, bukan curang.** Level menentukan: peluang lulus, rute, pemilihan/pemakaian kartu, kecepatan reaksi. Bot tidak pernah mendapat bonus aturan.
3. **Satu-satunya "bantuan" ke bot adalah rem, bukan gas** (§4): bot yang sedang memimpin menahan diri supaya match tetap 10–13 menit (C-1). Bot tidak pernah dipercepat.
4. **Semua acak dari stream bernama milik bot**, jadi seed sama + aksi sama → hasil sama.

## 2. Informasi yang boleh dibaca (DR-33)
Bot hanya melihat apa yang dilihat pemain manusia di layar.

| Boleh | Tidak boleh |
|---|---|
| State sendiri penuh: hand, pending, kartu pertahanan sendiri, cooldown, `targetId`, `winsAtTarget`, kartu sedang dipakai | `nextMinigameId` sendiri sebelum **Mulai** (disembunyikan dari manusia; mencegah "mengocok" lewat ganti target) |
| Tiap lawan: `nodeId`, `remainingWins`, status (main / cooldown / jalan), **jumlah** kartu di hand, **jumlah** slot sabotase terisi (0–2), dan **jenis (id) kartu sabotase pending** yang memegang slot lawan, **hanya dibaca validator** (lihat catatan di bawah tabel) | Isi hand lawan, `pending` boost lawan, Payung/Cermin aktif lawan, pengirim atau urutan kartu sabotase pending |
| `targetId` lawan **tidak** dipakai (picker tidak menampilkannya) | State stream RNG siapa pun (`pickRng`, `cardsRng`, `copetRng`, seed percobaan), hasil percobaan lawan yang belum selesai, isi penawaran lawan |
| Validitas target lewat fungsi validator (label "Sudah kena kartu ini" memang kebocoran yang disengaja, cards.md §1) | `matchSeed` untuk meramal apa pun |

**Catatan jenis sabotase pending (build CP5a, diterima PM):** observasi (`botObservation.ts`) membawa `{ uid, defId, seq }` untuk kartu sabotase pending lawan karena validator target valid butuh "Sudah kena kartu ini" (kebocoran yang disengaja, [cards.md §1](cards.md)). Keputusan bot hanya memakai `sabotageSlotsUsed` dan hasil validator, tidak pernah membaca `defId` itu langsung (dijaga scan sumber dan probe QA: 2.859 jenis kartu ditukar, 3.660 keputusan identik). Manusia hanya melihat label itu untuk kartu yang sedang ia pegang; bot punya daftar penuh lewat validator.

Tes metamorfik wajib (§11 #6): ubah semua kolom "Tidak boleh" pada salinan state, aksi bot harus identik.

## 3. Simulasi percobaan (DR-34, DR-35)
Bot tidak memainkan minigame; hasilnya diundi saat percobaan mulai dari stream `bot` (dua tarikan **tetap** per percobaan: `chance` lalu `range`, supaya tes lama tetap stabil).

1. **Peluang lulus** `p = clamp(BOT_PASS_CHANCE[level][difficulty efektif] + 8 poin × tiap jenis modifier setelah netting, 5%, 98%)`. Sudah dibangun (`botPassChance`); tabel jenis +/− di [cards.md §3.2.1](cards.md#321-bot-di-cp4b-dr-32). Kartu non-minigame (Ojek, Nyawa, Macet, Pelit) tidak mengubah `p`.
2. **Durasi efektif `D`** = `level.durationMs + (level.previewMs ?? 0)` dari `generateLevel` (sudah memuat `timeDelta` ter-clamp, `speed`, dan `extraTarget`; `previewMs` hanya ada di Cocokkan Kartu). Durasi dasar per minigame dan efek pool 7: [minigames.md §9](minigames.md#9-ringkasan). Peluang lulus **sama untuk semua minigame** (tidak ada peluang per minigame).
3. **Waktu main:** lulus → `D × U(passTimeFrac[level])`; **kecuali minigame tipe bertahan (`dodge_runner`, satu-satunya, `SURVIVAL_MINIGAMES`): lulus = 100% `D`** (survive sampai habis). Gagal → `D × U(0.4, 1.0)`. `timeTakenMs` = nilai itu.
4. **Hasil dikirim** pada `startedAtMs + introMs + timeTakenMs + RESULT_BANNER_MS` (sudah dibangun). Pause membekukan karena memakai jam game.
5. Cooldown, N kartu, efek `onWin/onFail` dihitung reducer seperti pemain.

**Jeda reaksi** (semua dari stream `botMind`, uniform dalam rentang; nilai di §8):
| Jeda | Mulai | Isi |
|---|---|---|
| `afterWinMs` | saat hasil **menang** dikirim | Meniru membaca layar kartu, animasi jalan, menimbang rute. Gerak (pilih target, Mulai) menunggu jeda ini |
| `thinkMs` | setelah pilih target, dan setelah cooldown habis | Jeda sebelum tekan Mulai / sebelum pilih target berikutnya |
| `tickMs` | tiap evaluasi kartu | Bot mengevaluasi kartu sekali tiap tick (gdd: "tiap 2–4 s") |
| `cardGapMs` | setiap kartu dimainkan | Jarak minimum antar dua kartu |

## 4. Rem pemimpin ("ritme", menjaga C-1)
Pass chance tabel + jeda manusiawi membuat Normal/Hard lebih cepat dari pemain kasual (§10). Tanpa rem, match solo-vs-bot ≈ 7–10 menit dan C-1 (median 10–13) pecah. Aturannya satu:

> Bot **menunda menekan Mulai** bila **(a) memimpin** (`remainingWins` ≤ `remainingWins` semua pemain lain; seri = memimpin) **dan (b) di depan jadwal**: `timeMs < paceTargetMs × (total − remainingWins) / total − paceSlackMs`, dengan `total` = `remainingWins` di start (Indonesia: 8). Cek ulang tiap 1 s.

- Bot yang **tertinggal** tidak direm: ia berjalan dengan kecepatan alami. Bot tidak pernah dipercepat; bot yang sial gagal berkali-kali jadi lebih lambat dari jadwal.
- Efek: bot terdepan melambat ke jadwal `paceTargetMs`; pengejar bebas. Batas bawah waktu selesai bot ≈ `paceTargetMs × (total−1)/total` + 1 percobaan (± 0,8 mnt) ≈ **9,7 menit** (Hard, pace 610 s; terukur p95 vs 1 Hard = 9,7), **13,0** (Normal, pace 840 s), 13,5 (Easy, pace 870 s). Karena itu Hard bisa mengakhiri match jauh lebih awal dari Normal/Easy.
- Rem hanya untuk bot, tidak untuk "manusia referensi" (§9). Pemain manusia cepat tetap bisa menang lebih awal dari 10 menit: C-1 berlaku untuk **median pemain kasual melawan bot Easy dan Normal saja** (§10); melawan Hard median target [7, 9] menit (keputusan PM, §10).
- Dengan pace Hard 610 s, jendela yang memenuhi semua gerbang Hard sekitar **600–620 s** (di bawah ≈ 600: casual vs 1 Hard < 15%; di atas ≈ 620: median vs 1 Hard > 9,0 dan casual vs 3 Hard mendekati 12%). Perubahan kecil di cooldown, durasi minigame, atau `afterWinMs` manusia menggeser jendela ini.
- Race view harus menampilkan bot yang menahan diri sebagai "berpikir/menahan diri", bukan beku (keputusan PM; sudah dibangun: gelembung di pion + label).
- Mematikan rem: `paceTargetMs = Infinity`. Bot tidak boleh tertahan tanpa batas (jadwal selalu maju).

## 5. Pilih rute (DR-36)
Kapan: bot di race view, `targetId = null`, jeda `thinkMs`/`afterWinMs` selesai. **Bot tidak pernah ganti target** (win parsial hilang, dan percobaan ulang butuh minigame sama). Deterministik: hanya bergantung pada peta, `BOT_PROFILE`, dan stream `botMind` untuk seri/kesalahan.

| Level | Aturan | Seri |
|---|---|---|
| Easy | Acak seragam di antara `selectableTargets` | — |
| Normal | Tetangga terbaik = `playDist(target)` terkecil (rute terpendek). Dengan peluang `routeMistake` (15%) bot memilih **acak seragam di antara tetangga selain yang terbaik**; bila tidak ada tetangga lain (satu opsi), tetap yang terbaik. Satu tarikan `chance` per keputusan, apa pun petanya | Difficulty dasar region lebih rendah; masih seri → acak (`botMind`) |
| Hard | Tetangga dengan `cost(t)` terkecil (di bawah); `routeMistake` 0 | `cost` selisih < 1 s (`ROUTE_COST_TIE_MS`) → difficulty dasar lebih rendah; masih seri → acak |

**Kenapa "bukan terbaik" (QA CP5a, diterima PM):** bila "acak seragam seperti Easy" dibaca termasuk tetangga terbaik, peluang salah efektif hanya 15% × (1 − 1/k) = 7,5% untuk k = 2, dan gerbang "terpendek 85% ± 3" (§11 #7) gagal. Dengan pembacaan ini hasilnya tepat 85%.

**`cost` (Hard)**, DP atas DAG peta, tanpa acak:
`cost(t) = W × E_win(d_t) − kartu(t) × cardValueMs + best(t)`, `W` = `winsRequired`, `best(t)` = `min cost` tetangga `t` ke finish (`best(region final) = 0`).
`E_win(d) = A_pass(d) + F(d) × A_fail(d)`, `F = (1 − p)/p`, `p = BOT_PASS_CHANCE[level][d]` (tanpa modifier kartu):
- `A_pass = introMs(3000) + mean(passTimeFrac) × estDurationMs + RESULT_BANNER_MS + mean(thinkMs) + mean(afterWinMs)`
- `A_fail = retryIntroMs(1500) + 0,7 × estDurationMs + RESULT_BANNER_MS + COOLDOWN_MS[d] + mean(thinkMs)`
- `kartu(t)` = N kartu per win (1/2/3 menurut `d`) × jumlah win yang memberi penawaran (semua kecuali win penentu, C-3).
- `estDurationMs = 25000` (rata-rata 7 minigame).

**Crowding tidak dipakai.** Banyak pemain di satu region tidak berbagi sumber daya (R6.1; tiap orang main sendiri), jadi tidak ada alasan menghindar. Sengaja.

Di peta Indonesia Normal dan Hard akan hampir selalu lewat Medan → Jakarta → Toraja → Labuan Bajo (rute C: terpendek dan tengah risiko). Itu benar menurut data; perilaku Easy (acak) dan kebenaran logika Normal/Hard diuji di **peta sintetis** (§11 #7).

## 6. Penawaran dan buang (DR-32)
Bot menjawab layar penawaran/buang pada poll pertama setelah layar terbuka (tanpa timer 15 s, tanpa jeda berpikir). Pemilihan lewat **satu aksi atomik `chooseCards { playerId, cardUids[] }`** (nama final di build; pengganti `pickCards`/`discardCards` pada rancangan awal): di layar penawaran `cardUids` = tepat N kartu yang diambil; di layar buang = tepat sejumlah kartu yang harus dibuang. Penandaan (mark) diabaikan; aksi dengan jumlah salah, uid ganda, uid asing, atau tanpa layar terbuka ditolak (`actionRejected`). Hasil harus identik untuk state sama. Invarian layar: "layar bot terbuka ≤ 1 poll". **Server nanti harus memvalidasi `chooseCards` per pengirim** (melewati timer 15 s dan penandaan), seperti `autoCards` dan `debug*` (keputusan PM).

| Level | Pilih N dari 5 | Buang saat hand > 5 |
|---|---|---|
| Easy | Acak seragam (stream `botMind`) | Aturan auto-buang [cards.md §3.4](cards.md#34-layar-pilih-dan-layar-buang-timer-15-s-dr-25) |
| Normal | N skor `BOT_CARD_VALUE` tertinggi. Seri: rarity lebih tinggi, lalu slot paling kiri | Buang skor terendah; seri: paling lama di hand |
| Hard | Seperti Normal, ditambah penyesuaian konteks (di bawah) | Seperti Normal |

`BOT_CARD_VALUE` (data, §8): gunung_meletus 9, cermin_balik 8, tiket_pesawat 7, ojek_kilat 7, copet 6, badai 6, santai_dulu 6, payung_tameng 5, tambah_beban 4,5, ngebut 4,5, jam_pasir 4, zona_lebar 3,5, teropong 3,5, jam_rusak 3, kabut_asap 3, nyawa_cadangan 3, macet_total 2,5, pelit_hadiah 2,5, oleh_oleh 2, kopi_tubruk 1,5.

**Penyesuaian konteks (hanya Hard):** −3 bila kartu sama sudah di hand (−1 bila `maxStacks` 2); +1,5 untuk `tiket_pesawat`, `ojek_kilat`, `santai_dulu` bila `gap` bot ≥ 3 (tertinggal); +1 untuk `copet` bila hand lawan terbanyak ≥ 3; −3 untuk `payung_tameng`/`cermin_balik` bila bot sudah punya kartu pertahanan (aktif atau di hand); −2 untuk `oleh_oleh`/`kopi_tubruk`/`tiket_pesawat` bila tidak ada region non-final tersisa di depan.

## 7. Memakai kartu
Hanya di race view (`phase = idle`), status `running`, tidak sedang percobaan. Bot tidak punya layar kartu yang terbuka lebih dari satu poll (§6), jadi tidak ada aturan "jangan main saat layar kartu" untuk bot sendiri. Maks **1 kartu per poll**, jarak ≥ `cardGapMs`. Sebelum memainkan, bot memanggil validator yang sama dengan UI: kartu dimainkan hanya bila playable (maxStacks boost, kartu pertahanan maks 1, `hasTarget`, `cooldown`), dan sabotase hanya ke target valid (§2.2.1: slot < 2 / bukan `maxStacks` / hand ≥ 1 untuk Copet). Tidak ada target valid = kartu tetap di hand.

Evaluasi dilakukan tiap `tickMs`. Urutan prioritas per evaluasi (Normal/Hard); kartu pertama yang memenuhi syarat dimainkan, evaluasi berhenti:

| # | Kelompok | Syarat (Normal / Hard) |
|---|---|---|
| 1 | Pertahanan (`cermin_balik` dulu, lalu `payung_tameng`) | Belum ada kartu pertahanan aktif. Dimainkan **segera** di kedua level (lihat ★ di §12: kartu aktif tidak bisa dicopet dan tidak terlihat lawan, jadi menahannya tidak ada untungnya) |
| 2 | `kopi_tubruk` | Sisa cooldown ≥ 2 s |
| 3 | `tiket_pesawat` | Target terpilih, `winsAtTarget = 0`, target bukan region final, dan difficulty dasar target = hard. Hard juga bila medium dan `gap` ≥ 3 |
| 4 | `ojek_kilat` | Target terpilih, `winsAtTarget = 0`. Normal: difficulty dasar ≥ medium. Hard: difficulty dasar = hard, atau target region final |
| 5 | `oleh_oleh` | Target terpilih, win berikutnya memberi penawaran (bukan win penentu), dan `hand + N(difficulty dasar) + 1 ≤ 5` |
| 6 | Boost percobaan: `santai_dulu`, `nyawa_cadangan`, `teropong`, `zona_lebar`, `jam_pasir` (urutan itu) | Target terpilih dan `p_next ≤ boostMaxPass` (Normal 0,80; Hard 0,70). `p_next` = `botPassChance` dengan difficulty dasar target dan semua pending `next_minigame` bot. `santai_dulu` juga butuh difficulty efektif ≥ medium. Akibatnya Hard menyimpan boost untuk region hard atau saat sedang disabotase |
| 7 | Sabotase | Lihat §7.2 |

**Aturan luapan:** bila hand ≥ `overflowHand` (4, Normal/Hard) dan tidak ada kartu lolos syarat di atas, bot memainkan kartu playable bernilai `BOT_CARD_VALUE` terendah (seri: paling lama di hand; target seperti §7.2). Mencegah kartu terbuang di penawaran berikutnya.
- **Catatan terukur (QA CP5a, diterima PM "biarkan"):** 120 match: Normal memainkan 0,9% kartunya lewat luapan, **Hard 10,0%** (teropong 40, zona lebar 40, nyawa cadangan 26, jam pasir 18 dari 131 kartu luapan; Kopi Tubruk boros 0). Jadi yang "terbuang" hanya boost kecil di region mudah; alternatifnya kartu itu dibuang di layar buang berikutnya. Konsekuensi: kalimat "Hard menyimpan boost untuk region hard" (#6) hanya benar sebagian di praktik. Tuas bila PM ingin Hard lebih hemat: `overflowHand` Hard 4 → 5.

### 7.1 Easy
Tiap evaluasi, dengan peluang `cardPlayChance` (30%): pilih **acak seragam** satu kartu playable (boost, sabotase, atau pertahanan; tanpa cek relevansi) dan, bila sabotase, target valid acak. "Kesempatan" (DR-37) = satu evaluasi `tickMs` (3–4 s) di race view dengan ≥ 1 kartu playable. Maks 1 kartu per 8 s.

### 7.2 Sabotase dan target
Syarat umum Normal/Hard: ≥ 1 target valid. Pilih kartu menurut urutan (`BOT_SABOTAGE_ORDER`, perkiraan dampak turun): `gunung_meletus`, `badai`, **`copet`** (tepat **setelah Badai**; nilai Copet = Badai = 6; syaratnya di tabel di bawah), `tambah_beban`, `ngebut`, `jam_rusak`, `macet_total`, `kabut_asap`, `pelit_hadiah`. Kartu pertama yang lolos syarat dimainkan.

| Aspek | Normal | Hard |
|---|---|---|
| Target (kartu `opponent`) | Pemimpin = `remainingWins` terkecil di antara lawan **valid** (gdd: Hard "pemain dengan `remainingWins` terkecil"); seri → slot sabotase terisi lebih sedikit, lalu acak (`botMind`) | Sama |
| `gunung_meletus` | Bila ≥ `gunungMinValid` (1) lawan valid | Bila ≥ 2 lawan valid; bila match hanya punya 1 lawan, seperti kartu `opponent` biasa; atau bila `gap` bot ≥ 3 |
| `copet` | Lawan dengan hand terbanyak bila hand ≥ `copetMinHand` (2); seri: pemimpin | Sama dengan `copetMinHand` 3 |
| Jarak antar Copet | `copetMinGapMs` 75 s | 60 s (Easy 90 s) |

Bot memakai target dengan 1 slot terisi tanpa ragu (menumpuk sabotase = tujuan; batas 2 per target dijaga validator). Bila bot sendiri pemimpin, "pemimpin di antara lawan" tetap dipilih.

## 8. Profil per level (`BOT_PROFILE`, data; tunables)
Disimpan sebagai data (mis. `src/logic/botProfiles.ts`); kode tidak boleh punya angka bot di luar tabel ini dan `BOT_CARD_VALUE`.

| Nama | Easy | Normal | Hard | Dipakai di |
|---|---|---|---|---|
| `passChance` easy/medium/hard region | 0,70 / 0,50 / 0,30 | 0,85 / 0,65 / 0,45 | 0,92 / 0,80 / 0,65 | §3 (tidak berubah) |
| `passTimeFrac` | 0,85–1,00 | 0,70–0,95 | 0,55–0,85 | §3 |
| `failTimeFrac` | 0,4–1,0 | 0,4–1,0 | 0,4–1,0 | §3 |
| `modifierPoints` | 0,08 | 0,08 | 0,08 | §3 (`BOT_MODIFIER_POINTS`) |
| `passMin` / `passMax` | 0,05 / 0,98 | idem | idem | §3 |
| `thinkMs` | 1500–4000 | 1000–3000 | 500–2000 | §3 |
| `afterWinMs` | 18000–30000 | 22000–34000 | 18000–30000 | §3 (tidak berubah di CP5a; setel dulu bila gerbang §10 meleset) |
| `tickMs` | 3000–4000 | 2500–3500 | 2000–3000 | §7 |
| `cardGapMs` | 8000 | 5000 | 4000 | §7 |
| `cardPlayChance` | 0,30 | 1,0 | 1,0 | §7.1 |
| `boostMaxPass` | — | 0,80 | 0,70 | §7 #6 |
| `overflowHand` | — | 4 | 4 | §7 |
| `routePolicy` | random | shortest | expectedCost | §5 |
| `routeMistake` | 1,0 | 0,15 | 0 | §5 |
| `cardValueMs` | — | — | 5000 | §5 |
| `estDurationMs` | 25000 | 25000 | 25000 | §5 |
| `offerPolicy` | random | value | valueContext | §6 |
| `discardPolicy` | autoRule | lowestValue | lowestValue | §6 |
| `copetMinHand` | 1 | 2 | 3 | §7.2 |
| `copetMinGapMs` | 90000 | 75000 | 60000 | §7.2 |
| `gunungMinValid` | 1 | 1 | 2 | §7.2 |
| `paceTargetMs` | 870000 (14,5 mnt) | **840000 (14,0)** | **610000 (10,2)** | §4 (Normal dan Hard disetel di CP5a; v0.1: 750000 / 690000. Hard jendela 600–620 s) |
| `paceSlackMs` | 20000 | 20000 | 20000 | §4 |
| `restRecheckMs` | 1000 | 1000 | 1000 | §4 |

Tidak ada angka lain yang boleh diam-diam tertanam di controller.

## 9. Manusia referensi (untuk simulasi QA)
Tiga profil memakai **kelas controller yang sama** dengan bot (`profile` + flag `brake: false`), supaya QA bisa mensimulasikan match tanpa manusia sungguhan. Ini model, bukan pemain asli; kalibrasi ulang setelah playtest CP6.

| Nama | `passChance` e/m/h | `passTimeFrac` | `thinkMs` | `afterWinMs` | Rute | Kartu | Target solo (median) |
|---|---|---|---|---|---|---|---|
| `casual` | 0,80 / 0,60 / 0,40 | 0,85–1,0 | 1500–3500 | **36000–50000** | Normal | logika Normal, `cardPlayChance` 0,6 | 11,0 ± 0,7 mnt (terukur 10,77) |
| `attentive` | 0,90 / 0,75 / 0,55 | 0,75–0,95 | 1000–2500 | **27500–39500** | Hard | logika Hard | 8,0 ± 0,7 mnt (terukur 7,82) |
| `expert` | 0,95 / 0,85 / 0,70 | 0,65–0,90 | 800–2000 | **21500–31500** | Hard | logika Hard | 6,5 ± 0,7 mnt (terukur 6,40) |

"Solo" = satu pemain tanpa lawan, preset Standard, 1000 seed. `casual` memakai pass 80/60/40 persis target tuning [minigames.md](minigames.md#keputusan-cp2-diputuskan-pm) (easy 80 / medium 60 / hard 40).

**`afterWinMs` manusia referensi disetel ulang di CP5a** (v0.1: 20–34 / 14–26 / 11–21 s) supaya median solo cocok dengan target; nilai di atas ada di `HUMAN_PROFILE`. **Peringatan (QA CP5a):** angka ini hanya **asumsi model**. Lebih dari separuh waktu 10,8 menit `casual` adalah jeda antar-win yang diasumsikan (8 × ≈ 43 s ≈ 5,7 mnt), jadi gerbang C-1 hanya membuktikan model cocok dengan angka itu. Bila pemain kasual nyata lebih cepat dari ≈ 43 s antar win, C-1 pecah; **validasi dengan pemain sungguhan di playtest CP6** (tuas sisi manusia: cooldown atau durasi minigame, keputusan PM ★1).

## 10. Target keadilan dan rasa
**Rumus perkiraan waktu per win** (dipakai §5 dan perkiraan di bawah): `E_win(d)` §5, dengan `estDurationMs` 25 s. Waktu selesai rute C (Medan, Jakarta, Toraja, Labuan Bajo: M, M, H, M) ≈ `W × (3 × E_win(M) + E_win(H))`.

**Perkiraan analitis, tanpa rem dan tanpa kartu `[ASSUMPTION]`:**

| Pemain | Median solo | σ kira-kira |
|---|---|---|
| Bot Easy (rute acak, rata-rata 9 win) | 13,3 mnt | 2,3 |
| Bot Normal | 9,9 | 1,1 |
| Bot Hard | 7,4 | 0,8 |
| Manusia `casual` / `attentive` / `expert` | 11,0 / 8,0 / 6,5 | 1,9 / 1,3 / 1,0 |

**Band win rate manusia referensi** (1000 match per sel, preset Standard, kartu aktif, rem aktif untuk bot; **n ≥ 4000 untuk sel yang jadi gerbang**). Band = persentase match yang dimenangkan manusia. **Hanya dua sel yang menjadi gerbang (lihat "Gerbang" di bawah): `casual` vs 1 Hard dan vs 3 Hard. Semua sel lain hanya dilaporkan** (keputusan PM CP5a: Normal lebih mudah dari rancangan, `casual` vs 1 Normal menang ≈ 67%; kalibrasi ulang setelah playtest CP6). Angka terukur CP5a (seed 7, n=1000) di kolom terakhir tabel gerbang.

| Manusia | vs 1 Easy | vs 1 Normal | vs 1 Hard | vs 3 Easy | vs 3 Normal | vs 3 Hard |
|---|---|---|---|---|---|---|
| `casual` | 75–90% | 35–55% | 15–35% | 50–75% | 8–22% | 3–12% |
| `attentive` | 90–99% | 60–80% | 35–55% | 85–97% | 25–45% | 12–25% |
| `expert` | ≥ 97% | 80–92% | 55–75% | ≥ 95% | 45–65% | 25–45% |

- "Easy biasanya kalah dari pemain yang memperhatikan" = `attentive` vs Easy ≥ 90% (dilaporkan; terukur 99,6%).
- "Hard tantangan sungguhan" = `casual` vs 1 Hard di band 15–35% (gerbang) dan `attentive` ≤ 55% (dilaporkan; terukur 66%, di atas band).
- Antar bot, 1 lawan 1 (tanpa manusia): **Hard menang atas Normal ≥ 65% tanpa batas atas** (gerbang; terukur 91–93%); Normal atas Easy 75–90% (dilaporkan; terukur 86–88%).

**Gerbang (diputuskan PM, CP5a; berlaku sama untuk setiap build berikutnya, termasuk CP5b dengan 7 minigame):**

| # | Gerbang | Nilai | Terukur CP5a (seed 7) |
|---|---|---|---|
| G1 | **C-1 untuk Easy dan Normal saja**: `casual` + 1/2/3 bot Easy atau Normal (6 sel) | median ∈ **[10, 13] menit** dan **persentil 95 ≤ 18 menit**. Persentil 5 **hanya dicatat** (tidak bisa lebih tinggi dari p5 solo `casual` ≈ 7,3) | median 10,53–11,20; p95 12,3–13,9 |
| G2 | **Hard, waktu**: `casual` + 1/2/3 bot Hard (3 sel) | median ∈ **[7, 9] menit** (target 7–9; keputusan PM, Hard boleh lebih pendek dari C-1) | 8,91 / 8,28 / 7,71 (margin 1 Hard hanya 0,09 mnt) |
| G3 | **`casual` vs 1 Hard**, diukur **n ≥ 4000** (galat baku ≈ 0,6 poin; pada n=1000 ≈ 1,15 poin sehingga gerbang berisik) | menang **15–35%** | 16,4% (rata-rata 8 run ≈ 15,7%) |
| G4 | **`casual` vs 3 Hard**, n ≥ 4000 | menang **3–12%** | 8,9% |
| G5 | **Hard vs Normal**, 1 lawan 1, tanpa manusia | Hard menang **≥ 65%** (tanpa batas atas) | 91,2% |
| G6 | Kalibrasi solo (§11 #14) | median `casual` / `attentive` / `expert` = 11,0 / 8,0 / 6,5 ± 0,7 | 10,77 / 7,82 / 6,40 |

**Hanya dilaporkan (bukan gerbang):** persentil 5 semua sel; semua band win rate di tabel di atas selain G3–G5 (`casual` vs Easy/Normal, `attentive`, `expert`); Normal vs Easy; Hard vs Easy; median `attentive`/`expert` (≥ 7 / ≥ 6 menit). Alasan: pemain cepat memang menang lebih cepat, dan Normal sengaja tidak dituning sekeras Hard di CP5a.

**Margin tipis (QA CP5a):** G2 untuk 1 Hard dan G3 hanya ± 0,1 menit / ± 1 poin dari batas; jendela `paceTargetMs` Hard ≈ 600–620 s (§4). Setiap perubahan cooldown, durasi minigame, `afterWinMs` manusia, atau isi pool minigame menggeser G2–G4 langsung; QA menjalankan ulang G1–G6 pada tiap build yang mengubah salah satunya (mis. CP5b: [minigames.md §10 F](minigames.md#f-simulasi-dengan-7-minigame-di-pool-gerbang)). Perkiraan analitis lama "median 10,2–10,6 untuk ke-9 sel" tidak berlaku untuk Hard (dikunci rem, §4).

## 11. Kriteria penerimaan QA (simulasi headless; seed tetap, hasil dicatat)
1. **Nol penolakan:** 2000 match (campuran level, 1–3 bot, preset Standard) tanpa satu pun `actionRejected` dari aksi bot. Hand bot ≤ 5 setiap kali poll selesai; slot sabotase ≤ 2; kartu pertahanan ≤ 1 per pemain; fuzz zona kartu (cards.md §8 #19) lulus dengan bot memainkan kartu.
2. **Replay:** match dengan bot + `actionLog` direplay → state identik (cards.md §8 #20). Dua run dengan seed sama → urutan aksi sama; seed berbeda → berbeda.
3. **Simulasi percobaan:** 12.000 percobaan per (level, difficulty) tanpa modifier: pass rate = tabel ± 1,5 poin; dengan satu modifier tiap jenis ±8 poin dan clamp 5–98%; lulus memakai `D × U(passTimeFrac)` (rata-rata ± 2%), `dodge_runner` lulus = 100% `D`; gagal `D × U(0,4–1,0)`. Dua tarikan `bot` per percobaan.
4. **Jeda reaksi:** setelah menang, bot tidak memilih target/Mulai sebelum `afterWinMs` (min); setelah cooldown habis, Mulai ditekan dalam `thinkMs` + 1 poll. Histogram jeda ada di dalam rentang tabel §8 (100% sampel) dan rata-rata ± 5% dari tengah rentang.
5. **Rem:** bot yang memimpin dan di depan jadwal tidak pernah memulai percobaan (assert tiap `startAttempt`); bot yang tertinggal memulai tanpa menunggu rem; `paceTargetMs = Infinity` menonaktifkan rem; tak pernah ada bot yang menunggu > `paceTargetMs/total + 5 s` berturut-turut.
6. **Informasi tersembunyi:** tes metamorfik, lihat §2: 500 state acak, ubah kolom "Tidak boleh" → aksi `nextAction` identik. Bot tidak membaca `nextMinigameId` sebelum Mulai.
7. **Rute (peta sintetis):** peta uji 8 node dengan dua jalur: jalur pendek-sulit (2 region hard) vs jalur panjang-mudah (4 region easy). Easy: 10.000 pilihan, tiap tetangga 50% ± 3. Normal: memilih terpendek 85% ± 3 (sisanya acak). Hard: memilih `cost` terendah 100%, termasuk satu kasus di mana jalur panjang-mudah lebih murah dan satu di mana jalur pendek lebih murah. Peta Indonesia: Normal dan Hard dari Sabang → Medan, dari Jakarta → Toraja, dari Toraja → Labuan Bajo (Normal ≥ 85%). Seed sama → pilihan sama. Bot tidak pernah ganti target.
8. **Penawaran:** Easy: tiap slot terpilih 1/5 ± 2 poin (10.000 penawaran). Normal: selalu N skor tertinggi (seri sesuai aturan); Hard: dua kasus konteks (duplikat −3, Copet +1) mengubah pilihan seperti di §6. Comeback bobot tier berlaku untuk bot (cards.md §3.2).
9. **Easy kartu:** dari 10.000 evaluasi dengan ≥ 1 kartu playable dan `cardGapMs` lewat, 30% ± 3 memainkan kartu; target sabotase seragam atas target valid ± 3 poin.
10. **Normal kartu:** `santai_dulu` dan `ojek_kilat` tidak pernah dimainkan di region easy; `kopi_tubruk` hanya saat cooldown; `tiket_pesawat` tidak pernah di region final atau dengan win parsial; sabotase target = pemimpin valid ≥ 95% (sisanya hanya saat pemimpin tidak valid).
11. **Hard kartu:** boost percobaan hanya bila `p_next ≤ 0,70` (kecuali aturan luapan); Copet hanya bila hand target ≥ 3 dan ke hand terbanyak ≥ 95%; jarak antar Copet ≥ 60 s; `gunung_meletus` hanya bila ≥ 2 lawan valid (atau pengecualian di §7.2); `cermin_balik` dimainkan sebelum `payung_tameng`; kartu pertahanan dimainkan dalam 1 evaluasi setelah dimiliki.
12. **Maks stack:** 10.000 evaluasi dengan hand penuh sabotase vs lawan "Penuh" / sudah `maxStacks`: tidak ada kartu dimainkan; kartu tetap di hand; tidak ada penolakan.
13. **Gerbang G1–G5 (§10) dan laporan sel lain:** jalankan sel `casual`/`attentive`/`expert` × Easy/Normal/Hard × 1 dan 3 bot (+ 2 bot untuk median). **Gerbang:** G1 (C-1 Easy dan Normal: median [10, 13], p95 ≤ 18), G2 (median Hard [7, 9]), G3 dan G4 (`casual` vs 1 / 3 Hard di band, **n ≥ 4000** per sel), G5 (Hard vs Normal ≥ 65%). **Hanya dilaporkan:** p5, band win rate selain G3–G5, `attentive`/`expert`, Normal vs Easy, Hard vs Easy. Hasil mentah (win %, median, p5, p95, n) dilampirkan.
14. **Kalibrasi manusia referensi (G6):** median solo tiap profil §9 dalam ± 0,7 menit dari target (11,0 / 8,0 / 6,5); bila meleset, setel `afterWinMs` profil itu, bukan profil bot, dan catat nilai akhir. Validasi dengan pemain nyata di playtest CP6.
15. **Satu keputusan per 2–4 s:** jarak antar evaluasi kartu dalam rentang `tickMs` level itu (± 1 poll).
16. **Pause:** pause membekukan semua jeda dan rem bot (jam game); tidak ada aksi bot selama pause.
17. **Performa:** 1000 match 4 pemain (1 manusia referensi + 3 bot) selesai < 5 menit di CI (mode lompat jam).

## 12. Perubahan untuk Engineer
- `PlaceholderBotController` → `SmartBotController` (profil dari `BOT_PROFILE`); stream baru `botMind` = `hash(matchSeed, playerId, 'botMind')`; stream `bot` tetap hanya untuk simulasi percobaan.
- Penawaran dan buang bot: reducer tidak lagi auto-resolve; layar terbuka tanpa timer dan dijawab bot pada poll pertama lewat aksi atomik **`chooseCards`** (§6). Invarian "bot tak pernah punya layar" menjadi "layar bot terbuka ≤ 1 poll".
- Fungsi murni baru: `botScoreCard`, `botChooseOffer`, `botChooseDiscard`, `botChooseRoute`, `botPickCardToPlay`, `botPickSabotageTarget`, `isAheadOfSchedule`, semuanya `(state, map, profile, rng) → keputusan`, tanpa efek samping, supaya bisa dites.
- `autoCards`, `chooseCards` (divalidasi per pengirim) dan `debug*` ditolak/divalidasi server dari klien (keputusan PM; lihat [cards.md §3.4](cards.md#34-layar-pilih-dan-layar-buang-timer-15-s-dr-25)).
- Stream bot hidup di controller, bukan di `GameState`; bila nanti match disimpan di tengah, state stream harus ikut diserialisasi.

## 13. Keputusan dan ★ untuk PM
Status tiap ★ di bawah sudah diputuskan PM (pm-decisions.md, bagian CP5a dan CP5a QA follow-up).

- **★1 C-1 vs kecepatan bot: DITERIMA, dengan cakupan C-1 dipersempit.** Rem pemimpin (§4) + `afterWinMs` 18–34 s. C-1 [10, 13] berlaku untuk Easy dan Normal saja; melawan Hard median target [7, 9] dengan `paceTargetMs` Hard 610 s (fachril memilih rekomendasi PM). Bot tidak pernah dipercepat; tuas bila C-1 pecah: `afterWinMs`/`paceTargetMs` dulu, lalu sisi manusia (cooldown, durasi minigame). Alternatif ditolak: menurunkan pass chance Normal/Hard; batas bawah waktu selesai keras.
- **★2 Hard memainkan Payung/Cermin segera: DITERIMA.** Kartu aktif tidak bisa dicopet dan tidak terlihat lawan, jadi menyimpan hanya menambah risiko dicopet.
- **★3 Semua bot Normal/Hard menyerang pemimpin: DITERIMA** dengan risiko playtest (manusia pemimpin jadi sasaran, dibatasi Q2). Terukur CP5a: ≈ 1,1 sabotase/menit ke manusia pemimpin, dua slot penuh 14% waktu: tidak menindas; tuas tetap `copetMinGapMs`, `cardGapMs`, `gunungMinValid`.
- **★4 Reducer berubah (bot menjawab layar lewat controller, `chooseCards`): DITERIMA.** Invarian QA CP4b #17 menjadi "layar bot tidak terbuka lebih dari 1 poll"; determinisme replay tetap.
- **★5/★6 Angka manusia referensi, rem, dominasi rute C: DITERIMA sebagai sementara.** Gerbang QA §11 #13–14 memutuskan; rute dibuktikan di peta sintetis.
- **Hard overflow 10%: dibiarkan** (§7). **Pace Hard 600–620 s: diterima sampai playtest CP6.**
- Bot tidak ganti target, tidak memakai crowding, dan tidak membaca `targetId` lawan (picker tak menampilkannya).
- `oleh_oleh` tidak dimainkan bila win berikutnya adalah win penentu (tanpa penawaran, C-3; §7 #5).

## Change log
**0.2 (2026-11-17):** CP5b: disinkronkan dengan build CP5a dan keputusan PM. §2 jenis sabotase pending lawan (validator saja); §3 `D` memuat `previewMs`, peluang lulus sama untuk semua minigame; §4 batas bawah waktu bot dan jendela pace Hard, indikator "menahan diri"; §5 `routeMistake` di antara tetangga bukan terbaik; §6 aksi `chooseCards`; §7 Copet setelah Badai, catatan luapan; §8 pace Normal 840 s / Hard 610 s; §9 `afterWinMs` manusia 36–50 / 27,5–39,5 / 21,5–31,5 s dan peringatan C-1; §10 gerbang G1–G6 baru (C-1 hanya Easy/Normal dengan median + p95, Hard median [7, 9], casual vs Hard n ≥ 4000, Hard vs Normal ≥ 65%, sisanya dilaporkan); §11 #13–14; §13 status ★.
**0.1 (2026-11-17):** CP5a: spek bot pintar pertama.
