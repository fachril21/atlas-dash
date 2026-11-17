/**
 * Setup Bot screen (ui-flow §2, gdd "Setup Bot"): number of bots (1-3, B3) and one level for all
 * of them (Easy / Normal / Hard, B1), then "Mulai Balapan". The URL (?bots=, ?botLevel=) only
 * preselects the values; with both present main.ts skips the screen (tests, shared links).
 */
import type { BotLevel } from '../logic';
import { t } from './strings';

export interface SetupChoice {
  botCount: number;
  botLevel: BotLevel;
}

const LEVELS: readonly BotLevel[] = ['easy', 'normal', 'hard'];

export class SetupScreen {
  private readonly root: HTMLElement;
  private choice: SetupChoice;

  constructor(
    parent: HTMLElement,
    initial: SetupChoice,
    private readonly onStart: (choice: SetupChoice) => void,
  ) {
    this.choice = { ...initial };
    this.root = document.createElement('div');
    this.root.className = 'hud-modal setup';
    this.root.dataset.testid = 'setup-screen';
    this.root.hidden = true;
    parent.appendChild(this.root);
    this.root.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-setup]');
      if (!btn || btn.disabled) return;
      switch (btn.dataset.setup) {
        case 'bots-minus': this.choice.botCount = Math.max(1, this.choice.botCount - 1); break;
        case 'bots-plus': this.choice.botCount = Math.min(3, this.choice.botCount + 1); break;
        case 'level': this.choice.botLevel = btn.dataset.level as BotLevel; break;
        case 'start': this.hide(); this.onStart({ ...this.choice }); return;
      }
      this.render();
    });
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  show(): void {
    this.root.hidden = false;
    this.render();
    (this.root.querySelector('button[data-setup="start"]') as HTMLButtonElement | null)?.focus();
  }

  hide(): void {
    this.root.hidden = true;
  }

  dispose(): void {
    this.root.remove();
  }

  private render(): void {
    const { botCount, botLevel } = this.choice;
    this.root.innerHTML = `<div class="card">
      <h2>${t('setup.title')}</h2>
      <div class="setup-row"><span>${t('setup.botCount')}</span>
        <span class="stepper">
          <button data-setup="bots-minus" aria-label="${t('setup.fewer')}" data-testid="setup-bots-minus" ${botCount <= 1 ? 'disabled' : ''}>−</button>
          <span class="count" data-testid="setup-bots-count" aria-live="polite">${botCount}</span>
          <button data-setup="bots-plus" aria-label="${t('setup.more')}" data-testid="setup-bots-plus" ${botCount >= 3 ? 'disabled' : ''}>+</button>
        </span></div>
      <div class="setup-row"><span>${t('setup.botLevel')}</span>
        <span class="segmented" role="radiogroup" aria-label="${t('setup.botLevel')}">
          ${LEVELS.map((l) => `<button data-setup="level" data-level="${l}" role="radio" aria-checked="${l === botLevel}" class="${l === botLevel ? 'on' : ''}" data-testid="setup-level-${l}">${t(`setup.level.${l}`)}</button>`).join('')}
        </span></div>
      <button data-setup="start" class="ok big" data-testid="setup-start">${t('setup.start')}</button></div>`;
  }
}
