/**
 * Whack-a-Mole render half (HTML/CSS). Rules and the spawn schedule are pure
 * (src/logic/minigames/whackAMole.ts); this file turns taps/keys into `{ hole }` and draws the
 * state derived from play time.
 */
import {
  holeCount,
  visibleSpawns,
  whackAMoleLogic,
  type MinigameContext,
  type WhackInput,
  type WhackLevel,
  type WhackState,
} from '../../logic';
import { t } from '../strings';
import { MinigameViewBase } from './instanceBase';
import { catSvg, moleSvg } from './pictograms';
import type { MinigameDefinition, MinigameInstance } from './types';
import './whack.css';

/** Keyboard layout mirrors the grid: row 1 "1 2 3 4", row 2 "Q W E R", row 3 "A S D F" (3x3 uses the left 3 columns). */
const KEY_ROWS: readonly (readonly string[])[] = [
  ['Digit1', 'Digit2', 'Digit3', 'Digit4'],
  ['KeyQ', 'KeyW', 'KeyE', 'KeyR'],
  ['KeyA', 'KeyS', 'KeyD', 'KeyF'],
];
const KEY_LABELS: readonly (readonly string[])[] = [
  ['1', '2', '3', '4'],
  ['Q', 'W', 'E', 'R'],
  ['A', 'S', 'D', 'F'],
];

class WhackInstance extends MinigameViewBase<WhackLevel, WhackInput, WhackState> {
  private readonly root: HTMLElement;
  private readonly holes: HTMLButtonElement[] = [];
  private readonly timerFill: HTMLElement;
  private readonly progress: HTMLElement;
  private readonly misses: HTMLElement;
  private readonly live: HTMLElement;
  private combo = 0;

  constructor(container: HTMLElement, ctx: MinigameContext, level: WhackLevel) {
    super(ctx, level, whackAMoleLogic);
    const root = document.createElement('div');
    root.className = `mg-whack cols-${level.gridCols}`;
    root.dataset.testid = 'mg-play-area';
    root.dataset.cols = String(level.gridCols);
    root.dataset.rows = String(level.gridRows);
    const n = holeCount(level);
    const holes = Array.from({ length: n }, (_, i) => {
      const r = Math.floor(i / level.gridCols);
      const c = i % level.gridCols;
      const key = KEY_LABELS[r]?.[c] ?? '';
      return `<button type="button" class="wm-hole${level.wideTouch ? ' wide' : ''}" data-hole="${i}" data-testid="mg-hole-${i}" data-state="empty"
        aria-label="${t('mg.whack.holeEmpty', { n: i + 1 })}"><span class="wm-mound" aria-hidden="true"></span><span class="wm-char" aria-hidden="true"></span><span class="wm-fog" aria-hidden="true"></span><span class="wm-key" aria-hidden="true">${key}</span></button>`;
    }).join('');
    root.innerHTML = `
      <div class="wm-top">
        <div class="wm-timer" data-testid="mg-timer"><div class="wm-timer-fill"></div></div>
        <div class="wm-stats">
          <span class="wm-progress" data-testid="mg-progress"></span>
          <span class="wm-misses" data-testid="mg-misses"></span>
        </div>
      </div>
      <div class="wm-stage"><div class="wm-grid" data-testid="mg-holes">${holes}</div></div>
      <div class="wm-live" role="status" aria-live="polite" data-testid="mg-live"></div>`;
    container.appendChild(root);
    this.root = root;
    const q = (s: string) => root.querySelector(s) as HTMLElement;
    this.timerFill = q('.wm-timer-fill');
    this.progress = q('.wm-progress');
    this.misses = q('.wm-misses');
    this.live = q('.wm-live');
    this.holes = [...root.querySelectorAll<HTMLButtonElement>('.wm-hole')];
    if (ctx.settings.reducedMotion) root.classList.add('reduced-motion');
    if (ctx.settings.reducedFlash) root.classList.add('reduced-flash');

    const opts = { signal: this.abort.signal };
    for (const h of this.holes) {
      h.addEventListener('pointerdown', (e) => {
        e.preventDefault(); // no focus ring, no synthetic click doubling the tap
        this.queueInput({ hole: Number(h.dataset.hole) }, e.timeStamp);
      }, opts);
    }
    window.addEventListener('keydown', (e) => {
      if (e.repeat || e.altKey || e.ctrlKey || e.metaKey) return;
      for (let r = 0; r < KEY_ROWS.length; r++) {
        const c = (KEY_ROWS[r] as readonly string[]).indexOf(e.code);
        if (c >= 0 && c < level.gridCols && r < level.gridRows) {
          e.preventDefault();
          this.queueInput({ hole: r * level.gridCols + c }, e.timeStamp);
          return;
        }
      }
    }, opts);
    this.draw();
  }

