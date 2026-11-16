/**
 * Pure reducer: (config, state, action) -> (new state, events). Never mutates its input.
 * This is the function an authoritative server will run.
 */
import type { GameAction, GameEvent, RejectReason } from './actions';
import { outgoing, regionDifficulty, type MapGraph } from './map';
import { pickMinigame } from './minigames';
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
      attempt: p.attempt ? { ...p.attempt } : null,
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
  if (!p.targetId) return 'no-target';
  if (state.timeMs < p.cooldownUntilMs) return 'cooldown';
  return null;
}

/** Targets the player may select now (outgoing edges; the finish is never a target). */
export function selectableTargets(map: MapGraph, state: Readonly<GameState>, p: PlayerState): string[] {
  if (state.status !== 'running' || p.phase !== 'idle') return [];
  return outgoing(map, p.nodeId).filter((id) => id !== map.finishId);
}

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
    state.timeMs += action.dtMs;
    for (const p of state.players) {
      if (p.cooldownUntilMs > before && p.cooldownUntilMs <= state.timeMs) {
        events.push({ type: 'cooldownEnded', playerId: p.id });
      }
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
      p.attempt = {
        minigameId: p.nextMinigameId as string,
        targetId,
        seed: streamSeed(state.matchSeed, p.id, `minigameParams:${targetId}:${attemptIndex}`),
        difficulty: regionDifficulty(map, targetId),
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

      if (action.passed) {
        p.winsAtTarget += 1;
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
      } else {
        // Fail: same minigame, new seed next time, short intro; cooldown by difficulty (R2).
        cooldownMs = COOLDOWN_MS[attempt.difficulty];
        p.cooldownUntilMs = state.timeMs + cooldownMs;
        p.nextMinigameId = attempt.minigameId;
        p.retry = true;
        events.push({
          type: 'attemptResolved', playerId: p.id, targetId: attempt.targetId, minigameId: attempt.minigameId,
          passed: false, winsAtTarget: p.winsAtTarget, cooldownMs, timeTakenMs: action.timeTakenMs ?? null,
        });
      }
      refreshProgress(map, state, p, events);
      return { state, events };
    }
  }
}
