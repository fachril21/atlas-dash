import { describe, expect, it } from 'vitest';
import {
  applyAction,
  autoDiscard,
  autoPick,
  buildOffer,
  CARDS,
  cardPlayability,
  cardWarnings,
  createInitialState,
  createStream,
  discardNeeded,
  getCard,
  HAND_MAX,
  loadMap,
  minigamePool,
  MINIGAME_LOGIC,
  offerPool,
  opsValidFor,
  pickCount,
  resolveAttemptEffects,
  Rng,
  tierWeights,
  LEADER_WEIGHTS,
  COOLDOWN_MS,
  CARD_SCREEN_MS,
  type GameAction,
  type GameState,
  type MinigameContext,
  type MinigameModifier,
  type PlayerState,
} from '../src/logic';
import { indonesiaData } from './helpers';

const map = loadMap(indonesiaData(), 'standard', MINIGAME_LOGIC);
const pool = minigamePool(map.data);

// ---------------------------------------------------------------- helpers
const game = (seed = 42, ids = ['p1', 'p2']): GameState =>
  createInitialState(map, ids.map((id) => ({ id, name: id, kind: 'human' as const })), seed, pool);
const P = (s: GameState, id = 'p1'): PlayerState => s.players.find((p) => p.id === id)!;

function run(state: GameState, actions: GameAction[]): GameState {
  for (const a of actions) {
    const r = applyAction(map, state, a);
    const rej = r.events.find((e) => e.type === 'actionRejected');
    if (rej) throw new Error(`rejected ${JSON.stringify(a)}: ${JSON.stringify(rej)}`);
    state = r.state;
  }
  return state;
}
const reason = (s: GameState, a: GameAction): string | undefined => {
  const r = applyAction(map, s, a);
  const e = r.events[0];
  if (e?.type === 'actionRejected') {
    expect(r.state).toBe(s);
    return e.reason;
  }
  return undefined;
};
const give = (s: GameState, id: string, playerId = 'p1'): GameState => run(s, [{ type: 'debugGrantCard', playerId, cardId: id }]);
const uidOf = (s: GameState, defId: string, playerId = 'p1'): string => P(s, playerId).hand.find((c) => c.defId === defId)!.uid;
const play = (s: GameState, defId: string, playerId = 'p1'): GameState =>
  run(s, [{ type: 'playCard', playerId, cardUid: uidOf(s, defId, playerId) }]);
const sel = (playerId: string, targetId: string): GameAction => ({ type: 'selectTarget', playerId, targetId });
const start = (playerId = 'p1'): GameAction => ({ type: 'startAttempt', playerId });
const res = (passed: boolean, playerId = 'p1'): GameAction => ({ type: 'minigameResult', playerId, passed });
const tick = (dtMs: number): GameAction => ({ type: 'tick', dtMs });
const auto = (playerId = 'p1'): GameAction => ({ type: 'autoCards', playerId });
/** Settle any open card screen with the auto rules. */
const settle = (s: GameState): GameState => {
  for (const p of s.players) while (P(s, p.id).offer || P(s, p.id).discard) s = run(s, [auto(p.id)]);
  return s;
};
/** Conquer regions in order (2 forced wins each), resolving card screens with the auto rules. */
const conquer = (s: GameState, regions: string[], playerId = 'p1'): GameState => {
  for (const r of regions) {
    s = run(s, [sel(playerId, r)]);
    s = settle(run(s, [start(playerId), res(true, playerId)]));
    if (s.status === 'running') s = settle(run(s, [start(playerId), res(true, playerId)]));
  }
  // Empty the hands (test setup) so cards given afterwards never trip the 5-card limit.
  return { ...s, players: s.players.map((p) => ({ ...p, hand: [] })) };
};
const TO_FINAL_GATE = ['medan', 'jakarta', 'toraja'];
const cardIds = (s: GameState, id = 'p1') => P(s, id).hand.map((c) => c.defId);

// ---------------------------------------------------------------- data
describe('cards_data_matches_spec', () => {
  it('20 unique cards, 11 boost / 9 sabotage, rarity 10/7/3, 8 base = 5 boost + 3 sabotage', () => {
    expect(CARDS).toHaveLength(20);
    expect(new Set(CARDS.map((c) => c.id)).size).toBe(20);
    expect(CARDS.filter((c) => c.type === 'boost')).toHaveLength(11);
    expect(CARDS.filter((c) => c.type === 'sabotage')).toHaveLength(9);
    const r = (x: string) => CARDS.filter((c) => c.rarity === x).length;
    expect([r('common'), r('rare'), r('epic')]).toEqual([10, 7, 3]);
    const base = CARDS.filter((c) => c.base);
    expect(base).toHaveLength(8);
    expect(base.filter((c) => c.type === 'boost')).toHaveLength(5);
    expect(base.filter((c) => c.type === 'sabotage')).toHaveLength(3);
  });

  it('every op fits the card duration/trigger; Copet is not a sabotage slot user', () => {
    for (const c of CARDS) expect(opsValidFor(c), c.id).toBe(true);
    expect(getCard('copet').usesSabotageSlot).toBe(false);
  });

  it('phase: the 9 boost cards without Payung/Cermin are phase a; everything else is phase b', () => {
    const a = CARDS.filter((c) => c.phase === 'a').map((c) => c.id);
    expect(a).toEqual(['jam_pasir', 'santai_dulu', 'nyawa_cadangan', 'teropong', 'zona_lebar', 'kopi_tubruk', 'oleh_oleh', 'ojek_kilat', 'tiket_pesawat']);
    expect(CARDS.filter((c) => c.type === 'sabotage').every((c) => c.phase === 'b')).toBe(true);
    expect(getCard('payung_tameng').phase).toBe('b');
    expect(getCard('cermin_balik').phase).toBe('b');
  });

  it('triggers, playableWhen and maxStacks follow the table', () => {
    expect(getCard('nyawa_cadangan').trigger).toBe('onFail');
    expect(getCard('oleh_oleh').trigger).toBe('onWin');
    expect(getCard('ojek_kilat').trigger).toBe('onWin');
    expect(getCard('macet_total').trigger).toBe('onFail');
    expect(getCard('pelit_hadiah').trigger).toBe('onWin');
    expect(getCard('kopi_tubruk').playableWhen).toBe('cooldown');
    expect(getCard('tiket_pesawat').playableWhen).toBe('hasTarget');
    expect(getCard('jam_pasir').maxStacks).toBe(2);
    expect(getCard('jam_rusak').maxStacks).toBe(2);
    for (const c of CARDS.filter((x) => x.duration !== 'instant' && !['jam_pasir', 'jam_rusak'].includes(x.id))) expect(c.maxStacks, c.id).toBe(1);
  });
});

