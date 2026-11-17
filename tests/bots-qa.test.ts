/**
 * CP5a QA: independent checks on top of tests/bots.test.ts (docs/bots.md §11).
 * Adds: whole-match hidden-information test with a stateful tampering wrapper, a leak probe on the
 * one column the observation keeps (opponent pending sabotage types), 2000-match zero-rejection run
 * on fresh seeds, disruption fuzz (random grants / forced offers / long ticks) with zone invariants,
 * replay over many level mixes, pause at the worst moments (thinking / braking), and measurements
 * (dog-pile on a human leader, overflow-rule plays, delay lower bounds) that are printed for the report.
 */
import { describe, expect, it } from 'vitest';
import {
  BOT_PROFILE,
  botPickCardToPlay,
  CARDS,
  cooldownRemainingMs,
  createInitialState,
  GameSession,
  getCard,
  HUMAN_PROFILE,
  holdsSlot,
  loadMap,
  minigamePool,
  MINIGAME_LOGIC,
  observe,
  replay,
  Rng,
  SmartBotController,
  sabotageSlotsUsed,
  simulateMatch,
  type BotActivity,
  type BotLevel,
  type BotProfile,
  type GameAction,
  type GameState,
  type MapGraph,
  type PlayerController,
  type PlayerState,
  type SimSeat,
} from '../src/logic';
import { indonesiaData } from './helpers';

const map: MapGraph = loadMap(indonesiaData(), 'standard', MINIGAME_LOGIC);
const pool = minigamePool(map.data);
const LEVELS: BotLevel[] = ['easy', 'normal', 'hard'];
const HUMANS = [HUMAN_PROFILE.casual, HUMAN_PROFILE.attentive, HUMAN_PROFILE.expert];

const humanSeat = (profile: BotProfile = HUMAN_PROFILE.casual): SimSeat => ({ id: 'p1', kind: 'human', profile });
const botSeat = (id: string, level: BotLevel): SimSeat => ({ id, kind: 'bot', profile: BOT_PROFILE[level], botLevel: level });
const setup = (seats: readonly SimSeat[]) => seats.map((s) => ({ id: s.id, name: s.id, kind: s.kind, ...(s.botLevel ? { botLevel: s.botLevel } : {}) }));
const mkState = (seats: readonly SimSeat[], seed: number): GameState => createInitialState(map, setup(seats), seed, pool);
const mkSession = (seats: readonly SimSeat[], seed: number, wrap?: (c: SmartBotController) => PlayerController): GameSession => {
  const ctls = seats.map((s) => {
    const c = new SmartBotController(s.id, seed, s.profile);
    return wrap ? wrap(c) : c;
  });
  return new GameSession(map, mkState(seats, seed), ctls);
};
const finish = (s: GameSession, guard = 60_000): void => {
  let n = 0;
  while (s.state.status === 'running' && n++ < guard) s.stepToNextWake();
};

function allUids(s: Readonly<GameState>): string[] {
  const out: string[] = [];
  for (const p of s.players) {
    out.push(...p.hand.map((c) => c.uid), ...p.pending.map((c) => c.uid), ...p.discarded.map((c) => c.uid));
    if (p.offer) out.push(...p.offer.cards.map((c) => c.uid));
  }
  return out;
}

/** Zone / legality invariants that must hold after every applied action (throws with a label). */
function invariants(s: Readonly<GameState>, label: string, opts: { restHand?: boolean } = {}): void {
  const all = allUids(s);
  if (new Set(all).size !== all.length) throw new Error(`${label}: a card is in two zones`);
  if (all.length !== s.nextCardUid - 1) throw new Error(`${label}: a card is in no zone (${all.length} vs ${s.nextCardUid - 1})`);
  for (const q of s.players) {
    const tag = `${label} ${q.id}`;
    if (sabotageSlotsUsed(q) > 2) throw new Error(`${tag}: ${sabotageSlotsUsed(q)} sabotage slots`);
    if (q.offer && q.discard) throw new Error(`${tag}: offer and discard together`);
    if ((q.phase === 'playing') !== (q.attempt !== null)) throw new Error(`${tag}: phase vs attempt`);
    if (q.phase === 'playing' && (q.offer || q.discard)) throw new Error(`${tag}: screen while playing`);
    if (q.discard && q.hand.length <= 5) throw new Error(`${tag}: discard open with hand ${q.hand.length}`);
    if (q.hand.length > 11) throw new Error(`${tag}: hand ${q.hand.length}`);
    if (opts.restHand !== false && s.status === 'running' && q.phase === 'idle' && !q.offer && !q.discard && q.hand.length > 5) throw new Error(`${tag}: idle hand ${q.hand.length}`);
    if (q.pending.filter((c) => getCard(c.defId).duration === 'next_sabotage').length > 1) throw new Error(`${tag}: two defence cards`);
    for (const c of CARDS) {
      if (c.maxStacks !== null && c.duration === 'next_minigame' && q.pending.filter((x) => x.defId === c.id).length > c.maxStacks) throw new Error(`${tag}: ${c.id} over maxStacks`);
    }
  }
}

