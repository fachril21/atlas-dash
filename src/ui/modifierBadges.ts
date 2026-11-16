/**
 * Intro badges for the modifiers snapshotted at Mulai (ui-flow §8). Hindari Rintangan does not
 * change its duration for timeDelta; it changes tempo, so the badge says so (cards.md §5).
 */
import type { Attempt, MinigameModifier } from '../logic';
import { t } from './strings';

export interface Badge {
  key: string;
  text: string;
}

const DODGE_TEMPO_PER_SECOND = 0.03; // minigames.md §4: M = speed x (1 - 0.03 x sum timeDelta)

export function modifierBadges(minigameId: string, modifiers: readonly MinigameModifier[], attempt: Pick<Attempt, 'baseDifficulty' | 'difficulty'>): Badge[] {
  const out: Badge[] = [];
  if (attempt.baseDifficulty !== attempt.difficulty) {
    const idx = (d: string) => ['easy', 'medium', 'hard'].indexOf(d);
    out.push(idx(attempt.difficulty) < idx(attempt.baseDifficulty)
      ? { key: 'difficulty', text: t('badge.easier') }
      : { key: 'difficulty', text: t('badge.harder') });
  }
  for (const m of modifiers) {
    switch (m.kind) {
      case 'timeDelta':
        if (minigameId === 'dodge_runner') {
          const pct = Math.round(Math.abs(m.seconds) * DODGE_TEMPO_PER_SECOND * 100);
          out.push({ key: 'timeDelta', text: t(m.seconds > 0 ? 'badge.tempoDown' : 'badge.tempoUp', { p: pct }) });
        } else {
          out.push({ key: 'timeDelta', text: t(m.seconds > 0 ? 'badge.time' : 'badge.timeMinus', { s: Math.abs(m.seconds) }) });
        }
        break;
      case 'tolerance': out.push({ key: 'tolerance', text: t('badge.tolerance', { m: fmt(m.mult) }) }); break;
      case 'speed': out.push({ key: 'speed', text: t('badge.speed', { m: fmt(m.mult) }) }); break;
      case 'extraTarget': out.push({ key: 'extraTarget', text: t('badge.extra', { n: m.count }) }); break;
      case 'fog': out.push({ key: 'fog', text: t('badge.fog') }); break;
      case 'hint': out.push({ key: 'hint', text: t('badge.hint') }); break;
    }
  }
  return out;
}

function fmt(n: number): string {
  return String(Math.round(n * 100) / 100).replace('.', ',');
}
