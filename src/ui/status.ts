/** Player status icon/text shared by the progress rows and the target picker (ui-flow §3, §7). */
import { cooldownRemainingMs, type BotActivity, type GameState, type PlayerState } from '../logic';
import { t } from './strings';

/** A bot that waits on purpose shows as "thinking", never as frozen (CP5a, DR-33 friendly: no hidden info). */
export function statusIcon(state: Readonly<GameState>, p: PlayerState, activity: BotActivity | null = null): string {
  if (p.phase === 'finished') return '🏁';
  if (p.phase === 'playing') return '🎮';
  if (activity) return '💭';
  if (cooldownRemainingMs(state, p) > 0) return '⏱';
  return p.targetId ? '▶' : '🗺';
}

export function statusText(state: Readonly<GameState>, p: PlayerState, activity: BotActivity | null = null): string {
  if (p.phase === 'finished') return t('race.status.finished');
  if (p.phase === 'playing') return t('race.status.playing');
  if (activity) return t(`race.status.${activity}`);
  if (cooldownRemainingMs(state, p) > 0) return t('race.status.cooldown');
  return t(p.targetId ? 'race.status.ready' : 'race.status.choosing');
}

/** ●● / ●○ / ○○: sabotage slots in use, visible to everyone (DR-33). */
export function slotDots(used: number, cap = 2): string {
  return '●'.repeat(Math.min(used, cap)) + '○'.repeat(Math.max(0, cap - used));
}
