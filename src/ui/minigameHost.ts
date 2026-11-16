/**
 * Minigame shell (minigames.md §1.1): intro (3 s / 1.5 s on retry) -> play -> 1.2 s result
 * banner -> result callback. All time is game time fed through advance(), so pause and the
 * debug time scale apply. The host never decides pass/fail; the minigame (or a test hook) does.
 */
import { RESULT_BANNER_MS, type Attempt, type MinigameContext, type MinigameResult } from '../logic';
import { getMinigameDefinition } from './minigames/registry';
import type { MinigameInstance } from './minigames/types';
import { t } from './strings';
import './minigameHost.css';

type Phase = 'intro' | 'play' | 'banner' | 'closed';

export class MinigameHost {
  private phase: Phase = 'closed';
  private phaseT = 0;
  private introMs = 0;
  private instance: MinigameInstance | null = null;
  private is3d = false;
  private result: MinigameResult | null = null;
  private onResult: ((r: MinigameResult) => void) | null = null;
  private readonly overlay: HTMLElement;
  private readonly introEl: HTMLElement;
  private readonly playEl: HTMLElement;
  private readonly bannerEl: HTMLElement;

  constructor(parent: HTMLElement) {
    this.overlay = document.createElement('div');
    this.overlay.className = 'mg-overlay';
    this.overlay.dataset.testid = 'mg-overlay';
    this.overlay.hidden = true;
    this.overlay.innerHTML = `
      <div class="mg-intro" data-testid="mg-intro"></div>
      <div class="mg-play"></div>
      <div class="mg-banner" data-testid="mg-banner" hidden></div>`;
    parent.appendChild(this.overlay);
    this.introEl = this.overlay.querySelector('.mg-intro') as HTMLElement;
    this.playEl = this.overlay.querySelector('.mg-play') as HTMLElement;
    this.bannerEl = this.overlay.querySelector('.mg-banner') as HTMLElement;
  }

  get isOpen(): boolean {
    return this.phase !== 'closed';
  }

  /** True while a 3D minigame owns the screen (the race scene need not render). */
  get coversRace(): boolean {
    return this.phase !== 'closed' && this.is3d;
  }

  get currentPhase(): Phase {
    return this.phase;
  }

  open(attempt: Attempt, ctx: MinigameContext, onResult: (r: MinigameResult) => void): void {
    this.close();
    const def = getMinigameDefinition(attempt.minigameId);
    const level = def.generateLevel(ctx);
    for (const w of (level as { warnings?: string[] }).warnings ?? []) console.warn(w);
    this.onResult = onResult;
    this.is3d = def.render === '3d';
    this.result = null;
    this.introMs = attempt.introMs;
    this.phase = 'intro';
    this.phaseT = 0;
    this.overlay.hidden = false;
    this.overlay.dataset.minigame = attempt.minigameId;
    this.overlay.dataset.phase = 'intro';
    this.bannerEl.hidden = true;
    this.introEl.hidden = false;
    this.introEl.innerHTML = `
      <p class="mg-rule">${t(def.introKey)}</p>
      ${def.introIconHtml}
      <p class="mg-meta"><span class="badge d-${ctx.difficulty}">${t(`difficulty.${ctx.difficulty}`)}</span></p>
      <p class="mg-count" data-testid="mg-countdown"></p>`;
    this.instance = def.create(this.playEl, ctx, level);
    this.instance.onFinish((r) => this.showBanner(r));
    this.updateCountdown();
  }

  /** Advance by game time (0 while paused). */
  advance(dtMs: number): void {
    if (this.phase === 'closed') return;
    this.phaseT += dtMs;
    if (this.phase === 'intro') {
      this.updateCountdown();
      if (this.phaseT >= this.introMs) {
        const carry = this.phaseT - this.introMs;
        this.phase = 'play';
        this.phaseT = carry;
        this.overlay.dataset.phase = 'play';
        this.introEl.hidden = true;
        this.instance?.start();
        this.instance?.advance(carry);
      }
    } else if (this.phase === 'play') {
      this.instance?.advance(dtMs);
    } else if (this.phase === 'banner' && this.phaseT >= RESULT_BANNER_MS) {
      const r = this.result as MinigameResult;
      const cb = this.onResult;
      this.close();
      cb?.(r);
    }
  }

  pause(): void {
    this.instance?.pause();
    this.overlay.classList.add('paused');
  }

  resume(): void {
    this.instance?.resume();
    this.overlay.classList.remove('paused');
  }

  /** Test hook: end the running attempt with a forced result (goes through the banner). */
  force(passed: boolean): boolean {
    if (this.phase !== 'intro' && this.phase !== 'play') return false;
    this.showBanner({ passed, timeTakenMs: this.phase === 'play' ? this.phaseT : 0, progress: passed ? 1 : 0, reason: passed ? 'success' : 'failLimit' });
    return true;
  }

  /** Close without a result (e.g. someone else won: DR-06 input lock). */
  close(): void {
    this.instance?.destroy();
    this.instance = null;
    this.phase = 'closed';
    this.is3d = false;
    this.overlay.hidden = true;
    this.overlay.classList.remove('paused');
    delete this.overlay.dataset.phase;
    this.onResult = null;
  }

  private showBanner(r: MinigameResult): void {
    if (this.phase === 'banner' || this.phase === 'closed') return;
    this.instance?.destroy();
    this.instance = null;
    this.result = r;
    this.phase = 'banner';
    this.phaseT = 0;
    this.overlay.dataset.phase = 'banner';
    this.introEl.hidden = true;
    this.bannerEl.hidden = false;
    this.bannerEl.className = `mg-banner ${r.passed ? 'pass' : 'fail'}`;
    this.bannerEl.dataset.result = r.passed ? 'pass' : 'fail';
    this.bannerEl.textContent = t(r.passed ? 'mg.result.pass' : 'mg.result.fail');
  }

  private updateCountdown(): void {
    const el = this.introEl.querySelector('.mg-count');
    if (el) el.textContent = String(Math.max(1, Math.ceil((this.introMs - this.phaseT) / 1000)));
  }
}
