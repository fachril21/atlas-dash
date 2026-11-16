/**
 * CP4b: sabotage cards, targeting, Q2 cap, Cermin/Payung, Copet, comeback weights, bots.
 * Numbering follows cards.md §8 (acceptance criteria).
 */
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  botPassChance,
  BOT_PASS_CHANCE,
  buildOffer,
  CARDS,
  CARD_SCREEN_MS,
  cardPlayability,
  checkTarget,
  comebackGap,
  COOLDOWN_MS,
  createInitialState,
  createStream,
  getCard,
  GameSession,
  HumanController,
  impactSummary,
  loadMap,
  minigamePool,
  MINIGAME_LOGIC,
  offerPool,
  PlaceholderBotController,
  pickCount,
  replay,
  resolveAttemptEffects,
  Rng,
  sabotageSlotsUsed,
  tierWeights,
  type GameAction,
  type GameEvent,
  type GameState,
  type PlayerState,
  type Rarity,
} from '../src/logic';
import { indonesiaData } from './helpers';

const map = loadMap(indonesiaData(), 'standard', MINIGAME_LOGIC);
const pool = minigamePool(map.data);

type Kind = 'human' | 'bot';
const game = (seed = 42, ids = ['p1', 'p2', 'p3'], kind: Kind = 'human'): GameState =>
  createInitialState(map, ids.map((id) => ({ id, name: id, kind: id.startsWith('b') ? 'bot' : kind, ...(id.startsWith('b') ? { botLevel: 'normal' as const } : {}) })), seed, pool);
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
const give = (s: GameState, id: string, playerId = 'p1'): GameState => run(s, [{ type: 'debugGrantCard', playerId, cardId: id }]);
const uidOf = (s: GameState, defId: string, playerId = 'p1'): string => P(s, playerId).hand.find((c) => c.defId === defId)!.uid;
const playAction = (s: GameState, defId: string, playerId: string, targetId?: string): GameAction => ({
  type: 'playCard', playerId, cardUid: uidOf(s, defId, playerId), ...(targetId ? { targetId } : {}),
});
/** Give `defId` to `from` and play it at `to` (or without a target). */
const send = (s: GameState, defId: string, from: string, to?: string): GameState => {
  s = give(s, defId, from);
  return run(s, [playAction(s, defId, from, to)]);
};
const defsIn = (zone: { defId: string }[]): string[] => zone.map((c) => c.defId);
const sel = (playerId: string, targetId: string): GameAction => ({ type: 'selectTarget', playerId, targetId });
const start = (playerId = 'p1'): GameAction => ({ type: 'startAttempt', playerId });
const res = (passed: boolean, playerId = 'p1'): GameAction => ({ type: 'minigameResult', playerId, passed });
const tick = (dtMs: number): GameAction => ({ type: 'tick', dtMs });
const auto = (playerId = 'p1'): GameAction => ({ type: 'autoCards', playerId });
const clearHand = (s: GameState, playerId: string): GameState => run(s, [{ type: 'debugClearHand', playerId }]);
const settle = (s: GameState, only?: string): GameState => {
  for (const p of s.players) if (!only || p.id === only) while (P(s, p.id).offer || P(s, p.id).discard) s = run(s, [auto(p.id)]);
  return s;
};

/** All instances, per zone, over every player. */
function zones(s: GameState): string[] {
  const out: string[] = [];
  for (const p of s.players) {
    out.push(...p.hand.map((c) => c.uid), ...p.pending.map((c) => c.uid), ...p.discarded.map((c) => c.uid));
    if (p.offer) out.push(...p.offer.cards.map((c) => c.uid));
  }
  return out;
}
const expectZones = (s: GameState, label = ''): void => {
  const all = zones(s);
  expect(new Set(all).size, `${label} duplicate uid`).toBe(all.length);
  expect(all.length, `${label} card lost`).toBe(s.nextCardUid - 1);
};

// ============================================================================================
describe('1. pool', () => {
  it('the offer pool is all 20 cards in table order; Payung Tameng, Cermin Balik and sabotage can appear', () => {
    expect(offerPool()).toHaveLength(20);
    expect(offerPool().map((c) => c.id)).toEqual(CARDS.map((c) => c.id));
    const seen = new Set<string>();
    for (let seed = 1; seed <= 300; seed++) {
      for (const c of buildOffer(offerPool(), tierWeights(0).weights, createStream(seed, 'p1', 'cards'))) seen.add(c.id);
    }
    expect(seen.size).toBe(20);
    expect(seen.has('payung_tameng') && seen.has('cermin_balik')).toBe(true);
  });

  it('every offer holds at least one boost and one sabotage card (type guarantee is back)', () => {
    for (let seed = 1; seed <= 1500; seed++) {
      const o = buildOffer(offerPool(), tierWeights(0).weights, createStream(seed, 'p1', 'cards'));
      expect(o).toHaveLength(5);
      expect(o.some((c) => c.type === 'boost') && o.some((c) => c.type === 'sabotage')).toBe(true);
    }
  });

  it('the 9 sabotage cards resolve as active effects (a smoke play of each)', () => {
    const ids = CARDS.filter((c) => c.type === 'sabotage').map((c) => c.id);
    expect(ids).toHaveLength(9);
    for (const id of ids) {
      let s = give(game(), 'teropong', 'p2'); // Copet needs a card in the opponent's hand
      s = give(s, id);
      const def = getCard(id);
      const a = playAction(s, id, 'p1', def.target === 'opponent' ? 'p2' : undefined);
      const r = step(s, a);
      expect(r.rejected, id).toBeUndefined();
      expectZones(r.state, id);
      if (id === 'copet') expect(P(r.state, 'p1').hand.map((c) => c.defId)).toEqual(['teropong']);
      else expect(defsIn(P(r.state, 'p2').pending)).toContain(id);
    }
  });
});

// ============================================================================================
describe('2. valid targets (§2.2.1)', () => {
  it('yourself is never valid, and a bad or missing target changes nothing', () => {
    const s = give(game(), 'badai');
    expect(step(s, playAction(s, 'badai', 'p1', 'p1')).rejected).toBe('bad-target');
    expect(step(s, playAction(s, 'badai', 'p1')).rejected).toBe('bad-target');
    expect(step(s, playAction(s, 'badai', 'p1', 'nobody')).rejected).toBe('bad-target');
    expect(checkTarget(s, P(s), getCard('badai'), P(s))).toEqual({ ok: false, label: null });
  });

  it('a target with 2 sabotage slots is "full"; Copet ignores the slots', () => {
    let s = send(game(), 'badai', 'p3', 'p2');
    s = send(s, 'kabut_asap', 'p3', 'p2');
    expect(sabotageSlotsUsed(P(s, 'p2'))).toBe(2);
    s = give(give(s, 'ngebut'), 'copet');
    expect(checkTarget(s, P(s), getCard('ngebut'), P(s, 'p2'))).toEqual({ ok: false, label: 'full' });
    expect(step(s, playAction(s, 'ngebut', 'p1', 'p2')).rejected).toBe('bad-target');
    // Copet: valid to a "full" target as long as the target has a card in hand
    expect(checkTarget(s, P(s), getCard('copet'), P(s, 'p2'))).toEqual({ ok: false, label: 'empty' });
    s = give(s, 'teropong', 'p2');
    expect(checkTarget(s, P(s), getCard('copet'), P(s, 'p2'))).toEqual({ ok: true });
    expect(step(s, playAction(s, 'copet', 'p1', 'p2')).rejected).toBeUndefined();
  });

  it('maxStacks: a copy already pending (from any sender) makes the target "stacked"; Jam Rusak allows 2', () => {
    let s = send(game(), 'badai', 'p3', 'p2');
    s = give(s, 'badai');
    expect(checkTarget(s, P(s), getCard('badai'), P(s, 'p2'))).toEqual({ ok: false, label: 'stacked' });
    // priority: full (row 3) is reported before stacked (row 4)
    s = send(s, 'kabut_asap', 'p3', 'p2');
    expect(checkTarget(s, P(s), getCard('badai'), P(s, 'p2'))).toEqual({ ok: false, label: 'full' });
    let t = send(game(), 'jam_rusak', 'p3', 'p2');
    t = give(t, 'jam_rusak');
    expect(checkTarget(t, P(t), getCard('jam_rusak'), P(t, 'p2')).ok).toBe(true);
    t = run(t, [playAction(t, 'jam_rusak', 'p1', 'p2')]);
    expect(defsIn(P(t, 'p2').pending)).toEqual(['jam_rusak', 'jam_rusak']);
    t = give(t, 'jam_rusak');
    expect(checkTarget(t, P(t), getCard('jam_rusak'), P(t, 'p2'))).toEqual({ ok: false, label: 'full' });
  });

  it('Copet: an opponent with an empty hand is "empty"', () => {
    const s = give(game(), 'copet');
    expect(checkTarget(s, P(s), getCard('copet'), P(s, 'p2'))).toEqual({ ok: false, label: 'empty' });
  });

  it('the label for each opponent shows in impactSummary (Gunung confirmation text)', () => {
    let s = send(send(game(), 'badai', 'p1', 'p3'), 'kabut_asap', 'p1', 'p3');
    s = give(s, 'gunung_meletus');
    const sum = impactSummary(s, P(s), getCard('gunung_meletus'));
    expect(sum).toEqual({ hit: 1, total: 2, skipped: [{ id: 'p3', label: 'full' }] });
  });
});

