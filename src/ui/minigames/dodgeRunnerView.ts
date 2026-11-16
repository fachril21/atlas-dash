/**
 * Hindari Rintangan render half: HTML HUD + a three.js canvas (dodgeScene.ts) in the minigame
 * overlay. Pointer gestures, arrow keys and A/D become `{ dir }` inputs for the pure `step`.
 * Collision, lives and the tempo multiplier all live in src/logic/minigames/dodgeRunner.ts.
 */
import {
  dodgeRunnerLogic,
  type DodgeInput,
  type DodgeLevel,
  type DodgeState,
  type MinigameContext,
  type MinigameResult,
} from '../../logic';
import { DIFFICULTY_TILE_COLORS } from '../../render/palette';
import { DodgeScene } from './dodgeScene';
import { LaneGesture } from './laneGesture';
import type { MinigameDefinition, MinigameInstance } from './types';
import './dodgeRunner.css';

/** Max offset (ms) between a frame and an input event inside it. */
const MAX_INPUT_OFFSET_MS = 100;

type QueuedInput = { at: number; input: DodgeInput };

class DodgeInstance implements MinigameInstance {
  private state: DodgeState;
  private playT = 0;
  private running = false;
  private paused = false;
  private finished = false;
  private lastAdvanceWall = performance.now();
  private lastScale = 1;
  private readonly queue: QueuedInput[] = [];
  private finishCb: ((r: MinigameResult) => void) | null = null;
  private pendingResult: MinigameResult | null = null;
  private readonly abort = new AbortController();
  private readonly scene: DodgeScene;
  private readonly gesture: LaneGesture;
  private readonly el: { root: HTMLElement; timer: HTMLElement; progress: HTMLElement; lives: HTMLElement; area: HTMLElement };

  constructor(
    container: HTMLElement,
    private readonly ctx: MinigameContext,
    private readonly level: DodgeLevel,
  ) {
    this.state = dodgeRunnerLogic.initState(level);
    const root = document.createElement('div');
    root.className = 'mg-dodge';
    root.dataset.testid = 'mg-play-area';
    root.innerHTML = `
      <div class="dr-stage" data-testid="mg-dodge-stage"></div>
      <div class="dr-top">
        <div class="dr-timer" data-testid="mg-timer"><div class="dr-timer-fill"></div></div>
        <div class="dr-stats">
          <span class="dr-progress" data-testid="mg-progress"></span>
          <span class="dr-lives" data-testid="mg-lives"></span>
        </div>
      </div>`;
    container.appendChild(root);
    const q = (s: string) => root.querySelector(s) as HTMLElement;
    this.el = { root, timer: q('.dr-timer-fill'), progress: q('.dr-progress'), lives: q('.dr-lives'), area: q('.dr-stage') };
    if (ctx.settings.reducedMotion) root.classList.add('reduced-motion');
    if (ctx.settings.reducedFlash) root.classList.add('reduced-flash');

    const theme = ctx.map.minigameThemes['dodge_runner']?.['obstacles'];
    this.scene = new DodgeScene(this.el.area, level, {
      sky: ctx.map.theme.palette.sky,
      ground: ctx.map.theme.palette.ground,
      road: DIFFICULTY_TILE_COLORS[ctx.difficulty],
      props: Array.isArray(theme) ? theme : [],
      reducedMotion: ctx.settings.reducedMotion,
    });

    // Gestures: tap (left/right half), swipe, or 100 ms hold; one gesture = one move.
    this.gesture = new LaneGesture(() => root.getBoundingClientRect().left + root.clientWidth / 2);
    const opts = { signal: this.abort.signal };
    root.addEventListener('pointerdown', (e) => {
      if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
      e.preventDefault();
      this.gesture.down(e.pointerId, e.clientX, e.clientY, e.timeStamp);
    }, opts);
    root.addEventListener('pointermove', (e) => this.take(this.gesture.move(e.pointerId, e.clientX, e.clientY, e.timeStamp)), opts);
    root.addEventListener('pointerup', (e) => this.take(this.gesture.up(e.pointerId, e.clientX, e.clientY, e.timeStamp)), opts);
    root.addEventListener('pointercancel', () => this.gesture.cancel(), opts);
    window.addEventListener('keydown', (e) => {
      if (e.repeat || e.altKey || e.ctrlKey || e.metaKey) return;
      const dir = e.code === 'ArrowLeft' || e.code === 'KeyA' ? -1 : e.code === 'ArrowRight' || e.code === 'KeyD' ? 1 : 0;
      if (dir === 0) return;
      e.preventDefault();
      this.queueInput({ dir }, e.timeStamp);
    }, opts);
    this.draw();
  }

