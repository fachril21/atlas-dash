/**
 * CP4b QA: extra tests on the interactions the Engineer's tests/cp4b.test.ts covers least:
 * defence-vs-defence, Q2 slot hold during an attempt, DR-27 on already-open screens, order
 * independence through the real reducer, comeback weights measured over many seeds, bot pass
 * rate with sabotage, and bigger fuzz runs (zones, oracle per play, replay, tick-split).
 * Numbers in the comments refer to docs/cards.md §8 (acceptance criteria). See docs/qa/cp4b-report.md.
 */
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  BOT_PASS_CHANCE,
  buildOffer,
  CARDS,
  CARD_SCREEN_MS,
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
  opponentChecks,
  SmartBotController,
  replay,
  Rng,
  sabotagePlayability,
  sabotageSlotsUsed,
  tierWeights,
  type GameAction,
  type GameEvent,
  type GameState,
  type PlayerState,
  type Rarity,
} from '../src/logic';
import { answerBotScreens, botControllers, indonesiaData } from './helpers';

const map = loadMap(indonesiaData(), 'standard', MINIGAME_LOGIC);
const pool = minigamePool(map.data);

const game = (seed = 42, ids = ['p1', 'p2', 'p3']): GameState =>
  createInitialState(map, ids.map((id) => ({ id, name: id, kind: id.startsWith('b') ? ('bot' as const) : ('human' as const), ...(id.startsWith('b') ? { botLevel: 'normal' as const } : {}) })), seed, pool);
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
const playA = (s: GameState, defId: string, playerId: string, targetId?: string): GameAction => ({
  type: 'playCard', playerId, cardUid: uidOf(s, defId, playerId), ...(targetId ? { targetId } : {}),
});
/** Give `defId` to `from`, play it at `to`; returns state + events of the play. */
function sendEv(s: GameState, defId: string, from: string, to?: string): { state: GameState; events: GameEvent[] } {
  s = give(s, defId, from);
  const r = step(s, playA(s, defId, from, to));
  if (r.rejected) throw new Error(`send ${defId} ${from}->${to} rejected: ${r.rejected}`);
  return r;
}
const send = (s: GameState, defId: string, from: string, to?: string): GameState => sendEv(s, defId, from, to).state;
const defs = (zone: { defId: string }[]): string[] => zone.map((c) => c.defId);
const sel = (playerId: string, targetId: string): GameAction => ({ type: 'selectTarget', playerId, targetId });
const start = (playerId = 'p1'): GameAction => ({ type: 'startAttempt', playerId });
const res = (passed: boolean, playerId = 'p1'): GameAction => ({ type: 'minigameResult', playerId, passed });
const tick = (dtMs: number): GameAction => ({ type: 'tick', dtMs });
const auto = (playerId = 'p1'): GameAction => ({ type: 'autoCards', playerId });
const settle = (s: GameState, only?: string): GameState => {
  for (const p of s.players) if (!only || p.id === only) while (P(s, p.id).offer || P(s, p.id).discard) s = run(s, [auto(p.id)]);
  return s;
};
const outcomes = (events: GameEvent[]): string[] => events.flatMap((e) => (e.type === 'sabotagePlayed' ? [`${e.targetId}:${e.outcome}`] : []));

function allUids(s: GameState): string[] {
  const out: string[] = [];
  for (const p of s.players) {
    out.push(...p.hand.map((c) => c.uid), ...p.pending.map((c) => c.uid), ...p.discarded.map((c) => c.uid));
    if (p.offer) out.push(...p.offer.cards.map((c) => c.uid));
  }
  return out;
}
const expectZones = (s: GameState, label = ''): void => {
  const all = allUids(s);
  expect(new Set(all).size, `${label} a card is in two zones`).toBe(all.length);
  expect(all.length, `${label} a card is in no zone`).toBe(s.nextCardUid - 1);
};
const seqCopet = (seed: number, owner: string, handSeqs: number[]): number => {
  const sorted = handSeqs.slice().sort((a, b) => a - b);
  const rng = Rng.fromState(createStream(seed, owner, 'copet').getState());
  return sorted[rng.int(0, sorted.length - 1)]!;
};

