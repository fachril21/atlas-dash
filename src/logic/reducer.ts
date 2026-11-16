/**
 * Pure reducer: (map, state, action) -> (new state, events). Never mutates its input.
 * This is the function an authoritative server will run.
 */
import type { GameAction, GameEvent } from './actions';
import { nodeDifficulty, type MapGraph } from './map';
import { validateMove } from './movement';
import { COOLDOWN_MS, type GameState, type PlayerState } from './state';

export interface ReduceResult {
  state: GameState;
  events: GameEvent[];
}

function cloneState(s: GameState): GameState {
  return {
    ...s,
    players: s.players.map((p) => ({ ...p, path: p.path.slice() })),
  };
}

export function applyAction(map: MapGraph, prev: GameState, action: GameAction): ReduceResult {
  const reject = (reason: Extract<GameEvent, { type: 'actionRejected' }>['reason']): ReduceResult => ({
    state: prev,
    events: [{ type: 'actionRejected', action, reason }],
  });

  if (action.type === 'tick') {
    if (!(action.dtMs >= 0) || !Number.isFinite(action.dtMs)) return reject('bad-tick');
    const state = cloneState(prev);
    const events: GameEvent[] = [];
    state.timeMs += action.dtMs;
    for (const p of state.players) {
      if (p.phase === 'cooldown' && state.timeMs >= p.cooldownUntilMs) {
        p.phase = 'challenge';
        events.push({ type: 'cooldownEnded', playerId: p.id, nodeId: p.nodeId });
      }
    }
    return { state, events };
  }

  if (prev.status === 'finished') return reject('game-over');
  const idx = prev.players.findIndex((p) => p.id === action.playerId);
  if (idx < 0) return reject('unknown-player');

  switch (action.type) {
    case 'move': {
      const check = validateMove(map, prev.players[idx] as PlayerState, action.toNodeId);
      if (!check.ok) return reject(check.reason);
      const state = cloneState(prev);
      const p = state.players[idx] as PlayerState;
      const from = p.nodeId;
      p.nodeId = action.toNodeId;
      p.path.push(action.toNodeId);
      const events: GameEvent[] = [{ type: 'playerMoved', playerId: p.id, from, to: p.nodeId }];

      if (map.finish.has(p.nodeId)) {
        // R1: first player to reach a finish region wins.
        const place = state.players.filter((q) => q.phase === 'finished').length + 1;
        p.phase = 'finished';
        p.place = place;
        p.finishedAtMs = state.timeMs;
        events.push({ type: 'playerFinished', playerId: p.id, nodeId: p.nodeId, place });
        if (place === 1) {
          state.status = 'finished';
          state.winnerId = p.id;
          events.push({ type: 'gameOver', winnerId: p.id });
        }
      } else {
        p.phase = 'challenge';
        events.push({
          type: 'challengeStarted',
          playerId: p.id,
          nodeId: p.nodeId,
          difficulty: nodeDifficulty(map, p.nodeId),
        });
      }
      return { state, events };
    }

    case 'challengeResult': {
      if ((prev.players[idx] as PlayerState).phase !== 'challenge') return reject('not-in-challenge');
      const state = cloneState(prev);
      const p = state.players[idx] as PlayerState;
      let cooldownMs = 0;
      if (action.success) {
        p.phase = 'ready';
      } else {
        // R2: cooldown scales inversely with difficulty.
        cooldownMs = COOLDOWN_MS[nodeDifficulty(map, p.nodeId)];
        p.phase = 'cooldown';
        p.cooldownUntilMs = state.timeMs + cooldownMs;
      }
      return {
        state,
        events: [{ type: 'challengeResolved', playerId: p.id, nodeId: p.nodeId, success: action.success, cooldownMs }],
      };
    }
  }
}
