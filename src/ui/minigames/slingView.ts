/**
 * Ketapel render half: HTML HUD + the three.js canvas (slingScene.ts). Pointer drag (press in the
 * lower half of the screen, drag down/sideways, release) or the keyboard (arrows + Space) become
 * `{ yawDeg, power }` inputs for the pure `step`. A drag shorter than 5% of the screen height
 * cancels the shot and no bullet is used. Wind and bullets are always on screen.
 */
import {
  aimFromDrag,
  SLING_CANCEL_FRAC,
  SLING_MAX_DRAG_SCREEN_FRAC,
  SLING_POWER_MIN,
  SLING_POWER_START,
  SLING_YAW_MAX_DEG,
  slingshotLogic,
  type MinigameContext,
  type SlingAim,
  type SlingLevel,
  type SlingState,
} from '../../logic';
import { t } from '../strings';
import { MinigameViewBase } from './instanceBase';
import { SlingScene } from './slingScene';
import type { MinigameDefinition, MinigameInstance } from './types';
import './sling.css';

const KEY_HOLD_DELAY_MS = 250;
const KEY_RATE_YAW_DEG_S = 30;
const KEY_RATE_POWER_S = 0.3; // 30% per second

class SlingInstance extends MinigameViewBase<SlingLevel, SlingAim, SlingState> {
  private readonly root: HTMLElement;
  private readonly scene: SlingScene;
  private readonly timerFill: HTMLElement;
  private readonly progress: HTMLElement;
  private readonly bullets: HTMLElement;
  private readonly wind: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly preview: HTMLElement;
  private readonly readout: HTMLElement;
  /** Pointer drag in progress. */
  private drag: { id: number; x0: number; y0: number; aim: SlingAim | null } | null = null;
  /** Keyboard aim; shown once the player starts adjusting it. */
  private kb: SlingAim = { yawDeg: 0, power: SLING_POWER_START };
  private kbActive = false;
  private readonly held = new Map<string, number>();
  private lastHeldWall = performance.now();
  private shots = 0;

