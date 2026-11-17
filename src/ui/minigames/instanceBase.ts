/**
 * Shared plumbing of the CP5b minigame views: play time driven by the host (`advance`), inputs
 * queued with their event timestamps and fed to the pure `step` in time order, pause/destroy,
 * exactly-once finish, and a few synthesized sound effects. A subclass only builds its DOM, turns
 * pointer/keys into logic inputs (`queueInput`) and draws (`draw`).
 */
import type { MinigameContext, MinigameLogic, MinigameResult } from '../../logic';
import type { MinigameInstance } from './types';

/** Max offset (ms) between a frame and an input event inside it. */
export const MAX_INPUT_OFFSET_MS = 100;

interface Queued<I> {
  at: number;
  input: I;
}

export abstract class MinigameViewBase<Level, Input, State> implements MinigameInstance {
  protected state: State;
  /** Play time (ms) since start, pause excluded. */
  protected playT = 0;
  protected running = false;
  protected paused = false;
  protected finished = false;
  protected readonly abort = new AbortController();
  private lastAdvanceWall = performance.now();
  private lastScale = 1;
  private readonly queue: Queued<Input>[] = [];
  private finishCb: ((r: MinigameResult) => void) | null = null;
  private pendingResult: MinigameResult | null = null;
  private audio: AudioContext | null = null;

  constructor(
    protected readonly ctx: MinigameContext,
    protected readonly level: Level,
    protected readonly logic: MinigameLogic<Level, Input, State>,
  ) {
    this.state = logic.initState(level);
  }

  start(): void {
    this.running = true;
    this.lastAdvanceWall = performance.now();
  }

  pause(): void {
    this.paused = true;
    this.onPause();
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
    if (!this.running || this.paused || this.finished) {
      if (this.paused && !this.finished) this.draw(); // keep a 3D canvas alive while paused
      return;
    }
    if (wallDelta > 0 && dtMs > 0) this.lastScale = dtMs / wallDelta;
    this.beforeAdvance(dtMs);
    const prevT = this.playT;
    const nextT = prevT + dtMs;
    // Simultaneous pointers are processed in timestamp order, one input each.
    for (const qi of this.queue.splice(0).sort((a, b) => a.at - b.at)) {
      const at = Math.min(Math.max(qi.at, prevT), nextT);
      this.apply(this.logic.step(this.level, this.state, qi.input, at));
      if (this.finished) return;
    }
    this.playT = nextT;
    this.apply(this.logic.step(this.level, this.state, null, nextT));
    this.draw();
  }

  destroy(): void {
    if (this.audio) void this.audio.close().catch(() => undefined);
    this.audio = null;
    this.abort.abort();
    this.finished = true;
    this.onDestroy();
  }

  /** Test hook: feed an input at the current play time (no pointer needed). */
  injectInput(input: Input): void {
    if (!this.running || this.paused || this.finished) return;
    this.queue.push({ at: this.playT, input });
  }

  /** Test hook: read-only snapshot for QA. */
  snapshot(): { playT: number; state: State; level: Level; finished: boolean } {
    return { playT: this.playT, state: this.state, level: this.level, finished: this.finished };
  }

  protected queueInput(input: Input, eventTime: number): void {
    if (!this.running || this.paused || this.finished) return;
    const offset = Math.min(Math.max((eventTime - this.lastAdvanceWall) * this.lastScale, 0), MAX_INPUT_OFFSET_MS);
    this.queue.push({ at: this.playT + offset, input });
  }

  private apply(next: State): void {
    const prev = this.state;
    this.state = next;
    this.onStateChange(prev, next);
    const r = this.logic.result(this.level, next);
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

  protected onPause(): void {}
  protected onDestroy(): void {}
  protected beforeAdvance(_dtMs: number): void {}
  protected abstract onStateChange(prev: State, next: State): void;
  protected abstract draw(): void;

  // ---- sound (synthesized, optional) ----

  private audioCtx(): AudioContext | null {
    if (this.ctx.settings.sfxVolume <= 0) return null;
    try {
      this.audio ??= new AudioContext();
      if (this.audio.state === 'suspended') void this.audio.resume();
      return this.audio;
    } catch {
      return null;
    }
  }

  protected beep(hz: number, ms: number, type: OscillatorType = 'sine', gain = 0.12): void {
    const ac = this.audioCtx();
    if (!ac) return;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.value = hz;
    const v = gain * this.ctx.settings.sfxVolume;
    g.gain.setValueAtTime(v, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + ms / 1000);
    osc.connect(g).connect(ac.destination);
    osc.start();
    osc.stop(ac.currentTime + ms / 1000 + 0.02);
  }

  /** "ting", pitch up one semitone per combo step (max +6). */
  protected ting(combo: number): void {
    this.beep(660 * 2 ** (Math.min(6, Math.max(0, combo)) / 12), 160, 'triangle');
  }

  protected bonk(): void {
    this.beep(120, 220, 'square', 0.1);
  }

  protected vibrate(): void {
    if ('vibrate' in navigator && this.ctx.inputMode === 'touch') navigator.vibrate?.(40);
  }

  /** Restart a one-shot CSS animation class on an element. */
  protected pulse(el: HTMLElement, cls: string): void {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  /** Timer bar fill + low-time pulse shared by all 2D views. */
  protected drawTimer(fill: HTMLElement, remainingMs: number, totalMs: number): void {
    fill.style.transform = `scaleX(${Math.max(0, Math.min(1, remainingMs / Math.max(1, totalMs)))})`;
    fill.parentElement?.classList.toggle('low', remainingMs < 5000);
  }
}