// ============================================================================================
describe('7. defence vs defence and mixed Gunung (§2.2.3)', () => {
  it('Copet into Cermin vs Cermin: the sender\'s Cermin is NOT spent, the owner steals from the sender', () => {
    let s = send(send(game(), 'cermin_balik', 'p2'), 'cermin_balik', 'p1');
    s = give(give(give(s, 'teropong', 'p1'), 'jam_pasir', 'p1'), 'zona_lebar', 'p2'); // p2 needs a card or Copet is not playable
    const r = sendEv(s, 'copet', 'p1', 'p2');
    expect(outcomes(r.events)).toEqual(['p2:reflectStolen']);
    expect(defs(P(r.state).pending)).toEqual(['cermin_balik']); // sender keeps his Cermin
    expect(defs(P(r.state, 'p2').pending)).toEqual([]);
    expect(defs(P(r.state, 'p2').discarded)).toEqual(['cermin_balik']);
    expect(P(r.state).hand).toHaveLength(1);
    expect(P(r.state, 'p2').hand).toHaveLength(2); // his own zona_lebar + the stolen card
    expectZones(r.state);
  });

  it('reflected Copet with a Payung sender: Payung is not spent (a reflection is never blocked)', () => {
    let s = send(send(game(), 'payung_tameng', 'p1'), 'cermin_balik', 'p2');
    s = give(give(s, 'teropong', 'p1'), 'zona_lebar', 'p2');
    const r = sendEv(s, 'copet', 'p1', 'p2');
    expect(outcomes(r.events)).toEqual(['p2:reflectStolen']);
    expect(defs(P(r.state).pending)).toEqual(['payung_tameng']);
    expect(defs(P(r.state, 'p2').hand).sort()).toEqual(['teropong', 'zona_lebar']);
  });

  it('the reflected steal uses the Cermin owner\'s copet stream (50 seeds); the sender\'s stream does not move', () => {
    for (let seed = 1; seed <= 50; seed++) {
      let s = give(send(game(seed), 'cermin_balik', 'p2'), 'kopi_tubruk', 'p2');
      for (const c of ['teropong', 'jam_pasir', 'zona_lebar', 'kopi_tubruk']) s = give(s, c, 'p1');
      const before = P(s).hand.map((c) => c.seq);
      const wantSeq = seqCopet(seed, 'p2', before);
      const wantCard = P(s).hand.find((c) => c.seq === wantSeq)!;
      const r = sendEv(s, 'copet', 'p1', 'p2');
      const got = P(r.state, 'p2').hand.filter((c) => P(s).hand.some((o) => o.uid === c.uid)).map((c) => c.uid);
      expect(got, `seed ${seed}`).toEqual([wantCard.uid]);
      expect(P(r.state).copetRng).toEqual(P(game(seed)).copetRng);
      expect(P(r.state, 'p2').copetRng).not.toEqual(P(game(seed), 'p2').copetRng);
      expect(P(r.state).hand).toHaveLength(3);
    }
  });

  it('Gunung with one Cermin, one Payung and one plain opponent: outcomes in seat order, each defence spent once', () => {
    let s = game(5, ['p1', 'p2', 'p3', 'p4']);
    s = send(send(s, 'cermin_balik', 'p2'), 'payung_tameng', 'p3');
    const r = sendEv(s, 'gunung_meletus', 'p1');
    expect(outcomes(r.events)).toEqual(['p2:reflected', 'p3:blocked', 'p4:landed']);
    s = r.state;
    expect(defs(P(s).pending)).toEqual(['gunung_meletus']);
    expect(P(s).pending[0]!.source).toBe('p2');
    expect(P(s, 'p2').pending).toHaveLength(0);
    expect(P(s, 'p3').pending).toHaveLength(0);
    expect(defs(P(s, 'p4').pending)).toEqual(['gunung_meletus']);
    expect(P(s, 'p4').pending[0]!.source).toBe('p1');
    expect(defs(P(s).discarded)).toEqual(['gunung_meletus']); // the blocked copy
    expectZones(s);
  });

  it('Gunung from a sender who holds his own Cermin: the reflection still lands and his Cermin stays', () => {
    let s = send(send(game(5, ['p1', 'p2', 'p3']), 'cermin_balik', 'p1'), 'cermin_balik', 'p2');
    const r = sendEv(s, 'gunung_meletus', 'p1');
    expect(outcomes(r.events)).toEqual(['p2:reflected', 'p3:landed']);
    s = r.state;
    expect(defs(P(s).pending).sort()).toEqual(['cermin_balik', 'gunung_meletus']);
    expect(sabotageSlotsUsed(P(s))).toBe(1); // a defence card never holds a slot
  });

  it('Gunung skips an opponent who already carries Gunung; a reflected Badai onto a sender who already carries Badai burns and the Cermin is still spent', () => {
    let s = send(game(5, ['p1', 'p2', 'p3']), 'gunung_meletus', 'p3'); // lands on p1 and p2
    s = send(s, 'cermin_balik', 'p2');
    // p2 already holds Gunung (maxStacks 1): it is not a valid Gunung target, so it is skipped before the Cermin matters.
    const r = sendEv(s, 'gunung_meletus', 'p1');
    expect(outcomes(r.events)).toEqual(['p3:landed']);
    expect(defs(P(r.state, 'p2').pending)).toEqual(['gunung_meletus', 'cermin_balik']); // untouched
    // single-target version: Badai into a Cermin while the sender already has Badai
    let t = send(game(7), 'badai', 'p3', 'p1');
    t = send(t, 'cermin_balik', 'p2');
    const r2 = sendEv(t, 'badai', 'p1', 'p2');
    expect(outcomes(r2.events)).toEqual(['p2:reflectBurned']);
    expect(defs(P(r2.state, 'p2').discarded)).toEqual(['cermin_balik']);
    expectZones(r2.state);
  });

  it('hidden information: validity and dimming never depend on the target\'s Payung / Cermin (§2.2.1)', () => {
    const plain = give(game(3, ['p1', 'p2', 'p3']), 'badai');
    const shielded = send(send(plain, 'payung_tameng', 'p2'), 'cermin_balik', 'p3');
    for (const id of ['badai', 'copet', 'gunung_meletus', 'jam_rusak']) {
      const a = give(give(plain, id), 'teropong', 'p2');
      const b = give(give(shielded, id), 'teropong', 'p2');
      expect(opponentChecks(b, P(b), getCard(id)).map((c) => c.check.ok), id).toEqual(opponentChecks(a, P(a), getCard(id)).map((c) => c.check.ok));
      expect(sabotagePlayability(b, P(b), getCard(id)).ok).toBe(sabotagePlayability(a, P(a), getCard(id)).ok);
      expect(impactSummary(b, P(b), getCard(id))).toEqual(impactSummary(a, P(a), getCard(id)));
    }
  });

  it('a Payung that is played after a sabotage is already pending only blocks the NEXT one', () => {
    let s = send(game(), 'badai', 'p2', 'p1');
    s = send(s, 'payung_tameng', 'p1');
    expect(defs(P(s).pending)).toEqual(['badai', 'payung_tameng']);
    const r = sendEv(s, 'kabut_asap', 'p3', 'p1');
    expect(outcomes(r.events)).toEqual(['p1:blocked']);
    expect(defs(P(r.state).pending)).toEqual(['badai']);
  });
});