  constructor(container: HTMLElement, ctx: MinigameContext, level: SlingLevel) {
    super(ctx, level, slingshotLogic);
    const root = document.createElement('div');
    root.className = 'mg-sling';
    root.dataset.testid = 'mg-play-area';
    const windAbs = Math.abs(level.windMps);
    root.innerHTML = `
      <div class="sl-stage" data-testid="mg-sling-stage"></div>
      <div class="sl-top">
        <div class="sl-timer" data-testid="mg-timer"><div class="sl-timer-fill"></div></div>
        <div class="sl-stats">
          <span class="sl-progress" data-testid="mg-progress"></span>
          <span class="sl-bullets" data-testid="mg-bullets"></span>
        </div>
        <div class="sl-wind" data-testid="mg-wind" data-wind="${level.windMps.toFixed(2)}" role="img"
          aria-label="${windAbs === 0 ? t('mg.sling.windNone') : t('mg.sling.windAria', { dir: t(level.windMps < 0 ? 'mg.sling.left' : 'mg.sling.right'), v: windAbs.toFixed(1) })}">
          ${windAbs === 0 ? t('mg.sling.windNone') : t(level.windMps < 0 ? 'mg.sling.windLeft' : 'mg.sling.windRight', { v: windAbs.toFixed(1) })}
        </div>
      </div>
      <div class="sl-preview" data-testid="mg-hit-preview" hidden>✓ ${t('mg.sling.willHit')}</div>
      <div class="sl-readout" data-testid="mg-aim" hidden></div>
      <p class="sl-hint" data-testid="mg-aim-hint">${t('mg.sling.aimHint')}</p>`;
    container.appendChild(root);
    this.root = root;
    const q = (s: string) => root.querySelector(s) as HTMLElement;
    this.timerFill = q('.sl-timer-fill');
    this.progress = q('.sl-progress');
    this.bullets = q('.sl-bullets');
    this.wind = q('.sl-wind');
    this.hint = q('.sl-hint');
    this.preview = q('.sl-preview');
    this.readout = q('.sl-readout');
    if (ctx.settings.reducedMotion) root.classList.add('reduced-motion');
    if (ctx.settings.reducedFlash) root.classList.add('reduced-flash');

    this.scene = new SlingScene(q('.sl-stage'), level, {
      sky: ctx.map.theme.palette.sky,
      ground: ctx.map.theme.palette.ground,
      reducedMotion: ctx.settings.reducedMotion,
    });

    const opts = { signal: this.abort.signal };
    root.addEventListener('pointerdown', (e) => {
      if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0) || this.drag) return;
      const r = root.getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) return; // aim in the lower half only
      e.preventDefault();
      this.drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, aim: null };
      try { root.setPointerCapture(e.pointerId); } catch { /* synthetic pointers */ }
    }, opts);
    root.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!d || e.pointerId !== d.id) return;
      d.aim = aimFromDrag(e.clientX - d.x0, e.clientY - d.y0, this.maxDragPx());
    }, opts);
    root.addEventListener('pointerup', (e) => {
      const d = this.drag;
      if (!d || e.pointerId !== d.id) return;
      const aim = aimFromDrag(e.clientX - d.x0, e.clientY - d.y0, this.maxDragPx());
      this.drag = null;
      if (aim) {
        this.queueInput(aim, e.timeStamp);
        this.shots += 1;
      }
    }, opts);
    root.addEventListener('pointercancel', () => { this.drag = null; }, opts);

    // Capture phase: Esc cancels an aim in progress before the game's own Esc (pause) sees it.
    window.addEventListener('keydown', (e) => this.onKeyDown(e), { signal: this.abort.signal, capture: true });
    window.addEventListener('keyup', (e) => this.held.delete(e.code), opts);
    this.draw();
  }

  private maxDragPx(): number {
    return SLING_MAX_DRAG_SCREEN_FRAC * Math.max(1, this.root.clientHeight);
  }

  private clampKb(): void {
    this.kb = {
      yawDeg: Math.max(-SLING_YAW_MAX_DEG, Math.min(SLING_YAW_MAX_DEG, this.kb.yawDeg)),
      power: Math.max(SLING_POWER_MIN, Math.min(1, this.kb.power)),
    };
  }

  private resetAim(): void {
    this.kb = { yawDeg: 0, power: SLING_POWER_START };
    this.kbActive = false;
    this.drag = null;
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.altKey || e.ctrlKey || e.metaKey || this.finished) return;
    if (e.code === 'Escape') {
      if (this.drag || this.kbActive) {
        e.preventDefault();
        e.stopImmediatePropagation(); // cancel the aim, do not pause
        this.resetAim();
      }
      return;
    }
    if (this.paused || !this.running) return;
    const step: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 0.01], ArrowDown: [0, -0.01],
    };
    const s = step[e.code];
    if (s) {
      e.preventDefault();
      if (e.repeat) return; // holding is handled per frame at 30 deg/s or 30%/s
      this.kb = { yawDeg: this.kb.yawDeg + s[0], power: this.kb.power + s[1] };
      this.clampKb();
      this.kbActive = true;
      this.held.set(e.code, performance.now());
      this.lastHeldWall = performance.now();
    } else if ((e.code === 'Space' || e.code === 'Enter') && !e.repeat) {
      e.preventDefault();
      this.queueInput({ ...this.kb }, e.timeStamp);
      this.shots += 1;
      this.resetAim();
    }
  }

  protected override beforeAdvance(_dtMs: number): void {
    // Held arrow keys: after a short delay yaw moves 30 deg/s and power 30%/s.
    const now = performance.now();
    const dt = Math.max(0, now - this.lastHeldWall) / 1000;
    this.lastHeldWall = now;
    for (const [code, since] of this.held) {
      if (now - since < KEY_HOLD_DELAY_MS) continue;
      if (code === 'ArrowLeft') this.kb.yawDeg -= KEY_RATE_YAW_DEG_S * dt;
      else if (code === 'ArrowRight') this.kb.yawDeg += KEY_RATE_YAW_DEG_S * dt;
      else if (code === 'ArrowUp') this.kb.power += KEY_RATE_POWER_S * dt;
      else if (code === 'ArrowDown') this.kb.power -= KEY_RATE_POWER_S * dt;
    }
    if (this.held.size > 0) this.clampKb();
  }

  protected override onPause(): void {
    this.drag = null;
    this.held.clear();
  }

  protected onStateChange(prev: SlingState, next: SlingState): void {
    if (next.flight && !prev.flight) {
      this.pulse(this.root, 'fx-shoot');
      this.beep(300, 120, 'triangle');
      this.hint.hidden = true;
    }
    if (next.landed.length > prev.landed.length) {
      const last = next.landed[next.landed.length - 1] as SlingState['landed'][number];
      if (last.hitIndex !== null) {
        this.ting(next.down.length);
        this.pulse(this.root, 'fx-down');
      } else {
        this.bonk();
      }
    }
  }

  protected override onDestroy(): void {
    this.scene.dispose(); // GPU resources + canvas
    this.root.remove();
  }

  /** The aim to show: an active drag first, else the keyboard aim while it is being set. */
  private shownAim(): SlingAim | null {
    if (this.drag) return this.drag.aim;
    return this.kbActive ? this.kb : null;
  }

  protected draw(): void {
    const { level, state, playT } = this;
    this.drawTimer(this.timerFill, level.durationMs - playT, level.durationMs);
    this.progress.textContent = `${state.down.length}/${level.targetsRequired}`;
    this.progress.dataset.down = String(state.down.length);
    this.bullets.textContent = '●'.repeat(Math.max(0, state.bulletsLeft + (state.flight ? 1 : 0))) + '○'.repeat(level.bullets - state.bulletsLeft - (state.flight ? 1 : 0));
    this.bullets.dataset.left = String(state.bulletsLeft);
    this.bullets.setAttribute('aria-label', `peluru ${state.bulletsLeft}`);
    const aim = this.shownAim();
    const canAim = !state.flight && state.bulletsLeft > 0 && !state.result;
    this.scene.update({ tMs: playT, state, aim: canAim ? aim : null });
    const showHit = canAim && !!aim && this.scene.hitPreview;
    this.preview.hidden = !showHit;
    const dragging = !!this.drag;
    this.readout.hidden = !aim || !canAim;
    if (aim) {
      this.readout.textContent = `${aim.yawDeg.toFixed(0)}° · ${Math.round(aim.power * 100)}%`;
      this.root.dataset.yaw = aim.yawDeg.toFixed(1);
      this.root.dataset.power = aim.power.toFixed(2);
    }
    this.root.dataset.aiming = aim ? (dragging ? 'drag' : 'keys') : this.drag ? 'cancel' : 'none';
    this.root.dataset.shots = String(this.shots);
    this.root.dataset.cancelFrac = String(SLING_CANCEL_FRAC);
    this.wind.classList.toggle('calm', level.windMps === 0);
  }

  /** Test hook: draw state of the 3D side. */
  gpuStats(): { geometries: number; textures: number; calls: number } {
    return this.scene.stats();
  }
}

export const slingDefinition: MinigameDefinition<SlingLevel> = {
  ...slingshotLogic,
  introIconHtml: '<span class="icon-sling" aria-hidden="true"><i class="stone"></i><i class="tgt"></i></span>',
  create: (container, ctx, level): MinigameInstance => new SlingInstance(container, ctx, level),
};