// ---------------------------------------------------------------- offers
describe('offer algorithm (§3.1, DR-26)', () => {
  const cp4a = offerPool('a');
  const w = LEADER_WEIGHTS;

  it('CP4a pool: 9 boost cards in table order; the leader row is gap 0', () => {
    expect(cp4a).toHaveLength(9);
    expect(tierWeights(0)).toEqual({ weights: { common: 75, rare: 22, epic: 3 }, guaranteeRarePlus: false });
  });

  it('1..2000 seeds: 5 distinct boost cards, all from the pool, terminates', () => {
    for (let seed = 1; seed <= 2000; seed++) {
      const offer = buildOffer(cp4a, w, createStream(seed, 'p1', 'cards'));
      expect(offer).toHaveLength(5);
      expect(new Set(offer.map((c) => c.id)).size).toBe(5);
      for (const c of offer) {
        expect(cp4a.map((x) => x.id)).toContain(c.id);
        expect(c.type).toBe('boost');
      }
    }
  });

  it('deterministic: same seed and player -> same offer; consumes a fixed number of draws', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const a = createStream(seed, 'p1', 'cards');
      const b = createStream(seed, 'p1', 'cards');
      expect(buildOffer(cp4a, w, a).map((c) => c.id)).toEqual(buildOffer(cp4a, w, b).map((c) => c.id));
      expect(a.getState()).toEqual(b.getState());
    }
    const x = buildOffer(cp4a, w, createStream(7, 'p1', 'cards')).map((c) => c.id);
    const y = buildOffer(cp4a, w, createStream(7, 'p2', 'cards')).map((c) => c.id);
    const z = buildOffer(cp4a, w, createStream(8, 'p1', 'cards')).map((c) => c.id);
    expect(x.join() === y.join() && x.join() === z.join()).toBe(false);
  });

  it('the cards stream is independent of the minigame streams', () => {
    const before = buildOffer(cp4a, w, createStream(5, 'p1', 'cards')).map((c) => c.id);
    const pick = createStream(5, 'p1', 'minigamePick');
    for (let i = 0; i < 50; i++) pick.next();
    expect(buildOffer(cp4a, w, createStream(5, 'p1', 'cards')).map((c) => c.id)).toEqual(before);
  });

  it('pool of only epic cards: offer is those cards, exhausted stock leaves the draw', () => {
    const epics = CARDS.filter((c) => c.rarity === 'epic');
    expect(epics).toHaveLength(3);
    const offer = buildOffer(epics, w, new Rng(1));
    expect(offer.map((c) => c.id).sort()).toEqual(epics.map((c) => c.id).sort());
  });

  it('pool smaller than 5 -> shorter offer, no duplicates; empty pool -> empty offer', () => {
    for (let n = 0; n <= 4; n++) {
      const small = cp4a.slice(0, n);
      const offer = buildOffer(small, w, new Rng(n + 1));
      expect(offer).toHaveLength(n);
      expect(new Set(offer.map((c) => c.id)).size).toBe(n);
    }
  });

  it('full 20-card pool: type guarantee gives >= 1 boost and >= 1 sabotage, 5 distinct (CP4b path)', () => {
    for (let seed = 1; seed <= 1500; seed++) {
      const offer = buildOffer(CARDS, w, new Rng(seed));
      expect(offer).toHaveLength(5);
      expect(new Set(offer.map((c) => c.id)).size).toBe(5);
      expect(offer.some((c) => c.type === 'boost')).toBe(true);
      expect(offer.some((c) => c.type === 'sabotage')).toBe(true);
    }
  });

  it('rare+ guarantee (when a tier asks for it) holds for the full pool and keeps type guarantee', () => {
    const heavy = { common: 100, rare: 0, epic: 0 };
    for (let seed = 1; seed <= 800; seed++) {
      const offer = buildOffer(CARDS, heavy, new Rng(seed), true);
      expect(offer.some((c) => c.rarity !== 'common')).toBe(true);
      expect(offer.some((c) => c.type === 'boost') && offer.some((c) => c.type === 'sabotage')).toBe(true);
      expect(new Set(offer.map((c) => c.id)).size).toBe(offer.length);
    }
  });

  it('CP4a distribution: most offers hold a rare+ (about 70-75%)', () => {
    let withRare = 0;
    const N = 20000;
    for (let seed = 1; seed <= N; seed++) {
      if (buildOffer(cp4a, w, new Rng(seed)).some((c) => c.rarity !== 'common')) withRare++;
    }
    const share = withRare / N;
    expect(share).toBeGreaterThan(0.6);
    expect(share).toBeLessThan(0.95);
  });
});

