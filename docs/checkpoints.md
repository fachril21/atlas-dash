# Checkpoints: Atlas Dash MVP

Rule: every checkpoint needs fachril's approval before it starts. Before each one, the PM explains what will be done and the goal. Agents stop at the end of a checkpoint; nobody continues without approval. Plan beyond the current checkpoint is a draft and can change.

| CP | Status | Who | Work | Goal |
|----|--------|-----|------|------|
| CP0 | ✅ done | PM | Requirements locked, agents set up, git repo + first push | Shared, locked scope |
| CP1 | ✅ done | Designer, Engineer | Designer: GDD, 7 minigame specs, 20 cards, Indonesia map, UI flow, art style. Engineer: scaffold, isometric view, placeholder map, movement rules + tests | Design ready for review; technical foundation runs |
| CP2 | ✅ done | fachril, QA | fachril reviews the GDD; QA reviews it for testability and writes the test plan | GDD approved, test plan ready |
| CP3a | ⏸ paused (QA step: Playwright + tests partly done, uncommitted) | Designer, Engineer, QA | Docs aligned to PM decisions; scaffold refactor (target + 2 wins, final map schema, RNG streams); real Indonesia map; minigame framework + Tap Tepat Waktu; cooldown/retry; test hooks; Playwright + CP3a tests | First playable race on the real map with 1 minigame |
| CP3b | ⏸ draft | Designer, Engineer, QA | Remaining should-fix doc items; Simon + Hindari Rintangan (3D) | 2D + 3D minigame framework proven |
| CP4 | ⏸ draft | Engineer, QA | Cards (20), hand/discard, sabotage targeting, comeback | Full card loop |
| CP5 | ⏸ draft | Engineer, QA | Bots (3 levels), remaining minigames | Solo vs bots full match |
| CP6 | ⏸ draft | Designer, Engineer, QA | Polish, mobile check, playtest, MVP build | MVP ready to play |
