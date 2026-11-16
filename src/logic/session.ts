/**
 * GameSession: owns the current state, runs the reducer and notifies subscribers.
 * Rendering and UI subscribe; they never write state directly.
 */
import type { GameAction, GameEvent } from './actions';
import type { PlayerController } from './controllers';
import type { MapGraph } from './map';
import { applyAction } from './reducer';
import type { GameState } from './state';

export type SessionListener = (state: Readonly<GameState>, events: readonly GameEvent[]) => void;

export class GameSession {
  private _state: GameState;
  private readonly listeners = new Set<SessionListener>();

  constructor(
    readonly map: MapGraph,
    initial: GameState,
    private readonly controllers: readonly PlayerController[],
  ) {
    this._state = initial;
  }

  get state(): Readonly<GameState> {
    return this._state;
  }

  subscribe(fn: SessionListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Apply one action and notify listeners. Returns the events it produced. */
  dispatch(action: GameAction): GameEvent[] {
    const { state, events } = applyAction(this.map, this._state, action);
    this._state = state;
    if (events.length > 0) for (const fn of this.listeners) fn(this._state, events);
    return events;
  }

  /** Advance game time and poll every controller once. dtMs is game time in ms. */
  update(dtMs: number): void {
    this.dispatch({ type: 'tick', dtMs });
    for (const c of this.controllers) {
      const action = c.nextAction(this._state, this.map);
      if (action) this.dispatch(action);
    }
  }
}
