/**
 * Pure half of the minigame interface (minigames.md §1.2). Everything here runs in Vitest
 * without DOM or three.js. The render half (`create`) lives in src/ui/minigames/ and is
 * combined with this into a full MinigameDefinition there.
 */
import type { Difficulty, MapData } from '../map';

export type MinigameModifier =
  | { kind: 'timeDelta'; seconds: number }
  | { kind: 'tolerance'; mult: number }
  | { kind: 'speed'; mult: number }
  | { kind: 'extraTarget'; count: number }
  | { kind: 'fog' }
  | { kind: 'hint' };

export interface MinigameSettings {
  reducedMotion: boolean;
  reducedFlash: boolean;
  sfxVolume: number;
}

export interface MinigameContext {
  /** uint32 from the "minigameParams:<targetId>:<attemptIndex>" stream. */
  seed: number;
  /** Effective difficulty (after cards). */
  difficulty: Difficulty;
  modifiers: MinigameModifier[];
  map: MapData;
  regionId: string;
  inputMode: 'touch' | 'mouse';
  settings: MinigameSettings;
}

export interface MinigameResult {
  passed: boolean;
  /** From end of intro to finish, pause excluded. */
  timeTakenMs: number;
  /** 0..1 progress towards the pass condition. */
  progress: number;
  reason: 'success' | 'timeout' | 'failLimit' | 'aborted';
}

export interface MinigameLogic<Level = unknown, Input = unknown, State = unknown> {
  id: string;
  render: '2d' | '3d';
  /** String key of the ≤ 8-word rule sentence. */
  introKey: string;
  /** Base duration before timeDelta; used by the race layer (clamp) and bot simulation. */
  baseDurationMs: number;
  requires?: (map: MapData) => boolean;
  generateLevel(ctx: MinigameContext): Level;
  initState(level: Level): State;
  /** Advance rules to play time tMs, applying `input` (if any) at tMs. Never mutates `state`. */
  step(level: Level, state: State, input: Input | null, tMs: number): State;
  /** null = still running. */
  result(level: Level, state: State): MinigameResult | null;
}