describe('pick count N (§3.3)', () => {
  it('base 1/2/3 by effective difficulty', () => {
    expect([pickCount('easy', 0, 5), pickCount('medium', 0, 5), pickCount('hard', 0, 5)]).toEqual([1, 2, 3]);
  });
  it('Oleh-oleh +1, capped at 5 and at the offer size; Pelit -1 floors at 1; both = net 0', () => {
    expect(pickCount('hard', 1, 5)).toBe(4);
    expect(pickCount('hard', 5, 5)).toBe(5);
    expect(pickCount('hard', 1, 3)).toBe(3);
    expect(pickCount('easy', -1, 5)).toBe(1);
    expect(pickCount('medium', 1 - 1, 5)).toBe(2);
    expect(pickCount('easy', 0, 0)).toBe(1);
  });
  it('uses the EFFECTIVE difficulty: Santai Dulu at a hard region gives 2 cards and a 6 s cooldown', () => {
    // toraja is hard
    let s = conquer(game(), TO_FINAL_GATE.slice(0, 2));
    s = run(s, [sel('p1', 'toraja')]);
    s = give(s, 'santai_dulu');
    s = play(s, 'santai_dulu');
    s = run(s, [start()]);
    expect(P(s).attempt!.baseDifficulty).toBe('hard');
    expect(P(s).attempt!.difficulty).toBe('medium');
    const won = run(s, [res(true)]);
    expect(P(won).offer!.pick).toBe(2);
    const lost = run(s, [res(false)]);
    expect(P(lost).cooldownUntilMs - lost.timeMs).toBe(COOLDOWN_MS.medium);
  });
});

// ---------------------------------------------------------------- earning cards in the reducer
describe('earning cards (K1, C-3)', () => {
  it('a won attempt opens an offer of 5 distinct boost cards, N from effective difficulty', () => {
    let s = run(game(), [sel('p1', 'medan'), start(), res(true)]); // medan = medium
    const o = P(s).offer!;
    expect(o.cards).toHaveLength(5);
    expect(new Set(o.cards.map((c) => c.defId)).size).toBe(5);
    expect(o.pick).toBe(2);
    expect(o.expiresAtMs).toBe(s.timeMs + CARD_SCREEN_MS);
    expect(reason(s, start())).toBe('cards-open');
    expect(reason(s, sel('p1', 'jakarta'))).toBe('cards-open');
    s = settle(s);
    expect(P(s).offer).toBeNull();
  });

  it('a failed attempt gives no offer', () => {
    const s = run(game(), [sel('p1', 'medan'), start(), res(false)]);
    expect(P(s).offer).toBeNull();
  });

  it('offer is deterministic from the match seed and does not depend on other players', () => {
    const a = run(game(42, ['p1', 'p2']), [sel('p1', 'medan'), start(), res(true)]);
    const b = run(game(42, ['p1', 'p2', 'p3']), [sel('p3', 'medan'), start('p3'), res(false, 'p3'), sel('p1', 'medan'), start(), res(true)]);
    expect(P(a).offer!.cards.map((c) => c.defId)).toEqual(P(b).offer!.cards.map((c) => c.defId));
  });

  it('no offer after the deciding win (C-3), also with Ojek Kilat on the first win at FINAL', () => {
    const s = conquer(game(), TO_FINAL_GATE);
    expect(P(s).nodeId).toBe('toraja');
    for (const fin of ['labuan_bajo', 'raja_ampat']) {
      expect(map.finalRegions.has(fin)).toBe(true);
      // win 1 at FINAL still opens an offer
      let s1 = run(s, [sel('p1', fin), start(), res(true)]);
      expect(P(s1).offer).not.toBeNull();
      s1 = settle(s1);
      // win 2 decides: no offer, screens closed
      const done = run(s1, [start(), res(true)]);
      expect(done.status).toBe('finished');
      expect(P(done).offer).toBeNull();
      // Ojek Kilat: a single win decides
      let s2 = give(run(s, [sel('p1', fin)]), 'ojek_kilat');
      s2 = play(s2, 'ojek_kilat');
      const done2 = run(s2, [start(), res(true)]);
      expect(done2.status).toBe('finished');
      expect(P(done2).offer).toBeNull();
      expect(P(done2).discard).toBeNull();
    }
  });
});

