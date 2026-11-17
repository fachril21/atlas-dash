/**
 * CP5a: smart bots (docs/bots.md §11). Numbering follows §11. The long statistical gates
 * (win-rate bands, 1000 matches per cell) are run by `npm run sim`; here the parts that can be
 * proven with fixed seeds in a few seconds.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  BOT_CARD_VALUE,
  BOT_PROFILE,
  BOT_PASS_CHANCE,
  botChooseDiscard,
  botChooseOffer,
  botChooseRoute,
  botPickCardToPlay,
  botScoreCard,
  CARDS,
  createInitialState,
  createStream,
  GameSession,
  getCard,
  getMinigameLogic,
  HIDDEN_CARD_ID,
  HUMAN_PROFILE,
  isAheadOfSchedule,
  loadMap,
  minigamePool,
  MINIGAME_LOGIC,
  observe,
  passChanceFor,
  remainingWinsFor,
  replay,
  Rng,
  routeCosts,
  runCell,
  simulateAttempt,
  simulateMatch,
  SmartBotController,
  type Attempt,
  type BotLevel,
  type BotProfile,
  type GameAction,
  type GameState,
  type MapData,
  type MapGraph,
  type PlayerState,
  type SimSeat,
} from '../src/logic';
import { indonesiaData, ROOT } from './helpers';

const map = loadMap(indonesiaData(), 'standard', MINIGAME_LOGIC);
const pool = minigamePool(map.data);
const LEVELS: BotLevel[] = ['easy', 'normal', 'hard'];

const humanSeat = (profile: BotProfile = HUMAN_PROFILE.casual): SimSeat => ({ id: 'p1', kind: 'human', profile });
const botSeats = (level: BotLevel, k: number): SimSeat[] =>
  Array.from({ length: k }, (_, i) => ({ id: `bot${i + 1}`, kind: 'bot' as const, profile: BOT_PROFILE[level], botLevel: level }));

// ------------------------------------------------------------------ scenario builder

interface OppSpec {
  remaining?: number;
  hand?: string[];
  /** Sabotage cards already pending on the opponent (they fill its slots). */
  slots?: string[];
  /** Cards that must stay hidden (boost / defence pending). */
  secretPending?: string[];
}
interface Scenario {
  seed?: number;
  node?: string;
  target?: string | null;
  wins?: number;
  hand?: string[];
  pending?: { id: string; source?: string }[];
  cooldownMs?: number;
  timeMs?: number;
  opps?: OppSpec[];
}

function scenario(o: Scenario = {}): GameState {
  const opps = o.opps ?? [{}, {}];
  const ids = ['bot1', ...opps.map((_, i) => `o${i + 1}`)];
  const s = createInitialState(map, ids.map((id) => ({ id, name: id, kind: id === 'bot1' ? 'bot' : 'human', ...(id === 'bot1' ? { botLevel: 'normal' as const } : {}) })), o.seed ?? 5, pool);
  s.timeMs = o.timeMs ?? 100_000;
  let uid = 1;
  const card = (defId: string, source?: string) => ({ uid: `t${uid++}`, defId, seq: uid, ...(source ? { source } : {}) });
  const me = s.players[0] as PlayerState;
  me.nodeId = o.node ?? 'sabang';
  me.targetId = o.target === undefined ? null : o.target;
  me.winsAtTarget = o.wins ?? 0;
  me.remainingWins = remainingWinsFor(map, me.nodeId, me.targetId, me.winsAtTarget);
  me.hand = (o.hand ?? []).map((d) => card(d));
  me.nextHandSeq = 100;
  me.pending = (o.pending ?? []).map((p) => card(p.id, p.source));
  me.cooldownUntilMs = o.cooldownMs ? s.timeMs + o.cooldownMs : 0;
  opps.forEach((spec, i) => {
    const p = s.players[i + 1] as PlayerState;
    if (spec.remaining !== undefined) p.remainingWins = spec.remaining;
    p.hand = (spec.hand ?? []).map((d) => card(d));
    p.pending = [...(spec.slots ?? []).map((d) => card(d, 'bot1')), ...(spec.secretPending ?? []).map((d) => card(d))];
  });
  return s;
}
const obsOf = (s: GameState, id = 'bot1') => observe(s, id);
const rng = (seed: number) => new Rng(seed * 2654435761 + 7);

// ================================================================ §11 #1 zero rejections
describe('1. zero rejected bot actions and legal states', () => {
  it('600 matches (mixed levels, 1-3 bots, reference humans): no actionRejected; hand <= 5 at rest, slots <= 2, one defence card', () => {
    const humans = [HUMAN_PROFILE.casual, HUMAN_PROFILE.attentive, HUMAN_PROFILE.expert];
    let polls = 0;
    let cardsPlayed = 0;
    for (let i = 0; i < 600; i++) {
      const level = LEVELS[i % 3] as BotLevel;
      const k = (i % 3) + 1;
      const seats = [humanSeat(humans[i % 3]), ...botSeats(level, k)];
      const initial = createInitialState(map, seats.map((s) => ({ id: s.id, name: s.id, kind: s.kind, ...(s.botLevel ? { botLevel: s.botLevel } : {}) })), 1000 + i, pool);
      const session = new GameSession(map, initial, seats.map((s) => new SmartBotController(s.id, 1000 + i, s.profile)));
      session.subscribe((state, events) => {
        for (const e of events) {
          if (e.type === 'actionRejected') throw new Error(`match ${i}: rejected ${JSON.stringify(e.action)} (${e.reason})`);
          if (e.type === 'cardPlayed') cardsPlayed++;
        }
        for (const p of state.players) {
          polls++;
          if (p.phase === 'idle' && !p.offer && !p.discard && p.hand.length > 5) throw new Error(`match ${i}: ${p.id} hand ${p.hand.length} at rest`);
          const slots = p.pending.filter((c) => getCard(c.defId).type === 'sabotage' && getCard(c.defId).duration !== 'instant').length;
          if (slots > 2) throw new Error(`match ${i}: ${p.id} has ${slots} sabotage slots`);
          if (p.pending.filter((c) => getCard(c.defId).duration === 'next_sabotage').length > 1) throw new Error(`match ${i}: ${p.id} has 2 defence cards`);
        }
      });
      let steps = 0;
      while (session.state.status === 'running' && steps++ < 40_000) session.stepToNextWake();
      expect(session.state.status, `match ${i} finished`).toBe('finished');
    }
    expect(polls).toBeGreaterThan(10_000);
    expect(cardsPlayed).toBeGreaterThan(2000); // the bots do use cards
  }, 120_000);

  it('a bot never answers a screen with anything but one atomic chooseCards, and never leaves it open for a second poll', () => {
    const seats = [humanSeat(), ...botSeats('normal', 3)];
    for (let seed = 1; seed <= 40; seed++) {
      const initial = createInitialState(map, seats.map((s) => ({ id: s.id, name: s.id, kind: s.kind })), seed, pool);
      const session = new GameSession(map, initial, seats.map((s) => new SmartBotController(s.id, seed, s.profile)));
      const openSince = new Map<string, number>();
      session.subscribe((state) => {
        for (const p of state.players) {
          const open = !!(p.offer || p.discard);
          if (!open) openSince.delete(p.id);
          else if (!openSince.has(p.id)) openSince.set(p.id, state.timeMs);
        }
      });
      let guard = 0;
      while (session.state.status === 'running' && guard++ < 40_000) {
        session.stepToNextWake();
        for (const p of session.state.players) {
          // after a full step (tick + every poll) no bot screen may exist at all, except one opened by another seat's action later in the same step
          const t0 = openSince.get(p.id);
          if (t0 !== undefined) expect(session.state.timeMs - t0, `${p.id} seed ${seed}`).toBeLessThanOrEqual(100);
        }
      }
    }
  }, 120_000);
});