const mixSeats = (i: number): SimSeat[] => {
  const k = (i % 3) + 1;
  const seats: SimSeat[] = [humanSeat(HUMANS[i % 3])];
  for (let b = 0; b < k; b++) seats.push(botSeat(`bot${b + 1}`, LEVELS[(i + b * (1 + (i % 2))) % 3] as BotLevel)); // mixed levels inside one match too
  return seats;
};

// ------------------------------------------------------------------------------------------
// #6 hidden information, whole match (stateful): the controller sees only a tampered copy
// ------------------------------------------------------------------------------------------
describe('QA 6. hidden information over whole matches', () => {
  /** Rewrite every column of the "Tidak boleh" list (plus a few the engineer test leaves alone). */
  function tamper(state: Readonly<GameState>, selfId: string, r: Rng): GameState {
    const s = JSON.parse(JSON.stringify(state)) as GameState;
    const ids = CARDS.map((c) => c.id);
    s.matchSeed = r.nextUint32();
    s.nextCardUid += r.int(0, 500);
    for (const p of s.players) {
      p.pickRng = [r.nextUint32(), r.nextUint32(), r.nextUint32(), r.nextUint32()];
      p.cardsRng = [r.nextUint32(), r.nextUint32(), r.nextUint32(), r.nextUint32()];
      p.copetRng = [r.nextUint32(), r.nextUint32(), r.nextUint32(), r.nextUint32()];
      p.discarded = [{ uid: 'zz', defId: r.pick(ids), seq: 1 }];
      if (p.id === selfId) {
        p.nextMinigameId = r.pick(['simon', 'tap_timing', 'dodge_runner', null]);
        continue;
      }
      p.hand = p.hand.map((c) => ({ ...c, defId: r.pick(ids) }));
      p.pending = p.pending.filter((c) => getCard(c.defId).type === 'sabotage' && holdsSlot(getCard(c.defId))).map((c) => ({ ...c, source: r.pick(['x', 'y', c.source ?? 'z']) }));
      if (r.chance(0.5)) p.pending.push({ uid: 'zy', defId: r.pick(['cermin_balik', 'payung_tameng', 'jam_pasir', 'santai_dulu', 'nyawa_cadangan']), seq: 0 });
      p.targetId = r.chance(0.5) ? null : r.pick([...map.regions.keys()]);
      p.winsAtTarget = r.int(0, 2);
      p.nextMinigameId = r.pick(['simon', 'tap_timing', null]);
      p.retry = r.chance(0.5);
      p.lastMinigameId = r.pick(['simon', null]);
      p.attempts = { medan: r.int(0, 9) };
      p.nextHandSeq += r.int(0, 20);
      if (p.phase === 'playing' && p.attempt) p.attempt = { ...p.attempt, seed: r.nextUint32(), minigameId: r.pick(['simon', 'tap_timing']) };
      if (p.offer) p.offer = { ...p.offer, marked: [], cards: p.offer.cards.map((c) => ({ ...c, defId: r.pick(ids) })) };
    }
    return s;
  }

  class Blindfold implements PlayerController {
    private readonly r: Rng;
    constructor(private readonly inner: SmartBotController, seed: number) {
      this.r = new Rng(seed * 40503 + 1);
    }
    get playerId(): string {
      return this.inner.playerId;
    }
    nextAction(state: Readonly<GameState>, m: MapGraph): GameAction | null {
      return this.inner.nextAction(tamper(state, this.playerId, this.r), m);
    }
    wakeAtMs(state: Readonly<GameState>): number {
      return this.inner.wakeAtMs(state);
    }
    activity(): BotActivity | null {
      return this.inner.activity();
    }
  }

  it('36 matches: the controllers fed a tampered state produce exactly the same action log and final state', () => {
    let totalActions = 0;
    for (let i = 0; i < 36; i++) {
      const seed = 91_000 + i;
      const seats = mixSeats(i);
      const plain = mkSession(seats, seed);
      finish(plain);
      const blind = mkSession(seats, seed, (c) => new Blindfold(c, seed));
      finish(blind);
      expect(blind.state.status).toBe('finished');
      expect(JSON.stringify(blind.actionLog), `match ${i}`).toBe(JSON.stringify(plain.actionLog));
      expect(JSON.stringify(blind.state), `match ${i} final`).toBe(JSON.stringify(plain.state));
      totalActions += plain.actionLog.length;
    }
    expect(totalActions).toBeGreaterThan(5000);
  }, 300_000);

  it('power check: the harness does see a leak (a bot that peeks at an opponent hand or the seed diverges under tampering)', () => {
    class Peeker extends SmartBotController {
      override nextAction(state: Readonly<GameState>, m: MapGraph): GameAction | null {
        const a = super.nextAction(state, m);
        // peeks: sits out a poll when some opponent holds a Copet, or when the seed is odd
        const copetAround = state.players.some((p) => p.id !== this.playerId && p.hand.some((c) => c.defId === 'copet'));
        return a && a.type === 'playCard' && (copetAround || state.matchSeed % 2 === 1) ? null : a;
      }
    }
    let diverged = 0;
    for (let i = 0; i < 8; i++) {
      const seed = 95_000 + i;
      const seats = [humanSeat(HUMAN_PROFILE.expert), botSeat('bot1', 'hard'), botSeat('bot2', 'normal')];
      const mk = (blind: boolean) => {
        const ctls = seats.map((x) => {
          const c = x.id.startsWith('bot') ? new Peeker(x.id, seed, x.profile) : new SmartBotController(x.id, seed, x.profile);
          return blind ? new Blindfold(c, seed) : c;
        });
        return new GameSession(map, mkState(seats, seed), ctls);
      };
      const a = mk(false);
      finish(a);
      const b = mk(true);
      finish(b);
      if (JSON.stringify(a.actionLog) !== JSON.stringify(b.actionLog)) diverged++;
    }
    expect(diverged).toBeGreaterThanOrEqual(6);
  }, 120_000);

  it('the one kept column (opponent pending sabotage types) is not exploited: swapping them for types the bot does not hold changes no decision', () => {
    const slotTypes = CARDS.filter((c) => c.type === 'sabotage' && holdsSlot(c)).map((c) => c.id);
    let swapped = 0;
    let decisions = 0;
    for (let i = 0; i < 40; i++) {
      const seed = 92_000 + i;
      const seats = [humanSeat(HUMAN_PROFILE.expert), botSeat('bot1', LEVELS[i % 3] as BotLevel), botSeat('bot2', LEVELS[(i + 1) % 3] as BotLevel), botSeat('bot3', LEVELS[(i + 2) % 3] as BotLevel)];
      const session = mkSession(seats, seed);
      let next = 30_000;
      let guard = 0;
      while (session.state.status === 'running' && guard++ < 60_000) {
        session.stepToNextWake();
        if (session.state.timeMs < next) continue;
        next += 25_000;
        const state = session.state;
        for (const me of state.players.filter((p) => p.kind === 'bot')) {
          const held = new Set(me.hand.map((c) => c.defId));
          const free = slotTypes.filter((t) => !held.has(t));
          const alt = JSON.parse(JSON.stringify(state)) as GameState;
          const r = new Rng(i * 31 + 5);
          for (const p of alt.players) {
            if (p.id === me.id) continue;
            p.pending = p.pending.map((c) => {
              if (!(getCard(c.defId).type === 'sabotage' && holdsSlot(getCard(c.defId))) || held.has(c.defId)) return c;
              swapped++;
              return { ...c, defId: r.pick(free) };
            });
          }
          const act = (st: GameState) => JSON.stringify(new SmartBotController(me.id, seed, (me.botLevel ?? 'normal') as BotLevel).nextAction(st, map));
          // The first poll of a fresh controller is mostly "schedule a delay"; poll later too, with a warmed-up copy.
          const run = (st: GameState) => {
            const c = new SmartBotController(me.id, seed, (me.botLevel ?? 'normal') as BotLevel);
            const out: (GameAction | null)[] = [];
            for (let k = 0; k < 4; k++) out.push(c.nextAction({ ...st, timeMs: st.timeMs + k * 3000 }, map));
            return JSON.stringify(out);
          };
          expect(act(alt)).toBe(act(state));
          expect(run(alt)).toBe(run(state));
          decisions += 2;
        }
      }
    }
    console.log(`\n[CP5a-QA] pending-sabotage swap probe: ${swapped} swapped cards, ${decisions} compared decisions`);
    expect(swapped).toBeGreaterThan(30);
  }, 300_000);
});

