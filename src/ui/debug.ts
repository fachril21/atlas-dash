/**
 * QA test hooks (docs/qa/test-plan.md §0), installed only with ?debug=1:
 *   window.__atlasTest = { getState, dispatch, forceMinigameResult, setTimeScale, events, exportLog, ... }
 * plus a small panel with the seed, time scale and an "export log" button.
 */
import type { GameAction, GameEvent, GameSession, GameState, LoggedEvent } from '../logic';

export interface DebugDeps {
  getSession(): GameSession;
  getSeed(): number;
  setTimeScale(x: number): void;
  getTimeScale(): number;
  /** Resolve the human's current attempt (starting one first if allowed). False if impossible. */
  forceMinigameResult(passed: boolean): boolean;
  setPaused(paused: boolean): void;
  extra: Record<string, unknown>;
}

export interface AtlasTestApi {
  getState(): GameState;
  dispatch(action: GameAction): GameEvent[];
  forceMinigameResult(passed: boolean): boolean;
  setTimeScale(x: number): void;
  events(): LoggedEvent[];
  exportLog(): string;
  pause(): void;
  resume(): void;
  seed(): number;
}

declare global {
  interface Window {
    __atlasTest?: AtlasTestApi;
    atlas?: Record<string, unknown>;
  }
}

export function installDebug(deps: DebugDeps): AtlasTestApi {
  const exportLog = (): string => {
    const s = deps.getSession();
    return JSON.stringify({
      format: 'atlas-dash-match-log@1',
      exportedAt: new Date().toISOString(),
      matchSeed: deps.getSeed(),
      mapId: s.state.mapId,
      presetId: s.state.presetId,
      players: s.state.players.map((p) => ({ id: p.id, name: p.name, kind: p.kind, botLevel: p.botLevel ?? null })),
      finalState: s.state,
      actions: s.actionLog,
      events: s.eventLog,
    }, null, 2);
  };

  const api: AtlasTestApi = {
    getState: () => structuredClone(deps.getSession().state) as GameState,
    dispatch: (action) => deps.getSession().dispatch(action),
    forceMinigameResult: (passed) => deps.forceMinigameResult(passed),
    setTimeScale: (x) => { deps.setTimeScale(x); render(); },
    events: () => structuredClone(deps.getSession().eventLog),
    exportLog,
    pause: () => deps.setPaused(true),
    resume: () => deps.setPaused(false),
    seed: () => deps.getSeed(),
  };
  window.__atlasTest = api;
  window.atlas = { ...deps.extra, get session() { return deps.getSession(); } };

  const panel = document.createElement('div');
  panel.className = 'debug-panel';
  panel.dataset.testid = 'debug-panel';
  document.body.appendChild(panel);
  const render = (): void => {
    panel.innerHTML = `<span data-testid="debug-seed">seed ${deps.getSeed()}</span>
      <button data-scale="1">×1</button><button data-scale="10">×10</button>
      <span>now ×${deps.getTimeScale()}</span>
      <button data-testid="btn-export-log">log</button>`;
  };
  panel.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    if (b.dataset.scale) api.setTimeScale(Number(b.dataset.scale));
    else {
      const blob = new Blob([exportLog()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `atlas-log-${deps.getSeed()}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    }
  });
  render();
  setInterval(() => { if (!panel.textContent?.includes(`seed ${deps.getSeed()}`)) render(); }, 1000);
  return api;
}
