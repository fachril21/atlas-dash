/**
 * Simon render half (HTML/CSS). Rules live in src/logic/minigames/simon.ts; this file feeds
 * pad taps/keys (with event timestamps) into `step` and draws the state.
 */
import {
  playbackPad,
  roundLength,
  simonLogic,
  totalRounds,
  SIMON_PRESS_LIT_MS,
  type MinigameContext,
  type MinigameResult,
  type SimonInput,
  type SimonLevel,
  type SimonState,
} from '../../logic';
import { t } from '../strings';
import type { MinigameDefinition, MinigameInstance } from './types';
import './simon.css';

/** Colour + shape + tone per pad (not colour alone): red, blue, yellow, green, purple, orange. */
const PADS: readonly { glyph: string; color: string; hz: number }[] = [
  { glyph: '●', color: '#ff5a5f', hz: 262 },
  { glyph: '■', color: '#3a86ff', hz: 330 },
  { glyph: '▲', color: '#ffd23f', hz: 392 },
  { glyph: '◆', color: '#3ddc84', hz: 440 },
  { glyph: '★', color: '#9b5de5', hz: 523 },
  { glyph: '⬢', color: '#ff9f1c', hz: 587 },
];
const MAX_INPUT_OFFSET_MS = 100;

type QueuedInput = { at: number; input: SimonInput };

class SimonInstance implements MinigameInstance {
  private state: SimonState;
  private playT = 0;
  private running = false;
  private paused = false;
  private finished = false;
  private lastAdvanceWall = performance.now();
  private lastScale = 1;
  private readonly queue: QueuedInput[] = [];
  private readonly litUntil: number[];
  private finishCb: ((r: MinigameResult) => void) | null = null;
  private pendingResult: MinigameResult | null = null;
  private readonly abort = new AbortController();
  private audio: AudioContext | null = null;
  private readonly el: {
    root: HTMLElement; timer: HTMLElement; progress: HTMLElement; misses: HTMLElement;
    status: HTMLElement; grid: HTMLElement; pads: HTMLButtonElement[]; replay: HTMLButtonElement | null;
    idle: HTMLElement;
  };

