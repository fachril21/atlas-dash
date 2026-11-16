/**
 * CP4a QA: extra tests on the riskiest card areas (card loss/duplication, stacking, trigger
 * consumption, Tiket Pesawat, Ojek Kilat at FINAL, N clamp, determinism).
 * The two former `it.fails` tests (QA-CP4a-01, QA-CP4a-02) are normal assertions since CP4b.
 * See docs/qa/cp4a-report.md.
 */
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  CARD_SCREEN_MS,
  CARDS,
  cardPlayability,
  COOLDOWN_MS,
  createInitialState,
  getCard,
  GameSession,
  HumanController,
  loadMap,
  minigamePool,
  MINIGAME_LOGIC,
  PlaceholderBotController,
  pickCount,
  replay,
  resolveAttemptEffects,
  Rng,
  type GameAction,
  type GameEvent,
  type GameState,
  type PlayerState,
} from '../src/logic';
import { indonesiaData } from './helpers';

const map = loadMap(indonesiaData(), 'standard', MINIGAME_LOGIC);
const pool = minigamePool(map.data);

const game = (seed = 42, ids = ['p1', 'p2']): GameState =>
  createInitialState(map, ids.map((id) => ({ id, name: id, kind: 'human' as const })), seed, pool);
const P = (s: GameState, id = 'p1'): PlayerState => s.players.find((p) => p.id === id)!;
const step = (s: GameState, a: GameAction): { state: GameState; events: GameEvent[]; rejected?: string } => {
  const r = applyAction(map, s, a);
  const e = r.events[0];
  return { ...r, ...(e?.type === 'actionRejected' ? { rejected: e.reason } : {}) };
};
function run(s: GameState, actions: GameAction[]): GameState {
  for (const a of actions) {
    const r = step(s, a);
    if (r.rejected) throw new Error(`rejected ${JSON.stringify(a)}: ${r.rejected}`);
    s = r.state;
  }
  return s;
}
const sel = (playerId: string, targetId: string): GameAction => ({ type: 'selectTarget', playerId, targetId });
const start = (playerId = 'p1'): GameAction => ({ type: 'startAttempt', playerId });
const res = (passed: boolean, playerId = 'p1'): GameAction => ({ type: 'minigameResult', playerId, passed });
const tick = (dtMs: number): GameAction => ({ type: 'tick', dtMs });
const auto = (playerId = 'p1'): GameAction => ({ type: 'autoCards', playerId });
const give = (s: GameState, id: string, playerId = 'p1'): GameState => run(s, [{ type: 'debugGrantCard', playerId, cardId: id }]);
const uidOf = (s: GameState, defId: string, playerId = 'p1'): string => P(s, playerId).hand.find((c) => c.defId === defId)!.uid;
const play = (s: GameState, defId: string, playerId = 'p1'): GameState =>
  run(s, [{ type: 'playCard', playerId, cardUid: uidOf(s, defId, playerId) }]);
const settle = (s: GameState, only?: string): GameState => {
  for (const p of s.players) if (!only || p.id === only) while (P(s, p.id).offer || P(s, p.id).discard) s = run(s, [auto(p.id)]);
  return s;
};
const emptyHands = (s: GameState, only?: string): GameState => ({ ...s, players: s.players.map((p) => (!only || p.id === only ? { ...p, hand: [] } : p)) });
// Only the conquering player's screens are settled and hand emptied; the others keep theirs.
const conquer = (s: GameState, regions: string[], playerId = 'p1'): GameState => {
  for (const r of regions) {
    s = run(s, [sel(playerId, r)]);
    s = settle(run(s, [start(playerId), res(true, playerId)]), playerId);
    if (s.status === 'running') s = settle(run(s, [start(playerId), res(true, playerId)]), playerId);
  }
  return emptyHands(s, playerId);
};
const TO_GATE = ['medan', 'jakarta', 'toraja'];

/** Every card instance the state knows about, per zone. */
function zones(s: GameState): string[] {
  const out: string[] = [];
  for (const p of s.players) {
    out.push(...p.hand.map((c) => c.uid), ...p.pending.map((c) => c.uid), ...p.discarded.map((c) => c.uid));
    if (p.offer) out.push(...p.offer.cards.map((c) => c.uid));
  }
  return out;
}