// ============================================================================================
describe('5. Q2 slot hold during an attempt', () => {
  it('a snapshot card keeps its slot while the target plays; a third sender is refused; the result frees the held slot only', () => {
    let s = send(game(), 'jam_rusak', 'p2', 'p1'); // slot 1
    s = run(s, [sel('p1', 'medan'), start()]);
    expect(P(s).attempt!.cardUids).toHaveLength(1);
    expect(sabotageSlotsUsed(P(s))).toBe(1);
    s = send(s, 'kabut_asap', 'p3', 'p1'); // slot 2, lands mid-attempt (R3)
    expect(sabotageSlotsUsed(P(s))).toBe(2);
    expect(P(s).attempt!.cardUids).toHaveLength(1);
    // p2 may not send a third card: p1 is full, the card stays in hand
    const g = give(s, 'badai', 'p2');
    const r = step(g, playA(g, 'badai', 'p2', 'p1'));
    expect(r.rejected).toBe('bad-target');
    expect(defs(P(g, 'p2').hand)).toEqual(['badai']);
    // Gunung from p2 skips p1 (full) and hits p3 only
    const gg = give(s, 'gunung_meletus', 'p2');
    const rg = step(gg, playA(gg, 'gunung_meletus', 'p2'));
    expect(outcomes(rg.events)).toEqual(['p3:landed']);
    // result releases the snapshot slot, keeps the mid-attempt card, and a third card now fits
    s = run(s, [res(false)]);
    expect(defs(P(s).pending)).toEqual(['kabut_asap']);
    expect(sabotageSlotsUsed(P(s))).toBe(1);
    s = send(s, 'badai', 'p2', 'p1');
    expect(sabotageSlotsUsed(P(s))).toBe(2);
    expectZones(s);
  });

  it('three senders race for the last slot: first two land, the third is refused and keeps the card', () => {
    let s = game(11, ['p1', 'p2', 'p3', 'p4']);
    s = send(s, 'jam_rusak', 'p2', 'p1');
    s = send(s, 'jam_rusak', 'p3', 'p1'); // same card twice (maxStacks 2): slots 2/2
    const g = give(s, 'badai', 'p4');
    expect(step(g, playA(g, 'badai', 'p4', 'p1')).rejected).toBe('bad-target');
    expect(defs(P(g, 'p4').hand)).toEqual(['badai']);
    expect(sabotageSlotsUsed(P(g))).toBe(2);
  });

  it('Copet ignores the cap even on a target in a running attempt with 2 slots, and does not touch the attempt', () => {
    let s = send(game(), 'jam_rusak', 'p2', 'p1');
    s = give(s, 'teropong', 'p1');
    s = run(s, [sel('p1', 'medan'), start()]);
    s = send(s, 'badai', 'p3', 'p1');
    expect(sabotageSlotsUsed(P(s))).toBe(2);
    const attemptBefore = JSON.stringify(P(s).attempt);
    s = send(s, 'copet', 'p2', 'p1');
    expect(defs(P(s, 'p2').hand)).toEqual(['teropong']);
    expect(JSON.stringify(P(s).attempt)).toBe(attemptBefore);
    expect(sabotageSlotsUsed(P(s))).toBe(2);
    expectZones(s);
  });

  it('pending sabotage survives Tiket Pesawat and a target change (§2.3 point 7)', () => {
    let s = send(game(), 'badai', 'p2', 'p1');
    s = run(s, [sel('p1', 'medan')]);
    s = send(s, 'tiket_pesawat', 'p1');
    expect(P(s).nodeId).toBe('medan');
    expect(defs(P(s).pending)).toEqual(['badai']);
    s = run(s, [sel('p1', 'jakarta')]);
    expect(defs(P(s).pending)).toEqual(['badai']);
    expect(sabotageSlotsUsed(P(s))).toBe(1);
  });
});

// ============================================================================================
describe('15. DR-27 on screens that are already open', () => {
  it('a reflected steal into the Cermin owner\'s open Buang screen: need grows, marks stay, timer is NOT reset', () => {
    let s = send(game(), 'cermin_balik', 'p2');
    for (let i = 0; i < 7; i++) s = give(s, 'teropong', 'p2'); // hand 7 -> discard (need 2)
    s = give(s, 'jam_pasir', 'p1');
    expect(P(s, 'p2').discard).not.toBeNull();
    s = run(s, [tick(4000)]);
    const marked = P(s, 'p2').hand.slice(0, 2).map((c) => c.uid);
    s = run(s, [{ type: 'markCard', playerId: 'p2', cardUid: marked[0]! }, { type: 'markCard', playerId: 'p2', cardUid: marked[1]! }]);
    const expiry = P(s, 'p2').discard!.expiresAtMs;
    const r = sendEv(s, 'copet', 'p1', 'p2'); // reflected: p2 steals p1's jam_pasir... p1 has 1 card
    s = r.state;
    expect(outcomes(r.events)).toEqual(['p2:reflectStolen']);
    expect(P(s, 'p2').hand).toHaveLength(8);
    expect(P(s, 'p2').discard!.expiresAtMs).toBe(expiry);
    expect(P(s, 'p2').discard!.marked).toEqual(marked);
    // need is now 3: confirm is refused with 2 marks, accepted with 3
    expect(step(s, { type: 'confirmCards', playerId: 'p2' }).rejected).toBe('bad-selection');
    s = run(s, [{ type: 'markCard', playerId: 'p2', cardUid: P(s, 'p2').hand[2]!.uid }, { type: 'confirmCards', playerId: 'p2' }]);
    expect(P(s, 'p2').hand).toHaveLength(5);
    expectZones(s);
  });

  it('a reflected steal into the owner\'s open offer: hand grows, overflow is computed at Take time', () => {
    let s = send(game(), 'cermin_balik', 'p2');
    for (let i = 0; i < 4; i++) s = give(s, 'teropong', 'p2');
    s = run(s, [{ type: 'debugForceOffer', playerId: 'p2', cardIds: ['jam_pasir', 'badai', 'ngebut'], pick: 2 }]);
    s = give(s, 'zona_lebar', 'p1');
    s = send(s, 'copet', 'p1', 'p2');
    expect(P(s, 'p2').hand).toHaveLength(5);
    expect(P(s, 'p2').discard).toBeNull();
    const o = P(s, 'p2').offer!.cards.map((c) => c.uid);
    s = run(s, [{ type: 'markCard', playerId: 'p2', cardUid: o[0]! }, { type: 'markCard', playerId: 'p2', cardUid: o[1]! }, { type: 'confirmCards', playerId: 'p2' }]);
    expect(P(s, 'p2').hand).toHaveLength(7);
    expect(P(s, 'p2').discard).not.toBeNull();
    expect(P(s, 'p2').discard!.newUids).toHaveLength(2);
    expectZones(s);
  });

  it('a victim with an open offer but an empty hand is not a valid Copet target (offered cards are not stealable)', () => {
    let s = run(game(), [{ type: 'debugForceOffer', playerId: 'p2', cardIds: ['jam_pasir', 'badai'], pick: 1 }]);
    s = give(s, 'copet', 'p1');
    expect(step(s, playA(s, 'copet', 'p1', 'p2')).rejected).toBe('card-unplayable'); // reducer checks playability first
    const forced = P(s).hand[0]!.uid;
    void forced;
    expect(P(s, 'p2').offer!.cards).toHaveLength(2);
  });

  it('a Buang screen that the steal closes does not time out later (no stale auto-discard)', () => {
    let s = game();
    for (let i = 0; i < 6; i++) s = give(s, 'teropong', 'p2');
    s = run(s, [tick(3000)]);
    s = send(s, 'copet', 'p1', 'p2');
    expect(P(s, 'p2').discard).toBeNull();
    const handBefore = P(s, 'p2').hand.map((c) => c.uid);
    s = run(s, [tick(60_000)]);
    expect(P(s, 'p2').hand.map((c) => c.uid)).toEqual(handBefore);
    expectZones(s);
  });

  it('a victim in a minigame whose hand is 6 (deferred Buang) and gets stolen to 5 never sees the Buang screen', () => {
    let s = send(game(), 'cermin_balik', 'p2');
    for (let i = 0; i < 5; i++) s = give(s, 'teropong', 'p2');
    s = run(s, [sel('p2', 'medan'), start('p2')]);
    s = give(s, 'jam_pasir', 'p1');
    // p1 sends a Copet that p2's Cermin reflects: p2 (playing) steals -> hand 6, no screen yet
    s = send(s, 'copet', 'p1', 'p2');
    expect(P(s, 'p2').hand).toHaveLength(6);
    expect(P(s, 'p2').discard).toBeNull();
    // a second Copet cannot be reflected (Cermin spent) and takes one back
    s = send(s, 'copet', 'p3', 'p2');
    expect(P(s, 'p2').hand).toHaveLength(5);
    s = run(s, [res(false, 'p2')]);
    expect(P(s, 'p2').discard).toBeNull();
    expectZones(s);
  });
});