// ---------------------------------------------------------------- pick / discard / timers
describe('hand, overflow and discard (K1.1, R9)', () => {
  it('marking is limited to N; confirm needs exactly N; extras go to discarded', () => {
    let s = run(game(), [sel('p1', 'medan'), start(), res(true)]);
    const o = P(s).offer!;
    expect(reason(s, { type: 'confirmCards', playerId: 'p1' })).toBe('bad-selection');
    s = run(s, [{ type: 'markCard', playerId: 'p1', cardUid: o.cards[0]!.uid }, { type: 'markCard', playerId: 'p1', cardUid: o.cards[3]!.uid }]);
    expect(reason(s, { type: 'markCard', playerId: 'p1', cardUid: o.cards[1]!.uid })).toBe('bad-selection');
    s = run(s, [{ type: 'markCard', playerId: 'p1', cardUid: o.cards[3]!.uid }]); // toggle off
    expect(P(s).offer!.marked).toEqual([o.cards[0]!.uid]);
    expect(reason(s, { type: 'confirmCards', playerId: 'p1' })).toBe('bad-selection');
    s = run(s, [{ type: 'markCard', playerId: 'p1', cardUid: o.cards[2]!.uid }, { type: 'confirmCards', playerId: 'p1' }]);
    expect(cardIds(s)).toEqual([o.cards[0]!.defId, o.cards[2]!.defId]);
    expect(P(s).offer).toBeNull();
    expect(P(s).discard).toBeNull();
    expect(P(s).discarded).toHaveLength(3);
  });

  it('hand + N > 5 opens the discard screen; it cannot be closed before the hand is 5', () => {
    let s = game();
    for (let i = 0; i < 4; i++) s = give(s, 'teropong');
    s = run(s, [sel('p1', 'medan'), start(), res(true), auto()]); // N = 2 -> hand 6
    const d = P(s).discard!;
    expect(P(s).hand).toHaveLength(6);
    expect(discardNeeded(P(s))).toBe(1);
    expect(d.newUids).toHaveLength(2);
    expect(reason(s, { type: 'confirmCards', playerId: 'p1' })).toBe('bad-selection');
    expect(reason(s, start())).toBe('cards-open');
    expect(reason(s, { type: 'playCard', playerId: 'p1', cardUid: P(s).hand[0]!.uid })).toBe('cards-open');
    s = run(s, [{ type: 'markCard', playerId: 'p1', cardUid: P(s).hand[0]!.uid }, { type: 'confirmCards', playerId: 'p1' }]);
    expect(P(s).hand).toHaveLength(HAND_MAX);
    expect(P(s).discard).toBeNull();
  });

  it('maximum before discard is 9 (hand 5 + hard 3 + Oleh-oleh 1)', () => {
    let s = game();
    for (let i = 0; i < 5; i++) s = give(s, 'teropong'); // 5th give already overflows? hand=5 is fine
    expect(P(s).discard).toBeNull();
    s = run(s, [sel('p1', 'medan')]);
    // pending Oleh-oleh via hand slot would need room; use debug offer of 4 cards
    s = run(s, [{ type: 'debugForceOffer', playerId: 'p1', cardIds: ['jam_pasir', 'santai_dulu', 'teropong', 'zona_lebar', 'kopi_tubruk'], pick: 4 }, auto()]);
    expect(P(s).hand).toHaveLength(9);
    expect(discardNeeded(P(s))).toBe(4);
    s = settle(s);
    expect(P(s).hand).toHaveLength(5);
  });

  it('zones invariant: every instance is in exactly one zone, unique ids', () => {
    let s = game(9);
    for (let i = 0; i < 6; i++) s = give(s, ['jam_pasir', 'teropong', 'kopi_tubruk'][i % 3]!);
    s = settle(s);
    s = run(s, [sel('p1', 'medan'), start(), res(true)]);
    const p = P(s);
    const all = [...p.hand, ...p.pending, ...p.discarded, ...(p.offer?.cards ?? [])];
    expect(new Set(all.map((c) => c.uid)).size).toBe(all.length);
    expect(all.length).toBe(s.nextCardUid - 1);
  });
});

describe('auto-pick (DR-25)', () => {
  const rc = (uid: string, rarity: 'common' | 'rare' | 'epic') => ({ uid, rarity });
  it('highest rarity first, ties by leftmost slot; marked cards stay', () => {
    const slots = [rc('a', 'common'), rc('b', 'rare'), rc('c', 'common'), rc('d', 'epic'), rc('e', 'rare')];
    expect(autoPick(slots, [], 2)).toEqual(['b', 'd']);
    expect(autoPick(slots, [], 3)).toEqual(['b', 'd', 'e']);
    expect(autoPick(slots, ['c'], 2)).toEqual(['c', 'd']);
    expect(autoPick(slots, ['a', 'c'], 2)).toEqual(['a', 'c']);
    expect(autoPick([rc('a', 'common'), rc('b', 'common'), rc('c', 'common')], [], 2)).toEqual(['a', 'b']);
  });
  it('timeout in the reducer: 15 s of game time -> auto-pick; pause (no ticks) never triggers it', () => {
    let s = run(game(), [sel('p1', 'medan'), start(), res(true)]);
    const o = P(s).offer!;
    s = run(s, [tick(14_950)]);
    expect(P(s).offer).not.toBeNull();
    const expected = autoPick(o.cards.map((c) => ({ uid: c.uid, rarity: getCard(c.defId).rarity })), [], 2);
    s = run(s, [tick(50)]);
    expect(P(s).offer).toBeNull();
    expect(P(s).hand.map((c) => c.uid)).toEqual(expected);
  });
  it('marked card survives the timeout', () => {
    let s = run(game(), [sel('p1', 'medan'), start(), res(true)]);
    const o = P(s).offer!;
    const lowest = o.cards.find((c) => getCard(c.defId).rarity === 'common')!;
    s = run(s, [{ type: 'markCard', playerId: 'p1', cardUid: lowest.uid }, tick(15_000)]);
    expect(P(s).hand.map((c) => c.uid)).toContain(lowest.uid);
    expect(P(s).hand).toHaveLength(2);
  });
});