// ------------------------------------------------------------------------------------------
// #1 zero rejections, fresh seeds, plus zone invariants
// ------------------------------------------------------------------------------------------
describe('QA 1. zero rejected bot actions', () => {
  it('2000 matches on fresh seeds (all level mixes, 1-3 bots, 3 reference humans): 0 actionRejected, zone invariants after every action, all finish', () => {
    let cardPlays = 0;
    const kinds = new Map<string, number>();
    let events = 0;
    for (let i = 0; i < 2000; i++) {
      const seed = 500_000 + i * 7;
      const session = mkSession(mixSeats(i), seed);
      session.subscribe((state, evs) => {
        for (const e of evs) {
          events++;
          if (e.type === 'actionRejected') throw new Error(`match ${i} seed ${seed}: rejected ${JSON.stringify(e.action)} (${e.reason})`);
          if (e.type === 'cardPlayed') {
            cardPlays++;
            kinds.set(e.cardId, (kinds.get(e.cardId) ?? 0) + 1);
          }
        }
        invariants(state, `match ${i} seed ${seed} t=${state.timeMs}`);
      });
      finish(session);
      if (session.state.status !== 'finished') throw new Error(`match ${i} seed ${seed} did not finish`);
    }
    console.log(`\n[CP5a-QA] 2000 matches: ${events} events, ${cardPlays} card plays, ${kinds.size} distinct cards played`);
    expect(kinds.size).toBeGreaterThanOrEqual(18);
  }, 600_000);

  it('disruption fuzz: random grants (hand up to 10), forced offers and long ticks mid-match; bots never get an action rejected and never stall', () => {
    const ids = CARDS.map((c) => c.id);
    let injected = 0;
    let botRejects = 0;
    for (let i = 0; i < 150; i++) {
      const seed = 700_000 + i;
      const seats = mixSeats(i + 2);
      const session = mkSession(seats, seed);
      const mine = new Set<GameAction>();
      session.subscribe((state, evs) => {
        for (const e of evs) if (e.type === 'actionRejected' && !mine.has(e.action)) botRejects++;
        invariants(state, `fuzz ${i}`, { restHand: false });
      });
      const r = new Rng(seed);
      let guard = 0;
      while (session.state.status === 'running' && guard++ < 40_000) {
        session.stepToNextWake();
        if (r.chance(0.04)) {
          const target = r.pick(session.state.players);
          const roll = r.int(0, 9);
          let a: GameAction;
          if (roll <= 4) a = { type: 'debugGrantCard', playerId: target.id, cardId: r.pick(r.chance(0.6) ? ['copet', 'cermin_balik', 'payung_tameng', 'gunung_meletus', 'badai', 'oleh_oleh', 'tiket_pesawat'] : ids) };
          else if (roll <= 6 && target.kind === 'bot' && !target.offer && !target.discard) a = { type: 'debugForceOffer', playerId: target.id, cardIds: [r.pick(ids), r.pick(ids), r.pick(ids)], pick: r.int(1, 3) };
          else if (roll === 7) a = { type: 'debugClearHand', playerId: target.id };
          else a = { type: 'tick', dtMs: r.pick([777, 5000, 14_999, 15_001, 33_333]) };
          mine.add(a);
          session.dispatch(a);
          injected++;
        }
      }
      expect(session.state.status, `fuzz ${i} finished`).toBe('finished');
    }
    console.log(`\n[CP5a-QA] disruption fuzz: ${injected} injected actions in 150 matches; bot rejects ${botRejects}`);
    expect(injected).toBeGreaterThan(1500);
    expect(botRejects).toBe(0);
  }, 600_000);
});