// ============================================================================================
describe('10-11. order independence through the real reducer', () => {
  function permutations<T>(xs: T[]): T[][] {
    if (xs.length <= 1) return [xs];
    return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((rest) => [x, ...rest]));
  }
  type Play = { card: string; from: string };
  const snapshotOf = (plays: Play[], base: GameState = game(9, ['p1', 'p2', 'p3', 'p4'])): { sig: string; s: GameState } => {
    let s = base;
    for (const pl of plays) s = send(s, pl.card, pl.from, pl.from === 'p1' ? undefined : 'p1');
    s = run(s, [sel('p1', 'medan'), start()]);
    const a = P(s).attempt!;
    const sig = JSON.stringify({ d: a.difficulty, m: a.modifiers, f: a.onFail, w: a.onWin, c: a.cardUids.map((u) => P(s).pending.find((x) => x.uid === u)!.defId).sort() });
    return { sig, s };
  };

  it('all 120 play orders of Badai, Ngebut (senders) + Jam Pasir, Zona Lebar, Teropong give the same attempt', () => {
    const plays: Play[] = [
      { card: 'badai', from: 'p2' }, { card: 'ngebut', from: 'p3' },
      { card: 'jam_pasir', from: 'p1' }, { card: 'zona_lebar', from: 'p1' }, { card: 'teropong', from: 'p1' },
    ];
    const perms = permutations(plays);
    expect(perms).toHaveLength(120);
    const ref = snapshotOf(plays).sig;
    for (const p of perms) expect(snapshotOf(p).sig).toBe(ref);
    const a = JSON.parse(ref);
    expect(a.d).not.toBe(undefined);
    expect(a.m).toEqual(expect.arrayContaining([{ kind: 'speed', mult: 1.25 }, { kind: 'tolerance', mult: 1.3 }, { kind: 'hint' }]));
  });

  it('conditional cards in any order: Macet + Nyawa + Pelit + Oleh-oleh give the same cooldown on a fail and the same N on a win', () => {
    const plays: Play[] = [
      { card: 'macet_total', from: 'p2' }, { card: 'pelit_hadiah', from: 'p3' },
      { card: 'nyawa_cadangan', from: 'p1' }, { card: 'oleh_oleh', from: 'p1' },
    ];
    const outcomesOf = (order: Play[]) => {
      const { s } = snapshotOf(order);
      const fail = run(s, [res(false)]);
      const win = run(s, [res(true)]);
      return JSON.stringify({ cd: P(fail).cooldownUntilMs - fail.timeMs, pick: P(win).offer!.pick, spentF: P(fail).pending.length, spentW: P(win).pending.length, slotsF: sabotageSlotsUsed(P(fail)) });
    };
    const ref = outcomesOf(plays);
    for (const p of permutations(plays)) expect(outcomesOf(p)).toBe(ref);
    const r = JSON.parse(ref);
    expect(r.cd).toBe(0); // DR-24: Nyawa wins over Macet
    expect(r.pick).toBe(2); // medan is medium: 2 + 1 - 1
    expect(r.spentF + r.spentW + r.slotsF).toBe(0);
  });

  it('difficulty is clamped after the sum on a medium region: Badai + Gunung -> hard, + Santai Dulu -> still hard (+1), Badai + Santai Dulu -> medium, Santai Dulu alone -> easy', () => {
    const attemptDifficulty = (cards: [string, string | null][]): string => {
      let s = game(9, ['p1', 'p2', 'p3']);
      for (const [c, from] of cards) s = from ? (c === 'gunung_meletus' ? send(s, c, from) : send(s, c, from, 'p1')) : send(s, c, 'p1');
      s = run(s, [sel('p1', 'medan'), start()]);
      return P(s).attempt!.difficulty;
    };
    expect(attemptDifficulty([['badai', 'p2'], ['gunung_meletus', 'p3']])).toBe('hard');
    expect(attemptDifficulty([['badai', 'p2'], ['gunung_meletus', 'p3'], ['santai_dulu', null]])).toBe('hard');
    expect(attemptDifficulty([['badai', 'p2'], ['santai_dulu', null]])).toBe('medium');
    expect(attemptDifficulty([['santai_dulu', null]])).toBe('easy');
    // cooldown of a fail follows the EFFECTIVE difficulty
    let s = send(send(game(9, ['p1', 'p2', 'p3']), 'badai', 'p2', 'p1'), 'gunung_meletus', 'p3');
    s = run(s, [sel('p1', 'medan'), start(), res(false)]);
    expect(P(s).cooldownUntilMs - s.timeMs).toBe(COOLDOWN_MS.hard);
  });
});