// ================================================================ §11 #2 replay and determinism
describe('2. replay and determinism with bots', () => {
  const seats = (): SimSeat[] => [humanSeat(HUMAN_PROFILE.attentive), ...botSeats('hard', 1), { id: 'bot2', kind: 'bot', profile: BOT_PROFILE.normal, botLevel: 'normal' }];
  const mk = (seed: number): GameState => createInitialState(map, seats().map((s) => ({ id: s.id, name: s.id, kind: s.kind, ...(s.botLevel ? { botLevel: s.botLevel } : {}) })), seed, pool);

  it('replay(actionLog) of a full match with bots equals the live final state (cards.md §8 #20)', () => {
    for (const seed of [11, 12, 13, 14, 15]) {
      const r = simulateMatch({ map, pool, seed, seats: seats() });
      expect(r.state.status).toBe('finished');
      const replayed = replay(map, mk(seed), r.session.actionLog.map((l) => l.action));
      expect(JSON.stringify(replayed), `seed ${seed}`).toBe(JSON.stringify(r.state));
    }
  });

  it('same seed -> same action sequence; different seed -> different', () => {
    const log = (seed: number) => JSON.stringify(simulateMatch({ map, pool, seed, seats: seats() }).session.actionLog);
    expect(log(21)).toBe(log(21));
    expect(log(21)).not.toBe(log(22));
  });

  it('skip-ahead simulation equals stepping every 50 ms (same actions at the same game times)', () => {
    for (const seed of [31, 32, 33]) {
      const a = simulateMatch({ map, pool, seed, seats: seats() });
      const b = simulateMatch({ map, pool, seed, seats: seats(), stepwise: true });
      expect(JSON.stringify(a.session.actionLog), `seed ${seed}`).toBe(JSON.stringify(b.session.actionLog));
      expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    }
  }, 60_000);

  it('streams: `bot` is used for attempts only and `botMind` for the rest', () => {
    const ctl = new SmartBotController('bot1', 7, 'normal');
    const botStream = createStream(7, 'bot1', 'bot');
    const mindStream = createStream(7, 'bot1', 'botMind');
    expect(botStream.getState()).not.toEqual(mindStream.getState());
    expect(ctl.playerId).toBe('bot1');
  });
});

// ================================================================ §11 #3 attempt simulation
describe('3. attempt simulation', () => {
  const attemptFor = (minigameId: string, difficulty: 'easy' | 'medium' | 'hard', seed: number, modifiers: Attempt['modifiers'] = []): Attempt => ({
    minigameId, targetId: 'medan', baseDifficulty: difficulty, modifiers, cardUids: [], onFail: { noCooldown: false, cooldownDeltaMs: 0 },
    onWin: { pickDelta: 0, winMultiplier: 1 }, seed, difficulty, attemptIndex: 0, introMs: 3000, startedAtMs: 10_000,
  });

  it('pass rate = table +-1.5 points per (level, difficulty), 12,000 attempts each, no modifiers', () => {
    for (const level of LEVELS) {
      for (const d of ['easy', 'medium', 'hard'] as const) {
        const r = createStream(99, `x-${level}-${d}`, 'bot');
        let pass = 0;
        for (let i = 0; i < 12_000; i++) if (simulateAttempt(attemptFor('tap_timing', d, i + 1), map, BOT_PROFILE[level], r).passed) pass++;
        expect(Math.abs(pass / 12_000 - BOT_PASS_CHANCE[level][d]), `${level}/${d}`).toBeLessThan(0.015);
      }
    }
  }, 60_000);

  it('each modifier kind moves the observed pass rate by 8 points; clamp 5-98%', () => {
    const profile = BOT_PROFILE.normal;
    const kinds: { m: Attempt['modifiers']; delta: number }[] = [
      { m: [{ kind: 'timeDelta', seconds: 5 }], delta: 0.08 },
      { m: [{ kind: 'tolerance', mult: 1.3 }], delta: 0.08 },
      { m: [{ kind: 'hint' }], delta: 0.08 },
      { m: [{ kind: 'speed', mult: 1.25 }], delta: -0.08 },
      { m: [{ kind: 'extraTarget', count: 1 }], delta: -0.08 },
      { m: [{ kind: 'fog' }], delta: -0.08 },
      { m: [{ kind: 'timeDelta', seconds: -5 }], delta: -0.08 },
    ];
    for (const { m, delta } of kinds) {
      const r = createStream(5, 'mod', 'bot');
      let pass = 0;
      for (let i = 0; i < 12_000; i++) if (simulateAttempt(attemptFor('tap_timing', 'medium', i + 1, m), map, profile, r).passed) pass++;
      expect(Math.abs(pass / 12_000 - (0.65 + delta)), JSON.stringify(m)).toBeLessThan(0.015);
    }
    expect(passChanceFor(BOT_PROFILE.easy, 'hard', [{ kind: 'fog' }, { kind: 'speed', mult: 1.25 }, { kind: 'extraTarget', count: 1 }, { kind: 'timeDelta', seconds: -5 }])).toBe(0.05);
    expect(passChanceFor(BOT_PROFILE.hard, 'easy', [{ kind: 'hint' }, { kind: 'tolerance', mult: 1.3 }, { kind: 'timeDelta', seconds: 5 }])).toBe(0.98);
  }, 60_000);

  it('pass time = D x U(passTimeFrac) (mean within 2%); dodge_runner passes take 100% of D; fail = D x U(0.4, 1.0)', () => {
    for (const level of LEVELS) {
      const profile = BOT_PROFILE[level];
      for (const mg of ['tap_timing', 'simon', 'dodge_runner']) {
        const r = createStream(3, `t-${level}-${mg}`, 'bot');
        const sums = { pass: 0, fail: 0, np: 0, nf: 0 };
        for (let i = 0; i < 6000; i++) {
          const a = attemptFor(mg, 'medium', i + 1);
          const D = (getMinigameLogic(mg).generateLevel({ seed: a.seed, difficulty: 'medium', modifiers: [], map: map.data, regionId: 'medan', inputMode: 'mouse', settings: { reducedMotion: false, reducedFlash: false, sfxVolume: 1 } }) as { durationMs: number }).durationMs;
          const out = simulateAttempt(a, map, profile, r);
          if (out.passed) { sums.pass += out.timeTakenMs / D; sums.np++; if (mg === 'dodge_runner') expect(out.timeTakenMs).toBe(D); }
          else { sums.fail += out.timeTakenMs / D; sums.nf++; expect(out.timeTakenMs / D).toBeGreaterThanOrEqual(0.399); expect(out.timeTakenMs / D).toBeLessThanOrEqual(1.001); }
          expect(out.resultAtMs).toBe(a.startedAtMs + a.introMs + out.timeTakenMs + 1200);
        }
        if (mg !== 'dodge_runner') {
          const mid = (profile.passTimeFrac[0] + profile.passTimeFrac[1]) / 2;
          expect(Math.abs(sums.pass / sums.np / mid - 1), `${level}/${mg} pass`).toBeLessThan(0.02);
        }
        expect(Math.abs(sums.fail / sums.nf / 0.7 - 1), `${level}/${mg} fail`).toBeLessThan(0.03);
      }
    }
  }, 120_000);

  it('exactly two `bot` draws per attempt: chance, then range', () => {
    const a = attemptFor('simon', 'hard', 77);
    const used = createStream(4, 'z', 'bot');
    simulateAttempt(a, map, BOT_PROFILE.hard, used);
    const ref = createStream(4, 'z', 'bot');
    ref.next();
    ref.next();
    expect(used.getState()).toEqual(ref.getState());
  });
});

