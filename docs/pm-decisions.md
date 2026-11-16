# PM decisions (CP3a, approved by fachril 2026-11-16)

Resolutions for QA design-review blockers (docs/qa/design-review.md). The design docs are the source of truth; the scaffold is changed to match them.

| Finding | Decision |
|---|---|
| DR-01 movement model | Follow the design: the pawn stands on a cleared region, picks a neighbour as target, needs 2 wins on that target before moving. State gets `targetId` + `winsAtTarget`. Rewrite the scaffold movement tests. |
| DR-02 retry rule | After a fail: the same minigame with a new seed (short 1.5 s intro). After a win: re-roll, never the same minigame twice in a row. The 2nd win in a region is a different minigame. |
| DR-03 map schema | The design schema (`regions`, `position`, `presets`, single finish, DAG) wins. Remove `twoWay`. The validator adds cycles, direct start→finish, edges leaving finish, `routeLength`, `places`. Map files live at `public/maps/<id>/`. |
| DR-04 RNG streams | Named streams `hash(matchSeed, playerId, label)` for minigame pick, minigame params, card offers, bot sim, Copet/reflect. `attemptIndex` = attempt count on the current target. The match seed from `Math.random()` is the only allowed exception (DR-21). |
| DR-05 cooldown vs target switch | Switching target is allowed during cooldown, but the cooldown keeps running (no dodging). Retry needs a Mulai press. |
| DR-06 win moment | The logic event (2nd win at the final region) decides the win. The walk animation is cosmetic; all input locks at that event. |
| DR-38 | C-2 and C-3 are decided; docs updated to remove "to confirm". |
| DR-39 | GDD milestones M1–M3 are replaced by CP3–CP6. |

## CP3b decisions (PM, 2026-11-16)

| Finding | Decision |
|---|---|
| DR-09 dead wait | Option B. Pillar 2 is reworded so the race view stays interactive during cooldown. Starting cooldowns change to **8/6/4 s** (easy/medium/hard); the order stays inverse, so R2 still holds. The engineer updates `COOLDOWN_MS` and its tests; gdd.md and map-indonesia §5 follow. |
| Pick-result visibility | The rolled minigame stays hidden until Mulai is pressed, so switching target can't be used to re-roll. Accepted. |
| Simon length | `targetLength` is 4/5/6 (easy/medium/hard) so a hard round fits in 30 s. Accepted. |

## CP4a decisions (PM, 2026-11-16)

| Topic | Decision |
|---|---|
| Defensive cards in CP4a | Option A. Payung Tameng and Cermin Balik get `phase: 'b'` and are left out of the CP4a offer pool, which leaves 9 boost cards. They stay defined as data. |
| Ojek Kilat at FINAL, Zona Lebar on Simon hard | Kept as designed. Flagged for playtest. |
| Engineer interpretations (CP4a) | Accepted as built: Santai Dulu on hard gives a 6 s cooldown (test-plan line was stale); auto-discard breaks rarity ties by oldest first, with new cards last; Ojek Kilat adds +2 wins, clamped to `winsRequired`; when the match ends, open card screens close with no cards given. |
| Debug reducer actions | `debug*` actions are accepted by the reducer in any build. Before multiplayer, the server must reject them. Tracked for CP4b / multiplayer. |