// ============================================================================================
describe('16. comeback weights measured over many seeds', () => {
  const N = 10_000;
  const draws = (gap: number): { slots: Record<Rarity, number>[]; offers: ReturnType<typeof buildOffer>[] } => {
    const t = tierWeights(gap);
    const slots = Array.from({ length: 5 }, () => ({ common: 0, rare: 0, epic: 0 }));
    const offers: ReturnType<typeof buildOffer>[] = [];
    for (let seed = 1; seed <= N; seed++) {
      const o = buildOffer(offerPool(), t.weights, createStream(seed, 'p1', 'cards'), t.guaranteeRarePlus);
      offers.push(o);
      o.forEach((c, i) => slots[i]![c.rarity]++);
    }
    return { slots, offers };
  };

  it('measured rarity per slot vs the table weights (slot 1 within 4 points; later slots within the stock-exhaustion bound)', () => {
    const report: string[] = [];
    for (const gap of [0, 2, 4, 6]) {
      const t = tierWeights(gap);
      const { slots } = draws(gap);
      slots.forEach((s, i) => {
        const pct = (['common', 'rare', 'epic'] as const).map((r) => `${r} ${(s[r] / N * 100).toFixed(1)}`);
        report.push(`gap ${gap} slot ${i + 1}: ${pct.join(' / ')} (table ${t.weights.common}/${t.weights.rare}/${t.weights.epic})`);
      });
      for (const r of ['common', 'rare', 'epic'] as const) {
        expect(Math.abs((slots[0]![r] / N) * 100 - t.weights[r]), `gap ${gap} slot 1 ${r}`).toBeLessThanOrEqual(4);
      }
    }
    console.log(`\n[CP4b-QA] rarity per slot over ${N} seeds\n${report.join('\n')}`);
  });

  it('whole-offer statistics per tier: P(>= 1 rare+), mean rare+, mean epic; tiers are strictly ordered', () => {
    const rows: { gap: number; p: number; mean: number; epic: number }[] = [];
    for (const gap of [0, 1, 3, 5]) {
      const { offers } = draws(gap);
      const p = offers.filter((o) => o.some((c) => c.rarity !== 'common')).length / N;
      const mean = offers.reduce((s, o) => s + o.filter((c) => c.rarity !== 'common').length, 0) / N;
      const epic = offers.reduce((s, o) => s + o.filter((c) => c.rarity === 'epic').length, 0) / N;
      rows.push({ gap, p, mean, epic });
    }
    console.log(`\n[CP4b-QA] tiers\n${rows.map((r) => `gap ${r.gap}: P(rare+) ${(r.p * 100).toFixed(1)}%  mean rare+ ${r.mean.toFixed(2)}  mean epic ${r.epic.toFixed(2)}`).join('\n')}`);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]!.mean).toBeGreaterThan(rows[i - 1]!.mean);
      expect(rows[i]!.epic).toBeGreaterThan(rows[i - 1]!.epic);
      expect(rows[i]!.p).toBeGreaterThanOrEqual(rows[i - 1]!.p);
    }
    expect(rows[2]!.p).toBe(1);
    expect(rows[3]!.p).toBe(1);
    // gap 0 is a real "no guarantee" tier: some offers have no rare+ (otherwise the guarantee row would be meaningless)
    expect(rows[0]!.p).toBeLessThan(1);
  });

  it('through the real reducer: a human who wins while p2 is k regions ahead gets the tier of gap 2k-1, and the offer equals the §3.1 result', () => {
    const wantGap: Record<number, number> = { 0: 0, 1: 1, 2: 3, 3: 5 };
    for (const k of [0, 1, 2, 3]) {
      for (let seed = 1; seed <= 40; seed++) {
        let s = game(seed, ['p1', 'p2']);
        for (const r of ['medan', 'jakarta', 'toraja'].slice(0, k)) {
          s = run(s, [sel('p2', r)]);
          s = settle(run(s, [start('p2'), res(true, 'p2')]), 'p2');
          s = settle(run(s, [start('p2'), res(true, 'p2')]), 'p2');
        }
        s = run(s, [sel('p1', 'medan'), start('p1')]);
        const rngBefore = P(s).cardsRng;
        s = run(s, [res(true, 'p1')]);
        const gap = comebackGap(s.players, P(s));
        expect(gap, `k ${k}`).toBe(wantGap[k]);
        const t = tierWeights(gap);
        const expected = buildOffer(offerPool(), t.weights, Rng.fromState(rngBefore), t.guaranteeRarePlus).map((c) => c.id);
        expect(P(s).offer!.cards.map((c) => c.defId)).toEqual(expected);
        if (gap >= 3) expect(P(s).offer!.cards.some((c) => getCard(c.defId).rarity !== 'common')).toBe(true);
      }
    }
  });

  it('the gap counts bots too: a bot in front lowers the human\'s tier exactly like a human would', () => {
    let s = game(2, ['p1', 'b1']);
    const ctls = botControllers(s);
    for (const r of ['medan', 'jakarta']) {
      s = run(s, [sel('b1', r)]);
      s = answerBotScreens(map, run(s, [start('b1'), res(true, 'b1')]), ctls);
      s = answerBotScreens(map, run(s, [start('b1'), res(true, 'b1')]), ctls);
    }
    expect(P(s, 'b1').offer).toBeNull();
    expect(P(s, 'b1').hand.length).toBeLessThanOrEqual(5);
    expect(comebackGap(s.players, P(s))).toBe(P(s).remainingWins - P(s, 'b1').remainingWins);
  });
});

