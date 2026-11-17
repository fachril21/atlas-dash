/**
 * Full minigame definition = pure logic half (src/logic/minigames) + render half (create).
 * Matches minigames.md §1.2, with one addition: MinigameInstance.advance(dtMs). The host
 * drives play time from the game loop so pause and the debug time scale apply to
 * minigames exactly like to the rest of the match.
 */
import type { MinigameContext, MinigameLogic, MinigameResult } from '../../logic';

export interface MinigameInstance {
  /** Called by the shell after the intro. */
  start(): void;
  /** Advance play time by dtMs (game time; 0 while paused). */
  advance(dtMs: number): void;
  pause(): void;
  resume(): void;
  /** Remove listeners and DOM; must be safe to call more than once. */
  destroy(): void;
  /** Called exactly once. */
  onFinish(cb: (r: MinigameResult) => void): void;
  /** QA hooks (CP5b views): feed a logic input at the current play time / read level + state. */
  injectInput?(input: unknown): void;
  snapshot?(): { playT: number; state: unknown; level: unknown; finished: boolean };
  gpuStats?(): { geometries: number; textures: number; calls: number };
}

export interface MinigameDefinition<Level = any> extends MinigameLogic<Level, any, any> {
  /** HTML of the intro animation icon (decorative). */
  introIconHtml: string;
  create(container: HTMLElement, ctx: MinigameContext, level: Level): MinigameInstance;
}
