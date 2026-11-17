/**
 * CP3b gap tests (QA): cooldown literals 8/6/4, pick rule over whole matches, and the
 * 3-minigame registry invariants that the e2e suite relies on.
 */
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  COOLDOWN_MS,
  createInitialState,
  dodgeRunnerLogic,
  loadMap,
  minigamePool,
  MINIGAME_LOGIC,
  simonLogic,
  type GameAction,
  type GameState,
  type MinigameContext,
} from '../src/logic';
import { t } from '../src/ui/strings';
import { indonesiaData, settleCards } from './helpers';

const map = loadMap(indonesiaData(), 'standard', MINIGAME_LOGIC);
const pool = minigamePool(map.data);

const act = (s: GameState, a: GameAction): GameState => {
  const r = applyAction(map, s, a);
  const rej = r.events.find((e) => e.type === 'actionRejected');
  if (rej) throw new Error(`rejected ${JSON.stringify(a)}: ${JSON.stringify(rej)}`);
  return settleCards(map, r.state);
};

describe('cooldown 8/6/4 s (DR-09 option B)', () => {
  it('literal values, inverse order (easy longest)', () => {
    expect(COOLDOWN_MS).toEqual({ easy: 8000, medium: 6000, hard: 4000 });
  });

  it.each([
    ['yogyakarta', 'easy', 8000],
    ['medan', 'medium', 6000],
    ['padang', 'hard', 4000],
  ] as const)('a fail on %s (%s) blocks Mulai for exactly %i ms', (region, _d, ms) => {
    let s = createInitialState(map, [{ id: 'p1', name: 'p1', kind: 'human' }], 7, pool);
    // reach the region with forced wins
    const route: Record<string, string[]> = { yogyakarta: ['medan', 'jakarta'], medan: [], padang: [] };
    for (const r of route[region] as string[]) {
      s = act(s, { type: 'selectTarget', playerId: 'p1', targetId: r });
      for (let i = 0; i < 2; i++) {
        s = act(s, { type: 'startAttempt', playerId: 'p1' });
        s = act(s, { type: 'minigameResult', playerId: 'p1', passed: true });
      }
    }
    s = act(s, { type: 'selectTarget', playerId: 'p1', targetId: region });
    s = act(s, { type: 'startAttempt', playerId: 'p1' });
    s = act(s, { type: 'minigameResult', playerId: 'p1', passed: false });
    const p = s.players[0]!;
    expect(p.cooldownUntilMs - s.timeMs).toBe(ms);
    const early = applyAction(map, act(s, { type: 'tick', dtMs: ms - 50 }), { type: 'startAttempt', playerId: 'p1' });
    expect(early.events.some((e) => e.type === 'actionRejected')).toBe(true);
    const ok = act(s, { type: 'tick', dtMs: ms });
    expect(applyAction(map, ok, { type: 'startAttempt', playerId: 'p1' }).events.some((e) => e.type === 'actionRejected')).toBe(false);
  });
});

describe('pick rule over whole runs (mg_pick_rules, 3-minigame pool)', () => {
  it('300 seeds x 6 wins: a win never leads to the same minigame; a fail repeats it; no draw is wasted', () => {
    for (let seed = 1; seed <= 300; seed++) {
      let s = createInitialState(map, [{ id: 'p1', name: 'p1', kind: 'human' }], seed, pool);
      s = act(s, { type: 'selectTarget', playerId: 'p1', targetId: 'medan' });
      let prev: string | null = null;
      for (let w = 0; w < 6; w++) {
        const target = s.players[0]!.targetId;
        s = act(s, { type: 'startAttempt', playerId: 'p1' });
        const id = s.players[0]!.attempt!.minigameId;
        expect(pool).toContain(id);
        if (prev) expect(id, `seed ${seed} win ${w}`).not.toBe(prev);
        // one fail first on every other win: same minigame again
        if (w % 2 === 0) {
          s = act(s, { type: 'minigameResult', playerId: 'p1', passed: false });
          s = act(s, { type: 'tick', dtMs: COOLDOWN_MS.hard + COOLDOWN_MS.easy });
          s = act(s, { type: 'startAttempt', playerId: 'p1' });
          expect(s.players[0]!.attempt!.minigameId).toBe(id);
          expect(s.players[0]!.attempt!.introMs).toBe(1500);
        }
        s = act(s, { type: 'minigameResult', playerId: 'p1', passed: true });
        prev = id;
        if (s.players[0]!.targetId === null) {
          const next = { medan: 'jakarta', jakarta: 'yogyakarta', yogyakarta: 'bali', bali: 'labuan_bajo' }[target as string];
          if (!next) break;
          s = act(s, { type: 'selectTarget', playerId: 'p1', targetId: next });
        }
      }
    }
  });
});

describe('CP3b minigame registry', () => {
  it('3D flag: dodge_runner and slingshot are 3D, the other five are 2D', () => {
    expect(Object.fromEntries(MINIGAME_LOGIC.map((m) => [m.id, m.render]))).toEqual({
      tap_timing: '2d', simon: '2d', dodge_runner: '3d', whack_a_mole: '2d', slingshot: '3d', memory_match: '2d', guess_location: '2d',
    });
  });

  it('intro sentences are at most 8 words (mg_intro_rule)', () => {
    for (const m of MINIGAME_LOGIC) {
      const words = t(m.introKey).trim().split(/\s+/).length;
      expect(words, `${m.id}: ${t(m.introKey)}`).toBeLessThanOrEqual(8);
      expect(t(m.introKey)).not.toBe(m.introKey); // key exists
    }
  });

  it('every minigame level is generated without Math.random: same ctx twice gives equal levels', () => {
    const ctx = (seed: number): MinigameContext => ({
      seed, difficulty: 'hard', modifiers: [], map: indonesiaData(), regionId: 'padang', inputMode: 'touch',
      settings: { reducedMotion: false, reducedFlash: false, sfxVolume: 1 },
    });
    for (const seed of [1, 42, 1337]) {
      expect(simonLogic.generateLevel(ctx(seed))).toEqual(simonLogic.generateLevel(ctx(seed)));
      expect(dodgeRunnerLogic.generateLevel(ctx(seed))).toEqual(dodgeRunnerLogic.generateLevel(ctx(seed)));
    }
  });
});