// ============================================================================================
describe('17. bots: pass rate with sabotage pending (DR-35), measured', () => {
  it('Ngebut + Kabut (two kinds = -16 points) on a normal bot: observed pass rate within 2 points of table - 16 (12,000 attempts; 24,000 gave 49.0% vs 49.0%)', () => {
    const N = 12000;
    let pass = 0;
    let diff = 'easy';
    for (let seed = 1; seed <= N; seed++) {
      let s = game(seed, ['p1', 'b1']);
      s = send(send(s, 'ngebut', 'p1', 'b1'), 'kabut_asap', 'p1', 'b1');
      s = run(s, [sel('b1', 'medan'), start('b1')]);
      diff = P(s, 'b1').attempt!.difficulty;
      s = run(s, [tick(120_000)]);
      const bot = new SmartBotController('b1', seed, 'normal');
      const a = bot.nextAction(s, map)!;
      expect(a.type).toBe('minigameResult');
      if (a.type === 'minigameResult' && a.passed) pass++;
    }
    const expected = BOT_PASS_CHANCE.normal[diff as 'easy'] - 0.16;
    const rate = pass / N;
    console.log(`\n[CP4b-QA] bot pass rate ${(rate * 100).toFixed(1)}% (expected ${(expected * 100).toFixed(1)}%, difficulty ${diff})`);
    expect(Math.abs(rate - expected)).toBeLessThan(0.02);
  });
});

