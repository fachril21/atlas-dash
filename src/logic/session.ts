/**
 * GameSession: owns the current state, runs the reducer, keeps the match log and notifies
 * subscribers. Rendering and UI subscribe; they never write state directly.
 */
import type { GameAction, GameEvent } from './actions';
import type { BotActivity, PlayerController } from './controllers';
import type { MapGraph } from './map';
import { applyAction } from './reducer';
import type { GameState } from './state';

export type SessionListener = (state: Readonly<GameState>, events: readonly GameEvent[]) => void;

export interface LoggedEvent {
  timeMs: number;
  event: GameEvent;
}
export interface LoggedAction {
  timeMs: number;
  action: GameAction;
}

/** Fixed logic step (20 Hz), same as a future server tick. */
export const LOGIC_STEP_MS = 50;

export class GameSession {
  private _state: GameState;
  private readonly listeners = new Set<SessionListener>();
  private _paused = false;
  /** True when the last step() applied a non-tick action (headless skip-ahead polls again next step). */
  private actedLastStep = false;
  /** Every applied action except ticks, plus tick totals folded in, for replay. */
  readonly actionLog: LoggedAction[] = [];
  readonly eventLog: LoggedEvent[] = [];

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

  get paused(): boolean {
    return this._paused;
  }

  /** Solo pause: freezes the whole logic clock (cooldowns, bots, attempts). */
  setPaused(paused: boolean): void {
    this._paused = paused;
  }

  /** What a waiting bot is doing ("thinking" / "braking"), for the HUD; null for humans and idle bots. */
  activityOf(playerId: string): BotActivity | null {
    return this.controllers.find((c) => c.playerId === playerId)?.activity?.() ?? null;
  }

  subscribe(fn: SessionListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Apply one action and notify listeners. Returns the events it produced. */
  dispatch(action: GameAction): GameEvent[] {
    const { state, events } = applyAction(this.map, this._state, action);
    const accepted = !(events.length === 1 && events[0]?.type === 'actionRejected');
    if (accepted) this.logAction(action);
    this._state = state;
    for (const e of events) this.eventLog.push({ timeMs: state.timeMs, event: e });
    if (events.length > 0) for (const fn of this.listeners) fn(this._state, events);
    return events;
  }

  /** One fixed logic step: advance time, then poll every controller once. */
  step(dtMs: number = LOGIC_STEP_MS): void {
    if (this._paused) return;
    this.dispatch({ type: 'tick', dtMs });
    this.actedLastStep = false;
    for (const c of this.controllers) {
      const action = c.nextAction(this._state, this.map);
      if (action) {
        this.actedLastStep = true;
        this.dispatch(action);
      }
    }
  }

  /**
   * Headless skip-ahead (simulator): advance to the next step at which some controller wants a
   * poll, in whole LOGIC_STEP_MS multiples, never more than `maxDtMs`. Same results as calling
   * step() every 50 ms (tested), because controllers report a lower bound of their next useful
   * poll and every applied action forces a poll at the very next step.
   */
  stepToNextWake(maxDtMs = 60_000): void {
    if (this._paused) return;
    const now = this._state.timeMs;
    let wake = this.actedLastStep ? now : Infinity;
    for (const c of this.controllers) wake = Math.min(wake, c.wakeAtMs ? c.wakeAtMs(this._state, this.map) : now);
    const steps = Number.isFinite(wake) ? Math.ceil((wake - now) / LOGIC_STEP_MS) : Math.floor(maxDtMs / LOGIC_STEP_MS);
    const cap = Math.max(1, Math.floor(maxDtMs / LOGIC_STEP_MS));
    this.step(Math.min(cap, Math.max(1, steps)) * LOGIC_STEP_MS);
  }

  private logAction(action: GameAction): void {
    const last = this.actionLog[this.actionLog.length - 1];
    if (action.type === 'tick' && last?.action.type === 'tick') {
      last.action = { type: 'tick', dtMs: last.action.dtMs + action.dtMs };
      return;
    }
    this.actionLog.push({ timeMs: this._state.timeMs, action });
  }
}

/** Re-run a logged action list from an initial state (deterministic replay). */
export function replay(map: MapGraph, initial: GameState, actions: readonly GameAction[]): GameState {
  let s = initial;
  for (const a of actions) s = applyAction(map, s, a).state;
  return s;
}