// ============================================================================================
describe('3-4. no valid target, and the re-check on confirm', () => {
  it('no valid opponent: the card is dimmed with a reason, stays in hand, and a forced play changes nothing', () => {
    let s = send(send(game(), 'badai', 'p1', 'p2'), 'kabut_asap', 'p1', 'p2');
    s = send(send(s, 'badai', 'p1', 'p3'), 'kabut_asap', 'p1', 'p3');
    s = give(s, 'ngebut');
    const card = P(s).hand[0]!;
    expect(cardPlayability(map, s, P(s), card)).toEqual({ ok: false, reason: 'allFull' });
    const r = step(s, playAction(s, 'ngebut', 'p1', 'p2'));
    expect(r.rejected).toBe('card-unplayable');
    expect(r.state).toBe(s); // not even a new object: no state change
    expect(P(s).hand).toHaveLength(1);
  });

  it('reasons: all stacked, all empty (Copet), mixed, and nobody to target', () => {
    let s = send(send(game(), 'badai', 'p3', 'p2'), 'kabut_asap', 'p1', 'p2');
    s = send(game(), 'badai', 'p1', 'p2'); // p2 holds Badai
    s = send(s, 'badai', 'p1', 'p3'); // p3 holds Badai: both opponents are "stacked" for a 3rd Badai
    s = give(s, 'badai');
    expect(cardPlayability(map, s, P(s), P(s).hand[0]!)).toEqual({ ok: false, reason: 'allStacked' });
    const t = give(game(), 'copet');
    expect(cardPlayability(map, t, P(t), P(t).hand[0]!)).toEqual({ ok: false, reason: 'allEmpty' });
    let m = give(send(send(game(), 'badai', 'p1', 'p2'), 'kabut_asap', 'p1', 'p3'), 'badai');
    m = send(m, 'kabut_asap', 'p1', 'p2'); // p2 full (badai + kabut), p3 stacked? p3 has kabut, not badai
    expect(cardPlayability(map, m, P(m), P(m).hand[0]!).ok).toBe(true); // p3 can still take Badai
    const solo = give(game(1, ['p1']), 'badai');
    expect(cardPlayability(map, solo, P(solo), P(solo).hand[0]!)).toEqual({ ok: false, reason: 'noOpponents' });
  });

  it('the target filled up between opening the picker and confirming: no change, card stays in hand', () => {
    let s = give(game(), 'badai');
    const a = playAction(s, 'badai', 'p1', 'p2'); // picker was open on p2
    s = send(send(s, 'ngebut', 'p3', 'p2'), 'tambah_beban', 'p3', 'p2'); // meanwhile p2 filled
    const r = step(s, a);
    expect(r.rejected).toBe('bad-target');
    expect(r.state).toBe(s);
    expect(defsIn(P(s).hand)).toEqual(['badai']);
    // the other opponent is still fine
    expect(step(s, playAction(s, 'badai', 'p1', 'p3')).rejected).toBeUndefined();
  });

  it('Copet target emptied between picker and confirm: no change', () => {
    let s = give(give(give(game(), 'copet'), 'teropong', 'p2'), 'teropong', 'p3');
    const a = playAction(s, 'copet', 'p1', 'p2');
    s = clearHand(s, 'p2');
    const r = step(s, a);
    expect(r.rejected).toBe('bad-target');
    expect(r.state).toBe(s);
  });

  it('cannot play while a card screen is open or while in a minigame', () => {
    let s = give(game(), 'badai');
    const a = playAction(s, 'badai', 'p1', 'p2');
    const open = run(s, [{ type: 'debugForceOffer', playerId: 'p1', cardIds: ['jam_pasir'], pick: 1 }]);
    expect(step(open, a).rejected).toBe('cards-open');
    s = run(s, [sel('p1', 'medan'), start()]);
    expect(step(s, a).rejected).toBe('busy');
  });
});

// ============================================================================================
describe('5. Q2: slots', () => {
  it('Copet takes no slot; the snapshot holds slots until the attempt result; then they are released', () => {
    let s = give(game(), 'teropong', 'p2');
    s = send(s, 'copet', 'p3', 'p2');
    expect(sabotageSlotsUsed(P(s, 'p2'))).toBe(0);
    s = send(send(s, 'badai', 'p3', 'p2'), 'kabut_asap', 'p1', 'p2');
    expect(sabotageSlotsUsed(P(s, 'p2'))).toBe(2);
    s = run(s, [sel('p2', 'medan'), start('p2')]);
    // the running attempt consumed both cards, but they still hold the slots
    expect(P(s, 'p2').attempt!.cardUids).toHaveLength(2);
    expect(sabotageSlotsUsed(P(s, 'p2'))).toBe(2);
    s = give(s, 'ngebut', 'p3');
    expect(step(s, playAction(s, 'ngebut', 'p3', 'p2')).rejected).toBe('bad-target');
    s = run(s, [res(false, 'p2')]);
    expect(sabotageSlotsUsed(P(s, 'p2'))).toBe(0);
    expect(step(s, playAction(s, 'ngebut', 'p3', 'p2')).rejected).toBeUndefined();
  });

  it('a slot is held by every sender equally, and a defence card does not use one', () => {
    let s = send(game(), 'payung_tameng', 'p2');
    expect(sabotageSlotsUsed(P(s, 'p2'))).toBe(0);
    s = send(send(game(), 'cermin_balik', 'p2'), 'badai', 'p3', 'p1');
    s = send(s, 'kabut_asap', 'p2', 'p1');
    expect(sabotageSlotsUsed(P(s, 'p1'))).toBe(2);
  });
});

// ============================================================================================
describe('6. R3: sabotage played on a target who is already playing', () => {
  it('does not touch the running attempt; applies to the next attempt including the retry', () => {
    let s = run(game(), [sel('p2', 'medan'), start('p2')]);
    const before = JSON.stringify(P(s, 'p2').attempt);
    s = send(s, 'badai', 'p1', 'p2');
    expect(JSON.stringify(P(s, 'p2').attempt)).toBe(before);
    expect(P(s, 'p2').attempt!.difficulty).toBe('medium');
    s = run(s, [res(false, 'p2'), tick(60_000), start('p2')]);
    expect(P(s, 'p2').attempt!.difficulty).toBe('hard'); // the retry carries Badai
    expect(P(s, 'p2').attempt!.baseDifficulty).toBe('medium');
  });

  it('a card played while the target sits in the cooldown goes into the retry', () => {
    let s = run(game(), [sel('p2', 'medan'), start('p2'), res(false, 'p2')]);
    s = send(s, 'kabut_asap', 'p1', 'p2');
    s = run(s, [tick(COOLDOWN_MS.medium + 100), start('p2')]);
    expect(P(s, 'p2').attempt!.modifiers).toContainEqual({ kind: 'fog' });
  });
});