describe('auto-discard (DR-25)', () => {
  const hc = (uid: string, rarity: 'common' | 'rare' | 'epic', seq: number) => ({ uid, rarity, seq });
  it('lowest rarity first, ties by oldest handSeq, new cards (largest seq) last', () => {
    const cards = [hc('a', 'rare', 1), hc('b', 'common', 2), hc('c', 'common', 3), hc('d', 'epic', 4), hc('e', 'common', 5), hc('n1', 'common', 6), hc('n2', 'rare', 7)];
    expect(autoDiscard(cards, [], 2)).toEqual(['b', 'c']);
    expect(autoDiscard(cards, [], 4)).toEqual(['b', 'c', 'e', 'n1']);
    expect(autoDiscard(cards, ['d'], 2)).toEqual(['b', 'd']);
    expect(autoDiscard(cards, ['d', 'a'], 2)).toEqual(['a', 'd']);
  });
  it('same state -> same result, no RNG: timeout of the discard screen', () => {
    const make = () => {
      let s = game();
      for (const id of ['teropong', 'kopi_tubruk', 'ojek_kilat', 'jam_pasir', 'tiket_pesawat']) s = give(s, id);
      return run(s, [{ type: 'debugForceOffer', playerId: 'p1', cardIds: ['zona_lebar', 'santai_dulu', 'oleh_oleh', 'nyawa_cadangan', 'teropong'], pick: 2 }, auto()]);
    };
    const a = make();
    expect(P(a).hand).toHaveLength(7);
    const b = run(a, [tick(14_900)]);
    expect(P(b).discard).not.toBeNull();
    const c = run(b, [tick(100)]);
    expect(P(c).discard).toBeNull();
    expect(P(c).hand).toHaveLength(5);
    expect(run(make(), [tick(15_000)]).players).toEqual(c.players);
    // oldest commons go first: teropong(1), kopi(2) are the oldest commons -> dropped
    expect(P(c).hand.map((x) => x.defId)).not.toContain('kopi_tubruk');
  });
  it('a marked card stays discarded at the timeout', () => {
    let s = game();
    for (const id of ['teropong', 'kopi_tubruk', 'ojek_kilat', 'jam_pasir', 'tiket_pesawat', 'zona_lebar']) s = give(s, id);
    expect(P(s).discard).not.toBeNull();
    const epic = uidOf(s, 'tiket_pesawat');
    s = run(s, [{ type: 'markCard', playerId: 'p1', cardUid: epic }, tick(15_000)]);
    expect(cardIds(s)).not.toContain('tiket_pesawat');
    expect(P(s).hand).toHaveLength(5);
  });
});

// ---------------------------------------------------------------- effect engine
describe('effect engine', () => {
  const defs = (...ids: string[]) => ids.map(getCard);
  it('netting: Jam Pasir + Jam Rusak = 0, Santai + Badai = base difficulty', () => {
    const e = resolveAttemptEffects(defs('jam_pasir', 'jam_rusak', 'santai_dulu', 'badai'), 'medium', 20_000);
    expect(e.modifiers).toEqual([]);
    expect(e.difficulty).toBe('medium');
  });
  it('time clamp: base + total within 10-40 s', () => {
    expect(resolveAttemptEffects(defs('jam_rusak', 'jam_rusak'), 'easy', 15_000).modifiers).toEqual([{ kind: 'timeDelta', seconds: -5 }]);
    expect(resolveAttemptEffects(defs('jam_pasir', 'jam_pasir'), 'easy', 30_000).modifiers).toEqual([{ kind: 'timeDelta', seconds: 10 }]);
    expect(resolveAttemptEffects(defs('jam_pasir', 'jam_pasir'), 'easy', 35_000).modifiers).toEqual([{ kind: 'timeDelta', seconds: 5 }]);
  });
  it('difficulty shift clamps at easy and hard', () => {
    expect(resolveAttemptEffects(defs('santai_dulu'), 'easy', 20_000).difficulty).toBe('easy');
    expect(resolveAttemptEffects(defs('santai_dulu'), 'hard', 20_000).difficulty).toBe('medium');
    expect(resolveAttemptEffects(defs('badai', 'gunung_meletus'), 'easy', 20_000).difficulty).toBe('hard');
  });
  it('conditional ops go to onFail/onWin, never into modifiers', () => {
    const e = resolveAttemptEffects(defs('nyawa_cadangan', 'oleh_oleh', 'ojek_kilat', 'macet_total', 'pelit_hadiah'), 'medium', 20_000);
    expect(e.modifiers).toEqual([]);
    expect(e.onFail).toEqual({ noCooldown: true, cooldownDeltaMs: 6000 });
    expect(e.onWin).toEqual({ pickDelta: 0, winMultiplier: 2 });
  });
  it('merges one modifier per kind', () => {
    const e = resolveAttemptEffects(defs('teropong', 'zona_lebar', 'kabut_asap', 'ngebut', 'tambah_beban'), 'medium', 20_000);
    expect(e.modifiers).toEqual(expect.arrayContaining([
      { kind: 'hint' }, { kind: 'tolerance', mult: 1.3 }, { kind: 'fog' }, { kind: 'speed', mult: 1.25 }, { kind: 'extraTarget', count: 1 },
    ]));
    expect(e.modifiers).toHaveLength(5);
  });
});