  constructor(
    container: HTMLElement,
    private readonly ctx: MinigameContext,
    private readonly level: SimonLevel,
  ) {
    this.state = simonLogic.initState(level);
    this.litUntil = Array.from({ length: level.padCount }, () => -1);
    const root = document.createElement('div');
    root.className = 'mg-simon';
    root.dataset.testid = 'mg-play-area';
    const padsHtml = Array.from({ length: level.padCount }, (_, i) => {
      const p = PADS[i] as (typeof PADS)[number];
      return `<button type="button" class="sm-pad" data-pad="${i}" data-testid="mg-pad-${i}" style="--pad:${p.color}" aria-label="pad ${i + 1}"><span aria-hidden="true">${p.glyph}</span></button>`;
    }).join('');
    root.innerHTML = `
      <div class="sm-top">
        <div class="sm-timer" data-testid="mg-timer"><div class="sm-timer-fill"></div></div>
        <div class="sm-stats">
          <span class="sm-progress" data-testid="mg-progress"></span>
          <span class="sm-misses" data-testid="mg-misses"></span>
        </div>
        <div class="sm-idle" aria-hidden="true"><div class="sm-idle-fill" data-testid="mg-idle"></div></div>
      </div>
      <div class="sm-stage">
        <p class="sm-status" data-testid="mg-simon-status"></p>
        <div class="sm-grid pads-${level.padCount}${level.fog ? ' fog' : ''}" data-testid="mg-pads">${padsHtml}</div>
        ${level.replayAvailable ? `<button type="button" class="sm-replay" data-testid="mg-replay">${t('mg.simon.replay')}</button>` : ''}
      </div>`;
    container.appendChild(root);
    const q = (s: string) => root.querySelector(s) as HTMLElement;
    this.el = {
      root, timer: q('.sm-timer-fill'), progress: q('.sm-progress'), misses: q('.sm-misses'),
      status: q('.sm-status'), grid: q('.sm-grid'), idle: q('.sm-idle-fill'),
      pads: [...root.querySelectorAll<HTMLButtonElement>('.sm-pad')],
      replay: root.querySelector<HTMLButtonElement>('.sm-replay'),
    };
    if (ctx.settings.reducedMotion) root.classList.add('reduced-motion');
    if (ctx.settings.reducedFlash) root.classList.add('reduced-flash');

    const opts = { signal: this.abort.signal };
    for (const pad of this.el.pads) {
      pad.addEventListener('pointerdown', (e) => {
        e.preventDefault(); // no focus ring, no synthetic click doubling the input
        this.queueInput({ kind: 'pad', pad: Number(pad.dataset.pad) }, e.timeStamp);
      }, opts);
    }
    this.el.replay?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.queueInput({ kind: 'replay' }, e.timeStamp);
    }, opts);
    window.addEventListener('keydown', (e) => {
      if (e.repeat || e.altKey || e.ctrlKey || e.metaKey) return;
      const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
      if (m && Number(m[1]) <= level.padCount) {
        e.preventDefault();
        this.queueInput({ kind: 'pad', pad: Number(m[1]) - 1 }, e.timeStamp);
      } else if (e.code === 'KeyR' && level.replayAvailable) {
        e.preventDefault();
        this.queueInput({ kind: 'replay' }, e.timeStamp);
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
    // Simultaneous pointers: processed in timestamp order, one input each.
    const inputs = this.queue.splice(0).sort((a, b) => a.at - b.at);
    for (const qi of inputs) {
      const at = Math.min(Math.max(qi.at, prevT), nextT);
      this.apply(simonLogic.step(this.level, this.state, qi.input, at));
      if (this.finished) return;
    }
    this.playT = nextT;
    this.apply(simonLogic.step(this.level, this.state, null, nextT));
    this.draw();
  }

  destroy(): void {
    this.abort.abort();
    this.el.root.remove();
    this.finished = true;
    void this.audio?.close().catch(() => undefined);
    this.audio = null;
  }

  private queueInput(input: SimonInput, eventTime: number): void {
    if (!this.running || this.paused || this.finished) return;
    const offset = Math.min(Math.max((eventTime - this.lastAdvanceWall) * this.lastScale, 0), MAX_INPUT_OFFSET_MS);
    this.queue.push({ at: this.playT + offset, input });
  }

  private apply(next: SimonState): void {
    const prev = this.state;
    this.state = next;
    const lp = next.lastPress;
    if (lp && lp !== prev.lastPress) {
      if (lp.pad !== null) this.litUntil[lp.pad] = lp.tMs + SIMON_PRESS_LIT_MS;
      if (lp.correct && lp.pad !== null) this.tone(lp.pad);
      else this.feedbackMistake();
    }
    const r = simonLogic.result(this.level, next);
    if (r && !this.finished) {
      this.finished = true;
      this.draw();
      this.emit(r);
    }
  }

  private lastPlaybackPad = -1;

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

  private feedbackMistake(): void {
    const g = this.el.grid;
    g.classList.remove('fx-miss');
    void g.offsetWidth; // restart the CSS animation
    g.classList.add('fx-miss');
    this.toneBonk();
    if ('vibrate' in navigator && this.ctx.inputMode === 'touch') navigator.vibrate?.(40);
  }

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

  private beep(hz: number, ms: number, type: OscillatorType = 'sine', gain = 0.12): void {
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

  private tone(pad: number): void {
    this.beep((PADS[pad] as (typeof PADS)[number]).hz, 200);
  }

  private toneBonk(): void {
    this.beep(120, 220, 'square', 0.1);
  }

  private draw(): void {
    const { level, state, playT } = this;
    const remaining = Math.max(0, level.durationMs - playT);
    this.el.timer.style.transform = `scaleX(${remaining / level.durationMs})`;
    this.el.timer.parentElement?.classList.toggle('low', remaining < 5000);
    this.el.progress.textContent = `${Math.min(state.roundsDone + 1, totalRounds(level))}/${totalRounds(level)}`;
    this.el.progress.dataset.round = String(state.roundsDone);
    const left = Math.max(0, level.mistakesAllowed - state.mistakes);
    this.el.misses.textContent = `${'♥'.repeat(left)}${'♡'.repeat(level.mistakesAllowed - left)}`;
    this.el.misses.setAttribute('aria-label', `sisa salah ${left}`);
    this.el.misses.dataset.left = String(left);

    const lit = playbackPad(level, state, playT);
    if (lit !== null && lit !== this.lastPlaybackPad) {
      this.lastPlaybackPad = lit;
      this.tone(lit);
    } else if (lit === null) {
      this.lastPlaybackPad = -1;
    }
    this.el.pads.forEach((p, i) => p.classList.toggle('lit', lit === i || playT < (this.litUntil[i] as number)));

    const inInput = state.phase === 'input';
    this.el.grid.classList.toggle('locked', !inInput);
    this.el.grid.dataset.phase = state.phase;
    this.el.root.dataset.phase = state.phase;
    this.el.status.textContent = t(inInput ? 'mg.simon.yourTurn' : state.phase === 'playback' ? 'mg.simon.watch' : 'mg.simon.ready');
    this.el.status.dataset.len = String(roundLength(level, state.round));
    this.el.status.dataset.entered = String(state.inputIndex);
    const idleLeft = inInput ? Math.max(0, level.idleTimeoutMs - (playT - state.lastActivityMs)) / level.idleTimeoutMs : 0;
    this.el.idle.style.transform = `scaleX(${idleLeft})`;
    if (this.el.replay) this.el.replay.hidden = !(inInput && !state.replayUsed);
  }
}

export const simonDefinition: MinigameDefinition<SimonLevel> = {
  ...simonLogic,
  introIconHtml: '<span class="icon-simon" aria-hidden="true"><i></i><i></i><i></i><i></i></span>',
  create: (container, ctx, level) => new SimonInstance(container, ctx, level),
};