// ------------------------------------------------------------------------------------------
describe('card conservation / duplication (fuzz)', () => {
  it('random legal and illegal action sequences never duplicate or lose a card, never break the screen rules', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const rng = new Rng(seed * 7919);
      let s = game(seed);
      const regions = [...map.regions.keys()];
      for (let i = 0; i < 350 && s.status === 'running'; i++) {
        const pid = rng.chance(0.7) ? 'p1' : 'p2';
        const p = P(s, pid);
        const k = rng.int(0, 11);
        let a: GameAction;
        if (k === 0) a = sel(pid, regions[rng.int(0, regions.length - 1)] as string);
        else if (k === 1) a = start(pid);
        else if (k === 2) a = res(rng.chance(0.6), pid);
        else if (k === 3 && p.hand.length > 0) a = { type: 'playCard', playerId: pid, cardUid: p.hand[rng.int(0, p.hand.length - 1)]!.uid };
        else if (k === 4 && (p.offer || p.discard)) a = { type: 'markCard', playerId: pid, cardUid: (p.offer ? p.offer.cards : p.hand)[rng.int(0, (p.offer ? p.offer.cards : p.hand).length - 1)]!.uid };
        else if (k === 5) a = { type: 'confirmCards', playerId: pid };
        else if (k === 6) a = auto(pid);
        else if (k === 7) a = tick(rng.pick([50, 1000, 5000, 14_999, 15_000, 40_000]));
        else if (k === 8 && !p.offer && !p.discard && p.phase === 'idle' && p.hand.length < 5) {
          a = { type: 'debugGrantCard', playerId: pid, cardId: (rng.pick(CARDS) as { id: string }).id };
        } else if (k === 9) a = { type: 'markCard', playerId: pid, cardUid: 'c999' };
        else a = tick(50);
        s = applyAction(map, s, a).state;

        // Invariants.
        const all = zones(s);
        expect(new Set(all).size, `seed ${seed} step ${i}: duplicate uid`).toBe(all.length);
        if (s.status === 'running') expect(all.length, `seed ${seed} step ${i}: card lost`).toBe(s.nextCardUid - 1);
        for (const q of s.players) {
          expect(q.offer && q.discard, 'offer and discard open together').toBeFalsy();
          if (!q.discard) expect(q.hand.length).toBeLessThanOrEqual(5);
          expect(q.hand.length).toBeLessThanOrEqual(9);
          if (q.discard) expect(q.hand.length).toBeGreaterThan(5);
          if (q.phase === 'playing') expect(q.offer || q.discard).toBeFalsy();
          for (const c of CARDS) {
            const n = q.pending.filter((x) => x.defId === c.id).length;
            if (c.maxStacks !== null && c.duration === 'next_minigame') expect(n).toBeLessThanOrEqual(c.maxStacks);
          }
          const seqs = q.hand.map((c) => c.seq);
          expect(new Set(seqs).size).toBe(seqs.length);
          for (const uid of q.attempt?.cardUids ?? []) expect(q.pending.some((c) => c.uid === uid)).toBe(true);
          if (q.phase !== 'playing') expect(q.attempt).toBeNull();
        }
      }
    }
  }, 120_000);

  it('double confirm / double mark on the same screen never gives the cards twice', () => {
    let s = game();
    s = run(s, [{ type: 'debugForceOffer', playerId: 'p1', cardIds: ['jam_pasir', 'teropong', 'zona_lebar'], pick: 2 }]);
    const [a, b] = P(s).offer!.cards.map((c) => c.uid);
    s = run(s, [{ type: 'markCard', playerId: 'p1', cardUid: a! }, { type: 'markCard', playerId: 'p1', cardUid: b! }]);
    const once = run(s, [{ type: 'confirmCards', playerId: 'p1' }]);
    expect(step(once, { type: 'confirmCards', playerId: 'p1' }).rejected).toBe('no-cards-screen');
    expect(P(once).hand).toHaveLength(2);
    // timeout racing a confirm: the second resolution is a no-op rejection, not a second pick
    expect(step(once, auto()).rejected).toBe('no-cards-screen');
    expect(step(once, tick(CARD_SCREEN_MS * 2)).state.players[0]!.hand).toHaveLength(2);
  });

  it('overflow: marks on the offer screen do not leak into the discard screen; timers restart at 15 s', () => {
    let s = game();
    for (let i = 0; i < 5; i++) s = give(s, 'teropong');
    s = run(s, [{ type: 'debugForceOffer', playerId: 'p1', cardIds: ['jam_pasir', 'santai_dulu', 'ojek_kilat'], pick: 2 }, tick(3000)]);
    const uids = P(s).offer!.cards.map((c) => c.uid);
    s = run(s, [{ type: 'markCard', playerId: 'p1', cardUid: uids[0]! }, { type: 'markCard', playerId: 'p1', cardUid: uids[1]! }, { type: 'confirmCards', playerId: 'p1' }]);
    expect(P(s).discard!.marked).toEqual([]);
    expect(P(s).discard!.expiresAtMs).toBe(s.timeMs + CARD_SCREEN_MS);
    expect(P(s).hand).toHaveLength(7);
    // 14.9 s: nothing; +0.1 s: auto-discard drops the 2 oldest commons (teropong), keeps the new ones
    s = run(s, [tick(14_950)]);
    expect(P(s).discard).not.toBeNull();
    s = run(s, [tick(50)]);
    expect(P(s).discard).toBeNull();
    expect(P(s).hand.map((c) => c.defId)).toEqual(['teropong', 'teropong', 'teropong', 'jam_pasir', 'santai_dulu']);
  });

  it('QA-CP4a-01: timeouts run at their exact expiresAtMs, so the discard screen chained after an offer timeout starts at the offer expiry', () => {
    let s = game();
    for (let i = 0; i < 5; i++) s = give(s, 'teropong');
    s = run(s, [{ type: 'debugForceOffer', playerId: 'p1', cardIds: ['jam_pasir', 'santai_dulu'], pick: 2 }, tick(20_000)]);
    expect(P(s).offer).toBeNull();
    expect(P(s).discard).not.toBeNull();
    expect(P(s).discard!.expiresAtMs).toBe(CARD_SCREEN_MS * 2); // opened at 15 s, not at the 20 s tick
    expect(P(s).hand).toHaveLength(7);
    s = run(s, [tick(10_000)]);
    expect(P(s).discard).toBeNull();
    expect(P(s).hand).toHaveLength(5);
    // the same in one huge tick
    let b = game();
    for (let i = 0; i < 5; i++) b = give(b, 'teropong');
    b = run(b, [{ type: 'debugForceOffer', playerId: 'p1', cardIds: ['jam_pasir', 'santai_dulu'], pick: 2 }, tick(60_000)]);
    expect(P(b).offer).toBeNull();
    expect(P(b).discard).toBeNull();
    expect(P(b).hand).toHaveLength(5);
    expect(P(b).hand.map((c) => c.defId)).toEqual(P(s).hand.map((c) => c.defId));
  });
});