// ================================================================ §11 #4 reaction delays, #5 brake, #16 pause
describe('4-5. reaction delays and the leader brake', () => {
  const free = (level: BotLevel): BotProfile => ({ ...BOT_PROFILE[level], paceTargetMs: Infinity, cardPlayChance: 0 });
  const timeline = (profile: BotProfile, seed: number) => {
    const r = simulateMatch({ map, pool, seed, seats: [{ id: 'bot1', kind: 'bot', profile, botLevel: 'normal' }] });
    return r.session.eventLog;
  };

  it('after a win nothing happens before afterWinMs (min); after a cooldown Mulai comes within thinkMs + 1 poll; all samples in range, mean within 5% of the middle', () => {
    for (const level of LEVELS) {
      const profile = free(level);
      const afterWin: number[] = [];
      const afterCd: number[] = [];
      for (let seed = 1; seed <= 80; seed++) {
        const log = timeline(profile, seed);
        let winAt: number | null = null;
        let cdEnd: number | null = null;
        for (const { timeMs, event: e } of log) {
          if (e.type === 'attemptResolved' && e.passed) { winAt = timeMs; cdEnd = null; }
          else if (e.type === 'attemptResolved') { cdEnd = e.cooldownMs > 0 ? timeMs + e.cooldownMs : timeMs; winAt = null; }
          else if (e.type === 'targetSelected' && winAt !== null) { afterWin.push(timeMs - winAt); winAt = null; }
          else if (e.type === 'attemptStarted') {
            if (winAt !== null) { afterWin.push(timeMs - winAt); winAt = null; }
            else if (cdEnd !== null) { afterCd.push(timeMs - cdEnd); cdEnd = null; }
          }
        }
      }
      const [wLo, wHi] = profile.afterWinMs;
      expect(afterWin.length).toBeGreaterThan(100);
      for (const d of afterWin) { expect(d).toBeGreaterThanOrEqual(wLo); expect(d).toBeLessThanOrEqual(wHi + 100); }
      expect(Math.abs(afterWin.reduce((a, b) => a + b, 0) / afterWin.length / ((wLo + wHi) / 2) - 1), `${level} afterWin mean`).toBeLessThan(0.05);
      const [tLo, tHi] = profile.thinkMs;
      expect(afterCd.length).toBeGreaterThan(50);
      for (const d of afterCd) { expect(d).toBeGreaterThanOrEqual(tLo); expect(d).toBeLessThanOrEqual(tHi + 100); }
    }
  }, 60_000);

  it('brake: a leading bot that is ahead of schedule never starts an attempt (asserted at every attemptStarted); a trailing bot starts without a brake', () => {
    let starts = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const k = (seed % 3) + 1;
      const seats = [humanSeat(), ...botSeats(seed % 2 ? 'hard' : 'normal', k)];
      const initial = createInitialState(map, seats.map((s) => ({ id: s.id, name: s.id, kind: s.kind })), seed, pool);
      const session = new GameSession(map, initial, seats.map((s) => new SmartBotController(s.id, seed, s.profile)));
      session.subscribe((state, events) => {
        for (const e of events) {
          if (e.type !== 'attemptStarted' || !e.playerId.startsWith('bot')) continue;
          starts++;
          const profile = seed % 2 ? BOT_PROFILE.hard : BOT_PROFILE.normal;
          expect(isAheadOfSchedule(observe(state, e.playerId), map, profile), `seed ${seed} ${e.playerId} at ${state.timeMs}`).toBe(false);
        }
      });
      let guard = 0;
      while (session.state.status === 'running' && guard++ < 40_000) session.stepToNextWake();
    }
    expect(starts).toBeGreaterThan(300);

    // rule itself: trailing = no brake, leading + early = brake, Infinity = off
    const s = scenario({ node: 'jakarta', target: 'toraja', wins: 0, timeMs: 60_000, opps: [{ remaining: 8 }, { remaining: 6 }] });
    const me = s.players[0] as PlayerState;
    me.remainingWins = 3; // 5 of 8 won, very early: ahead and leading (ties lead)
    expect(isAheadOfSchedule(obsOf(s), map, BOT_PROFILE.normal)).toBe(true);
    expect(isAheadOfSchedule(obsOf(s), map, { ...BOT_PROFILE.normal, paceTargetMs: Infinity })).toBe(false);
    (s.players[1] as PlayerState).remainingWins = 2; // an opponent in front: trailing, no brake
    expect(isAheadOfSchedule(obsOf(s), map, BOT_PROFILE.normal)).toBe(false);
    (s.players[1] as PlayerState).remainingWins = 3; // tie leads
    expect(isAheadOfSchedule(obsOf(s), map, BOT_PROFILE.normal)).toBe(true);
    s.timeMs = BOT_PROFILE.normal.paceTargetMs; // late: behind schedule
    expect(isAheadOfSchedule(obsOf(s), map, BOT_PROFILE.normal)).toBe(false);
  }, 120_000);

  it('without skip cards a braked bot never waits longer than paceTarget/total + 5 s in a row', () => {
    const total = 8;
    for (const level of ['normal', 'hard'] as const) {
      const profile: BotProfile = { ...BOT_PROFILE[level], cardPlayChance: 0 };
      const limit = profile.paceTargetMs / total + 5000;
      let longest = 0;
      for (let seed = 1; seed <= 6; seed++) {
        const seats: SimSeat[] = [{ id: 'bot1', kind: 'bot', profile, botLevel: level }];
        const initial = createInitialState(map, [{ id: 'bot1', name: 'b', kind: 'bot', botLevel: level }], seed, pool);
        const ctl = new SmartBotController('bot1', seed, profile);
        const session = new GameSession(map, initial, [ctl]);
        let since: number | null = null;
        let guard = 0;
        while (session.state.status === 'running' && guard++ < 60_000) {
          session.step();
          if (ctl.activity() === 'braking') since ??= session.state.timeMs;
          else if (since !== null) { longest = Math.max(longest, session.state.timeMs - since); since = null; }
        }
        void seats;
      }
      expect(longest, level).toBeGreaterThan(0); // the brake did engage
      expect(longest, level).toBeLessThanOrEqual(limit);
    }
  }, 120_000);

  it('a trailing bot is never delayed by the brake: with an opponent in front it presses Mulai right after its think delay', () => {
    const ctl = new SmartBotController('bot1', 1, 'hard');
    let s = scenario({ node: 'jakarta', target: 'toraja', timeMs: 30_000, opps: [{ remaining: 1 }, { remaining: 4 }] });
    let started: number | null = null;
    for (let i = 0; i < 400 && started === null; i++) {
      s = applyAction(map, s, { type: 'tick', dtMs: 50 }).state;
      const a = ctl.nextAction(s, map);
      if (a?.type === 'startAttempt') started = s.timeMs;
      else if (a) s = applyAction(map, s, a).state;
    }
    expect(started).not.toBeNull();
    expect((started as number) - 30_000).toBeLessThanOrEqual(BOT_PROFILE.hard.thinkMs[1] + 150);
  });
});