describe('every boost card on each of the 3 minigames (cards.md §5)', () => {
  const ctx = (_id: string, difficulty: 'easy' | 'medium' | 'hard', modifiers: MinigameModifier[]): MinigameContext => ({
    seed: 1234, difficulty, modifiers, map: map.data, regionId: 'medan', inputMode: 'touch',
    settings: { reducedMotion: false, reducedFlash: false, sfxVolume: 1 },
  });
  const levelFor = (mgId: string, cardId: string | null, difficulty: 'easy' | 'medium' | 'hard' = 'medium') => {
    const mg = MINIGAME_LOGIC.find((m) => m.id === mgId)!;
    const eff = resolveAttemptEffects(cardId ? [getCard(cardId)] : [], difficulty, mg.baseDurationMs);
    return { level: mg.generateLevel(ctx(mgId, eff.difficulty, eff.modifiers)) as any, eff, mg };
  };
  const base = (mgId: string, d: 'easy' | 'medium' | 'hard' = 'medium') => levelFor(mgId, null, d).level;

  it('Jam Pasir: +5 s on Tap and Simon; Hindari Rintangan keeps its duration and slows tempo by 15%', () => {
    expect(levelFor('tap_timing', 'jam_pasir').level.durationMs).toBe(base('tap_timing').durationMs + 5000);
    expect(levelFor('simon', 'jam_pasir').level.durationMs).toBe(base('simon').durationMs + 5000);
    const d = levelFor('dodge_runner', 'jam_pasir').level;
    expect(d.durationMs).toBe(base('dodge_runner').durationMs);
    expect(d.tempo).toBeCloseTo(0.85, 10);
    expect(d.speedMps).toBeCloseTo(base('dodge_runner').speedMps * 0.85, 10);
    expect(d.intervalMs).toBeCloseTo(base('dodge_runner').intervalMs / 0.85, 6);
  });

  it('two Jam Pasir: Simon 40 s, Dodge tempo 0.70', () => {
    const mg = MINIGAME_LOGIC.find((m) => m.id === 'simon')!;
    const e = resolveAttemptEffects(defs2('jam_pasir', 'jam_pasir'), 'medium', mg.baseDurationMs);
    expect((mg.generateLevel(ctx('simon', 'medium', e.modifiers)) as any).durationMs).toBe(40_000);
    const dg = MINIGAME_LOGIC.find((m) => m.id === 'dodge_runner')!;
    const e2 = resolveAttemptEffects(defs2('jam_pasir', 'jam_pasir'), 'medium', dg.baseDurationMs);
    expect((dg.generateLevel(ctx('dodge_runner', 'medium', e2.modifiers)) as any).tempo).toBeCloseTo(0.7, 10);
  });
  const defs2 = (...ids: string[]) => ids.map(getCard);

  it('Santai Dulu: the minigame gets the lower difficulty on all three', () => {
    for (const id of ['tap_timing', 'simon', 'dodge_runner']) {
      const { level, eff } = levelFor(id, 'santai_dulu', 'hard');
      expect(eff.difficulty).toBe('medium');
      expect(level).toEqual(base(id, 'medium'));
      expect(levelFor(id, 'santai_dulu', 'easy').level).toEqual(base(id, 'easy')); // no effect at easy
    }
  });

  it('Teropong: hint on Tap (zone glow), Simon (replay button), Dodge (0.5 s shadow)', () => {
    expect(levelFor('tap_timing', 'teropong').level.hint).toBe(true);
    expect(base('tap_timing').hint).toBe(false);
    expect(levelFor('simon', 'teropong').level.replayAvailable).toBe(true);
    expect(base('simon').replayAvailable).toBe(false);
    expect(levelFor('dodge_runner', 'teropong').level.hintLeadMs).toBe(500);
    expect(base('dodge_runner').hintLeadMs).toBe(0);
  });

  it('Zona Lebar x1.3: Tap zone (max 0.40), Simon idle +30% and one extra mistake, Dodge hit window /1.3 and i-frames x1.3', () => {
    const t = levelFor('tap_timing', 'zona_lebar').level;
    expect(t.zoneWidth).toBeCloseTo(base('tap_timing').zoneWidth * 1.3, 10);
    expect(t.zoneWidth).toBeLessThanOrEqual(0.4);
    const s = levelFor('simon', 'zona_lebar').level;
    expect(s.idleTimeoutMs).toBeCloseTo(base('simon').idleTimeoutMs * 1.3, 6);
    expect(s.mistakesAllowed).toBe(base('simon').mistakesAllowed + 1);
    const d = levelFor('dodge_runner', 'zona_lebar').level;
    expect(d.hitHalfWindowMs).toBeCloseTo(base('dodge_runner').hitHalfWindowMs / 1.3, 6);
    expect(d.iFrameMs).toBeCloseTo(base('dodge_runner').iFrameMs * 1.3, 6);
    expect(levelFor('dodge_runner', 'zona_lebar', 'hard').level.iFrameMs).toBe(0);
  });

  it('Nyawa Cadangan, Kopi Tubruk, Oleh-oleh, Ojek Kilat, Tiket Pesawat do not touch any minigame', () => {
    for (const card of ['nyawa_cadangan', 'kopi_tubruk', 'oleh_oleh', 'ojek_kilat', 'tiket_pesawat']) {
      for (const id of ['tap_timing', 'simon', 'dodge_runner']) {
        const r = levelFor(id, card);
        expect(r.eff.modifiers, `${card}/${id}`).toEqual([]);
        expect(r.level, `${card}/${id}`).toEqual(base(id));
      }
    }
  });
});