// ------------------------------------------------------------------------------------------
describe('pause (GameSession)', () => {
  it('a paused session freezes the offer and discard timers; resuming keeps the remaining time', () => {
    const session = new GameSession(map, game(5, ['p1']), [new HumanController('p1')]);
    session.dispatch({ type: 'debugForceOffer', playerId: 'p1', cardIds: ['jam_pasir', 'santai_dulu', 'ojek_kilat'], pick: 1 });
    for (let i = 0; i < 100; i++) session.step(); // 5 s
    session.setPaused(true);
    for (let i = 0; i < 2000; i++) session.step(); // 100 s of wall time
    expect(session.state.players[0]!.offer).not.toBeNull();
    expect(session.state.timeMs).toBe(5000);
    session.setPaused(false);
    for (let i = 0; i < 199; i++) session.step(); // 9.95 s: still open
    expect(session.state.players[0]!.offer).not.toBeNull();
    session.step();
    expect(session.state.players[0]!.offer).toBeNull();
    expect(session.state.players[0]!.hand).toHaveLength(1);
  });
});

// ------------------------------------------------------------------------------------------
describe('match end while a card screen is open', () => {
  // QA-CP4a-02 (fixed in CP4b): the offered instances move to `discarded` when the match ends.
  it('another player winning closes the offer and the offered cards end in `discarded` (zone accounting)', () => {
    let s = game(3);
    s = run(s, [sel('p1', 'medan'), start('p1'), res(true, 'p1')]);
    const offered = P(s).offer!.cards.map((c) => c.uid);
    s = conquer(s, [...TO_GATE, 'labuan_bajo'], 'p2');
    expect(s.status).toBe('finished');
    expect(P(s).offer).toBeNull();
    // After the match nothing can be played or confirmed any more.
    expect(step(s, auto()).rejected).toBe('game-over');
    expect(offered.every((u) => zones(s).includes(u))).toBe(true);
  });

  it('the discard screen is closed at match end and the overflowing hand is left as it is (up to 9)', () => {
    let s = conquer(game(3), TO_GATE, 'p2');
    s = run(s, [sel('p2', 'labuan_bajo')]);
    for (let i = 0; i < 5; i++) s = give(s, 'teropong');
    s = run(s, [{ type: 'debugForceOffer', playerId: 'p1', cardIds: ['jam_pasir', 'santai_dulu', 'ojek_kilat'], pick: 3 }, auto()]);
    expect(P(s).discard).not.toBeNull();
    expect(P(s).hand).toHaveLength(8);
    const saved = s;
    s = run(s, [start('p2'), res(true, 'p2'), auto('p2'), start('p2'), res(true, 'p2')]);
    expect(s.status).toBe('finished');
    expect(P(s).discard).toBeNull();
    expect(P(s).hand.length).toBe(P(saved).hand.length); // hand > 5 on the results screen; harmless but noted
  });
});