// ============================================================================================
describe('7-8. Cermin Balik / Payung Tameng (§2.2.3)', () => {
  it('Payung: the sabotage burns, Payung is spent, no slot is used, nothing lands', () => {
    let s = send(game(), 'payung_tameng', 'p2');
    expect(defsIn(P(s, 'p2').pending)).toEqual(['payung_tameng']);
    const sent = give(s, 'badai');
    const r = step(sent, playAction(sent, 'badai', 'p1', 'p2'));
    s = r.state;
    expect(P(s, 'p2').pending).toHaveLength(0);
    expect(defsIn(P(s, 'p2').discarded)).toEqual(['payung_tameng']);
    expect(defsIn(P(s).discarded)).toEqual(['badai']);
    expect(r.events).toContainEqual({ type: 'sabotagePlayed', senderId: 'p1', targetId: 'p2', cardId: 'badai', outcome: 'blocked' });
    expectZones(s);
  });

  it('Cermin: the card lands on the sender with source = the Cermin owner; Cermin is spent', () => {
    let s = send(game(), 'cermin_balik', 'p2');
    s = send(s, 'badai', 'p1', 'p2');
    expect(defsIn(P(s).pending)).toEqual(['badai']);
    expect(P(s).pending[0]!.source).toBe('p2');
    expect(P(s, 'p2').pending).toHaveLength(0);
    expect(defsIn(P(s, 'p2').discarded)).toEqual(['cermin_balik']);
    expect(sabotageSlotsUsed(P(s))).toBe(1);
    expectZones(s);
  });

  it('Cermin vs Cermin: the reflection is not reflected again; the sender\'s Cermin is NOT spent', () => {
    let s = send(send(game(), 'cermin_balik', 'p2'), 'cermin_balik', 'p1');
    s = send(s, 'badai', 'p1', 'p2');
    expect(defsIn(P(s).pending).sort()).toEqual(['badai', 'cermin_balik']);
    expect(P(s, 'p2').pending).toHaveLength(0);
    expectZones(s);
  });

  it('reflection onto a full sender burns it; Cermin is still spent', () => {
    let s = send(send(game(), 'badai', 'p3', 'p1'), 'kabut_asap', 'p3', 'p1'); // p1 is full
    s = send(s, 'cermin_balik', 'p2');
    const g = give(s, 'jam_rusak');
    const r = step(g, playAction(g, 'jam_rusak', 'p1', 'p2'));
    s = r.state;
    expect(r.events).toContainEqual({ type: 'sabotagePlayed', senderId: 'p1', targetId: 'p2', cardId: 'jam_rusak', outcome: 'reflectBurned' });
    expect(sabotageSlotsUsed(P(s))).toBe(2);
    expect(defsIn(P(s, 'p2').discarded)).toEqual(['cermin_balik']);
    expect(defsIn(P(s).discarded)).toContain('jam_rusak');
    expectZones(s);
  });

  it('reflection onto a sender who already has the card (maxStacks) burns it', () => {
    let s = send(game(), 'badai', 'p3', 'p1');
    s = send(s, 'cermin_balik', 'p2');
    s = send(s, 'badai', 'p1', 'p2');
    expect(defsIn(P(s).pending)).toEqual(['badai']);
    expect(P(s, 'p2').pending).toHaveLength(0);
    expect(defsIn(P(s).discarded)).toContain('badai');
  });

  it('reflection onto a sender with Payung: Payung does not stop it and is not spent', () => {
    let s = send(send(game(), 'payung_tameng', 'p1'), 'cermin_balik', 'p2');
    s = send(s, 'badai', 'p1', 'p2');
    expect(defsIn(P(s).pending).sort()).toEqual(['badai', 'payung_tameng']);
  });

  it('Payung vs Copet: the Copet burns, no card moves', () => {
    let s = give(send(game(), 'payung_tameng', 'p2'), 'teropong', 'p2');
    s = send(s, 'copet', 'p1', 'p2');
    expect(defsIn(P(s, 'p2').hand)).toEqual(['teropong']);
    expect(P(s).hand).toHaveLength(0);
    expect(P(s, 'p2').pending).toHaveLength(0);
    expectZones(s);
  });

  it('Cermin vs Copet: the Cermin owner steals from the sender (empty sender hand: no effect, Cermin spent)', () => {
    let s = give(send(game(), 'cermin_balik', 'p2'), 'teropong', 'p2');
    s = give(s, 'jam_pasir'); // sender keeps this one in hand
    const sent = give(s, 'copet');
    const r = step(sent, playAction(sent, 'copet', 'p1', 'p2'));
    s = r.state;
    expect(defsIn(P(s).hand)).toEqual([]); // the only card was stolen back
    expect(defsIn(P(s, 'p2').hand).sort()).toEqual(['jam_pasir', 'teropong']);
    expect(r.events).toContainEqual({ type: 'cardStolen', thiefId: 'p2', victimId: 'p1', cardId: 'jam_pasir', uid: expect.any(String), reflected: true });
    // stream of the Cermin owner moved, the sender's did not
    expect(P(s, 'p2').copetRng).not.toEqual(P(game(), 'p2').copetRng);
    expect(P(s).copetRng).toEqual(P(game(), 'p1').copetRng);

    let e = give(send(game(), 'cermin_balik', 'p2'), 'teropong', 'p2');
    const g = give(e, 'copet');
    const r2 = step(g, playAction(g, 'copet', 'p1', 'p2'));
    expect(r2.events).toContainEqual({ type: 'sabotagePlayed', senderId: 'p1', targetId: 'p2', cardId: 'copet', outcome: 'reflectEmpty' });
    e = r2.state;
    expect(defsIn(P(e, 'p2').hand)).toEqual(['teropong']);
    expect(P(e, 'p2').pending).toHaveLength(0);
    expectZones(e);
  });

  it('only 1 defence card is active: the second is dimmed ("defenseActive"), stays in hand', () => {
    let s = send(game(), 'payung_tameng', 'p1');
    s = give(give(s, 'cermin_balik'), 'payung_tameng');
    for (const c of P(s).hand) expect(cardPlayability(map, s, P(s), c)).toEqual({ ok: false, reason: 'defenseActive' });
    expect(step(s, playAction(s, 'cermin_balik', 'p1')).rejected).toBe('card-unplayable');
    expect(P(s).hand).toHaveLength(2);
    let t = send(game(), 'cermin_balik', 'p1');
    t = give(t, 'payung_tameng');
    expect(cardPlayability(map, t, P(t), P(t).hand[0]!)).toEqual({ ok: false, reason: 'defenseActive' });
  });

  it('defence cards are not part of an attempt snapshot and survive attempts', () => {
    let s = send(game(), 'payung_tameng', 'p1');
    s = run(s, [sel('p1', 'medan'), start()]);
    expect(P(s).attempt!.cardUids).toHaveLength(0);
    s = run(s, [res(false)]);
    expect(defsIn(P(s).pending)).toEqual(['payung_tameng']);
  });
});

