/**
 * Tap Tepat Waktu render half (HTML/CSS). All rules live in the pure logic
 * (src/logic/minigames/tapTiming.ts); this file only feeds inputs and draws state.
 */
import {
  FOG_INTERVAL_MS,
  FOG_PIECE_WIDTH,
  needleAt,
  tapTimingLogic,
  zoneAt,
  type MinigameContext,
  type MinigameResult,
  type TapTimingLevel,
  type TapTimingState,
} from '../../logic';
import type { MinigameDefinition, MinigameInstance } from './types';
import './tapTiming.css';

const HINT_LEAD_MS = 150;
/** Max offset (ms) between a frame and an input event inside it. */
const MAX_INPUT_OFFSET_MS = 100;

class TapTimingInstance implements MinigameInstance {
  private state: TapTimingState;
  private playT = 0;
  private running = false;
  private paused = false;
  private finished = false;
  private lastAdvanceWall = performance.now();
  private lastScale = 1;
  private readonly inputs: number[] = [];
  private finishCb: ((r: MinigameResult) => void) | null = null;
  private pendingResult: MinigameResult | null = null;
  private readonly abort = new AbortController();
  private readonly el: {
    root: HTMLElement; timer: HTMLElement; progress: HTMLElement; misses: HTMLElement;
    bar: HTMLElement; zone: HTMLElement; needle: HTMLElement; fog: HTMLElement[];
  };