// ------------------------------------------------------------------------------------------
// #2 replay and determinism, many mixes
// ------------------------------------------------------------------------------------------
describe('QA 2. replay with smart bots', () => {
  it('60 matches over every level mix: replay(actionLog) equals the live final state; the same seed gives the same log; a different seed does not', () => {
    for (let i = 0; i < 60; i++) {
      const seed = 31_000 + i;
      const seats = mixSeats(i);
      const live = mkSession(seats, seed);
      finish(live);
      const replayed = replay(map, mkState(seats, seed), live.actionLog.map((l) => l.action));
      expect(JSON.stringify(replayed), `match ${i}`).toBe(JSON.stringify(live.state));
      if (i < 12) {
        const again = mkSession(seats, seed);
        finish(again);
        expect(JSON.stringify(again.actionLog), `again ${i}`).toBe(JSON.stringify(live.actionLog));
        const other = simulateMatch({ map, pool, seed: seed + 1, seats });
        expect(JSON.stringify(other.session.actionLog)).not.toBe(JSON.stringify(live.actionLog));
      }
    }
  }, 300_000);
});

// ------------------------------------------------------------------------------------------
// #16 pause at the worst moments
// ------------------------------------------------------------------------------------------
describe('QA 16. pause freezes bot think / brake timers', () => {
  it('pausing for 3-40 s of real steps exactly while bots are thinking or braking (and the HUD activity) changes nothing afterwards', () => {
    let pausesWhileThinking = 0;
    let pausesWhileBraking = 0;
    for (let i = 0; i < 6; i++) {
      const seed = 41_000 + i;
      const seats = [humanSeat(HUMAN_PROFILE.expert), botSeat('bot1', i % 2 ? 'hard' : 'normal'), botSeat('bot2', 'easy')];
      const plain = mkSession(seats, seed);
      while (plain.state.status === 'running') plain.step();
      const paused = mkSession(seats, seed);
      const r = new Rng(seed);
      let steps = 0;
      while (paused.state.status === 'running' && steps++ < 60_000) {
        paused.step();
        const act = ['bot1', 'bot2'].map((id) => paused.activityOf(id));
        if ((act.includes('thinking') || act.includes('braking')) && r.chance(0.01)) {
          if (act.includes('braking')) pausesWhileBraking++;
          else pausesWhileThinking++;
          const before = JSON.stringify([paused.state, paused.actionLog.length, act]);
          paused.setPaused(true);
          const n = r.int(60, 800);
          for (let k = 0; k < n; k++) paused.step();
          expect(JSON.stringify([paused.state, paused.actionLog.length, ['bot1', 'bot2'].map((id) => paused.activityOf(id))]), 'frozen during pause').toBe(before);
          paused.setPaused(false);
        }
      }
      expect(JSON.stringify(paused.actionLog), `match ${i}`).toBe(JSON.stringify(plain.actionLog));
      expect(JSON.stringify(paused.state)).toBe(JSON.stringify(plain.state));
    }
    console.log(`\n[CP5a-QA] pauses: ${pausesWhileThinking} while a bot was thinking, ${pausesWhileBraking} while braking`);
    expect(pausesWhileThinking).toBeGreaterThan(5);
    expect(pausesWhileBraking).toBeGreaterThan(2);
  }, 300_000);
});

