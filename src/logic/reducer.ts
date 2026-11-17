/**
 * Pure reducer: (config, state, action) -> (new state, events). Never mutates its input.
 * This is the function an authoritative server will run.
 */
import type { GameAction, GameEvent, RejectReason } from './actions';
import {
  addToHand,
  autoResolve,
  closeCardScreens,
  discardNeeded,
  drawOffer,
  ensureDiscard,
  newInstance,
  openOffer,
  playSabotage,
  resolveDiscard,
  resolveOffer,
  spendSnapshot,
} from './cardflow';
import { getCard, hasCard as hasCardId } from './cards';
import { cardPlayability, cardScreenOpen, resolveAttemptEffects } from './effects';
import { outgoing, regionDifficulty, type MapGraph } from './map';
import { MINIGAME_LOGIC, pickMinigame } from './minigames';
import { pickCount } from './offers';
import { checkTarget, sabotagePlayability } from './sabotage';
import { streamSeed } from './rng';
import {
  COOLDOWN_MS,
  INTRO_MS,
  remainingWinsFor,
  RETRY_INTRO_MS,
  type GameState,
  type PlayerState,
} from './state';

export interface ReduceResult {
  state: GameState;
  events: GameEvent[];
}

function cloneState(s: GameState): GameState {
  return {
    ...s,
    pool: s.pool,
    players: s.players.map((p) => ({
      ...p,
      path: p.path.slice(),
      attempts: { ...p.attempts },
      attempt: p.attempt
        ? { ...p.attempt, modifiers: p.attempt.modifiers.slice(), cardUids: p.attempt.cardUids.slice(), onFail: { ...p.attempt.onFail }, onWin: { ...p.attempt.onWin } }
        : null,
      hand: p.hand.slice(),
      pending: p.pending.slice(),
      discarded: p.discarded.slice(),
      offer: p.offer ? { ...p.offer, cards: p.offer.cards.slice(), marked: p.offer.marked.slice() } : null,
      discard: p.discard ? { ...p.discard, newUids: p.discard.newUids.slice(), marked: p.discard.marked.slice() } : null,
    })),
  };
}

/** Recompute remainingWins; emit progressChanged and stamp the time when it changes. */
function refreshProgress(map: MapGraph, state: GameState, p: PlayerState, events: GameEvent[]): void {
  const rw = p.phase === 'finished' ? 0 : remainingWinsFor(map, p.nodeId, p.targetId, p.winsAtTarget);
  if (rw !== p.remainingWins) {
    p.remainingWins = rw;
    p.remainingWinsSinceMs = state.timeMs;
    events.push({ type: 'progressChanged', playerId: p.id, remainingWins: rw });
  }
}

/** Is this player allowed to press Mulai right now? */
export function canStartAttempt(state: Readonly<GameState>, p: PlayerState): RejectReason | null {
  if (state.status !== 'running') return 'game-over';
  if (p.phase === 'finished') return 'player-finished';
  if (p.phase === 'playing') return 'busy';
  if (cardScreenOpen(p)) return 'cards-open';
  if (!p.targetId) return 'no-target';
  if (state.timeMs < p.cooldownUntilMs) return 'cooldown';
  return null;
}

/** Targets the player may select now (outgoing edges; the finish is never a target). */
export function selectableTargets(map: MapGraph, state: Readonly<GameState>, p: PlayerState): string[] {
  if (state.status !== 'running' || p.phase !== 'idle' || cardScreenOpen(p)) return [];
  return outgoing(map, p.nodeId).filter((id) => id !== map.finishId);
}

export { discardNeeded };

