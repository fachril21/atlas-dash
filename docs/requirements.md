# Requirements: Atlas Dash

Status: **LOCKED (approved by fachril 2026-11-16)** (owner: fachril, PM: main session)
Last updated: 2026-11-16

## Name
**Atlas Dash**. Map name as subtitle (e.g. "Atlas Dash: Indonesia", "Atlas Dash: Japan").

## Concept
A virtual real-time race across a regional map (first map: Indonesia, Sabang → Merauke). Players unlock the next region by winning short minigames. Minigame rewards are cards to boost yourself or sabotage opponents. Up to 4 players via room code. MVP: solo vs bots.

## Platform & stack (locked)
- Web, desktop + mobile browsers
- three.js + TypeScript + Vite; cute 3D isometric race view; minigames 3D or 2D (HTML/CSS overlays)
- Multiplayer later: Colyseus (authoritative server)

## Locked decisions
| ID | Topic | Decision |
|----|-------|----------|
| R1 | Win condition | First player to reach the final region wins. |
| R2 | Losing a minigame | Cooldown, then retry. **Cooldown scales inversely with minigame difficulty**: easy minigame = long cooldown, hard minigame = short cooldown. |
| R3 | Sabotage | Cards only. Effects apply to an opponent's next minigame (e.g. harder, less time). No interrupting a minigame in progress. **Exception (CP2, Q3):** one steal card "Copet" that takes a card from the target's hand. |
| R4 | Content focus | General minigames (not education-focused). Visual theming follows the map. **Maps must be data-driven / map-agnostic**: Japan map planned after Indonesia. |
| R5 | Match length | Set by route length (regions to finish). Presets Short ~10 min / Standard ~15 min / Long 20+ min. **MVP ships Standard only**; system supports all presets. |
| R6 | Route structure | Branching map graph. MVP: ~9–10 region nodes, 2+ branch points, routes to finish ~5–6 regions, with trade-offs between routes. **Routing must be flexible**: players choose freely within movement rules (see R6.1). |
| R6.1 | Movement rules | Move only to **adjacent** (connected) regions. **No backtracking.** **No skipping** a region without playing its minigame, except via a card. **Multiple players may occupy the same region.** |
| R7 | Minigames | "Tebak harga barang" dropped. **MVP set (7):** Tap Tepat Waktu, Simon, Hindari Rintangan (3D), Whack-a-Mole, Ketapel (3D), Cocokkan Kartu, Tebak Lokasi. Detailed per-minigame specs: Designer. |
| M1 | Minigame win | Pass/fail against a target (e.g. 3/3 taps in zone). |
| K1 | Earning cards | Win a minigame → offered **5 random cards**, pick N where N scales with difficulty (proposed: easy 1 / medium 2 / hard 3). If the hand exceeds 5, the player must discard down to 5 (K1.1). |
| K2 | Sabotage target | Player chooses the target. |
| K3 | MVP card list | **20 cards total** (base 8 proposed: 5 boost, 3 sabotage; Designer drafts the rest). Rarer cards more likely for trailing players (R8). |
| B1 | Bot levels | Easy / Normal / Hard, chosen before the match. |
| B2 | Bot behaviour | Bots choose routes and use cards like players. |
| B3 | Bot count | Player chooses 1–3 bots. |
| Q1 | Wins per region | A region needs **2 minigame wins** to be cleared (so Standard ≈ 15 min). |
| Q2 | Sabotage cap | Max **2** pending sabotage cards on one target. |
| Q4 | Card screen timer | Pick/discard screens have a **15 s** limit, then auto-pick. |
| M2 | Minigame per region | Random from the pool; difficulty follows the **region type** (e.g. mountain = hard, beach = easy). |
| R8 | Comeback | Trailing players get better cards. |
| R9 | Card hand | Max 5 cards held. |
| R10 | Art style | Low-poly chibi, bright colours (toy diorama look). |

## R2 tuning (starting point)
Cooldown: easy 12 s, medium 8 s, hard 4 s. Tune in playtest.

## Open
- (none: ready for owner approval)