  constructor(
    container: HTMLElement,
    private readonly ctx: MinigameContext,
    private readonly level: TapTimingLevel,
  ) {
    this.state = tapTimingLogic.initState(level);
    const root = document.createElement('div');
    root.className = 'mg-tap';
    root.dataset.testid = 'mg-play-area';
    root.innerHTML = `
      <div class="tt-top">
        <div class="tt-timer" data-testid="mg-timer"><div class="tt-timer-fill"></div></div>
        <div class="tt-stats">
          <span class="tt-progress" data-testid="mg-progress"></span>
          <span class="tt-misses" data-testid="mg-misses"></span>
        </div>
      </div>
      <div class="tt-stage">
        <div class="tt-bar">
          <div class="tt-zone"></div>
          ${level.fog.length > 0 ? '<div class="tt-fog"></div><div class="tt-fog"></div>' : ''}
          <div class="tt-needle"></div>
        </div>
        <p class="tt-cta">TAP!</p>
      </div>`;
    container.appendChild(root);
    const q = (s: string) => root.querySelector(s) as HTMLElement;
    this.el = {
      root, timer: q('.tt-timer-fill'), progress: q('.tt-progress'), misses: q('.tt-misses'),
      bar: q('.tt-bar'), zone: q('.tt-zone'), needle: q('.tt-needle'),
      fog: [...root.querySelectorAll<HTMLElement>('.tt-fog')],
    };
    this.el.zone.style.width = `${level.zoneWidth * 100}%`;
    for (const f of this.el.fog) f.style.width = `${FOG_PIECE_WIDTH * 100}%`;
    if (ctx.settings.reducedMotion) root.classList.add('reduced-motion');
    if (ctx.settings.reducedFlash) root.classList.add('reduced-flash');

    const opts = { signal: this.abort.signal };
    root.addEventListener('pointerdown', (e) => {
      e.preventDefault(); // no focus/selection, no synthetic click doubling the tap
      this.queueInput(e.timeStamp);
    }, opts);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        this.queueInput(e.timeStamp);
      }
    }, opts);
    this.draw();
  }

  start(): void {
    this.running = true;
    this.lastAdvanceWall = performance.now();
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    this.lastAdvanceWall = performance.now();
  }

  onFinish(cb: (r: MinigameResult) => void): void {
    this.finishCb = cb;
    if (this.pendingResult) this.emit(this.pendingResult);
  }

  advance(dtMs: number): void {
    const wall = performance.now();
    const wallDelta = wall - this.lastAdvanceWall;
    this.lastAdvanceWall = wall;
    if (!this.running || this.paused || this.finished) return;
    if (wallDelta > 0 && dtMs > 0) this.lastScale = dtMs / wallDelta;
    const prevT = this.playT;
    const nextT = prevT + dtMs;
    // Inputs carry their own (event) time, clamped into this frame's window.
    for (const ti of this.inputs.splice(0)) {
      const t = Math.min(Math.max(ti, prevT), nextT);
      this.apply(tapTimingLogic.step(this.level, this.state, { kind: 'tap' }, t));
      if (this.finished) return;
    }
    this.playT = nextT;
    this.apply(tapTimingLogic.step(this.level, this.state, null, nextT));
    this.draw();
  }

  destroy(): void {
    this.abort.abort();
    this.el.root.remove();
    this.finished = true;
  }

  private queueInput(eventTime: number): void {
    if (!this.running || this.paused || this.finished) return;
    const offset = Math.min(Math.max((eventTime - this.lastAdvanceWall) * this.lastScale, 0), MAX_INPUT_OFFSET_MS);
    this.inputs.push(this.playT + offset);
  }

  private apply(next: TapTimingState): void {
    const prev = this.state;
    this.state = next;
    if (next.lastTap && next.lastTap !== prev.lastTap) this.feedback(next.lastTap.hit);
    const r = tapTimingLogic.result(this.level, next);
    if (r && !this.finished) {
      this.finished = true;
      this.draw();
      this.emit(r);
    }
  }

  private emit(r: MinigameResult): void {
    if (!this.finishCb) {
      this.pendingResult = r;
      return;
    }
    const cb = this.finishCb;
    this.finishCb = null; // exactly once
    this.pendingResult = null;
    cb(r);
  }

  private feedback(hit: boolean): void {
    const cls = hit ? 'fx-hit' : 'fx-miss';
    const target = hit ? this.el.zone : this.el.bar;
    target.classList.remove(cls);
    void target.offsetWidth; // restart the CSS animation
    target.classList.add(cls);
    if (!hit && 'vibrate' in navigator && this.ctx.inputMode === 'touch') navigator.vibrate?.(40);
  }

  private draw(): void {
    const { level, state, playT } = this;
    const zone = zoneAt(level, state, playT);
    const needle = needleAt(level, playT);
    this.el.zone.style.left = `${zone.start * 100}%`;
    this.el.needle.style.left = `${needle * 100}%`;
    const remaining = Math.max(0, level.durationMs - playT);
    this.el.timer.style.transform = `scaleX(${remaining / level.durationMs})`;
    this.el.timer.parentElement?.classList.toggle('low', remaining < 5000);
    this.el.progress.textContent = `${state.hits}/${level.hitsRequired}`;
    const left = Math.max(0, level.missesAllowed - state.misses);
    this.el.misses.textContent = `${'♥'.repeat(left)}${'♡'.repeat(level.missesAllowed - left)}`;
    this.el.misses.setAttribute('aria-label', `sisa salah ${left}`);
    if (this.el.fog.length > 0) {
      const slot = this.ctx.settings.reducedMotion ? 0 : Math.min(Math.floor(playT / FOG_INTERVAL_MS), level.fog.length - 1);
      const pieces = level.fog[slot];
      this.el.fog.forEach((f, i) => { f.style.left = `${(pieces?.[i] ?? 0) * 100}%`; });
    }
    if (level.hint) {
      const soon = needleAt(level, playT + HINT_LEAD_MS);
      const zSoon = zoneAt(level, state, playT + HINT_LEAD_MS);
      this.el.zone.classList.toggle('hint', soon >= zSoon.start && soon <= zSoon.start + level.zoneWidth);
    }
  }
}

export const tapTimingDefinition: MinigameDefinition<TapTimingLevel> = {
  ...tapTimingLogic,
  introIconHtml: '<div class="mg-icon" aria-hidden="true"><span class="mg-icon-zone"></span><span class="mg-icon-needle"></span></div>',
  create: (container, ctx, level) => new TapTimingInstance(container, ctx, level),
};