export function applyAction(map: MapGraph, prev: GameState, action: GameAction): ReduceResult {
  const reject = (reason: RejectReason): ReduceResult => ({
    state: prev,
    events: [{ type: 'actionRejected', action, reason }],
  });

  if (action.type === 'tick') {
    if (!Number.isFinite(action.dtMs) || action.dtMs < 0) return reject('bad-tick');
    const state = cloneState(prev);
    const events: GameEvent[] = [];
    const before = state.timeMs;
    const target = before + action.dtMs;
    // QA-CP4a-01: card screens time out at their exact expiresAtMs on the game clock, whatever the
    // tick size (so tick(a + b) == tick(a); tick(b) and an actionLog with folded ticks replays
    // identically). A screen opened by a timeout in this tick starts at that moment.
    if (prev.status === 'running') {
      for (;;) {
        let next: { p: PlayerState; at: number } | null = null;
        for (const p of state.players) {
          const at = (p.offer ?? p.discard)?.expiresAtMs;
          if (at !== undefined && at <= target && (next === null || at < next.at)) next = { p, at };
        }
        if (!next) break;
        state.timeMs = Math.max(state.timeMs, next.at);
        autoResolve(state, next.p, events);
      }
    }
    state.timeMs = target;
    for (const p of state.players) {
      if (p.cooldownUntilMs > before && p.cooldownUntilMs <= target) events.push({ type: 'cooldownEnded', playerId: p.id });
    }
    return { state, events };
  }

  if (prev.status === 'finished') return reject('game-over');
  const idx = prev.players.findIndex((p) => p.id === action.playerId);
  if (idx < 0) return reject('unknown-player');
  const before = prev.players[idx] as PlayerState;
  if (before.phase === 'finished') return reject('player-finished');

  switch (action.type) {
    case 'selectTarget': {
      if (before.phase === 'playing') return reject('busy');
      if (cardScreenOpen(before)) return reject('cards-open');
      if (!map.regions.has(action.targetId)) return reject('unknown-region');
      if (action.targetId === map.finishId) return reject('finish-not-playable');
      if (!outgoing(map, before.nodeId).includes(action.targetId)) return reject('not-adjacent');
      if (before.targetId === action.targetId) return reject('already-target');
      const state = cloneState(prev);
      const p = state.players[idx] as PlayerState;
      const lostWins = p.winsAtTarget;
      const pick = pickMinigame(state.pool, p.pickRng, p.lastMinigameId);
      p.pickRng = pick.rng;
      p.targetId = action.targetId;
      p.winsAtTarget = 0;
      p.nextMinigameId = pick.id;
      p.retry = false;
      // Cooldown is untouched: it belongs to the player (DR-05).
      const events: GameEvent[] = [
        { type: 'targetSelected', playerId: p.id, targetId: action.targetId, minigameId: pick.id, lostWins },
      ];
      refreshProgress(map, state, p, events);
      return { state, events };
    }

    case 'startAttempt': {
      const why = canStartAttempt(prev, before);
      if (why) return reject(why);
      const state = cloneState(prev);
      const p = state.players[idx] as PlayerState;
      const targetId = p.targetId as string;
      const attemptIndex = p.attempts[targetId] ?? 0;
      p.attempts[targetId] = attemptIndex + 1;
      p.phase = 'playing';
      p.cooldownUntilMs = 0;
      // DR-48: every pending next_minigame card is applied to this attempt (snapshot at Mulai).
      const minigameId = p.nextMinigameId as string;
      const baseDifficulty = regionDifficulty(map, targetId);
      // Defence cards (Payung / Cermin) wait in `pending` for a sabotage, not for an attempt.
      const snapshot = p.pending.filter((c) => getCard(c.defId).duration === 'next_minigame');
      const eff = resolveAttemptEffects(
        snapshot.map((c) => getCard(c.defId)),
        baseDifficulty,
        MINIGAME_LOGIC.find((m) => m.id === minigameId)?.baseDurationMs ?? 20_000,
      );
      p.attempt = {
        minigameId,
        targetId,
        baseDifficulty,
        modifiers: eff.modifiers,
        cardUids: snapshot.map((c) => c.uid),
        onFail: eff.onFail,
        onWin: eff.onWin,
        seed: streamSeed(state.matchSeed, p.id, `minigameParams:${targetId}:${attemptIndex}`),
        difficulty: eff.difficulty,
        attemptIndex,
        introMs: p.retry ? RETRY_INTRO_MS : INTRO_MS,
        startedAtMs: state.timeMs,
      };
      return { state, events: [{ type: 'attemptStarted', playerId: p.id, attempt: { ...p.attempt } }] };
    }

    case 'minigameResult': {
      if (before.phase !== 'playing' || !before.attempt) return reject('not-playing');
      const state = cloneState(prev);
      const p = state.players[idx] as PlayerState;
      const attempt = p.attempt as NonNullable<PlayerState['attempt']>;
      const events: GameEvent[] = [];
      p.phase = 'idle';
      p.attempt = null;
      p.lastMinigameId = attempt.minigameId;
      let cooldownMs = 0;
      // Conditional cards are spent either way; only the matching trigger takes effect (§1.1).
      const hadConditional = attempt.cardUids.some((uid) => {
        const c = p.pending.find((x) => x.uid === uid);
        return c ? getCard(c.defId).trigger !== undefined : false;
      });
      const conditionalFired = action.passed
        ? attempt.onWin.pickDelta !== 0 || attempt.onWin.winMultiplier !== 1
        : attempt.onFail.noCooldown || attempt.onFail.cooldownDeltaMs !== 0;
      spendSnapshot(p, attempt.cardUids, hadConditional ? conditionalFired : true, events);

      if (action.passed) {
        p.winsAtTarget = Math.min(map.winsRequired, p.winsAtTarget + Math.round(attempt.onWin.winMultiplier));
        events.push({
          type: 'attemptResolved', playerId: p.id, targetId: attempt.targetId, minigameId: attempt.minigameId,
          passed: true, winsAtTarget: p.winsAtTarget, cooldownMs: 0, timeTakenMs: action.timeTakenMs ?? null,
        });
        if (p.winsAtTarget >= map.winsRequired) {
          const from = p.nodeId;
          const to = attempt.targetId;
          p.nodeId = to;
          p.path.push(to);
          p.targetId = null;
          p.winsAtTarget = 0;
          p.nextMinigameId = null;
          p.retry = false;
          events.push({ type: 'regionConquered', playerId: p.id, from, to });
          if (map.finalRegions.has(to)) {
            // DR-06: the win is this logic event; the walk to the finish is cosmetic.
            p.nodeId = map.finishId;
            p.path.push(map.finishId);
            p.phase = 'finished';
            p.place = 1;
            p.finishedAtMs = state.timeMs;
            state.status = 'finished';
            state.winnerId = p.id;
            closeCardScreens(state); // C-3: no offer after the deciding win
            refreshProgress(map, state, p, events);
            events.push({ type: 'playerFinished', playerId: p.id, regionId: to, place: 1 });
            events.push({ type: 'gameOver', winnerId: p.id });
            return { state, events };
          }
        } else {
          // Win 1 -> 2: re-roll, never the same minigame twice in a row (DR-02).
          const pick = pickMinigame(state.pool, p.pickRng, p.lastMinigameId);
          p.pickRng = pick.rng;
          p.nextMinigameId = pick.id;
          p.retry = false;
        }
        // K1 / C-3: a won attempt that does not decide the match earns an offer. The comeback gap
        // (§3.2) is measured now, after the pawn move of this win.
        refreshProgress(map, state, p, events);
        const cards = drawOffer(state, p);
        openOffer(state, p, cards, pickCount(attempt.difficulty, attempt.onWin.pickDelta, cards.length), events);
      } else {
        // Fail: same minigame, new seed next time, short intro; cooldown by difficulty (R2).
        cooldownMs = attempt.onFail.noCooldown ? 0 : Math.max(0, COOLDOWN_MS[attempt.difficulty] + attempt.onFail.cooldownDeltaMs);
        p.cooldownUntilMs = cooldownMs > 0 ? state.timeMs + cooldownMs : 0;
        p.nextMinigameId = attempt.minigameId;
        p.retry = true;
        events.push({
          type: 'attemptResolved', playerId: p.id, targetId: attempt.targetId, minigameId: attempt.minigameId,
          passed: false, winsAtTarget: p.winsAtTarget, cooldownMs, timeTakenMs: action.timeTakenMs ?? null,
        });
      }
      refreshProgress(map, state, p, events);
      ensureDiscard(state, p, events); // a steal reflected onto this player during the minigame
      return { state, events };
    }
    case 'playCard': {
      const card = before.hand.find((c) => c.uid === action.cardUid);
      if (!card) return reject('no-card');
      if (before.phase === 'playing') return reject('busy');
      if (cardScreenOpen(before)) return reject('cards-open');
      if (!cardPlayability(map, prev, before, card).ok) return reject('card-unplayable');
      const def = getCard(card.defId);
      const events: GameEvent[] = [];

      if (def.type === 'sabotage') {
        // Targets are validated here, on confirm, against the current state (§2.2.1 (c)).
        let targetIds: string[];
        if (def.target === 'all_opponents') {
          const sp = sabotagePlayability(prev, before, def);
          if (!sp.ok) return reject('card-unplayable');
          targetIds = sp.validIds;
        } else {
          const target = prev.players.find((q) => q.id === action.targetId);
          if (!checkTarget(prev, before, def, target).ok) return reject('bad-target');
          targetIds = [(target as PlayerState).id];
        }
        const state = cloneState(prev);
        const p = state.players[idx] as PlayerState;
        playSabotage(state, p, card, def, targetIds, events);
        return { state, events };
      }

      const state = cloneState(prev);
      const p = state.players[idx] as PlayerState;
      p.hand = p.hand.filter((c) => c.uid !== card.uid);
      events.push({ type: 'cardPlayed', playerId: p.id, uid: card.uid, cardId: def.id });
      events.push({ type: 'handChanged', playerId: p.id });
      if (def.duration === 'next_minigame' || def.duration === 'next_sabotage') {
        p.pending.push(card);
        events.push({ type: 'pendingEffectsChanged', playerId: p.id });
      } else {
        p.discarded.push(card);
        for (const o of def.ops) {
          if (o.op === 'cooldownClear') {
            p.cooldownUntilMs = 0;
            events.push({ type: 'cooldownEnded', playerId: p.id });
          } else if (o.op === 'skipRegion') {
            // Tiket Pesawat (DR-31): straight into the chosen target, no minigame, no card.
            const from = p.nodeId;
            const to = p.targetId as string;
            p.nodeId = to;
            p.path.push(to);
            p.targetId = null;
            p.winsAtTarget = 0;
            p.nextMinigameId = null;
            p.retry = false;
            p.cooldownUntilMs = 0;
            events.push({ type: 'regionConquered', playerId: p.id, from, to });
          }
        }
        refreshProgress(map, state, p, events);
      }
      return { state, events };
    }

    case 'markCard': {
      if (!before.offer && !before.discard) return reject('no-cards-screen');
      const state = cloneState(prev);
      const p = state.players[idx] as PlayerState;
      const screen = (p.offer ?? p.discard) as { marked: string[] };
      const valid = p.offer ? p.offer.cards.some((c) => c.uid === action.cardUid) : p.hand.some((c) => c.uid === action.cardUid);
      if (!valid) return reject('bad-selection');
      const limit = p.offer ? p.offer.pick : discardNeeded(p);
      if (screen.marked.includes(action.cardUid)) screen.marked = screen.marked.filter((u) => u !== action.cardUid);
      else if (screen.marked.length < limit) screen.marked.push(action.cardUid);
      else return reject('bad-selection');
      return { state, events: [] };
    }

    case 'confirmCards': {
      if (!before.offer && !before.discard) return reject('no-cards-screen');
      const need = before.offer ? before.offer.pick : discardNeeded(before);
      const marked = (before.offer ?? before.discard)?.marked ?? [];
      if (marked.length !== need) return reject('bad-selection');
      const state = cloneState(prev);
      const p = state.players[idx] as PlayerState;
      const events: GameEvent[] = [];
      if (p.offer) resolveOffer(state, p, marked, false, events);
      else resolveDiscard(p, marked, false, events);
      return { state, events };
    }

    case 'chooseCards': {
      if (!before.offer && !before.discard) return reject('no-cards-screen');
      const need = before.offer ? before.offer.pick : discardNeeded(before);
      const valid = new Set((before.offer ? before.offer.cards : before.hand).map((c) => c.uid));
      const uids = action.cardUids;
      if (uids.length !== need || new Set(uids).size !== uids.length || uids.some((u) => !valid.has(u))) return reject('bad-selection');
      const state = cloneState(prev);
      const p = state.players[idx] as PlayerState;
      const events: GameEvent[] = [];
      if (p.offer) resolveOffer(state, p, uids, false, events);
      else resolveDiscard(p, uids, false, events);
      return { state, events };
    }

    case 'autoCards': {
      if (!before.offer && !before.discard) return reject('no-cards-screen');
      const state = cloneState(prev);
      const events: GameEvent[] = [];
      autoResolve(state, state.players[idx] as PlayerState, events);
      return { state, events };
    }

    case 'debugGrantCard': {
      if (!hasCardId(action.cardId)) return reject('unknown-card');
      const state = cloneState(prev);
      const p = state.players[idx] as PlayerState;
      const events: GameEvent[] = [];
      addToHand(state, p, [newInstance(state, action.cardId)], events);
      return { state, events };
    }

    case 'debugClearHand': {
      const state = cloneState(prev);
      const p = state.players[idx] as PlayerState;
      p.discarded.push(...p.hand);
      p.hand = [];
      p.discard = null;
      return { state, events: [{ type: 'handChanged', playerId: p.id }] };
    }

    case 'debugForceMinigame': {
      // Debug-only, like the other debug* actions: a server must validate it per sender.
      if (before.phase === 'playing') return reject('busy');
      if (!before.targetId) return reject('no-target');
      if (!prev.pool.includes(action.minigameId)) return reject('bad-selection');
      const state = cloneState(prev);
      (state.players[idx] as PlayerState).nextMinigameId = action.minigameId;
      return { state, events: [] };
    }

    case 'debugForceOffer': {
      if (before.phase === 'playing') return reject('busy');
      if (cardScreenOpen(before)) return reject('cards-open');
      if (action.cardIds?.some((id) => !hasCardId(id))) return reject('unknown-card');
      const state = cloneState(prev);
      const p = state.players[idx] as PlayerState;
      const events: GameEvent[] = [];
      const cards = action.cardIds ? action.cardIds.map((id) => newInstance(state, id)) : drawOffer(state, p);
      if (cards.length === 0) return reject('bad-selection');
      openOffer(state, p, cards, action.pick ?? 2, events);
      return { state, events };
    }
  }
}