  protected onStateChange(prev: WhackState, next: WhackState): void {
    if (next.lastHit && next.lastHit !== prev.lastHit) {
      const h = this.holes[next.lastHit.hole] as HTMLButtonElement;
      if (next.lastHit.kind === 'target') {
        this.combo += 1;
        this.ting(this.combo);
        this.pulse(h, 'fx-hit');
        this.live.textContent = '';
      } else {
        this.combo = 0;
        this.bonk();
        this.vibrate();
        this.pulse(h, 'fx-bonk');
        this.pulse(this.root, 'fx-shake');
      }
    }
  }

  protected override onDestroy(): void {
    this.root.remove();
  }

  protected draw(): void {
    const { level, state, playT } = this;
    this.drawTimer(this.timerFill, level.durationMs - playT, level.durationMs);
    this.progress.textContent = `${state.hits}/${level.hitsRequired}`;
    this.progress.dataset.hits = String(state.hits);
    const left = Math.max(0, level.decoyHitsAllowed - state.decoyHits);
    this.misses.textContent = level.decoyHitsAllowed > 0 ? `${'♥'.repeat(left)}${'♡'.repeat(level.decoyHitsAllowed - left)}` : '';
    this.misses.dataset.left = String(left);
    this.misses.setAttribute('aria-label', `sisa salah ${left}`);

    const visible = visibleSpawns(level, state.hit, playT);
    const byHole = new Map<number, number>();
    for (const i of visible) byHole.set((level.spawns[i] as { hole: number }).hole, i);
    // Spawns that will appear within the hint lead time (Teropong): the hole shakes first.
    const soon = new Set<number>();
    if (level.hintLeadMs > 0) {
      for (const s of level.spawns) {
        if (s.tMs > playT && s.tMs - playT <= level.hintLeadMs) soon.add(s.hole);
        if (s.tMs > playT + level.hintLeadMs) break;
      }
    }
    const fogHoles = new Set<number>();
    if (level.fog.length > 0) {
      const w = level.fog[Math.min(level.fog.length - 1, Math.floor(playT / 3000))];
      if (w) for (const h of w.holes) fogHoles.add(h);
    }
    this.holes.forEach((el, h) => {
      const idx = byHole.get(h);
      const kind = idx === undefined ? 'empty' : (level.spawns[idx] as { kind: string }).kind;
      if (el.dataset.state !== kind) {
        el.dataset.state = kind;
        const ch = el.querySelector('.wm-char') as HTMLElement;
        ch.innerHTML = kind === 'target' ? moleSvg() : kind === 'decoy' ? catSvg() : '';
        el.setAttribute('aria-label', t(kind === 'empty' ? 'mg.whack.holeEmpty' : kind === 'target' ? 'mg.whack.holeTarget' : 'mg.whack.holeDecoy', { n: h + 1 }));
      }
      el.classList.toggle('soon', soon.has(h) && kind === 'empty');
      el.classList.toggle('fogged', fogHoles.has(h));
    });
    this.root.dataset.state = this.finished ? 'done' : 'play';
  }
}

export const whackDefinition: MinigameDefinition<WhackLevel> = {
  ...whackAMoleLogic,
  introIconHtml: '<span class="icon-whack" aria-hidden="true"><i class="mole"></i><i class="hammer"></i></span>',
  create: (container, ctx, level): MinigameInstance => new WhackInstance(container, ctx, level),
};