// ============================================================================================
describe('9. Gunung Meletus', () => {
  const four = (seed = 5): GameState => game(seed, ['p1', 'p2', 'p3', 'p4']);

  it('hits every valid opponent; an invalid one is skipped and its Payung is not spent; others are checked on their own', () => {
    let s = send(send(four(), 'badai', 'p1', 'p3'), 'kabut_asap', 'p1', 'p3'); // p3 full
    s = send(s, 'payung_tameng', 'p3'); // p3 hidden Payung: must stay
    s = send(s, 'payung_tameng', 'p4'); // p4 Payung gets spent
    s = give(s, 'gunung_meletus');
    const r = step(s, playAction(s, 'gunung_meletus', 'p1'));
    s = r.state;
    expect(defsIn(P(s, 'p2').pending)).toEqual(['gunung_meletus']);
    expect(defsIn(P(s, 'p3').pending)).toEqual(['badai', 'kabut_asap', 'payung_tameng']);
    expect(P(s, 'p4').pending).toHaveLength(0);
    expect(defsIn(P(s, 'p4').discarded)).toEqual(['payung_tameng']);
    expect(r.events.filter((e) => e.type === 'sabotagePlayed').map((e) => (e as { targetId: string }).targetId)).toEqual(['p2', 'p4']);
    expectZones(s);
  });

  it('the targets are processed in seat order', () => {
    let s = send(send(four(), 'cermin_balik', 'p4'), 'cermin_balik', 'p2');
    s = give(s, 'gunung_meletus');
    const r = step(s, playAction(s, 'gunung_meletus', 'p1'));
    const order = r.events.filter((e) => e.type === 'sabotagePlayed').map((e) => (e as { targetId: string; outcome: string }).targetId + ':' + (e as { outcome: string }).outcome);
    expect(order).toEqual(['p2:reflected', 'p3:landed', 'p4:reflectBurned']);
  });

  it('reflected by 2 opponents: the sender is hit once (maxStacks 1), the second copy burns', () => {
    let s = send(send(four(), 'cermin_balik', 'p2'), 'cermin_balik', 'p3');
    s = send(s, 'gunung_meletus', 'p1');
    expect(defsIn(P(s).pending)).toEqual(['gunung_meletus']);
    expect(defsIn(P(s, 'p4').pending)).toEqual(['gunung_meletus']);
    expect(P(s, 'p2').pending).toHaveLength(0);
    expect(P(s, 'p3').pending).toHaveLength(0);
    expectZones(s);
  });

  it('needs at least one valid opponent; with none it is dim and unplayable', () => {
    let s = four();
    for (const t of ['p2', 'p3', 'p4']) s = send(send(s, 'badai', 'p1', t), 'kabut_asap', 'p1', t);
    s = give(s, 'gunung_meletus');
    expect(cardPlayability(map, s, P(s), P(s).hand[0]!)).toEqual({ ok: false, reason: 'allFull' });
    expect(step(s, playAction(s, 'gunung_meletus', 'p1')).rejected).toBe('card-unplayable');
  });
});

// ============================================================================================
describe('10. merging (§2.3)', () => {
  it('the Tap Tepat Waktu example: difficulty +1-1, time -5+5, speed x1.25, tolerance x1.3, +1 target, fog, hint', () => {
    const ids = ['badai', 'jam_rusak', 'ngebut', 'tambah_beban', 'kabut_asap', 'jam_pasir', 'santai_dulu', 'zona_lebar', 'teropong'];
    const r = resolveAttemptEffects(ids.map(getCard), 'medium', 20_000);
    expect(r.difficulty).toBe('medium');
    expect(r.modifiers).toEqual([
      { kind: 'tolerance', mult: 1.3 },
      { kind: 'speed', mult: 1.25 },
      { kind: 'extraTarget', count: 1 },
      { kind: 'fog' },
      { kind: 'hint' },
    ]);
  });

  it('shuffling the order the cards were played in gives an identical attempt (200 shuffles)', () => {
    const ids = ['badai', 'gunung_meletus', 'jam_rusak', 'jam_rusak', 'ngebut', 'tambah_beban', 'kabut_asap', 'jam_pasir', 'santai_dulu', 'zona_lebar', 'teropong'];
    const base = JSON.stringify(resolveAttemptEffects(ids.map(getCard), 'easy', 25_000));
    const rng = new Rng(7);
    for (let i = 0; i < 200; i++) expect(JSON.stringify(resolveAttemptEffects(rng.shuffle(ids).map(getCard), 'easy', 25_000))).toBe(base);
  });

  it('end to end: two different play orders of the same sabotage and boost give the same snapshot', () => {
    const order = (list: [string, string, string?][]): PlayerState['attempt'] => {
      let s = game();
      for (const [id, from, to] of list) {
        s = give(s, id, from);
        s = run(s, [playAction(s, id, from, to)]);
      }
      s = run(s, [sel('p2', 'medan'), start('p2')]);
      const a = P(s, 'p2').attempt!;
      return { ...a, cardUids: [] };
    };
    const cards: [string, string, string?][] = [['badai', 'p1', 'p2'], ['jam_rusak', 'p3', 'p2'], ['jam_pasir', 'p2'], ['zona_lebar', 'p2']];
    expect(JSON.stringify(order(cards))).toBe(JSON.stringify(order(cards.slice().reverse())));
  });

  it('difficulty is clamped after summing: Badai + Gunung -> hard; Badai + Santai Dulu -> neutral', () => {
    expect(resolveAttemptEffects(['badai', 'gunung_meletus'].map(getCard), 'medium', 20_000).difficulty).toBe('hard');
    expect(resolveAttemptEffects(['badai', 'gunung_meletus'].map(getCard), 'easy', 20_000).difficulty).toBe('hard');
    expect(resolveAttemptEffects(['badai', 'santai_dulu'].map(getCard), 'medium', 20_000).difficulty).toBe('medium');
    expect(resolveAttemptEffects(['santai_dulu', 'badai'].map(getCard), 'hard', 20_000).difficulty).toBe('hard');
    expect(resolveAttemptEffects(['badai', 'gunung_meletus', 'santai_dulu'].map(getCard), 'easy', 20_000).difficulty).toBe('medium');
  });

  it('time delta nets out and clamps to 10-40 s', () => {
    expect(resolveAttemptEffects(['jam_rusak', 'jam_rusak'].map(getCard), 'easy', 20_000).modifiers).toEqual([{ kind: 'timeDelta', seconds: -10 }]);
    expect(resolveAttemptEffects(['jam_rusak', 'jam_pasir'].map(getCard), 'easy', 20_000).modifiers).toEqual([]);
    expect(resolveAttemptEffects(['jam_rusak', 'jam_rusak'].map(getCard), 'easy', 12_000).modifiers).toEqual([{ kind: 'timeDelta', seconds: -2 }]);
  });
});

// ============================================================================================
describe('11-12. DR-24 and Pelit Hadiah + Oleh-oleh', () => {
  const ready = (cards: [string, string, string?][]): GameState => {
    let s = game();
    for (const [id, from, to] of cards) {
      s = give(s, id, from);
      s = run(s, [playAction(s, id, from, to)]);
    }
    return run(s, [sel('p2', 'medan'), start('p2')]);
  };

  it('fail with Macet + Nyawa -> cooldown 0 and both cards are spent', () => {
    let s = ready([['macet_total', 'p1', 'p2'], ['nyawa_cadangan', 'p2']]);
    s = run(s, [res(false, 'p2')]);
    expect(P(s, 'p2').cooldownUntilMs).toBe(0);
    expect(P(s, 'p2').pending).toHaveLength(0);
    expect(defsIn(P(s, 'p2').discarded).sort()).toEqual(['macet_total', 'nyawa_cadangan']);
  });

  it('fail with Macet only -> base cooldown + 6 s; win with Macet -> spent without effect, slot released', () => {
    let s = run(ready([['macet_total', 'p1', 'p2']]), [res(false, 'p2')]);
    expect(P(s, 'p2').cooldownUntilMs - s.timeMs).toBe(COOLDOWN_MS.medium + 6000);
    expect(sabotageSlotsUsed(P(s, 'p2'))).toBe(0);
    s = run(ready([['macet_total', 'p1', 'p2']]), [res(true, 'p2')]);
    expect(P(s, 'p2').cooldownUntilMs).toBe(0);
    expect(P(s, 'p2').pending).toHaveLength(0);
    expect(sabotageSlotsUsed(P(s, 'p2'))).toBe(0);
  });

  it('Pelit Hadiah: N - 1 (min 1) on a win; a fail spends it without effect', () => {
    let s = run(ready([['pelit_hadiah', 'p1', 'p2']]), [res(true, 'p2')]);
    expect(P(s, 'p2').offer!.pick).toBe(1); // medium would be 2
    s = run(ready([['pelit_hadiah', 'p1', 'p2']]), [res(false, 'p2')]);
    expect(P(s, 'p2').pending).toHaveLength(0);
    expect(P(s, 'p2').offer).toBeNull();
  });

  it('Pelit Hadiah + Oleh-oleh cancel out; N stays within [1, min(5, offer size)]', () => {
    const s = run(ready([['pelit_hadiah', 'p1', 'p2'], ['oleh_oleh', 'p2']]), [res(true, 'p2')]);
    expect(P(s, 'p2').offer!.pick).toBe(2);
    expect(pickCount('easy', -1, 5)).toBe(1);
    expect(pickCount('hard', 1, 5)).toBe(4);
    expect(pickCount('hard', 3, 5)).toBe(5);
    expect(pickCount('easy', -2, 5)).toBe(1);
    expect(pickCount('hard', 1, 3)).toBe(3);
  });
});