// ------------------------------------------------------------------------------------------
// #4 delay lower bound after a fail (interpretation 8) and #5 braking "thinking" activity
// ------------------------------------------------------------------------------------------
describe('QA 4. delays after a fail (interpretation 8)', () => {
  it('after a failed attempt a bot restarts no sooner than thinkMs(min) after the cooldown ENDED (Kopi Tubruk shortens it), no matter what', () => {
    const lag: Record<string, number[]> = { easy: [], normal: [], hard: [] };
    for (let i = 0; i < 120; i++) {
      const level = LEVELS[i % 3] as BotLevel;
      const seed = 61_000 + i;
      const seats = [botSeat('bot1', level), humanSeat(HUMAN_PROFILE.attentive)];
      const session = mkSession(seats, seed);
      let afterFail = false;
      let cooledAt: number | null = null;
      session.subscribe((state, evs) => {
        for (const e of evs) {
          if (e.type === 'attemptResolved' && e.playerId === 'bot1') {
            afterFail = !e.passed;
            cooledAt = null;
          }
          if (e.type === 'cooldownEnded' && e.playerId === 'bot1' && afterFail) cooledAt = state.timeMs;
          if (e.type === 'attemptStarted' && e.playerId === 'bot1') {
            if (afterFail && cooledAt !== null) lag[level]!.push(state.timeMs - cooledAt);
            afterFail = false;
            cooledAt = null;
          }
        }
      });
      finish(session);
    }
    for (const level of LEVELS) {
      const prof = BOT_PROFILE[level];
      const xs = lag[level] as number[];
      const brakedOrSlow = xs.filter((x) => x > prof.thinkMs[1] + 100);
      const fast = xs.filter((x) => x <= prof.thinkMs[1] + 100);
      console.log(`[CP5a-QA] ${level}: ${xs.length} retries, min lag ${Math.min(...xs)} ms (thinkMs ${prof.thinkMs}), ${brakedOrSlow.length} held longer (brake)`);
      expect(xs.length).toBeGreaterThan(40);
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(prof.thinkMs[0] - 1);
      expect(fast.length).toBeGreaterThan(0);
    }
  }, 300_000);
});