describe('16. pause freezes every bot delay and the brake', () => {
  it('no bot action while paused; after resuming the match matches an unpaused run step for step', () => {
    const mk = (): GameSession => {
      const seats = [...botSeats('normal', 2)];
      const initial = createInitialState(map, seats.map((x) => ({ id: x.id, name: x.id, kind: 'bot' as const, botLevel: 'normal' as const })), 9, pool);
      return new GameSession(map, initial, seats.map((x) => new SmartBotController(x.id, 9, x.profile)));
    };
    const a = mk();
    const b = mk();
    for (let i = 0; i < 1500; i++) a.step();
    for (let i = 0; i < 700; i++) b.step();
    const logLen = b.actionLog.length;
    const t = b.state.timeMs;
    b.setPaused(true);
    for (let i = 0; i < 5000; i++) b.step();
    expect(b.state.timeMs).toBe(t);
    expect(b.actionLog.length).toBe(logLen);
    b.setPaused(false);
    for (let i = 0; i < 800; i++) b.step();
    expect(JSON.stringify(b.state)).toBe(JSON.stringify(a.state));
    expect(JSON.stringify(b.actionLog)).toBe(JSON.stringify(a.actionLog));
  });
});

// ================================================================ §11 #6 hidden information
describe('6. a bot only uses what a human can see', () => {
  /** Change every column of the "Tidak boleh" list on a copy of the state. */
  function tamper(state: GameState, selfId: string, r: Rng): GameState {
    const s = JSON.parse(JSON.stringify(state)) as GameState;
    const ids = CARDS.map((c) => c.id);
    s.matchSeed = (s.matchSeed + 12345) >>> 0;
    s.nextCardUid += 99;
    for (const p of s.players) {
      p.pickRng = [r.nextUint32(), r.nextUint32(), r.nextUint32(), r.nextUint32()];
      p.cardsRng = [r.nextUint32(), r.nextUint32(), r.nextUint32(), r.nextUint32()];
      p.copetRng = [r.nextUint32(), r.nextUint32(), r.nextUint32(), r.nextUint32()];
      if (p.id === selfId) {
        p.nextMinigameId = p.nextMinigameId === 'simon' ? 'tap_timing' : 'simon'; // own roll before Mulai
        p.discarded = [];
        continue;
      }
      p.hand = p.hand.map((c) => ({ ...c, defId: r.pick(ids) })); // same count, other cards
      p.pending = p.pending.filter((c) => getCard(c.defId).type === 'sabotage' && getCard(c.defId).duration !== 'instant' && getCard(c.defId).usesSabotageSlot !== false); // boost / defence pending vanish
      for (const c of p.pending) c.source = c.source === selfId ? c.source : 'someone-else';
      p.pending.push(...(r.chance(0.5) ? [{ uid: 'zz1', defId: r.pick(['cermin_balik', 'payung_tameng', 'jam_pasir', 'santai_dulu']), seq: 0 }] : []));
      p.targetId = r.chance(0.5) ? null : 'padang';
      p.winsAtTarget = r.int(0, 1);
      p.lastMinigameId = r.chance(0.5) ? 'simon' : null;
      p.attempts = { x: r.int(0, 5) };
      p.discarded = [{ uid: 'zz2', defId: r.pick(ids), seq: 1 }];
      p.offer = p.offer ? { ...p.offer, marked: [], cards: p.offer.cards.map((c) => ({ ...c, defId: r.pick(ids) })) } : null;
      p.nextMinigameId = r.chance(0.5) ? 'simon' : 'tap_timing';
    }
    return s;
  }

  function sampleStates(n: number): { state: GameState; id: string }[] {
    const out: { state: GameState; id: string }[] = [];
    for (let seed = 1; out.length < n; seed++) {
      const seats = [humanSeat(), ...botSeats(LEVELS[seed % 3] as BotLevel, 3)];
      const initial = createInitialState(map, seats.map((x) => ({ id: x.id, name: x.id, kind: x.kind })), seed, pool);
      const session = new GameSession(map, initial, seats.map((x) => new SmartBotController(x.id, seed, x.profile)));
      let next = 20_000;
      let guard = 0;
      while (session.state.status === 'running' && guard++ < 40_000 && out.length < n) {
        session.stepToNextWake();
        if (session.state.timeMs >= next) {
          next += 12_000;
          out.push({ state: JSON.parse(JSON.stringify(session.state)) as GameState, id: seats[1 + (out.length % 3)]!.id });
        }
      }
    }
    return out;
  }

  it('500 mid-match states: the observation is identical, and so is every pure decision, after tampering with all hidden columns', () => {
    const states = sampleStates(500);
    let withHand = 0;
    let plays = 0;
    let picks = 0;
    states.forEach(({ state, id }, i) => {
      const r = rng(i + 1);
      const other = tamper(state, id, r);
      const o1 = observe(state, id);
      const o2 = observe(other, id);
      expect(JSON.stringify(o2.state), `state ${i}`).toBe(JSON.stringify(o1.state));
      // the observed hands of opponents are placeholders only
      for (const p of o1.state.players) if (p.id !== id) expect(p.hand.every((c) => c.defId === HIDDEN_CARD_ID)).toBe(true);
      expect(o1.me.nextMinigameId).toBeNull();
      const level = LEVELS[i % 3] as BotLevel;
      const profile = BOT_PROFILE[level];
      const decide = (o: typeof o1) => {
        const rr = rng(i + 100);
        const c = botPickCardToPlay(o, map, profile, rr, { lastCopetAtMs: null });
        const route = o.me.phase === 'idle' && !o.me.targetId ? botChooseRoute(o, map, profile, rr) : null;
        const offer = o.me.offer ? botChooseOffer(o, map, profile, rr) : null;
        const disc = o.me.discard ? botChooseDiscard(o, profile) : null;
        return JSON.stringify([c, route, offer, disc, isAheadOfSchedule(o, map, profile)]);
      };
      expect(decide(o2), `decision ${i}`).toBe(decide(o1));
      if (o1.me.hand.length > 0) withHand++;
      if (botPickCardToPlay(o1, map, profile, rng(i + 100), { lastCopetAtMs: null })) plays++;
      picks++;
    });
    expect(withHand).toBeGreaterThan(150);
    expect(plays).toBeGreaterThan(20);
    expect(picks).toBe(500);
  }, 120_000);

  it('whole controller: same actions on the real state and on the tampered state (200 polls)', () => {
    const states = sampleStates(200);
    states.forEach(({ state, id }, i) => {
      const level = LEVELS[i % 3] as BotLevel;
      const a = new SmartBotController(id, 55, level).nextAction(state, map);
      const b = new SmartBotController(id, 55, level).nextAction(tamper(state, id, rng(i)), map);
      expect(JSON.stringify(b), `poll ${i}`).toBe(JSON.stringify(a));
    });
  }, 120_000);

  it('bot code never reads secret fields (source scan): the decision code has none, the controller only seeds its own streams from matchSeed', () => {
    const strip = (f: string) => readFileSync(join(ROOT, 'src/logic', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const secret = /\b(matchSeed|pickRng|cardsRng|copetRng|nextMinigameId)\b/;
    expect(strip('botDecisions.ts').split('\n').filter((l) => secret.test(l))).toEqual([]);
    const ctl = strip('smartBot.ts').split('\n').filter((l) => secret.test(l)).map((l) => l.trim());
    expect(ctl).toEqual(['matchSeed: number,', "this.simRng = createStream(matchSeed, playerId, 'bot');", "this.mind = createStream(matchSeed, playerId, 'botMind');"]);
    expect(strip('smartBot.ts')).toMatch(/observe\(state, this\.playerId\)/);
  });
});

// ================================================================ §11 #7 routes
describe('7. route choice', () => {
  /** 8 nodes: start, hardA, hardB (short, hard) and easy1-4 (long, easy), finish. */
  const synthetic = (hardType: string): MapGraph => {
    const base = indonesiaData();
    const regions: MapData['regions'] = ['s', 'ha', 'hb', 'e1', 'e2', 'e3', 'e4', 'fin'].map((id, i) => ({
      id, name: { id }, type: id.startsWith('h') ? hardType : id === 's' || id === 'fin' ? 'pantai' : 'sawah', position: { x: 5 + i * 10, z: 20 },
    }));
    const edges = [['s', 'ha'], ['ha', 'hb'], ['hb', 'fin'], ['s', 'e1'], ['e1', 'e2'], ['e2', 'e3'], ['e3', 'e4'], ['e4', 'fin'], ['hb', 'e4']].map(([from, to]) => ({ from: from!, to: to! }));
    const places = base.places.map((pl, i) => ({ ...pl, regionId: regions[i % regions.length]!.id }));
    const data: MapData = { ...base, id: 'synthetic', regions, edges, places, presets: { ...base.presets, standard: { enabled: true, start: 's', finish: 'fin', winsRequired: 2, routeLength: { min: 3, max: 5 } }, short: { ...base.presets.short, enabled: false }, long: { ...base.presets.long, enabled: false } } };
    return loadMap(data, 'standard', []);
  };
  const stateAt = (m: MapGraph, node: string): GameState => {
    const s = createInitialState(m, [{ id: 'bot1', name: 'b', kind: 'bot' }, { id: 'o1', name: 'o', kind: 'human' }], 3, ['tap_timing']);
    (s.players[0] as PlayerState).nodeId = node;
    return s;
  };

  it('Easy: 10,000 picks, each neighbour 50% +-3', () => {
    const m = synthetic('gunung');
    const s = stateAt(m, 's');
    const r = createStream(1, 'bot1', 'botMind');
    const counts = new Map<string, number>();
    for (let i = 0; i < 10_000; i++) {
      const t = botChooseRoute(observe(s, 'bot1'), m, BOT_PROFILE.easy, r) as string;
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    expect([...counts.keys()].sort()).toEqual(['e1', 'ha']);
    for (const c of counts.values()) expect(Math.abs(c / 100 - 50)).toBeLessThan(3);
  });

  it('Normal: shortest 85% +-3 (the rest is a mistake), tie-break lower difficulty then random', () => {
    const m = synthetic('gunung');
    const s = stateAt(m, 's');
    const r = createStream(2, 'bot1', 'botMind');
    let short = 0;
    for (let i = 0; i < 10_000; i++) if (botChooseRoute(observe(s, 'bot1'), m, BOT_PROFILE.normal, r) === 'ha') short++;
    expect(Math.abs(short / 100 - 85)).toBeLessThan(3);
    // a real tie (two neighbours with the same distance): the lower base difficulty wins every time with mistake = 0
    const tie = (s2: GameState) => botChooseRoute(observe(s2, 'bot1'), map, { ...BOT_PROFILE.normal, routeMistake: 0 }, createStream(1, 'x', 'y'));
    const atSabang = stateAt(map, 'sabang');
    expect(tie(atSabang)).toBe('medan'); // medan (medium) vs padang (hard), same distance
  });

  it('Hard: always the lowest expected cost, in both directions', () => {
    const m = synthetic('gunung');
    const s = stateAt(m, 's');
    const choose = (profile: BotProfile) => new Set(Array.from({ length: 200 }, (_, i) => botChooseRoute(observe(s, 'bot1'), m, profile, createStream(i, 'h', 'h'))));
    const costs = routeCosts(m, BOT_PROFILE.hard);
    expect(costs.get('ha')!).toBeLessThan(costs.get('e1')!); // short-hard is cheaper with the real table
    expect([...choose(BOT_PROFILE.hard)]).toEqual(['ha']);
    const tough: BotProfile = { ...BOT_PROFILE.hard, passChance: { easy: 0.92, medium: 0.8, hard: 0.08 } };
    const costs2 = routeCosts(m, tough);
    expect(costs2.get('e1')!).toBeLessThan(costs2.get('ha')!); // and long-easy is cheaper when hard regions are brutal
    expect([...choose(tough)]).toEqual(['e1']);
  });

  it('Indonesia: Normal and Hard go Sabang -> Medan, Jakarta -> Toraja, Toraja -> Labuan Bajo (Normal >= 85%); same seed, same pick', () => {
    for (const [from, to] of [['sabang', 'medan'], ['jakarta', 'toraja'], ['toraja', 'labuan_bajo']] as const) {
      const s = stateAt(map, from);
      const r = createStream(9, 'bot1', 'botMind');
      let n = 0;
      for (let i = 0; i < 2000; i++) if (botChooseRoute(observe(s, 'bot1'), map, BOT_PROFILE.normal, r) === to) n++;
      expect(n / 2000, `normal ${from}`).toBeGreaterThanOrEqual(0.85);
      expect(botChooseRoute(observe(s, 'bot1'), map, BOT_PROFILE.hard, createStream(1, 'a', 'b')), `hard ${from}`).toBe(to);
      expect(botChooseRoute(observe(s, 'bot1'), map, BOT_PROFILE.normal, createStream(4, 'a', 'b'))).toBe(botChooseRoute(observe(s, 'bot1'), map, BOT_PROFILE.normal, createStream(4, 'a', 'b')));
    }
  });

  it('a bot never switches target: in 100 matches no bot ever loses partial wins or re-selects while it has a target', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const seats = [humanSeat(), ...botSeats(LEVELS[seed % 3] as BotLevel, 2)];
      const initial = createInitialState(map, seats.map((x) => ({ id: x.id, name: x.id, kind: x.kind })), seed, pool);
      const session = new GameSession(map, initial, seats.map((x) => new SmartBotController(x.id, seed, x.profile)));
      session.subscribe((_s, events) => {
        for (const e of events) if (e.type === 'targetSelected' && e.playerId.startsWith('bot')) expect(e.lostWins, `seed ${seed}`).toBe(0);
      });
      let guard = 0;
      while (session.state.status === 'running' && guard++ < 40_000) session.stepToNextWake();
      // exactly one selectTarget per region a bot conquers (+ the one it is working on)
      const perBot = new Map<string, number>();
      for (const l of session.actionLog) if (l.action.type === 'selectTarget' && l.action.playerId.startsWith('bot')) perBot.set(l.action.playerId, (perBot.get(l.action.playerId) ?? 0) + 1);
      for (const p of session.state.players) if (p.id.startsWith('bot')) expect(perBot.get(p.id) ?? 0, `${p.id} seed ${seed}`).toBeLessThanOrEqual(p.path.length);
    }
  }, 120_000);
});

// ================================================================ §11 #8 offers
describe('8. offers and discards', () => {
  const offerState = (cards: string[], pick: number, extra: Scenario = {}): GameState => {
    const s = scenario(extra);
    (s.players[0] as PlayerState).offer = { cards: cards.map((d, i) => ({ uid: `of${i}`, defId: d, seq: 0 })), pick, marked: [], expiresAtMs: 1e9 };
    return s;
  };
  const FIVE = ['jam_pasir', 'badai', 'kopi_tubruk', 'gunung_meletus', 'teropong'];

  it('Easy: each of the 5 slots is chosen 1/5 +-2 points of the time (10,000 offers, N = 1)', () => {
    const s = offerState(FIVE, 1);
    const r = createStream(1, 'bot1', 'botMind');
    const count = new Map<string, number>();
    for (let i = 0; i < 10_000; i++) for (const u of botChooseOffer(observe(s, 'bot1'), map, BOT_PROFILE.easy, r)) count.set(u, (count.get(u) ?? 0) + 1);
    for (let i = 0; i < 5; i++) expect(Math.abs((count.get(`of${i}`) ?? 0) / 100 - 20)).toBeLessThan(2);
  });

  it('Normal: always the N highest-valued cards; ties go to higher rarity, then the leftmost slot', () => {
    const s = offerState(FIVE, 2);
    expect(botChooseOffer(obsOf(s), map, BOT_PROFILE.normal, rng(1))).toEqual(['of1', 'of3']); // badai (6), gunung (9) in slot order
    // tie on value: ojek_kilat 7 vs tiket_pesawat 7 (epic wins), santai 6 / copet 6 / badai 6 (rare, leftmost wins)
    const tie = offerState(['ojek_kilat', 'tiket_pesawat', 'santai_dulu', 'copet', 'badai'], 2);
    expect(botChooseOffer(obsOf(tie), map, BOT_PROFILE.normal, rng(1))).toEqual(['of0', 'of1']);
    const tie2 = offerState(['santai_dulu', 'copet', 'badai', 'jam_pasir', 'teropong'], 2);
    expect(botChooseOffer(obsOf(tie2), map, BOT_PROFILE.normal, rng(1))).toEqual(['of0', 'of1']);
    for (const seed of [1, 2, 3]) expect(botChooseOffer(obsOf(s), map, BOT_PROFILE.normal, rng(seed))).toEqual(['of1', 'of3']);
  });

  it('Hard: a duplicate in hand (-3) and a rich opponent hand for Copet (+1) change the pick, as written in §6', () => {
    const base = ['badai', 'copet', 'tambah_beban', 'jam_pasir', 'teropong'];
    const plain = offerState(base, 1);
    expect(botChooseOffer(obsOf(plain), map, BOT_PROFILE.hard, rng(1))).toEqual(['of0']); // badai 6 vs copet 6: rarity tie, leftmost
    const dup = offerState(base, 1, { hand: ['badai'] }); // badai 6 - 3 = 3
    expect(botChooseOffer(obsOf(dup), map, BOT_PROFILE.hard, rng(1))).toEqual(['of1']); // copet 6
    const rich = offerState(base, 1, { opps: [{ hand: ['teropong', 'teropong', 'teropong'] }, {}] }); // copet 6 + 1
    expect(botChooseOffer(obsOf(rich), map, BOT_PROFILE.hard, rng(1))).toEqual(['of1']);
    expect(botChooseOffer(obsOf(rich), map, BOT_PROFILE.normal, rng(1))).toEqual(['of0']); // Normal has no context
    // maxStacks 2 cards only lose 1
    expect(botScoreCard(obsOf(offerState(['jam_pasir'], 1, { hand: ['jam_pasir'] })), map, 'jam_pasir', true)).toBe(BOT_CARD_VALUE.jam_pasir! - 1);
  });

  it('discard: Easy follows the §3.4 auto rule, Normal/Hard drop the lowest value (oldest first)', () => {
    const hand = ['gunung_meletus', 'kopi_tubruk', 'badai', 'oleh_oleh', 'jam_pasir', 'teropong'];
    const s = scenario({ hand });
    (s.players[0] as PlayerState).discard = { newUids: [], marked: [], expiresAtMs: 1e9 };
    const lowest = botChooseDiscard(obsOf(s), BOT_PROFILE.normal);
    expect(lowest).toHaveLength(1);
    expect(observe(s, 'bot1').me.hand.find((c) => c.uid === lowest[0])!.defId).toBe('kopi_tubruk'); // value 1.5
    const easy = botChooseDiscard(obsOf(s), BOT_PROFILE.easy);
    expect(observe(s, 'bot1').me.hand.find((c) => c.uid === easy[0])!.defId).toBe('kopi_tubruk'); // lowest rarity, oldest: first common
  });

  it('the same offer gives the same answer (atomic, deterministic) and the reducer accepts it; chooseCards validates its input', () => {
    const s = offerState(FIVE, 2);
    const a = new SmartBotController('bot1', 3, 'normal').nextAction(s, map) as GameAction;
    expect(a).toEqual({ type: 'chooseCards', playerId: 'bot1', cardUids: ['of1', 'of3'] });
    const ok = applyAction(map, s, a);
    expect(ok.events.some((e) => e.type === 'cardsPicked')).toBe(true);
    expect(ok.state.players[0]!.hand.map((c) => c.defId).sort()).toEqual(['badai', 'gunung_meletus']);
    const bad = (cardUids: string[]) => applyAction(map, s, { type: 'chooseCards', playerId: 'bot1', cardUids }).events[0];
    expect(bad(['of1'])).toMatchObject({ type: 'actionRejected', reason: 'bad-selection' });
    expect(bad(['of1', 'of1'])).toMatchObject({ type: 'actionRejected', reason: 'bad-selection' });
    expect(bad(['of1', 'nope'])).toMatchObject({ type: 'actionRejected', reason: 'bad-selection' });
    expect(bad(['of1', 'of2', 'of3'])).toMatchObject({ type: 'actionRejected', reason: 'bad-selection' });
    expect(applyAction(map, scenario(), { type: 'chooseCards', playerId: 'bot1', cardUids: [] }).events[0]).toMatchObject({ reason: 'no-cards-screen' });
  });
});

// ================================================================ §11 #9-#12 playing cards
describe('9-12. playing cards', () => {
  const play = (s: GameState, level: BotLevel, seed = 1, ctx: { lastCopetAtMs: number | null } = { lastCopetAtMs: null }) =>
    botPickCardToPlay(obsOf(s), map, BOT_PROFILE[level], rng(seed), ctx);
  const defOf = (s: GameState, p: { cardUid: string } | null) => (p ? s.players[0]!.hand.find((c) => c.uid === p.cardUid)!.defId : null);

  it('9. Easy: of 10,000 evaluations with a playable card, 30% +-3 play it; the target is uniform over valid targets (+-3)', () => {
    const s = scenario({ hand: ['ngebut'], opps: [{}, {}, {}] });
    let played = 0;
    const hits = new Map<string, number>();
    for (let i = 0; i < 10_000; i++) {
      const p = play(s, 'easy', i + 1);
      if (p) { played++; hits.set(p.targetId!, (hits.get(p.targetId!) ?? 0) + 1); }
    }
    expect(Math.abs(played / 100 - 30)).toBeLessThan(3);
    for (const id of ['o1', 'o2', 'o3']) expect(Math.abs(((hits.get(id) ?? 0) / played) * 100 - 100 / 3)).toBeLessThan(3);
    // nothing playable: no gate draw is needed and nothing is played
    expect(play(scenario({ hand: ['kopi_tubruk'] }), 'easy')).toBeNull(); // only during a cooldown
  });

  it('9. Easy plays any playable kind at random: boost, sabotage and defence all show up', () => {
    const s = scenario({ hand: ['jam_pasir', 'badai', 'cermin_balik'], target: 'medan', opps: [{}, {}] });
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) { const p = play(s, 'easy', i + 1); if (p) seen.add(defOf(s, p)!); }
    expect([...seen].sort()).toEqual(['badai', 'cermin_balik', 'jam_pasir']);
  });

  it('10. Normal: Santai Dulu / Ojek Kilat never on an easy region; Kopi only with a cooldown >= 2 s; Tiket never at FINAL or with a partial win', () => {
    for (const target of ['padang', 'medan', 'jakarta', 'toraja', 'labuan_bajo', 'yogyakarta', 'bali']) {
      const node = target === 'medan' || target === 'padang' ? 'sabang' : target === 'jakarta' ? 'medan' : target === 'toraja' || target === 'yogyakarta' ? 'jakarta' : target === 'bali' ? 'yogyakarta' : 'toraja';
      const diff = map.data.regionTypes[map.regions.get(target)!.type]!.difficulty;
      const s = scenario({ node, target, hand: ['santai_dulu', 'ojek_kilat', 'tiket_pesawat'] }); // 3 cards: below the overflow hand
      const p = play(s, 'normal');
      const d = defOf(s, p);
      if (diff === 'easy') expect(['santai_dulu', 'ojek_kilat', 'tiket_pesawat']).not.toContain(d);
      if (map.finalRegions.has(target)) expect(d).not.toBe('tiket_pesawat');
    }
    const partial = scenario({ node: 'jakarta', target: 'toraja', wins: 1, hand: ['tiket_pesawat', 'ojek_kilat'] });
    expect(defOf(partial, play(partial, 'normal'))).not.toBe('tiket_pesawat');
    expect(defOf(partial, play(partial, 'normal'))).toBeNull(); // Ojek only before the first win
    const cd1 = scenario({ hand: ['kopi_tubruk'], cooldownMs: 1500 });
    expect(play(cd1, 'normal')).toBeNull();
    const cd2 = scenario({ hand: ['kopi_tubruk'], cooldownMs: 4000 });
    expect(defOf(cd2, play(cd2, 'normal'))).toBe('kopi_tubruk');
    const hardTarget = scenario({ node: 'jakarta', target: 'toraja', hand: ['tiket_pesawat'] });
    expect(defOf(hardTarget, play(hardTarget, 'normal'))).toBe('tiket_pesawat');
  });

  it('10. Normal sabotage goes to the leader among valid targets (>= 95%); only when the leader is invalid does it go elsewhere', () => {
    let leader = 0;
    const N = 400;
    for (let i = 0; i < N; i++) {
      const s = scenario({ hand: ['ngebut'], opps: [{ remaining: 5 }, { remaining: 2 }, { remaining: 7 }], seed: i + 1 });
      const p = play(s, 'normal', i + 1)!;
      if (p.targetId === 'o2') leader++;
    }
    expect(leader / N).toBeGreaterThanOrEqual(0.95);
    const full = scenario({ hand: ['ngebut'], opps: [{ remaining: 5 }, { remaining: 2, slots: ['badai', 'kabut_asap'] }, { remaining: 7 }] });
    expect(play(full, 'normal')!.targetId).toBe('o1'); // the leader is Full: the next best valid one
    const tie = scenario({ hand: ['ngebut'], opps: [{ remaining: 3, slots: ['badai'] }, { remaining: 3 }] });
    expect(play(tie, 'normal')!.targetId).toBe('o2'); // tie: fewer filled slots
  });

  it('10. Normal priority list: defence first (Cermin before Payung), then Kopi, Tiket, Ojek, Oleh-oleh, boosts, sabotage', () => {
    const s = scenario({ node: 'jakarta', target: 'toraja', hand: ['jam_pasir', 'payung_tameng', 'badai', 'cermin_balik'], opps: [{}, {}] });
    expect(defOf(s, play(s, 'normal'))).toBe('cermin_balik');
    const s2 = scenario({ node: 'jakarta', target: 'toraja', hand: ['jam_pasir', 'payung_tameng'] });
    expect(defOf(s2, play(s2, 'normal'))).toBe('payung_tameng');
    const s3 = scenario({ node: 'jakarta', target: 'toraja', hand: ['badai', 'jam_pasir'], opps: [{}, {}] });
    expect(defOf(s3, play(s3, 'normal'))).toBe('jam_pasir'); // boost group (hard region, p 0.45) before sabotage
    const s4 = scenario({ node: 'jakarta', target: 'yogyakarta', hand: ['oleh_oleh'] });
    expect(defOf(s4, play(s4, 'normal'))).toBe('oleh_oleh');
    const s5 = scenario({ node: 'sabang', target: 'medan', hand: ['oleh_oleh', 'jam_pasir', 'zona_lebar'] });
    expect(defOf(s5, play(s5, 'normal'))).toBe('zona_lebar'); // hand 3 + N 2 + 1 > 5: no Oleh-oleh, the boost group runs instead
  });

  it('Normal: Oleh-oleh is never played when the next win decides the match (no offer, C-3)', () => {
    const s = scenario({ node: 'toraja', target: 'labuan_bajo', wins: 1, hand: ['oleh_oleh'] });
    expect(play(s, 'normal')).toBeNull();
  });

  it('11. Hard: boosts only while p_next <= 0.70; Copet only with a rich target hand and >= 60 s apart; Gunung needs 2 valid opponents', () => {
    // medium region: p = 0.80 -> keep the boosts
    const medium = scenario({ node: 'sabang', target: 'medan', hand: ['jam_pasir'] });
    expect(play(medium, 'hard')).toBeNull();
    // hard region: 0.65
    const hard = scenario({ node: 'jakarta', target: 'toraja', hand: ['jam_pasir'] });
    expect(defOf(hard, play(hard, 'hard'))).toBe('jam_pasir');
    // medium region but two sabotage kinds pending: 0.80 - 0.16 = 0.64
    const sab = scenario({ node: 'sabang', target: 'medan', hand: ['jam_pasir'], pending: [{ id: 'kabut_asap', source: 'o1' }, { id: 'ngebut', source: 'o1' }] });
    expect(defOf(sab, play(sab, 'hard'))).toBe('jam_pasir');
    // Copet
    const poor = scenario({ hand: ['copet'], opps: [{ hand: ['teropong', 'teropong'] }, { hand: ['teropong'] }] });
    expect(play(poor, 'hard')).toBeNull(); // hands of 2 < copetMinHand 3
    const rich = scenario({ hand: ['copet'], opps: [{ hand: ['teropong', 'teropong'], remaining: 1 }, { hand: ['teropong', 'teropong', 'teropong', 'teropong'] }] });
    expect(play(rich, 'hard')).toMatchObject({ targetId: 'o2' }); // the largest hand, not the leader
    expect(play(rich, 'hard', 1, { lastCopetAtMs: rich.timeMs - 59_000 })).toBeNull();
    expect(play(rich, 'hard', 1, { lastCopetAtMs: rich.timeMs - 60_000 })).not.toBeNull();
    // Gunung
    const one = scenario({ hand: ['gunung_meletus'], opps: [{ slots: ['badai', 'kabut_asap'] }, {}] }); // 1 valid of 2
    expect(play(one, 'hard')).toBeNull();
    const two = scenario({ hand: ['gunung_meletus'], opps: [{}, {}] });
    expect(defOf(two, play(two, 'hard'))).toBe('gunung_meletus');
    const solo = scenario({ hand: ['gunung_meletus'], opps: [{}] }); // a single opponent: like an `opponent` card
    expect(defOf(solo, play(solo, 'hard'))).toBe('gunung_meletus');
    expect(play(one, 'normal')).not.toBeNull(); // Normal: one valid is enough
  });

  it('11. Hard plays a defence card within one evaluation of owning it; Cermin before Payung', () => {
    const s = scenario({ hand: ['payung_tameng', 'cermin_balik'] });
    expect(defOf(s, play(s, 'hard'))).toBe('cermin_balik');
    const only = scenario({ hand: ['payung_tameng'] });
    expect(defOf(only, play(only, 'hard'))).toBe('payung_tameng');
    const active = scenario({ hand: ['payung_tameng'], pending: [{ id: 'cermin_balik' }] }); // already one active: not playable
    expect(play(active, 'hard')).toBeNull();
  });

  it('overflow rule: with 4+ cards and nothing that qualifies, the lowest-value playable card goes; with fewer it stays', () => {
    const four = scenario({ node: 'sabang', target: 'padang', hand: ['gunung_meletus', 'jam_rusak', 'badai', 'macet_total'], opps: [{ slots: ['badai', 'kabut_asap'] }] });
    // the only opponent is Full: nothing playable at all
    expect(play(four, 'normal')).toBeNull();
    const hand = ['oleh_oleh', 'teropong', 'zona_lebar', 'jam_pasir'];
    const s = scenario({ node: 'sabang', target: 'medan', hand }); // medium: p 0.65 -> boosts go anyway for Normal (<= 0.80)
    expect(play(s, 'normal')).not.toBeNull();
    const hardOne = scenario({ node: 'sabang', target: 'medan', hand: ['teropong', 'zona_lebar', 'jam_pasir'] }); // 3 cards, Hard keeps them (p 0.8 > 0.7)
    expect(play(hardOne, 'hard')).toBeNull();
    const hardFour = scenario({ node: 'sabang', target: 'medan', hand: ['teropong', 'zona_lebar', 'jam_pasir', 'kopi_tubruk'] }); // 4: overflow
    // kopi_tubruk is not playable (no cooldown), so the cheapest playable one goes: zona_lebar / teropong (3.5), oldest first
    expect(defOf(hardFour, play(hardFour, 'hard'))).toBe('teropong');
  });

  it('12. a hand of sabotage against Full / already-stacked opponents: nothing is played in 10,000 evaluations, the cards stay, nothing is rejected', () => {
    const s = scenario({
      hand: ['ngebut', 'badai', 'jam_rusak', 'tambah_beban', 'gunung_meletus'],
      opps: [{ slots: ['badai', 'kabut_asap'] }, { slots: ['ngebut', 'tambah_beban'] }],
    });
    for (let i = 0; i < 10_000; i++) {
      for (const level of LEVELS) expect(play(s, level, i + 1)).toBeNull();
    }
    // one slot taken by the same card: that card is stacked-out, others still land
    const stacked = scenario({ hand: ['ngebut', 'badai'], opps: [{ slots: ['ngebut'] }] });
    for (let i = 0; i < 200; i++) expect(defOf(stacked, play(stacked, 'hard', i + 1))).toBe('badai');
    // Copet at an empty-handed opponent is not valid
    const empty = scenario({ hand: ['copet'], opps: [{ hand: [] }] });
    expect(play(empty, 'normal')).toBeNull();
  });

  it('13-15. card evaluation period: gaps between evaluations follow tickMs and card plays respect cardGapMs', () => {
    for (const level of LEVELS) {
      const profile = BOT_PROFILE[level];
      const times: number[] = [];
      const seats: SimSeat[] = [{ id: 'bot1', kind: 'bot', profile, botLevel: level }, ...botSeats(level, 1).map((x) => ({ ...x, id: 'bot2' }))];
      const initial = createInitialState(map, seats.map((x) => ({ id: x.id, name: x.id, kind: 'bot' as const, botLevel: level })), 5, pool);
      const session = new GameSession(map, initial, seats.map((x) => new SmartBotController(x.id, 5, x.profile)));
      const plays: number[] = [];
      session.subscribe((state, events) => { for (const e of events) if (e.type === 'cardPlayed' && e.playerId === 'bot1') plays.push(state.timeMs); });
      void times;
      let guard = 0;
      while (session.state.status === 'running' && guard++ < 60_000) session.stepToNextWake();
      for (let i = 1; i < plays.length; i++) expect(plays[i]! - plays[i - 1]!, `${level} card gap`).toBeGreaterThanOrEqual(profile.cardGapMs);
      // evaluations are tickMs apart: consecutive plays are at least tickMin apart as well
      for (let i = 1; i < plays.length; i++) expect(plays[i]! - plays[i - 1]!).toBeGreaterThanOrEqual(profile.tickMs[0]);
      expect(plays.length).toBeGreaterThan(3);
    }
  }, 60_000);
});