// ------------------------------------------------------------------------------------------
describe('stacking, maxStacks and netting', () => {
  it('the 3rd Jam Pasir stays in hand; once the attempt spends the 2, it is playable again', () => {
    let s = game();
    for (let i = 0; i < 3; i++) s = give(s, 'jam_pasir');
    s = run(s, [sel('p1', 'medan')]);
    s = play(play(s, 'jam_pasir'), 'jam_pasir');
    expect(step(s, { type: 'playCard', playerId: 'p1', cardUid: uidOf(s, 'jam_pasir') }).rejected).toBe('card-unplayable');
    expect(P(s).hand).toHaveLength(1);
    expect(cardPlayability(map, s, P(s), P(s).hand[0]!)).toEqual({ ok: false, reason: 'maxStacks' });
    s = settle(run(s, [start(), res(false)]));
    expect(P(s).pending).toHaveLength(0);
    s = run(s, [tick(COOLDOWN_MS.medium)]);
    expect(cardPlayability(map, s, P(s), P(s).hand[0]!).ok).toBe(true);
  });

  it('all 8 pending boosts at once: modifiers net, one of each kind, cards all spent after one attempt', () => {
    let s = game();
    const ids = ['jam_pasir', 'jam_pasir', 'santai_dulu', 'teropong', 'zona_lebar', 'nyawa_cadangan', 'oleh_oleh', 'ojek_kilat'];
    // 8 cards do not fit a 5-card hand: give them in two rounds, playing each batch.
    s = run(s, [sel('p1', 'padang')]); // hard region
    for (const batch of [ids.slice(0, 4), ids.slice(4)]) {
      for (const id of batch) s = give(s, id);
      for (const id of batch) s = play(s, id);
    }
    expect(P(s).pending).toHaveLength(8);
    s = run(s, [start()]);
    const at = P(s).attempt!;
    expect(at.difficulty).toBe('medium'); // hard - 1
    expect(at.modifiers.filter((m) => m.kind === 'timeDelta')).toEqual([{ kind: 'timeDelta', seconds: 10 }]);
    expect(at.modifiers.map((m) => m.kind).sort()).toEqual(['hint', 'timeDelta', 'tolerance']);
    expect(at.onWin).toEqual({ pickDelta: 1, winMultiplier: 2 });
    expect(at.onFail.noCooldown).toBe(true);
    s = run(s, [res(true)]);
    expect(P(s).pending).toHaveLength(0);
    expect(P(s).winsAtTarget).toBe(0); // Ojek Kilat: 2 wins in one -> conquered, reset
    expect(P(s).path).toEqual(['sabang', 'padang']);
    expect(P(s).nodeId).toBe('padang');
    expect(P(s).offer!.pick).toBe(3); // medium 2 + Oleh-oleh 1; Ojek gives ONE offer
    expect(P(s).discarded.filter((c) => ids.includes(c.defId))).toHaveLength(8);
  });

  it('netting with hypothetical sabotage defs (CP4b data): +5 and -5 cancel, clamp stays 10-40, difficulty clamps', () => {
    const d = (id: string) => getCard(id);
    const jp = d('jam_pasir');
    const jr = d('jam_rusak');
    const none = resolveAttemptEffects([jp, jp, jr, jr], 'medium', 20_000);
    expect(none.modifiers).toEqual([]);
    expect(resolveAttemptEffects([jr, jr, jr], 'medium', 20_000).modifiers).toEqual([{ kind: 'timeDelta', seconds: -10 }]);
    expect(resolveAttemptEffects([jp, jp, jp], 'medium', 35_000).modifiers).toEqual([{ kind: 'timeDelta', seconds: 5 }]);
    expect(resolveAttemptEffects([d('santai_dulu'), d('badai'), d('gunung_meletus')], 'easy', 20_000).difficulty).toBe('medium');
    expect(resolveAttemptEffects([d('badai'), d('gunung_meletus')], 'hard', 20_000).difficulty).toBe('hard');
    expect(resolveAttemptEffects([d('santai_dulu'), d('santai_dulu')], 'hard', 20_000).difficulty).toBe('easy');
    expect(resolveAttemptEffects([d('santai_dulu'), d('badai')], 'hard', 20_000).difficulty).toBe('hard');
  });
});