// ============================================================================================
describe('13-14. Copet', () => {
  it('moves the same instance (no duplicate) to the thief with a fresh, newest handSeq', () => {
    let s = give(give(give(game(), 'teropong', 'p2'), 'jam_pasir', 'p2'), 'zona_lebar', 'p2');
    s = give(s, 'copet');
    const r = step(s, playAction(s, 'copet', 'p1', 'p2'));
    const stolen = r.events.find((e) => e.type === 'cardStolen') as Extract<GameEvent, { type: 'cardStolen' }>;
    s = r.state;
    expect(P(s, 'p2').hand).toHaveLength(2);
    expect(P(s).hand).toHaveLength(1);
    expect(P(s).hand[0]!.uid).toBe(stolen.uid);
    expect(P(s).hand[0]!.seq).toBe(2); // copet was seq 1
    expect(P(s, 'p2').hand.some((c) => c.uid === stolen.uid)).toBe(false);
    expect(defsIn(P(s).discarded)).toEqual(['copet']);
    expectZones(s);
  });

  it('only the hand is touched: pending, offer, discarded of the victim stay', () => {
    let s = send(game(), 'jam_pasir', 'p2'); // pending boost
    s = give(s, 'teropong', 'p2');
    s = run(s, [{ type: 'debugForceOffer', playerId: 'p2', cardIds: ['ojek_kilat'], pick: 1 }]);
    const pendingBefore = JSON.stringify(P(s, 'p2').pending);
    const offerBefore = JSON.stringify(P(s, 'p2').offer);
    s = send(s, 'copet', 'p1', 'p2');
    expect(JSON.stringify(P(s, 'p2').pending)).toBe(pendingBefore);
    expect(JSON.stringify(P(s, 'p2').offer)).toBe(offerBefore);
    expect(defsIn(P(s).hand)).toEqual(['teropong']);
  });

  it('same seed and state -> same stolen card; the copet stream belongs to the thief only', () => {
    const make = (): GameState => {
      let s = game(99);
      for (const id of ['teropong', 'jam_pasir', 'zona_lebar', 'ojek_kilat', 'kopi_tubruk']) s = give(s, id, 'p2');
      return send(s, 'copet', 'p1', 'p2');
    };
    expect(JSON.stringify(make())).toBe(JSON.stringify(make()));
    const s = make();
    expect(P(s, 'p2').copetRng).toEqual(P(game(99), 'p2').copetRng);
    expect(P(s, 'p3').copetRng).toEqual(P(game(99), 'p3').copetRng);
    expect(P(s).copetRng).not.toEqual(P(game(99), 'p1').copetRng);
  });

  it('uniform over a 5-card hand (10,000 trials, each card 20% +- 3 points)', () => {
    const counts: Record<string, number> = {};
    const ids = ['teropong', 'jam_pasir', 'zona_lebar', 'ojek_kilat', 'kopi_tubruk'];
    let base = game(1);
    for (const id of ids) base = give(base, id, 'p2');
    base = give(base, 'copet');
    // the stream state is all that changes between trials: swap it in rather than replaying a match
    for (let i = 0; i < 10_000; i++) {
      const s = { ...base, players: base.players.map((p) => (p.id === 'p1' ? { ...p, copetRng: createStream(1000 + i, 'p1', 'copet').getState() } : p)) };
      const r = step(s, playAction(s, 'copet', 'p1', 'p2'));
      const got = P(r.state).hand[0]!.defId;
      counts[got] = (counts[got] ?? 0) + 1;
    }
    for (const id of ids) expect(Math.abs((counts[id] ?? 0) / 100 - 20), id).toBeLessThanOrEqual(3);
  });

  it('the stolen card is chosen from the hand sorted by handSeq, whatever order the array has', () => {
    let s = game(3);
    for (const id of ['teropong', 'jam_pasir', 'zona_lebar']) s = give(s, id, 'p2');
    s = give(s, 'copet');
    const shuffled: GameState = { ...s, players: s.players.map((p) => (p.id === 'p2' ? { ...p, hand: p.hand.slice().reverse() } : p)) };
    const a = step(s, playAction(s, 'copet', 'p1', 'p2')).state;
    const b = step(shuffled, playAction(shuffled, 'copet', 'p1', 'p2')).state;
    expect(P(a).hand[0]!.uid).toBe(P(b).hand[0]!.uid);
  });

  it('the thief\'s hand stays <= 5 even with 5 cards: the Copet leaves the hand first', () => {
    let s = give(game(), 'teropong', 'p2');
    for (let i = 0; i < 4; i++) s = give(s, 'jam_pasir');
    s = give(s, 'copet');
    expect(P(s).hand).toHaveLength(5);
    s = run(s, [playAction(s, 'copet', 'p1', 'p2')]);
    expect(P(s).hand).toHaveLength(5);
    expect(P(s).discard).toBeNull();
    expectZones(s);
  });

  it('a reflected steal onto a victim with a full hand opens the Buang screen (15 s)', () => {
    let s = send(game(), 'cermin_balik', 'p2');
    for (let i = 0; i < 5; i++) s = give(s, 'teropong', 'p2');
    s = give(s, 'jam_pasir');
    s = give(s, 'copet');
    s = run(s, [{ type: 'tick', dtMs: 1000 }, playAction(s, 'copet', 'p1', 'p2')]);
    expect(P(s, 'p2').hand).toHaveLength(6);
    expect(P(s, 'p2').discard).not.toBeNull();
    expect(P(s, 'p2').discard!.expiresAtMs).toBe(s.timeMs + CARD_SCREEN_MS);
  });

  it('a reflected steal onto a player in a minigame is handled when he is back (merged into the win screens)', () => {
    let s = send(game(), 'cermin_balik', 'p2');
    for (let i = 0; i < 5; i++) s = give(s, 'teropong', 'p2');
    s = run(s, [sel('p2', 'medan'), start('p2')]);
    s = give(give(s, 'copet'), 'jam_pasir');
    s = run(s, [playAction(s, 'copet', 'p1', 'p2')]);
    expect(P(s, 'p2').hand).toHaveLength(6);
    expect(P(s, 'p2').discard).toBeNull(); // nothing opens behind his back
    expect(P(s, 'p2').phase).toBe('playing');
    const fail = run(s, [res(false, 'p2')]);
    expect(P(fail, 'p2').discard).not.toBeNull(); // opened as soon as he is back
    expect(P(fail, 'p2').discard!.expiresAtMs).toBe(fail.timeMs + CARD_SCREEN_MS);
    const win = run(s, [res(true, 'p2')]);
    expect(P(win, 'p2').offer).not.toBeNull();
    expect(P(win, 'p2').discard).toBeNull();
    const took = settle(win);
    expect(P(took, 'p2').hand.length).toBe(5);
    expectZones(took);
  });

  it('a Copet on a target in a minigame does not disturb the minigame', () => {
    let s = give(game(), 'teropong', 'p2');
    s = run(s, [sel('p2', 'medan'), start('p2')]);
    const attempt = JSON.stringify(P(s, 'p2').attempt);
    s = send(s, 'copet', 'p1', 'p2');
    expect(JSON.stringify(P(s, 'p2').attempt)).toBe(attempt);
    expect(P(s, 'p2').phase).toBe('playing');
    expect(defsIn(P(s).hand)).toEqual(['teropong']);
  });
});

