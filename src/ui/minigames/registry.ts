/** Render-side registry; ids must match MINIGAME_LOGIC in src/logic/minigames. */
import { tapTimingDefinition } from './tapTimingView';
import type { MinigameDefinition } from './types';

const DEFINITIONS: readonly MinigameDefinition[] = [tapTimingDefinition];

export function getMinigameDefinition(id: string): MinigameDefinition {
  const def = DEFINITIONS.find((d) => d.id === id);
  if (!def) throw new Error(`no renderer for minigame "${id}"`);
  return def;
}