  start(): void {
    this.running = true;
    this.lastAdvanceWall = performance.now();
  }

  pause(): void {
    this.paused = true;
    this.gesture.cancel();
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
    this.take(this.gesture.tick(wall)); // 100 ms hold tap
    const prevT = this.playT;
    const nextT = prevT + dtMs;
    for (const qi of this.queue.splice(0).sort((a, b) => a.at - b.at)) {
      const at = Math.min(Math.max(qi.at, prevT), nextT);
      this.apply(dodgeRunnerLogic.step(this.level, this.state, qi.input, at));
      if (this.finished) return;
    }
    this.playT = nextT;
    this.apply(dodgeRunnerLogic.step(this.level, this.state, null, nextT));
    this.draw();
  }

  destroy(): void {
    this.abort.abort();
    this.scene.dispose(); // GPU resources + canvas
    this.el.root.remove();
    this.finished = true;
  }

  private take(d: { dir: -1 | 1; t: number } | null): void {
    if (d) this.queueInput({ dir: d.dir }, d.t);
  }

  private queueInput(input: DodgeInput, eventTime: number): void {
    if (!this.running || this.paused || this.finished) return;
    const offset = Math.min(Math.max((eventTime - this.lastAdvanceWall) * this.lastScale, -MAX_INPUT_OFFSET_MS), MAX_INPUT_OFFSET_MS);
    this.queue.push({ at: this.playT + offset, input });
  }

  private apply(next: DodgeState): void {
    const prev = this.state;
    this.state = next;
    if (next.hits.length > prev.hits.length) this.feedbackHit();
    const r = dodgeRunnerLogic.result(this.level, next);
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

  private feedbackHit(): void {
    this.scene.hit();
    const root = this.el.root;
    root.classList.remove('fx-hit');
    void root.offsetWidth; // restart the CSS animation
    root.classList.add('fx-hit');
    if ('vibrate' in navigator && this.ctx.inputMode === 'touch') navigator.vibrate?.(40);
  }

  private draw(): void {
    const { level, state, playT } = this;
    const remaining = Math.max(0, level.durationMs - playT);
    this.el.timer.style.transform = `scaleX(${remaining / level.durationMs})`;
    this.el.timer.parentElement?.classList.toggle('low', remaining < 5000);
    this.el.progress.textContent = `${Math.min(100, Math.floor((playT / level.durationMs) * 100))}%`;
    const total = level.lives;
    const left = Math.max(0, state.lives);
    this.el.lives.textContent = `${'♥'.repeat(left)}${'♡'.repeat(total - left)}`;
    this.el.lives.setAttribute('aria-label', `nyawa ${left}`);
    this.el.lives.dataset.lives = String(left);
    this.el.root.dataset.lane = String(state.targetLane);
    this.scene.update({ tMs: playT, state });
  }
}

export const dodgeRunnerDefinition: MinigameDefinition<DodgeLevel> = {
  ...dodgeRunnerLogic,
  introIconHtml: '<span class="icon-dodge" aria-hidden="true"><i class="ob"></i><i class="pawn"></i></span>',
  create: (container, ctx, level) => new DodgeInstance(container, ctx, level),
};