// ------------------------------------------------------------------------------------------
// measurements printed for the report
// ------------------------------------------------------------------------------------------
describe('QA measure: dog-pile on a human leader (cards.md Q2 cap 2, pm-decisions CP5a star 4)', () => {
  function measure(level: BotLevel, human: BotProfile, n: number) {
    let leadMs = 0;
    let totalMs = 0;
    let hitsLead = 0; // sabotage aimed at p1 while p1 leads
    let hitsAll = 0;
    let slots2Ms = 0;
    let slots1Ms = 0;
    const outcomes: Record<string, number> = {};
    const perMatchRate: number[] = [];
    const byCard: Record<string, number> = {};
    let maxSlots = 0;
    let leaderWins = 0;
    for (let i = 0; i < n; i++) {
      const seed = 810_000 + i;
      const seats = [humanSeat(human), botSeat('bot1', level), botSeat('bot2', level), botSeat('bot3', level)];
      const session = mkSession(seats, seed);
      let lastT = 0;
      let lastLead = false;
      let lastSlots = 0;
      let mLead = 0;
      let mHits = 0;
      session.subscribe((state, evs) => {
        const dt = state.timeMs - lastT;
        totalMs += dt;
        if (lastLead) {
          leadMs += dt;
          mLead += dt;
          if (lastSlots >= 2) slots2Ms += dt;
          else if (lastSlots === 1) slots1Ms += dt;
        }
        lastT = state.timeMs;
        const p1 = state.players[0] as PlayerState;
        lastLead = state.players.every((q) => q.id === 'p1' || p1.remainingWins <= q.remainingWins);
        lastSlots = sabotageSlotsUsed(p1);
        maxSlots = Math.max(maxSlots, lastSlots);
        for (const e of evs) {
          if (e.type !== 'sabotagePlayed' || e.targetId !== 'p1') continue;
          hitsAll++;
          outcomes[e.outcome] = (outcomes[e.outcome] ?? 0) + 1;
          byCard[e.cardId] = (byCard[e.cardId] ?? 0) + 1;
          if (lastLead) {
            hitsLead++;
            mHits++;
          }
        }
      });
      finish(session);
      if (session.state.winnerId === 'p1') leaderWins++;
      if (mLead > 60_000) perMatchRate.push(mHits / (mLead / 60_000));
    }
    perMatchRate.sort((a, b) => a - b);
    const q = (x: number) => perMatchRate[Math.floor((perMatchRate.length - 1) * x)] ?? NaN;
    return {
      level, human: human.name, n,
      leadShare: leadMs / totalMs,
      perMinLeading: hitsLead / (leadMs / 60_000),
      perMinMatch: hitsAll / (totalMs / 60_000),
      matchRate: { p50: q(0.5), p90: q(0.9), max: q(1) },
      slots2Share: slots2Ms / leadMs,
      slots1Share: slots1Ms / leadMs,
      maxSlots,
      outcomes,
      byCard,
      humanWin: leaderWins / n,
    };
  }

  it('prints how many sabotages per minute a leading human takes from 3 Normal / 3 Hard bots (expert and casual human)', () => {
    const rows = [
      measure('normal', HUMAN_PROFILE.expert, 250),
      measure('hard', HUMAN_PROFILE.expert, 250),
      measure('normal', HUMAN_PROFILE.casual, 250),
      measure('hard', HUMAN_PROFILE.casual, 250),
      measure('easy', HUMAN_PROFILE.expert, 250),
    ];
    for (const r of rows) console.log(`[CP5a-QA] dogpile ${JSON.stringify(r)}`);
    for (const r of rows) expect(r.maxSlots).toBeLessThanOrEqual(2);
  }, 600_000);
});