// ------------------------------------------------------------------------------------------
describe('trigger consumption on win, fail and retry', () => {
  it('a card played during the cooldown after a fail covers the retry only; the next retry is plain', () => {
    let s = give(give(game(), 'oleh_oleh'), 'ojek_kilat');
    s = run(s, [sel('p1', 'medan'), start(), res(false)]);
    s = play(play(s, 'oleh_oleh'), 'ojek_kilat');
    s = run(s, [tick(COOLDOWN_MS.medium), start(), res(false)]); // retry fails: both spent, no effect
    expect(P(s).pending).toHaveLength(0);
    expect(P(s).winsAtTarget).toBe(0);
    s = run(s, [tick(COOLDOWN_MS.medium), start(), res(true)]);
    expect(P(s).winsAtTarget).toBe(1); // no Ojek any more
    expect(P(s).offer!.pick).toBe(2); // no Oleh-oleh any more
  });

  it('cardsSpent.effective: false for conditional cards whose trigger did not fire, true when it did', () => {
    const spent = (events: GameEvent[]) => events.find((e) => e.type === 'cardsSpent') as Extract<GameEvent, { type: 'cardsSpent' }>;
    let s = play(give(game(), 'ojek_kilat'), 'ojek_kilat');
    s = run(s, [sel('p1', 'medan'), start()]);
    expect(spent(step(s, res(false)).events).effective).toBe(false);
    expect(spent(step(s, res(true)).events).effective).toBe(true);
    let t = play(give(game(), 'nyawa_cadangan'), 'nyawa_cadangan');
    t = run(t, [sel('p1', 'medan'), start()]);
    expect(spent(step(t, res(true)).events).effective).toBe(false);
    expect(spent(step(t, res(false)).events).effective).toBe(true);
  });

  it('Nyawa Cadangan + Jam Pasir: fail keeps no cooldown, both spent, next attempt has no modifiers', () => {
    let s = play(give(play(give(game(), 'jam_pasir'), 'jam_pasir'), 'nyawa_cadangan'), 'nyawa_cadangan');
    s = run(s, [sel('p1', 'medan'), start()]);
    expect(P(s).attempt!.modifiers).toEqual([{ kind: 'timeDelta', seconds: 5 }]);
    s = run(s, [res(false)]);
    expect(P(s).cooldownUntilMs).toBe(0);
    s = run(s, [start()]);
    expect(P(s).attempt!.modifiers).toEqual([]);
    expect(P(s).attempt!.onFail.noCooldown).toBe(false);
  });

  it('a pending card survives a target switch and a Tiket Pesawat (not spent without an attempt)', () => {
    let s = play(give(game(), 'teropong'), 'teropong');
    s = run(s, [sel('p1', 'medan'), sel('p1', 'padang')]);
    expect(P(s).pending).toHaveLength(1);
    s = play(give(s, 'tiket_pesawat'), 'tiket_pesawat');
    expect(P(s).nodeId).toBe('padang');
    expect(P(s).pending).toHaveLength(1);
    s = run(s, [sel('p1', 'jakarta'), start()]);
    expect(P(s).attempt!.modifiers).toEqual([{ kind: 'hint' }]);
  });

  it('Santai Dulu snapshot uses the target at Mulai, not at the time the card was played', () => {
    let s = play(give(game(), 'santai_dulu'), 'santai_dulu');
    s = run(s, [sel('p1', 'padang'), sel('p1', 'medan'), start()]);
    expect(P(s).attempt!.baseDifficulty).toBe('medium');
    expect(P(s).attempt!.difficulty).toBe('easy');
  });
});