// ============================================================================================
describe('15. DR-27: Copet and open card screens', () => {
  it('the offer screen: offered cards cannot be stolen; the hand shrinks; overflow is computed at Take time', () => {
    let s = give(give(game(), 'teropong', 'p2'), 'jam_pasir', 'p2');
    s = run(s, [{ type: 'debugForceOffer', playerId: 'p2', cardIds: ['ojek_kilat', 'zona_lebar'], pick: 2 }]);
    const offered = P(s, 'p2').offer!.cards.map((c) => c.uid);
    s = send(s, 'copet', 'p1', 'p2');
    expect(P(s, 'p2').offer!.cards.map((c) => c.uid)).toEqual(offered);
    expect(P(s, 'p2').hand).toHaveLength(1);
    expect(P(s, 'p2').discard).toBeNull();
    const taken = run(s, [auto('p2')]);
    expect(P(taken, 'p2').hand).toHaveLength(3);
  });

  it('the discard screen: needed count is recomputed, marks on stolen cards drop, the screen closes at 0, the timer is not reset', () => {
    let s = game();
    for (let i = 0; i < 6; i++) s = give(s, 'teropong', 'p2');
    expect(P(s, 'p2').discard).not.toBeNull();
    s = give(s, 'copet');
    const expiry = P(s, 'p2').discard!.expiresAtMs;
    s = run(s, [tick(4000), { type: 'markCard', playerId: 'p2', cardUid: P(s, 'p2').hand[0]!.uid }]);
    // steal until the marked card is gone: seed-independent loop over fresh Copet cards
    let guard = 0;
    while (P(s, 'p2').discard && P(s, 'p2').discard!.marked.length > 0 && guard++ < 6) {
      s = give(s, 'copet');
      s = run(s, [playAction(s, 'copet', 'p1', 'p2')]);
    }
    expect(P(s, 'p2').hand).toHaveLength(5); // after the first steal the hand is at 5 and the screen closes
    expect(P(s, 'p2').discard).toBeNull();
    expectZones(s);
    // timer not reset while it stays open: a second case with a hand of 8
    let t = game();
    for (let i = 0; i < 8; i++) t = give(t, 'teropong', 'p2');
    t = give(t, 'copet');
    const e0 = P(t, 'p2').discard!.expiresAtMs;
    t = run(t, [tick(3000), playAction(t, 'copet', 'p1', 'p2')]);
    expect(P(t, 'p2').hand).toHaveLength(7);
    expect(P(t, 'p2').discard!.expiresAtMs).toBe(e0);
    expect(expiry).toBe(CARD_SCREEN_MS);
  });

  it('the discard screen closes by itself when the steal makes it unnecessary, with a discardCancelled event', () => {
    let s = game();
    for (let i = 0; i < 6; i++) s = give(s, 'teropong', 'p2');
    s = give(s, 'copet');
    const r = step(s, playAction(s, 'copet', 'p1', 'p2'));
    expect(P(r.state, 'p2').discard).toBeNull();
    expect(r.events).toContainEqual({ type: 'discardCancelled', playerId: 'p2' });
  });

  it('a marked card that gets stolen loses its mark; the others stay marked', () => {
    let s = game(11);
    for (let i = 0; i < 8; i++) s = give(s, i < 4 ? 'teropong' : 'jam_pasir', 'p2');
    const hand = P(s, 'p2').hand.map((c) => c.uid);
    s = run(s, [{ type: 'markCard', playerId: 'p2', cardUid: hand[0]! }, { type: 'markCard', playerId: 'p2', cardUid: hand[1]! }, { type: 'markCard', playerId: 'p2', cardUid: hand[2]! }]);
    s = give(s, 'copet');
    s = run(s, [playAction(s, 'copet', 'p1', 'p2')]);
    const d = P(s, 'p2').discard!;
    expect(d.marked.every((u) => P(s, 'p2').hand.some((c) => c.uid === u))).toBe(true);
    expect(d.marked.length).toBeLessThanOrEqual(P(s, 'p2').hand.length - 5);
  });
});

// ============================================================================================
describe('16. comeback weights (§3.2)', () => {
  const rows: [number, Record<Rarity, number>, boolean][] = [
    [0, { common: 75, rare: 22, epic: 3 }, false],
    [1, { common: 65, rare: 28, epic: 7 }, false],
    [2, { common: 65, rare: 28, epic: 7 }, false],
    [3, { common: 55, rare: 32, epic: 13 }, true],
    [4, { common: 55, rare: 32, epic: 13 }, true],
    [5, { common: 45, rare: 35, epic: 20 }, true],
    [9, { common: 45, rare: 35, epic: 20 }, true],
  ];
  it('tierWeights returns the table row exactly for gap 0, 1, 2, 3, 4, 5, 9', () => {
    for (const [gap, weights, guarantee] of rows) expect(tierWeights(gap), `gap ${gap}`).toEqual({ weights, guaranteeRarePlus: guarantee });
  });

  it('gap = own remainingWins - min over all players (bots included); leader and ties are 0', () => {
    const mk = (...rw: number[]) => rw.map((remainingWins) => ({ remainingWins }));
    const ps = mk(8, 8, 6, 4);
    expect(ps.map((p) => comebackGap(ps, p))).toEqual([4, 4, 2, 0]);
    expect(mk(5, 5).map((p, _i, a) => comebackGap(a, p))).toEqual([0, 0]);
  });

  it('the gap is measured when the win is recorded, after the pawn moved, over all players', () => {
    // p2 and p3 conquered 3 regions: remainingWins 2 (one region left before the finish). p1 wins the first minigame of its first region.
    let s = game(21);
    const leapfrog = (id: string): void => {
      for (const r of ['medan', 'jakarta', 'toraja']) {
        s = run(s, [sel(id, r), start(id), res(true, id)]);
        s = settle(s);
        s = run(s, [start(id), res(true, id)]);
        s = settle(s);
      }
    };
    leapfrog('p2');
    const rwOther = P(s, 'p2').remainingWins;
    expect(rwOther).toBeLessThan(P(s, 'p1').remainingWins);
    s = run(s, [sel('p1', 'medan'), start('p1')]);
    const rngBefore = P(s).cardsRng;
    s = run(s, [res(true, 'p1')]);
    const gap = P(s).remainingWins - Math.min(...s.players.map((p) => p.remainingWins));
    expect(gap).toBeGreaterThanOrEqual(3);
    // the offer is the §3.1 result with the tier of exactly this gap
    const t = tierWeights(gap);
    const expected = buildOffer(offerPool(), t.weights, Rng.fromState(rngBefore), t.guaranteeRarePlus).map((c) => c.id);
    expect(P(s).offer!.cards.map((c) => c.defId)).toEqual(expected);
    expect(t.guaranteeRarePlus).toBe(true);
  });

  it('rare+ guarantee: 100% of 10,000 offers for gap >= 3 hold a rare or epic card (pool 20)', () => {
    for (const gap of [3, 5]) {
      const t = tierWeights(gap);
      for (let seed = 1; seed <= 10_000; seed++) {
        const o = buildOffer(offerPool(), t.weights, createStream(seed, 'p1', 'cards'), t.guaranteeRarePlus);
        expect(o.some((c) => c.rarity !== 'common'), `gap ${gap} seed ${seed}`).toBe(true);
        expect(o.some((c) => c.type === 'boost') && o.some((c) => c.type === 'sabotage')).toBe(true);
        expect(new Set(o.map((c) => c.id)).size).toBe(5);
      }
    }
  });

  it('mean rare+ per offer rises with the tier; the first slot follows the weights within 4 points', () => {
    const means: number[] = [];
    for (const gap of [0, 1, 3, 5]) {
      const t = tierWeights(gap);
      let rare = 0;
      const slot1: Record<Rarity, number> = { common: 0, rare: 0, epic: 0 };
      const N = 20_000;
      for (let seed = 1; seed <= N; seed++) {
        const o = buildOffer(offerPool(), t.weights, createStream(seed, 'x', 'cards'), t.guaranteeRarePlus);
        rare += o.filter((c) => c.rarity !== 'common').length;
        slot1[o[0]!.rarity]++;
      }
      means.push(rare / N);
      for (const r of ['common', 'rare', 'epic'] as const) expect(Math.abs((slot1[r] / N) * 100 - t.weights[r]), `gap ${gap} ${r}`).toBeLessThanOrEqual(4);
    }
    for (let i = 1; i < means.length; i++) expect(means[i]!).toBeGreaterThan(means[i - 1]!);
  });
});