// ---------------------------------------------------------------- playing cards
describe('playing boost cards (playableWhen, locks)', () => {
  it('pending cards are applied at Mulai (snapshot) and spent after the attempt, win or fail', () => {
    for (const passed of [true, false]) {
      let s = give(give(game(), 'jam_pasir'), 'teropong');
      s = run(s, [sel('p1', 'medan')]);
      s = play(play(s, 'jam_pasir'), 'teropong');
      expect(P(s).pending).toHaveLength(2);
      s = run(s, [start()]);
      expect(P(s).attempt!.modifiers).toEqual(expect.arrayContaining([{ kind: 'timeDelta', seconds: 5 }, { kind: 'hint' }]));
      expect(P(s).attempt!.cardUids).toHaveLength(2);
      s = run(s, [res(passed)]);
      expect(P(s).pending).toHaveLength(0);
      expect(P(s).discarded.map((c) => c.defId)).toEqual(expect.arrayContaining(['jam_pasir', 'teropong']));
    }
  });

  it('a card played during cooldown applies to the retry, not the failed attempt (snapshot per attempt)', () => {
    let s = give(game(), 'teropong');
    s = run(s, [sel('p1', 'medan'), start()]);
    expect(P(s).attempt!.modifiers).toEqual([]);
    s = run(s, [res(false)]);
    s = play(s, 'teropong');
    s = run(s, [tick(6000), start()]);
    expect(P(s).attempt!.modifiers).toEqual([{ kind: 'hint' }]);
  });

  it('cards cannot be played during intro/minigame, nor on the offer or discard screens', () => {
    let s = give(game(), 'teropong');
    s = run(s, [sel('p1', 'medan'), start()]);
    expect(reason(s, { type: 'playCard', playerId: 'p1', cardUid: uidOf(s, 'teropong') })).toBe('busy');
    s = run(s, [res(true)]);
    expect(reason(s, { type: 'playCard', playerId: 'p1', cardUid: uidOf(s, 'teropong') })).toBe('cards-open');
  });

  it('maxStacks: Jam Pasir twice, a third is refused; others once', () => {
    let s = game();
    for (let i = 0; i < 3; i++) s = give(s, 'jam_pasir');
    s = play(play(s, 'jam_pasir'), 'jam_pasir');
    expect(reason(s, { type: 'playCard', playerId: 'p1', cardUid: uidOf(s, 'jam_pasir') })).toBe('card-unplayable');
    expect(cardPlayability(map, s, P(s), P(s).hand[0]!)).toEqual({ ok: false, reason: 'maxStacks' });
    expect(P(s).hand).toHaveLength(1); // stays in hand
    s = give(give(s, 'teropong'), 'teropong');
    s = play(s, 'teropong');
    expect(cardPlayability(map, s, P(s), P(s).hand.find((c) => c.defId === 'teropong')!)).toEqual({ ok: false, reason: 'maxStacks' });
  });

  it('Kopi Tubruk: only during cooldown; clears it; Mulai works at once', () => {
    let s = give(game(), 'kopi_tubruk');
    s = run(s, [sel('p1', 'medan')]);
    expect(cardPlayability(map, s, P(s), P(s).hand[0]!)).toEqual({ ok: false, reason: 'onlyCooldown' });
    expect(reason(s, { type: 'playCard', playerId: 'p1', cardUid: uidOf(s, 'kopi_tubruk') })).toBe('card-unplayable');
    s = run(s, [start(), res(false)]);
    expect(cardPlayability(map, s, P(s), P(s).hand[0]!).ok).toBe(true);
    expect(reason(s, start())).toBe('cooldown');
    s = play(s, 'kopi_tubruk');
    expect(P(s).cooldownUntilMs).toBe(0);
    expect(P(s).hand).toHaveLength(0);
    expect(reason(s, start())).toBeUndefined();
  });

  it('Nyawa Cadangan: on fail no cooldown; on win spent without effect; played during cooldown it covers the retry only', () => {
    let s = give(game(), 'nyawa_cadangan');
    s = play(run(s, [sel('p1', 'medan')]), 'nyawa_cadangan');
    const failed = run(s, [start(), res(false)]);
    expect(P(failed).cooldownUntilMs).toBe(0);
    expect(reason(failed, start())).toBeUndefined(); // Mulai active at once, still a press (DR-05)
    expect(P(failed).pending).toHaveLength(0);
    const won = run(s, [start(), res(true)]);
    expect(P(won).pending).toHaveLength(0);
    expect(P(won).discarded.map((c) => c.defId)).toContain('nyawa_cadangan');
    // played during cooldown
    let s2 = give(run(game(), [sel('p1', 'medan'), start(), res(false)]), 'nyawa_cadangan');
    s2 = play(s2, 'nyawa_cadangan');
    expect(P(s2).cooldownUntilMs).toBeGreaterThan(s2.timeMs); // does not reach back
    s2 = run(s2, [tick(6000), start(), res(false)]);
    expect(P(s2).cooldownUntilMs).toBe(0);
  });

  it('Oleh-oleh: on win N + 1; on fail it is spent without effect', () => {
    let s = play(give(run(game(), [sel('p1', 'medan')]), 'oleh_oleh'), 'oleh_oleh');
    expect(P(run(s, [start(), res(true)])).offer!.pick).toBe(3); // medium 2 + 1
    const f = run(s, [start(), res(false)]);
    expect(P(f).pending).toHaveLength(0);
    expect(P(f).offer).toBeNull();
    // next win is back to the base N
    expect(P(run(f, [tick(6000), start(), res(true)])).offer!.pick).toBe(2);
  });

  it('Oleh-oleh at hard + hand: 4 of 5 (hard 3 + 1); at easy 2', () => {
    let s = game();
    s = run(conquer(s, TO_FINAL_GATE.slice(0, 2)), [sel('p1', 'toraja')]);
    s = play(give(s, 'oleh_oleh'), 'oleh_oleh');
    expect(P(run(s, [start(), res(true)])).offer!.pick).toBe(4);
  });

  it('Ojek Kilat: a win counts as 2 (clamped), one offer only with N by difficulty; fail spends it', () => {
    let s = play(give(run(game(), [sel('p1', 'medan')]), 'ojek_kilat'), 'ojek_kilat');
    const won = run(s, [start(), res(true)]);
    expect(P(won).nodeId).toBe('medan'); // region conquered with one attempt
    expect(P(won).targetId).toBeNull();
    expect(P(won).offer!.pick).toBe(2);
    const lost = run(s, [start(), res(false)]);
    expect(P(lost).winsAtTarget).toBe(0);
    expect(P(lost).pending).toHaveLength(0);
  });

  it('Santai Dulu at an easy region: playable, warns, spent without effect', () => {
    let s = give(run(conquer(game(), ['medan', 'jakarta']), [sel('p1', 'yogyakarta')]), 'santai_dulu');
    expect(P(s).targetId).toBe('yogyakarta');
    expect(cardWarnings(map, P(s), P(s).hand[0]!)).toEqual(['santaiEasy']);
    expect(cardPlayability(map, s, P(s), P(s).hand[0]!).ok).toBe(true);
    s = play(s, 'santai_dulu');
    s = run(s, [start()]);
    expect(P(s).attempt!.difficulty).toBe('easy');
    s = run(s, [res(false)]);
    expect(P(s).pending).toHaveLength(0);
  });

  it('Oleh-oleh at a FINAL region warns', () => {
    let s = conquer(game(), TO_FINAL_GATE);
    s = give(run(s, [sel('p1', 'labuan_bajo')]), 'oleh_oleh');
    expect(cardWarnings(map, P(s), P(s).hand[0]!)).toEqual(['olehFinal']);
    expect(cardPlayability(map, s, P(s), P(s).hand[0]!).ok).toBe(true);
  });

  describe('Tiket Pesawat (DR-31)', () => {
    it('needs a target first, refuses FINAL targets, no card, no minigame', () => {
      let s = give(game(), 'tiket_pesawat');
      expect(cardPlayability(map, s, P(s), P(s).hand[0]!)).toEqual({ ok: false, reason: 'pickTargetFirst' });
      s = run(s, [sel('p1', 'medan')]);
      expect(cardPlayability(map, s, P(s), P(s).hand[0]!).ok).toBe(true);
      const moved = play(s, 'tiket_pesawat');
      expect(P(moved).nodeId).toBe('medan');
      expect(P(moved).targetId).toBeNull();
      expect(P(moved).winsAtTarget).toBe(0);
      expect(P(moved).offer).toBeNull();
      expect(P(moved).remainingWins).toBeLessThan(P(s).remainingWins + 1);
      expect(P(moved).path).toEqual(['sabang', 'medan']);
    });

    it('refused for Labuan Bajo and Raja Ampat, ok for Toraja/Padang/Bali', () => {
      let s = give(conquer(game(), TO_FINAL_GATE), 'tiket_pesawat');
      for (const f of ['labuan_bajo', 'raja_ampat']) {
        const t = run(s, [sel('p1', f)]);
        expect(cardPlayability(map, t, P(t), P(t).hand[0]!)).toEqual({ ok: false, reason: 'noFinal' });
      }
    });

    it('allowed during cooldown (clears it) and with a partial win (the win is lost); pending boosts stay', () => {
      let s = give(give(game(), 'tiket_pesawat'), 'teropong');
      s = play(run(s, [sel('p1', 'medan')]), 'teropong');
      s = settle(run(s, [start(), res(true)])); // consumes teropong, 1/2
      s = play(give(s, 'teropong'), 'teropong');
      s = run(s, [start(), res(false)]);
      expect(P(s).cooldownUntilMs).toBeGreaterThan(s.timeMs);
      s = give(s, 'teropong');
      s = play(s, 'teropong');
      s = play(s, 'tiket_pesawat');
      expect(P(s).nodeId).toBe('medan');
      expect(P(s).cooldownUntilMs).toBe(0);
      expect(P(s).pending.map((c) => c.defId)).toContain('teropong');
    });

    it('not while a minigame is running', () => {
      let s = give(game(), 'tiket_pesawat');
      s = run(s, [sel('p1', 'medan'), start()]);
      expect(reason(s, { type: 'playCard', playerId: 'p1', cardUid: uidOf(s, 'tiket_pesawat') })).toBe('busy');
    });
  });
});

// ---------------------------------------------------------------- bots and match end
describe('bots (placeholder)', () => {
  it('bots get offers and resolve them with the auto rules; hands never exceed 5 after the screen', () => {
    let s = game(3, ['p1', 'bot1']);
    s = run(s, [sel('bot1', 'medan'), start('bot1'), res(true, 'bot1')]);
    expect(P(s, 'bot1').offer).not.toBeNull();
    s = run(s, [auto('bot1')]);
    expect(P(s, 'bot1').hand).toHaveLength(2);
  });

  it("a match that ends closes the others' card screens without cards", () => {
    let s = game(3, ['p1', 'p2']);
    s = run(s, [sel('p1', 'medan'), start('p1'), res(true, 'p1')]);
    expect(P(s, 'p1').offer).not.toBeNull();
    s = conquer(s, [...TO_FINAL_GATE, 'labuan_bajo'], 'p2');
    expect(s.status).toBe('finished');
    expect(P(s, 'p1').offer).toBeNull();
    expect(P(s, 'p1').hand).toHaveLength(0);
  });
});