// ------------------------------------------------------------------------------------------
describe('Tiket Pesawat', () => {
  it('moves one region, drops the win, resets retry + minigame, allows picking a new target at once', () => {
    let s = give(game(), 'tiket_pesawat');
    s = run(s, [sel('p1', 'medan'), start(), res(true)]);
    s = settle(s);
    s = run(s, [start(), res(false)]); // fail on the 2nd win: retry armed, cooldown running
    expect(P(s).retry).toBe(true);
    s = play(s, 'tiket_pesawat');
    expect(P(s).nodeId).toBe('medan');
    expect(P(s).targetId).toBeNull();
    expect(P(s).retry).toBe(false);
    expect(P(s).nextMinigameId).toBeNull();
    expect(P(s).cooldownUntilMs).toBe(0);
    expect(P(s).offer).toBeNull();
    expect(P(s).remainingWins).toBe(map.winsRequired * map.playDist.get('medan')!);
    expect(step(s, { type: 'startAttempt', playerId: 'p1' }).rejected).toBe('no-target');
    s = run(s, [sel('p1', 'jakarta')]);
    expect(P(s).nextMinigameId).not.toBeNull();
  });

  it('chained Tiket: Sabang -> Medan -> Jakarta -> Toraja works, the next hop (FINAL) is refused, the card stays', () => {
    let s = game();
    for (const r of TO_GATE) {
      s = run(give(s, 'tiket_pesawat'), [sel('p1', r)]);
      s = play(s, 'tiket_pesawat');
    }
    expect(P(s).nodeId).toBe('toraja');
    s = run(give(s, 'tiket_pesawat'), [sel('p1', 'raja_ampat')]);
    const t = P(s).hand.find((c) => c.defId === 'tiket_pesawat')!;
    expect(step(s, { type: 'playCard', playerId: 'p1', cardUid: t.uid }).rejected).toBe('card-unplayable');
    expect(P(s).hand.some((c) => c.uid === t.uid)).toBe(true);
    expect(P(s).nodeId).toBe('toraja');
  });

  it('Tiket never gives a card, never ends the match, and does not touch the other player', () => {
    let s = give(game(), 'tiket_pesawat');
    const other = P(s, 'p2');
    s = play(run(s, [sel('p1', 'padang')]), 'tiket_pesawat');
    expect(s.status).toBe('running');
    expect(P(s).offer).toBeNull();
    expect(P(s, 'p2')).toEqual(other);
  });

  it('refused with a screen open and while playing; refused after a Tiket moved you onto a final-gate neighbour check', () => {
    let s = give(game(), 'tiket_pesawat');
    s = run(s, [sel('p1', 'medan'), { type: 'debugForceOffer', playerId: 'p1', cardIds: ['jam_pasir', 'teropong'], pick: 1 }]);
    expect(step(s, { type: 'playCard', playerId: 'p1', cardUid: uidOf(s, 'tiket_pesawat') }).rejected).toBe('cards-open');
  });
});