// ============================================================================================
describe('17. bots', () => {
  const botGame = (seed = 8): GameState => game(seed, ['p1', 'b1', 'b2']);

  it('a bot win gives an offer that resolves at once (no screen, no timer); hand <= 5 forever', () => {
    let s = botGame();
    let wins = 0;
    for (let i = 0; i < 3 && s.status === 'running'; i++) {
      const r = ['medan', 'jakarta', 'toraja'][i] as string;
      s = run(s, [sel('b1', r), start('b1')]);
      const out = step(s, res(true, 'b1'));
      s = out.state;
      expect(out.events.some((e) => e.type === 'cardOffered')).toBe(true);
      expect(out.events.some((e) => e.type === 'cardsPicked' && (e as { auto: boolean }).auto)).toBe(true);
      expect(P(s, 'b1').offer).toBeNull();
      expect(P(s, 'b1').discard).toBeNull();
      expect(P(s, 'b1').hand.length).toBeLessThanOrEqual(5);
      wins++;
      if (P(s, 'b1').targetId) s = run(s, [start('b1'), res(true, 'b1')]);
      expect(P(s, 'b1').hand.length).toBeLessThanOrEqual(5);
    }
    expect(wins).toBeGreaterThan(0);
    expect(P(s, 'b1').hand.length).toBeGreaterThan(0);
    expectZones(s);
  });

  it('bots use the tier weights of their own gap', () => {
    let s = botGame(31);
    s = run(s, [sel('p1', 'medan')]);
    for (const r of ['medan', 'jakarta', 'toraja']) {
      s = run(s, [sel('b2', r), start('b2'), res(true, 'b2'), start('b2'), res(true, 'b2')]);
    }
    s = run(s, [sel('b1', 'medan'), start('b1')]);
    const rngBefore = P(s, 'b1').cardsRng;
    const out = step(s, res(true, 'b1'));
    const rw = P(out.state, 'b1').remainingWins;
    const gap = rw - Math.min(...out.state.players.map((p) => p.remainingWins));
    expect(gap).toBeGreaterThanOrEqual(3);
    const ev = out.events.find((e) => e.type === 'cardOffered') as { cardIds: string[] };
    const t = tierWeights(gap);
    expect(ev.cardIds).toEqual(buildOffer(offerPool(), t.weights, Rng.fromState(rngBefore), t.guaranteeRarePlus).map((c) => c.id));
  });

  it('a bot session never plays a card (CP5), but cards land on it and it can be stolen from', () => {
    const initial = botGame(77);
    const session = new GameSession(map, initial, [new HumanController('p1'), new PlaceholderBotController('b1', 77, 'normal'), new PlaceholderBotController('b2', 77, 'hard')]);
    for (let i = 0; i < 20_000 && session.state.status === 'running'; i++) session.step();
    expect(session.eventLog.some((l) => l.event.type === 'cardPlayed' && l.event.playerId !== 'p1')).toBe(false);
    expect(session.eventLog.some((l) => l.event.type === 'cardOffered' && l.event.playerId.startsWith('b'))).toBe(true);
    for (const b of session.state.players.filter((p) => p.kind === 'bot')) {
      expect(b.hand.length).toBeLessThanOrEqual(5);
      expect(b.offer).toBeNull();
    }
    expectZones(session.state);
  });

  it('sabotage pending on a bot is snapshotted when it starts: difficulty and modifiers', () => {
    let s = send(send(botGame(), 'badai', 'p1', 'b1'), 'kabut_asap', 'p1', 'b1');
    s = run(s, [sel('b1', 'medan'), start('b1')]);
    const a = P(s, 'b1').attempt!;
    expect(a.difficulty).toBe('hard');
    expect(a.modifiers).toContainEqual({ kind: 'fog' });
  });

  it('Macet Total and Pelit Hadiah apply to a bot like to a human', () => {
    let s = send(botGame(), 'macet_total', 'p1', 'b1');
    s = run(s, [sel('b1', 'medan'), start('b1'), res(false, 'b1')]);
    expect(P(s, 'b1').cooldownUntilMs - s.timeMs).toBe(COOLDOWN_MS.medium + 6000);
    let t = send(botGame(), 'pelit_hadiah', 'p1', 'b1');
    const out = step(run(t, [sel('b1', 'medan'), start('b1')]), res(true, 'b1'));
    expect((out.events.find((e) => e.type === 'cardOffered') as { pick: number }).pick).toBe(1);
  });

  it('a bot with cards can be a Copet target; an empty-handed bot cannot', () => {
    let s = give(botGame(), 'copet');
    expect(checkTarget(s, P(s), getCard('copet'), P(s, 'b1')).ok).toBe(false);
    s = give(s, 'teropong', 'b1');
    expect(checkTarget(s, P(s), getCard('copet'), P(s, 'b1')).ok).toBe(true);
    s = run(s, [playAction(s, 'copet', 'p1', 'b1')]);
    expect(defsIn(P(s).hand)).toEqual(['teropong']);
    expect(P(s, 'b1').hand).toHaveLength(0);
  });

  it('debug-granted cards over 5 are dropped at once for a bot (auto-discard rules)', () => {
    let s = botGame();
    for (let i = 0; i < 7; i++) s = give(s, i < 3 ? 'jam_pasir' : 'badai', 'b1');
    expect(P(s, 'b1').hand).toHaveLength(5);
    expect(P(s, 'b1').discard).toBeNull();
    expectZones(s);
  });

  describe('DR-35 pass-chance mapping', () => {
    const base = BOT_PASS_CHANCE.normal.medium; // 0.65
    it('+-8 points per modifier kind after netting, clamped to 5-98%', () => {
      const f = (m: Parameters<typeof botPassChance>[2]) => botPassChance('normal', 'medium', m);
      expect(f([])).toBeCloseTo(base);
      expect(f([{ kind: 'timeDelta', seconds: 5 }])).toBeCloseTo(base + 0.08);
      expect(f([{ kind: 'timeDelta', seconds: -10 }])).toBeCloseTo(base - 0.08); // per kind, not per second
      expect(f([{ kind: 'tolerance', mult: 1.3 }])).toBeCloseTo(base + 0.08);
      expect(f([{ kind: 'hint' }])).toBeCloseTo(base + 0.08);
      expect(f([{ kind: 'speed', mult: 1.25 }])).toBeCloseTo(base - 0.08);
      expect(f([{ kind: 'extraTarget', count: 2 }])).toBeCloseTo(base - 0.08);
      expect(f([{ kind: 'fog' }])).toBeCloseTo(base - 0.08);
      expect(f([{ kind: 'fog' }, { kind: 'speed', mult: 1.25 }, { kind: 'extraTarget', count: 1 }])).toBeCloseTo(base - 0.24);
      expect(botPassChance('easy', 'hard', [{ kind: 'fog' }, { kind: 'speed', mult: 1.25 }, { kind: 'extraTarget', count: 1 }, { kind: 'timeDelta', seconds: -5 }])).toBe(0.05);
      expect(botPassChance('hard', 'easy', [{ kind: 'hint' }, { kind: 'tolerance', mult: 1.3 }, { kind: 'timeDelta', seconds: 5 }])).toBe(0.98);
    });
  });
});