describe('QA measure: overflow rule (interpretation 2)', () => {
  /** Reports every card play that only the overflow rule (hand >= 4, nothing else qualifies) made. */
  class Probe extends SmartBotController {
    static tally: Record<string, { all: number; overflow: number; wasteful: number }> = {};
    constructor(id: string, seed: number, private readonly lvl: BotLevel) {
      super(id, seed, lvl);
    }
    override nextAction(state: Readonly<GameState>, m: MapGraph): GameAction | null {
      const a = super.nextAction(state, m);
      if (a?.type !== 'playCard') return a;
      const obs = observe(state, this.playerId);
      const card = obs.me.hand.find((c) => c.uid === a.cardUid);
      if (!card) return a;
      const rowKey = `${this.lvl}`;
      const row = (Probe.tally[rowKey] ??= { all: 0, overflow: 0, wasteful: 0 });
      row.all++;
      const noOverflow = botPickCardToPlay(obs, m, { ...BOT_PROFILE[this.lvl], overflowHand: Infinity }, new Rng(1), { lastCopetAtMs: null });
      if (!noOverflow) {
        row.overflow++;
        const k = `${this.lvl}:${card.defId}`;
        const kr = (Probe.tally[k] ??= { all: 0, overflow: 0, wasteful: 0 });
        kr.overflow++;
        // "wasteful" = no effect worth a card: Kopi without a cooldown, Oleh-oleh on a deciding win, a boost with p already high
        const me = obs.me;
        if (card.defId === 'kopi_tubruk' && cooldownRemainingMs(obs.state, me) < 2000) {
          row.wasteful++;
          kr.wasteful++;
        }
      }
      return a;
    }
  }

  it('prints how often the overflow rule makes a play for Normal / Hard bots, and with which cards', () => {
    Probe.tally = {};
    for (let i = 0; i < 120; i++) {
      const level = LEVELS[1 + (i % 2)] as BotLevel;
      const seed = 880_000 + i;
      const seats = [humanSeat(HUMAN_PROFILE.attentive), botSeat('bot1', level), botSeat('bot2', level)];
      const ctls = seats.map((s) => (s.id.startsWith('bot') ? new Probe(s.id, seed, level) : new SmartBotController(s.id, seed, s.profile)));
      const session = new GameSession(map, mkState(seats, seed), ctls);
      finish(session);
    }
    for (const [k, v] of Object.entries(Probe.tally).sort()) console.log(`[CP5a-QA] overflow ${k}: ${JSON.stringify(v)}`);
    expect(Object.keys(Probe.tally).length).toBeGreaterThan(2);
  }, 300_000);
});

// ------------------------------------------------------------------------------------------
// #5: leader brake counters (additional): braked bots never start while leading + ahead, 300 matches
// ------------------------------------------------------------------------------------------
describe('QA 5. brake is only a brake', () => {
  it('300 matches: no bot ever starts an attempt while leading and ahead of schedule (asserted at every attemptStarted)', () => {
    let starts = 0;
    for (let i = 0; i < 300; i++) {
      const level = LEVELS[i % 3] as BotLevel;
      const seed = 99_000 + i;
      const seats = [humanSeat(HUMAN_PROFILE.attentive), botSeat('bot1', level), botSeat('bot2', level)];
      const session = mkSession(seats, seed);
      const total = 8;
      session.subscribe((state, evs) => {
        for (const e of evs) {
          if (e.type !== 'attemptStarted' || e.playerId === 'p1') continue;
          starts++;
          const me = state.players.find((p) => p.id === e.playerId) as PlayerState;
          const prof = BOT_PROFILE[level];
          const leading = state.players.every((p) => me.remainingWins <= p.remainingWins);
          const done = total - me.remainingWins;
          const ahead = state.timeMs < (prof.paceTargetMs * done) / total - prof.paceSlackMs;
          if (leading && ahead) throw new Error(`match ${i}: ${me.id} started while leading and ahead (t=${state.timeMs})`);
        }
      });
      finish(session);
    }
    expect(starts).toBeGreaterThan(3000);
  }, 300_000);
});
