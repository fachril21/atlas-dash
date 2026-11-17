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
| QA-CP4a-03 Pause on card screens | Pause is allowed on the offer and discard screens. The Pause button stays above the card modal, and pausing freezes the 15 s timer. Fix in CP4b. |
| QA-CP4a-01 actionLog replay | Fix in CP4b, so that tick coalescing can't change the timing of card-screen timeouts. Needed for debug export and the future server. |
| QA-CP4a-02 offer cards out of every zone at match end | Fix in CP4b, so that each card stays in exactly one zone. |

## CP4b decisions (PM, 2026-11-16)

| Topic | Decision |
|---|---|
| Bot hands in CP4b | Accepted. Bots get offers and auto-pick, and they build a hand, but they don't play cards until CP5. This makes Copet, cap 2 and comeback testable against bots. The bot pass-chance mapping of ±8 points per modifier kind (DR-35) applies from now on. |
| Picker with a single opponent | Accepted. The target picker is skipped when the match has only 1 opponent. |
| "Sudah kena kartu ini" label | Accepted, with its small information leak. This beats a card being wasted because the target already holds `maxStacks`. |
| Slot hold | Accepted. Sabotage slots stay held until the target's attempt finishes. |
| Designer rules for DR-24/27/28/29/32/33/35/47 and QA-CP4a-01/02/03 | Accepted as written in cards.md v0.4 §2.2–§3.4 and ui-flow §1/§7. |

## CP4b QA follow-up (PM, 2026-11-17)

| Topic | Decision |
|---|---|
| Engineer interpretations 1–6 | All accepted, per the QA verdicts. |
| Hand max during deferred Discard | The real maximum is 10. A 10-card Discard screen is usable at 390×844. The doc text (cards.md §1, ui-flow §6) is corrected in the next Designer pass. |
| Doc wording (Gunung instance per target, burned card to the sender's `discarded`, §2.2.1 disabled reason, §8 #16 tolerance of slots 1–4 ±4 and slot 5 ±7) | Accepted as built. The docs are updated in the next Designer pass. |
| QA-CP4b-04 picker rebuilt via innerHTML (mobile tap risk) | Fix at the start of CP5 (Engineer): update rows per node. |
| QA-CP4b-05 dodge/simon test timeouts under load | Fix at the start of CP5 (Engineer). |
| QA-CP4b-01/02/03 (tap outside, Esc back to Detail, initial focus) | Deferred to CP6 polish. |
| Drag card onto progress row, number keys 1–5, card fly animation | Deferred to CP6. |
| `autoCards` action | Like `debug*`, the server must reject it from clients before multiplayer. |

## CP5a decisions (PM, 2026-11-17)

| Topic | Decision |
|---|---|
| ★1 C-1 vs bot speed | The leader brake (`paceTargetMs`) plus `afterWinMs` 18–34 s is accepted. Bots are never sped up. If C-1 misses in simulation, tune `afterWinMs`/`paceTargetMs` first. If casual humans prove faster in CP6 playtests, the human-side levers (cooldown or minigame duration) come next. The race view must show a braking bot as "thinking", not frozen. |
| ★2 Hard plays Payung/Cermin at once | Accepted. |
| ★3 Bots answer offer/discard via the controller with atomic actions | Accepted. QA updates the CP4b #17 invariant to "a bot screen never stays open longer than 1 poll". Replay determinism must still hold. |
| ★4 Normal/Hard bots target the leader | Accepted, with a playtest risk: the human as leader gets dog-piled, limited by cap 2. Levers: `copetMinGapMs`, `cardGapMs`, `gunungMinValid`. |
| ★5/★6 calibration and route C dominance | Accepted. The numbers are provisional until QA simulation. Route variety is tested on synthetic maps. |