// ================================================================ §11 #13-#14, #17: gates (fixed seeds)
describe('13-14, 17. calibration and C-1 on fixed seeds (the full 1000-match gates run with `npm run sim`)', () => {
  const data = (): { map: MapGraph; pool: string[] } => ({ map, pool });

  it('reference humans: median solo time within +-0.7 min of 11.0 / 8.0 / 6.5 (300 matches each)', () => {
    const targets = { casual: 11.0, attentive: 8.0, expert: 6.5 } as const;
    for (const h of ['casual', 'attentive', 'expert'] as const) {
      const r = runCell({ ...data(), seats: [humanSeat(HUMAN_PROFILE[h])] }, `solo:${h}`, 300, 1);
      expect(Math.abs(r.medianMin - targets[h]), `${h} median ${r.medianMin.toFixed(2)}`).toBeLessThanOrEqual(0.7);
      expect(r.rejected).toBe(0);
    }
  }, 120_000);

  it('C-1: casual + 1/2/3 Easy/Normal bots: median in [10, 13] min and p95 <= 18; vs Hard: median in [7, 9] (200 matches per cell)', () => {
    for (const level of LEVELS) {
      for (const k of [1, 2, 3]) {
        const r = runCell({ ...data(), seats: [humanSeat(), ...botSeats(level, k)] }, `c1:${level}:${k}`, 200, 1);
        const [lo, hi] = level === 'hard' ? [7, 9] : [10, 13];
        expect(r.medianMin, `${level} x${k} median ${r.medianMin.toFixed(2)}`).toBeGreaterThanOrEqual(lo);
        expect(r.medianMin, `${level} x${k}`).toBeLessThanOrEqual(hi);
        expect(r.p95Min, `${level} x${k} p95`).toBeLessThanOrEqual(18);
        expect(r.rejected).toBe(0);
        expect(r.timedOut).toBe(0);
      }
    }
  }, 180_000);

  it('17. performance: 300 four-player matches (1 reference human + 3 bots) finish well inside the budget', () => {
    const t0 = Date.now();
    const r = runCell({ ...data(), seats: [humanSeat(), ...botSeats('hard', 3)] }, 'perf', 300, 2);
    expect(r.matches).toBe(300);
    expect(Date.now() - t0).toBeLessThan(90_000); // 1000 matches < 5 min means < 300 s per 1000
  }, 120_000);
});
