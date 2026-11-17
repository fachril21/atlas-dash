/** Render-side registry; ids must match MINIGAME_LOGIC in src/logic/minigames. */
import { dodgeRunnerDefinition } from './dodgeRunnerView';
import { guessDefinition } from './guessView';
import { memoryDefinition } from './memoryView';
import { simonDefinition } from './simonView';
import { slingDefinition } from './slingView';
import { tapTimingDefinition } from './tapTimingView';
import type { MinigameDefinition } from './types';
import { whackDefinition } from './whackView';

const DEFINITIONS: readonly MinigameDefinition[] = [
  tapTimingDefinition,
  simonDefinition,
  dodgeRunnerDefinition,
  whackDefinition,
  slingDefinition,
  memoryDefinition,
  guessDefinition,
];

export function getMinigameDefinition(id: string): MinigameDefinition {
  const def = DEFINITIONS.find((d) => d.id === id);
  if (!def) throw new Error(`no renderer for minigame "${id}"`);
  return def;
}