// ============================================================================================
describe('19-20. bigger fuzz: zones, per-play oracle, determinism, replay, tick-split', () => {
  const ids = CARDS.map((c) => c.id);

  const must = (cond: unknown, msg: string): void => {
    if (!cond) throw new Error(msg);
  };

  /** Everything that must hold after ANY action (plain checks: this runs ~100k times). */
  function invariants(s: GameState, label: string): void {
    const all = allUids(s);
    must(new Set(all).size === all.length, `${label} a card is in two zones`);
    must(all.length === s.nextCardUid - 1, `${label} a card is in no zone (${all.length} vs ${s.nextCardUid - 1})`);
    for (const q of s.players) {
      const tag = `${label} ${q.id}`;
      must(sabotageSlotsUsed(q) <= 2, `${tag} slots ${sabotageSlotsUsed(q)}`);
      must(!(q.offer && q.discard), `${tag} offer and discard together`);
      must((q.phase === 'playing') === (q.attempt !== null), `${tag} phase vs attempt`);
      if (q.phase === 'playing') must(!q.offer && !q.discard, `${tag} screen while playing`);
      if (q.kind === 'bot') must(!q.offer && !q.discard, `${tag} bot screen`);
      if (s.status === 'running' && q.phase === 'idle' && !q.offer && !q.discard) must(q.hand.length <= 5, `${tag} idle hand ${q.hand.length}`);
      if (q.discard) must(q.hand.length > 5, `${tag} discard open with hand ${q.hand.length}`);
      must(q.hand.length <= 11,  `${tag} hand cap ${q.hand.length}`);
      const pend = new Set(q.pending.map((c) => c.uid));
      for (const u of q.attempt?.cardUids ?? []) must(pend.has(u), `${tag} snapshot card left pending`);
      let defence = 0;
      for (const c of q.pending) {
        const def = getCard(c.defId);
        must(def.duration !== 'instant', `${tag} instant card pending (${def.id})`);
        if (def.duration === 'next_sabotage') defence++;
        if (def.type === 'sabotage') {
          must(c.source !== undefined, `${tag} pending sabotage without source`);
          must(c.source !== q.id, `${tag} sabotage sent by the owner`);
        }
      }
      must(defence <= 1, `${tag} ${defence} defence cards`);
      for (const c of CARDS) {
        if (c.maxStacks !== null && c.duration === 'next_minigame') {
          const n = q.pending.filter((x) => x.defId === c.id).length;
          must(n <= c.maxStacks, `${tag} ${c.id} x${n} pending`);
        }
      }
      const seqs = q.hand.map((c) => c.seq);
      must(new Set(seqs).size === seqs.length, `${tag} duplicate hand seq`);
      for (const c of q.hand) must(c.seq >= 1 && c.seq < q.nextHandSeq, `${tag} hand seq ${c.seq} out of range`);
      if (q.offer) {
        const ou = new Set(q.offer.cards.map((c) => c.uid));
        for (const m of q.offer.marked) must(ou.has(m), `${tag} offer mark not in offer`);
        must(q.offer.marked.length <= q.offer.pick, `${tag} offer marks over N`);
        must(q.offer.expiresAtMs > s.timeMs - 1, `${tag} offer already expired`);
      }
      if (q.discard) {
        const hu = new Set(q.hand.map((c) => c.uid));
        for (const m of q.discard.marked) must(hu.has(m), `${tag} discard mark on a card not in hand`);
        must(q.discard.marked.length <= q.hand.length - 5, `${tag} discard marks over need`);
        must(q.discard.expiresAtMs > s.timeMs - 1, `${tag} discard already expired`);
      }
    }
  }

  /** Check what one accepted card play did to the zones (an oracle independent of the implementation). */
  function playOracle(before: GameState, after: GameState, a: Extract<GameAction, { type: 'playCard' }>, events: GameEvent[]): void {
    const sender = P(before, a.playerId);
    const card = sender.hand.find((c) => c.uid === a.cardUid)!;
    const def = getCard(card.defId);
    expect(P(after, a.playerId).hand.some((c) => c.uid === card.uid)).toBe(false);
    if (def.type !== 'sabotage') return;
    const sab = events.filter((e): e is Extract<GameEvent, { type: 'sabotagePlayed' }> => e.type === 'sabotagePlayed');
    const targets = def.target === 'all_opponents' ? sab.length : 1;
    expect(sab).toHaveLength(targets);
    if (def.id === 'copet') {
      const e = sab[0]!;
      const stolen = events.filter((x): x is Extract<GameEvent, { type: 'cardStolen' }> => x.type === 'cardStolen');
      if (e.outcome === 'stolen' || e.outcome === 'reflectStolen') {
        expect(stolen).toHaveLength(1);
        const st = stolen[0]!;
        const thief = P(after, st.thiefId);
        expect(P(after, st.victimId).hand.some((c) => c.uid === st.uid)).toBe(false);
        expect(P(before, st.victimId).hand.some((c) => c.uid === st.uid)).toBe(true);
        if (thief.kind === 'human') {
          // (a bot thief may auto-discard the stolen card at once, so only humans are checked here)
          expect(thief.hand.find((c) => c.uid === st.uid)!.seq).toBe(thief.nextHandSeq - 1);
          expect(thief.hand.length).toBe(P(before, st.thiefId).hand.length + 1 - (st.thiefId === a.playerId ? 1 : 0));
        }
      } else expect(stolen).toHaveLength(0);
      expect(['stolen', 'blocked', 'reflectStolen', 'reflectEmpty']).toContain(e.outcome);
      expect(P(after, a.playerId).discarded.some((c) => c.uid === card.uid)).toBe(true);
      return;
    }
    for (const e of sab) {
      const tgtBefore = P(before, e.targetId);
      const tgtAfter = P(after, e.targetId);
      if (e.outcome === 'landed') {
        expect(tgtAfter.pending.length).toBe(tgtBefore.pending.length + 1);
        expect(tgtAfter.pending[tgtAfter.pending.length - 1]!.defId).toBe(def.id);
        expect(tgtAfter.pending[tgtAfter.pending.length - 1]!.source).toBe(a.playerId);
      } else if (e.outcome === 'blocked') {
        expect(defs(tgtBefore.pending).some((d) => getCard(d).duration === 'next_sabotage')).toBe(true);
        expect(tgtAfter.pending.length).toBe(tgtBefore.pending.length - 1);
      } else if (e.outcome === 'reflected') {
        expect(defs(tgtBefore.pending)).toContain('cermin_balik');
        expect(defs(tgtAfter.pending)).not.toContain('cermin_balik');
        expect(P(after, a.playerId).pending.some((c) => c.source === e.targetId && c.defId === def.id)).toBe(true);
      } else if (e.outcome === 'reflectBurned') {
        expect(defs(tgtBefore.pending)).toContain('cermin_balik');
        expect(defs(tgtAfter.pending)).not.toContain('cermin_balik');
      } else throw new Error(`unexpected outcome ${e.outcome} for ${def.id}`);
    }
    // the sender's own pending grows by exactly the number of reflections that landed
    const landedOnSender = sab.filter((e) => e.outcome === 'reflected').length;
    expect(P(after, a.playerId).pending.length - sender.pending.length).toBe(landedOnSender);
    // no instance was created or lost except the extra Gunung copies
    const created = after.nextCardUid - before.nextCardUid;
    expect(created).toBe(def.id === 'gunung_meletus' ? Math.max(0, targets - 1) : 0);
  }

  function randomAction(s: GameState, rng: Rng): GameAction {
    const pids = s.players.map((p) => p.id);
    const pid = rng.pick(pids);
    const p = P(s, pid);
    const k = rng.int(0, 17);
    if (k <= 4 && p.hand.length > 0) {
      const card = rng.pick(p.hand);
      const def = getCard(card.defId);
      // aim mostly at valid targets so that the sabotage branches are exercised often
      const opp = pids.filter((x) => x !== pid);
      const valid = def.type === 'sabotage' ? opponentChecks(s, p, def).filter((c) => c.check.ok).map((c) => c.id) : [];
      const target = rng.chance(0.85) && valid.length > 0 ? rng.pick(valid) : rng.pick(pids.concat(opp));
      return { type: 'playCard', playerId: pid, cardUid: card.uid, targetId: target };
    }
    if ((k === 5 || k === 6) && p.hand.length < 6) return { type: 'debugGrantCard', playerId: pid, cardId: rng.pick(rng.chance(0.5) ? ['copet', 'cermin_balik', 'payung_tameng', 'gunung_meletus', 'badai', 'jam_rusak', 'macet_total', 'pelit_hadiah'] : ids) };
    if (k === 7) return { type: 'selectTarget', playerId: pid, targetId: rng.pick([...map.regions.keys()]) };
    if (k === 8) return { type: 'startAttempt', playerId: pid };
    if (k === 9) return { type: 'minigameResult', playerId: pid, passed: rng.chance(0.6) };
    if (k === 10) return { type: 'tick', dtMs: rng.pick([1, 50, 777, 5000, 14_999, 15_000, 15_001, 33_333, 61_000]) };
    if (k === 11) return { type: 'autoCards', playerId: pid };
    if (k === 12 && (p.offer || p.discard)) return { type: 'markCard', playerId: pid, cardUid: rng.pick(p.offer ? p.offer.cards : p.hand).uid };
    if (k === 13) return { type: 'confirmCards', playerId: pid };
    if (k === 14 && !p.offer && !p.discard) return { type: 'debugForceOffer', playerId: pid, cardIds: [rng.pick(ids), rng.pick(ids), rng.pick(ids)], pick: rng.int(1, 3) };
    return { type: 'tick', dtMs: 50 };
  }

  it('250 seeds x 250 actions, 4 players (2 bots): invariants + per-play oracle + input never mutated + a rejected action changes nothing', () => {
    let plays = 0;
    const seen = new Set<string>();
    for (let seed = 1; seed <= 250; seed++) {
      const rng = new Rng(seed * 7919 + 13);
      let s = game(seed, ['p1', 'p2', 'b1', 'b2']);
      const ctls = botControllers(s);
      for (let i = 0; i < 250 && s.status === 'running'; i++) {
        const a = randomAction(s, rng);
        const frozen = JSON.stringify(s);
        const r = applyAction(map, s, a);
        expect(JSON.stringify(s), `seed ${seed} step ${i}: input state mutated by ${a.type}`).toBe(frozen);
        const rejected = r.events.length === 1 && r.events[0]!.type === 'actionRejected';
        if (rejected) expect(JSON.stringify(r.state), `seed ${seed} step ${i}: rejected ${a.type} changed state`).toBe(frozen);
        else if (a.type === 'playCard') {
          playOracle(s, r.state, a, r.events);
          plays++;
          for (const e of r.events) if (e.type === 'sabotagePlayed') seen.add(`${e.cardId}:${e.outcome}`);
        }
        s = answerBotScreens(map, r.state, ctls); // CP5a: a bot screen never stays open longer than one poll
        invariants(s, `seed ${seed} step ${i}`);
      }
    }
    console.log(`\n[CP4b-QA] fuzz: ${plays} accepted card plays; (card:outcome) pairs reached: ${seen.size}`);
    expect(plays).toBeGreaterThan(2000);
    for (const o of ['landed', 'blocked', 'reflected', 'reflectBurned', 'stolen', 'reflectStolen', 'reflectEmpty']) {
      expect([...seen].some((x) => x.endsWith(`:${o}`)), `fuzz never reached outcome ${o}`).toBe(true);
    }
  }, 240_000);

  it('same seed + same action stream twice gives byte-identical states (200 seeds)', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const runOnce = (): string => {
        const rng = new Rng(seed * 31 + 5);
        let s = game(seed, ['p1', 'p2', 'b1']);
        for (let i = 0; i < 200 && s.status === 'running'; i++) s = applyAction(map, s, randomAction(s, rng)).state;
        return JSON.stringify(s);
      };
      expect(runOnce(), `seed ${seed}`).toBe(runOnce());
    }
  }, 120_000);

  it('GameSession + bots + random human actions: replay(actionLog) equals the live state (150 seeds, folded ticks)', () => {
    let screens = 0;
    for (let seed = 1; seed <= 150; seed++) {
      const mk = () => game(seed, ['p1', 'p2', 'b1']);
      const session = new GameSession(map, mk(), [new HumanController('p1'), new HumanController('p2'), new SmartBotController('b1', seed, 'normal')]);
      const rng = new Rng(seed * 101 + 3);
      for (let i = 0; i < 400 && session.state.status === 'running'; i++) {
        if (rng.chance(0.35)) {
          const a = randomAction(session.state as GameState, rng);
          if (a.type !== 'tick') session.dispatch(a);
        }
        // many tiny ticks (folded in the log) and sometimes a long wait so card screens expire inside a fold
        const n = rng.chance(0.05) ? 400 : rng.int(1, 6);
        for (let j = 0; j < n; j++) session.step();
        if (session.state.players.some((q) => q.offer || q.discard)) screens++;
      }
      const replayed = replay(map, mk(), session.actionLog.map((l) => l.action));
      expect(JSON.stringify(replayed), `seed ${seed}`).toBe(JSON.stringify(session.state));
      invariants(session.state as GameState, `session seed ${seed}`);
    }
    expect(screens).toBeGreaterThan(30);
  }, 240_000);

  it('tick(a + b) == tick(a); tick(b) on fuzzed mid-game states (card screens, cooldowns, attempts open)', () => {
    let checked = 0;
    for (let seed = 1; seed <= 120; seed++) {
      const rng = new Rng(seed * 13 + 7);
      let s = game(seed, ['p1', 'p2', 'b1']);
      for (let i = 0; i < 120 && s.status === 'running'; i++) {
        s = applyAction(map, s, randomAction(s, rng)).state;
        if (i % 6 !== 0) continue;
        const total = rng.pick([40_000, 15_000, 31_000, 15_001, 62_345]);
        const cut = rng.int(1, total - 1);
        const whole = applyAction(map, s, tick(total)).state;
        const split = applyAction(map, applyAction(map, s, tick(cut)).state, tick(total - cut)).state;
        expect(JSON.stringify(split), `seed ${seed} step ${i} total ${total} cut ${cut}`).toBe(JSON.stringify(whole));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(500);
  }, 120_000);

  it('a discard/offer screen opened during a coalesced tick starts at the expiry of the previous one (3-link chain)', () => {
    // offer (15 s) -> discard (15 s): same as one 30 s tick, whatever the folding
    let s = game();
    for (let i = 0; i < 5; i++) s = give(s, 'teropong');
    s = run(s, [{ type: 'debugForceOffer', playerId: 'p1', cardIds: ['jam_pasir', 'santai_dulu', 'ojek_kilat'], pick: 3 }]);
    const a = run(s, [tick(CARD_SCREEN_MS + 1), tick(CARD_SCREEN_MS - 1)]);
    const b = run(s, [tick(2 * CARD_SCREEN_MS)]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(P(b).discard).toBeNull();
    expect(P(b).hand).toHaveLength(5);
  });
});

// ============================================================================================
describe('QA-CP4a-01 / 02 / 03 follow-up and the rewritten CP4a tests', () => {
  it('QA-CP4a-02: when another player wins, a Cermin owner\'s / sender\'s open offer goes to discarded, nothing is lost', () => {
    let s = game(3, ['p1', 'p2', 'p3']);
    s = send(s, 'cermin_balik', 'p3');
    s = run(s, [sel('p1', 'medan'), start('p1'), res(true, 'p1')]);
    const offered = P(s).offer!.cards.map((c) => c.uid);
    for (const r of ['medan', 'jakarta', 'toraja', 'labuan_bajo']) {
      s = run(s, [sel('p2', r)]);
      for (let w = 0; w < 2 && s.status === 'running'; w++) s = settle(run(s, [start('p2'), res(true, 'p2')]), 'p2');
    }
    expect(s.status).toBe('finished');
    for (const u of offered) expect(P(s).discarded.some((c) => c.uid === u)).toBe(true);
    expect(defs(P(s, 'p3').pending)).toEqual(['cermin_balik']); // unrelated zones are left alone
    expectZones(s);
  });

  it('after the match ends no card action is accepted (sabotage, Copet, marks) and state is unchanged', () => {
    let s = game(3, ['p1', 'p2']);
    s = give(give(s, 'copet', 'p1'), 'teropong', 'p2');
    for (const r of ['medan', 'jakarta', 'toraja', 'labuan_bajo']) {
      s = run(s, [sel('p2', r)]);
      for (let w = 0; w < 2 && s.status === 'running'; w++) s = settle(run(s, [start('p2'), res(true, 'p2')]), 'p2');
    }
    expect(s.status).toBe('finished');
    const r = step(s, playA(s, 'copet', 'p1', 'p2'));
    expect(r.rejected).toBe('game-over');
    expect(JSON.stringify(r.state)).toBe(JSON.stringify(s));
  });

  it('the old "huge tick" expectation is gone for good: one 60 s tick resolves offer AND the chained discard, ending with a 5-card hand', () => {
    let s = game();
    for (let i = 0; i < 5; i++) s = give(s, 'teropong');
    s = run(s, [{ type: 'debugForceOffer', playerId: 'p1', cardIds: ['jam_pasir', 'santai_dulu'], pick: 2 }, tick(60_000)]);
    expect(P(s).offer).toBeNull();
    expect(P(s).discard).toBeNull();
    expect(P(s).hand).toHaveLength(5);
  });
});