// ------------------------------------------------------------------------------------------
describe('Ojek Kilat', () => {
  it('at FINAL: first win already decides the match, no offer, other players screens closed', () => {
    let s = conquer(game(9), TO_GATE);
    s = play(give(s, 'ojek_kilat'), 'ojek_kilat');
    s = run(s, [sel('p2', 'medan'), start('p2'), res(true, 'p2')]);
    expect(P(s, 'p2').offer).not.toBeNull();
    s = run(s, [sel('p1', 'labuan_bajo'), start(), res(true)]);
    expect(s.status).toBe('finished');
    expect(s.winnerId).toBe('p1');
    expect(P(s, 'p1').offer).toBeNull();
    expect(P(s, 'p2').offer).toBeNull();
  });

  it('at FINAL, fail: spent, normal cooldown by difficulty, win count unchanged', () => {
    let s = conquer(game(9), TO_GATE);
    s = play(give(s, 'ojek_kilat'), 'ojek_kilat');
    s = run(s, [sel('p1', 'labuan_bajo'), start(), res(false)]);
    expect(P(s).pending).toHaveLength(0);
    expect(P(s).winsAtTarget).toBe(0);
    expect(P(s).cooldownUntilMs - s.timeMs).toBe(COOLDOWN_MS.medium);
    s = run(s, [tick(COOLDOWN_MS.medium), start(), res(true)]);
    expect(s.status).toBe('running'); // only 1 of 2 wins now
  });

  it('with a partial win and a non-final target: 1 win + Ojek = conquered once, exactly one offer', () => {
    let s = give(game(), 'ojek_kilat');
    s = run(s, [sel('p1', 'medan'), start(), res(true)]);
    s = settle(s);
    s = play(s, 'ojek_kilat');
    const r = step(run(s, [start()]), res(true));
    expect(r.events.filter((e) => e.type === 'regionConquered')).toHaveLength(1);
    expect(r.events.filter((e) => e.type === 'cardOffered')).toHaveLength(1);
    expect(P(r.state).nodeId).toBe('medan');
    expect(P(r.state).winsAtTarget).toBe(0);
  });

  it('Ojek Kilat + Oleh-oleh at FINAL: the match ends, both just vanish', () => {
    let s = conquer(game(9), TO_GATE);
    s = play(play(give(give(s, 'ojek_kilat'), 'oleh_oleh'), 'ojek_kilat'), 'oleh_oleh');
    s = run(s, [sel('p1', 'raja_ampat'), start(), res(true)]);
    expect(s.status).toBe('finished');
    expect(P(s).offer).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------
describe('Oleh-oleh / Pelit Hadiah and the N clamp', () => {
  it('pickCount table: easy/medium/hard x delta -1/0/+1, offer sizes 1..5', () => {
    const exp = (base: number, d: number, size: number) => Math.min(Math.max(1, Math.min(5, size)), Math.max(1, base + d));
    for (const [diff, base] of [['easy', 1], ['medium', 2], ['hard', 3]] as const) {
      for (const d of [-3, -1, 0, 1, 2, 5]) {
        for (const size of [0, 1, 2, 3, 5, 7]) expect(pickCount(diff, d, size)).toBe(exp(base, d, size));
      }
    }
    expect(pickCount('hard', 1, 5)).toBe(4);
    expect(pickCount('easy', -1, 5)).toBe(1);
  });

  it('Oleh-oleh at hard with a full hand: pick 4 -> hand 9 -> discard 4; hard + Santai + Oleh = 3', () => {
    let s = game();
    s = run(s, [sel('p1', 'padang')]);
    for (let i = 0; i < 4; i++) s = give(s, 'teropong');
    s = play(give(s, 'oleh_oleh'), 'oleh_oleh');
    s = give(s, 'zona_lebar');
    s = run(s, [start(), res(true)]);
    expect(P(s).offer!.pick).toBe(4);
    s = run(s, [auto()]);
    expect(P(s).hand).toHaveLength(9);
    expect(P(s).discard).not.toBeNull();
    s = run(s, [auto()]);
    expect(P(s).hand).toHaveLength(5);
    expect(zones(s).length).toBe(s.nextCardUid - 1);
  });

  it('the offer is never smaller than the pick: debugForceOffer clamps pick to the card count', () => {
    const s = run(game(), [{ type: 'debugForceOffer', playerId: 'p1', cardIds: ['jam_pasir', 'teropong'], pick: 4 }]);
    expect(P(s).offer!.pick).toBe(2);
  });

  it('Oleh-oleh on a failed attempt and then a win: next offer back to base N (condition is per attempt)', () => {
    let s = play(give(game(), 'oleh_oleh'), 'oleh_oleh');
    s = run(s, [sel('p1', 'medan'), start(), res(false), tick(6000), start(), res(true)]);
    expect(P(s).offer!.pick).toBe(2);
  });
});

// ------------------------------------------------------------------------------------------
describe('determinism', () => {
  const fresh = (seed: number) => createInitialState(map, [
    { id: 'p1', name: 'p1', kind: 'human' }, { id: 'p2', name: 'p2', kind: 'bot', botLevel: 'normal' },
  ], seed, pool);
  const scripted = (seed: number) => {
    const human = new HumanController('p1');
    const bot = new PlaceholderBotController('p2', seed, 'normal');
    const session = new GameSession(map, createInitialState(map, [
      { id: 'p1', name: 'p1', kind: 'human' }, { id: 'p2', name: 'p2', kind: 'bot', botLevel: 'normal' },
    ], seed, pool), [human, bot]);
    const all: GameAction[] = [];
    const orig = session.dispatch.bind(session);
    session.dispatch = (a: GameAction) => { const ev = orig(a); if (ev[0]?.type !== 'actionRejected') all.push(a); return ev; };
    const rngH = new Rng(seed ^ 0xabcdef);
    const offers: string[][] = [];
    for (let i = 0; i < 6000 && session.state.status === 'running'; i++) {
      const me = session.state.players[0]!;
      if (me.offer && !offers.length) offers.push(me.offer.cards.map((c) => c.defId));
      if (me.offer && i % 7 === 0) human.submit({ type: 'markCard', playerId: 'p1', cardUid: me.offer.cards[rngH.int(0, 4)]!.uid });
      if (me.phase === 'idle' && !me.offer && !me.discard) {
        if (!me.targetId) {
          const opts = [...map.regions.keys()].filter((r) => r !== map.finishId);
          human.submit({ type: 'selectTarget', playerId: 'p1', targetId: rngH.pick(opts) });
        } else if (i % 11 === 0) human.submit({ type: 'startAttempt', playerId: 'p1' });
        if (me.hand.length && i % 5 === 0) human.submit({ type: 'playCard', playerId: 'p1', cardUid: me.hand[0]!.uid });
      }
      if (me.phase === 'playing' && i % 13 === 0) human.submit({ type: 'minigameResult', playerId: 'p1', passed: rngH.chance(0.7) });
      session.step();
    }
    return Object.assign(session, { all });
  };

  it('same seed + same inputs -> byte-identical state, event log and card uids', () => {
    const a = scripted(1234);
    const b = scripted(1234);
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    expect(JSON.stringify(a.eventLog)).toBe(JSON.stringify(b.eventLog));
  });

  it('different seeds give different first offers (the stream is seeded)', () => {
    const offers = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      const s = run(game(seed), [{ type: 'debugForceOffer', playerId: 'p1' }]);
      offers.add(P(s).offer!.cards.map((c) => c.defId).join(','));
    }
    expect(offers.size).toBeGreaterThan(6);
  });

  it('human card choices (what, when) never change a later offer: only the number of offers drawn matters', () => {
    const draw = (s: GameState) => P(run(s, [{ type: 'debugForceOffer', playerId: 'p1' }])).offer!.cards.map((c) => c.defId);
    let a = game(77);
    let b = game(77);
    a = run(a, [{ type: 'debugForceOffer', playerId: 'p1', cardIds: ['teropong'], pick: 1 }, auto()]); // fixed ids: no draw
    b = give(b, 'jam_pasir');
    expect(draw(a)).toEqual(draw(b));
  });

  it('replaying the unfolded action list reproduces the final state', () => {
    const session = scripted(4321);
    expect(session.state.players[0]!.hand.length + session.state.players[0]!.discarded.length).toBeGreaterThan(5);
    expect(JSON.stringify(replay(map, fresh(4321), session.all))).toBe(JSON.stringify(session.state));
  });

  // QA-CP4a-01 (fixed in CP4b): card screens expire at their exact expiresAtMs, so folded ticks replay identically.
  it('replaying session.actionLog (folded ticks) reproduces the final state', () => {
    const session = scripted(4321);
    expect(JSON.stringify(replay(map, fresh(4321), session.actionLog.map((l) => l.action)))).toBe(JSON.stringify(session.state));
  });
});