// ============================================================================================
describe('19-20. zones fuzz and replay', () => {
  it('random sabotage, Copet, reflection and card-screen actions keep every instance in exactly one zone', () => {
    const ids = CARDS.map((c) => c.id);
    for (let seed = 1; seed <= 60; seed++) {
      const rng = new Rng(seed * 104729);
      let s = game(seed, ['p1', 'p2', 'b1', 'p3']);
      const pids = s.players.map((p) => p.id);
      const regions = [...map.regions.keys()];
      for (let i = 0; i < 300 && s.status === 'running'; i++) {
        const pid = rng.pick(pids);
        const p = P(s, pid);
        const k = rng.int(0, 13);
        let a: GameAction;
        if (k <= 3 && p.hand.length > 0) {
          const card = rng.pick(p.hand);
          a = { type: 'playCard', playerId: pid, cardUid: card.uid, targetId: rng.pick(pids) };
        } else if (k === 4) a = { type: 'debugGrantCard', playerId: pid, cardId: rng.pick(ids) };
        else if (k === 5) a = sel(pid, rng.pick(regions));
        else if (k === 6) a = start(pid);
        else if (k === 7) a = res(rng.chance(0.6), pid);
        else if (k === 8) a = tick(rng.pick([50, 1000, 5000, 14_999, 15_000, 33_333]));
        else if (k === 9) a = auto(pid);
        else if (k === 10 && (p.offer || p.discard)) {
          const list = p.offer ? p.offer.cards : p.hand;
          a = { type: 'markCard', playerId: pid, cardUid: rng.pick(list).uid };
        } else if (k === 11) a = { type: 'confirmCards', playerId: pid };
        else a = tick(50);
        s = applyAction(map, s, a).state;
        expectZones(s, `seed ${seed} step ${i}`);
        for (const q of s.players) {
          expect(q.offer && q.discard).toBeFalsy();
          expect(sabotageSlotsUsed(q), `${q.id} slots`).toBeLessThanOrEqual(2);
          expect(q.hand.length).toBeLessThanOrEqual(11);
          if (q.discard) expect(q.hand.length).toBeGreaterThan(5);
          if (q.phase === 'playing') expect(q.offer || q.discard).toBeFalsy();
          if (q.kind === 'bot') expect(q.offer || q.discard).toBeFalsy();
          if (q.phase === 'idle' && !q.offer && !q.discard) expect(q.hand.length).toBeLessThanOrEqual(5);
          for (const c of CARDS) {
            if (c.type === 'sabotage' && c.maxStacks !== null && c.duration === 'next_minigame') {
              expect(q.pending.filter((x) => x.defId === c.id).length).toBeLessThanOrEqual(c.maxStacks);
            }
          }
          expect(q.pending.filter((x) => getCard(x.defId).duration === 'next_sabotage').length).toBeLessThanOrEqual(1);
          const seqs = q.hand.map((c) => c.seq);
          expect(new Set(seqs).size).toBe(seqs.length);
        }
      }
    }
  }, 120_000);

  it('match end moves the open offer to discarded: every instance stays in one zone (QA-CP4a-02)', () => {
    let s = game(3, ['p1', 'p2']);
    s = run(s, [sel('p1', 'medan'), start('p1'), res(true, 'p1')]);
    const offered = P(s).offer!.cards.map((c) => c.uid);
    for (const r of ['medan', 'jakarta', 'toraja', 'labuan_bajo']) {
      s = run(s, [sel('p2', r)]);
      for (let w = 0; w < 2 && s.status === 'running'; w++) s = settle(run(s, [start('p2'), res(true, 'p2')]), 'p2');
    }
    expect(s.status).toBe('finished');
    expect(P(s).offer).toBeNull();
    for (const u of offered) expect(P(s).discarded.some((c) => c.uid === u)).toBe(true);
    expectZones(s);
  });

  it('replay(actionLog) of a session with sabotage, Copet and card timeouts equals the live state', () => {
    for (const seed of [4321, 77, 9001]) {
      const mk = () => game(seed, ['p1', 'p2', 'b1']);
      const session = new GameSession(map, mk(), [new HumanController('p1'), new HumanController('p2'), new PlaceholderBotController('b1', seed, 'normal')]);
      const h1 = session.state.players[0]!.id;
      const feed: GameAction[] = [
        { type: 'debugGrantCard', playerId: h1, cardId: 'badai' },
        { type: 'debugGrantCard', playerId: h1, cardId: 'ngebut' },
        { type: 'debugGrantCard', playerId: h1, cardId: 'copet' },
        { type: 'debugGrantCard', playerId: 'p2', cardId: 'cermin_balik' },
        { type: 'debugGrantCard', playerId: 'p2', cardId: 'teropong' },
      ];
      for (const a of feed) session.dispatch(a);
      const st = () => session.state;
      const uid = (pid: string, def: string) => st().players.find((p) => p.id === pid)!.hand.find((c) => c.defId === def)!.uid;
      session.dispatch({ type: 'playCard', playerId: 'p2', cardUid: uid('p2', 'cermin_balik') });
      session.dispatch({ type: 'playCard', playerId: 'p1', cardUid: uid('p1', 'copet'), targetId: 'p2' }); // reflected
      session.dispatch({ type: 'playCard', playerId: 'p1', cardUid: st().players[0]!.hand[0]!.uid, targetId: 'b1' }); // one of the two is left after the reflected steal
      session.dispatch({ type: 'selectTarget', playerId: 'p1', targetId: 'medan' });
      session.dispatch({ type: 'startAttempt', playerId: 'p1' });
      session.dispatch({ type: 'minigameResult', playerId: 'p1', passed: true });
      for (let i = 0; i < 3000; i++) session.step(); // screen times out inside many folded ticks
      session.dispatch({ type: 'debugForceOffer', playerId: 'p2', cardIds: ['jam_pasir', 'badai', 'teropong'], pick: 3 });
      for (let i = 0; i < 4000; i++) session.step();
      expect(session.actionLog.filter((l) => l.action.type === 'tick').length).toBeLessThan(session.actionLog.length);
      const replayed = replay(map, mk(), session.actionLog.map((l) => l.action));
      expect(JSON.stringify(replayed)).toBe(JSON.stringify(session.state));
    }
  });

  it('tick(a + b) equals tick(a); tick(b) for any split, across chained screen timeouts', () => {
    let s = game();
    for (let i = 0; i < 5; i++) s = give(s, 'teropong');
    s = run(s, [{ type: 'debugForceOffer', playerId: 'p1', cardIds: ['jam_pasir', 'santai_dulu', 'ojek_kilat'], pick: 3 }]);
    for (const total of [14_999, 15_000, 15_001, 29_999, 30_000, 45_000, 100_000]) {
      const whole = run(s, [tick(total)]);
      for (const cut of [1, 50, 7_500, 15_000, 20_000]) {
        if (cut >= total) continue;
        expect(JSON.stringify(run(s, [tick(cut), tick(total - cut)])), `${total} cut ${cut}`).toBe(JSON.stringify(whole));
      }
    }
  });
});
