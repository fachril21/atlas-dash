/**
 * Cocokkan Kartu render half (HTML/CSS). Rules are pure (src/logic/minigames/memoryMatch.ts):
 * this file turns taps / arrow keys + Enter into `{ card }` / `{ peek }` and draws the state.
 * Faces are inline SVG placeholders told apart by silhouette, never by colour alone.
 */
import {
  inPreview,
  isFaceUp,
  isPeeking,
  memoryMatchLogic,
  type MemoryInput,
  type MemoryLevel,
  type MemoryState,
  type MinigameContext,
} from '../../logic';
import { t } from '../strings';
import { MinigameViewBase } from './instanceBase';
import { groupColor, iconSvg } from './pictograms';
import type { MinigameDefinition, MinigameInstance } from './types';
import './memory.css';

const GAP_PX = 8;
const MAX_CELL_PX = 96;

class MemoryInstance extends MinigameViewBase<MemoryLevel, MemoryInput, MemoryState> {
  private readonly root: HTMLElement;
  private readonly board: HTMLElement;
  private readonly cards: HTMLButtonElement[] = [];
  private readonly timerFill: HTMLElement;
  private readonly progress: HTMLElement;
  private readonly status: HTMLElement;
  private readonly live: HTMLElement;
  private readonly peekBtn: HTMLButtonElement | null;
  private readonly resizeObserver: ResizeObserver;
  private readonly names: string[];
  private combo = 0;
  private focusIdx = 0;
  private orient: 'portrait' | 'landscape' = 'portrait';

  constructor(container: HTMLElement, ctx: MinigameContext, level: MemoryLevel) {
    super(ctx, level, memoryMatchLogic);
    const theme = ctx.map.minigameThemes['memory_match'] ?? {};
    const icons = (theme['icons'] ?? []) as string[];
    const groups = (theme['iconGroups'] ?? []) as string[];
    // "icons/rendang.png" -> "rendang": a readable name for aria-labels (from data, not code).
    this.names = level.cards.map((id) => (id.split('/').pop() ?? id).replace(/\.[a-z0-9]+$/i, '').replace(/_/g, ' '));

    const root = document.createElement('div');
    root.className = 'mg-memory';
    root.dataset.testid = 'mg-play-area';
    root.innerHTML = `
      <div class="mm-top">
        <div class="mm-timer" data-testid="mg-timer"><div class="mm-timer-fill"></div></div>
        <div class="mm-stats">
          <span class="mm-progress" data-testid="mg-progress"></span>
          <span class="mm-status" data-testid="mg-status"></span>
          ${level.peekAvailable ? `<button type="button" class="mm-peek" data-testid="mg-peek">${t('mg.mm.peek')}</button>` : ''}
        </div>
      </div>
      <div class="mm-stage"><div class="mm-board" role="grid" data-testid="mg-cards" aria-label="${t('mg.memory_match.intro')}"></div></div>
      <div class="mm-live" role="status" aria-live="polite" data-testid="mg-live"></div>`;
    container.appendChild(root);
    this.root = root;
    const q = (s: string) => root.querySelector(s) as HTMLElement;
    this.board = q('.mm-board');
    this.timerFill = q('.mm-timer-fill');
    this.progress = q('.mm-progress');
    this.status = q('.mm-status');
    this.live = q('.mm-live');
    this.peekBtn = root.querySelector<HTMLButtonElement>('.mm-peek');
    if (level.fog) root.classList.add('fog');
    if (ctx.settings.reducedMotion) root.classList.add('reduced-motion');
    if (ctx.settings.reducedFlash) root.classList.add('reduced-flash');
    root.style.setProperty('--flip-ms', `${level.flipMs}ms`);

    level.cards.forEach((icon, i) => {
      const idx = icons.indexOf(icon);
      const color = groupColor(groups[idx] ?? '');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mm-card';
      b.setAttribute('role', 'gridcell');
      b.dataset.card = String(i);
      b.dataset.testid = `mg-card-${i}`;
      b.dataset.state = 'closed';
      b.tabIndex = i === 0 ? 0 : -1;
      b.innerHTML = `<span class="mm-inner"><span class="mm-back" aria-hidden="true">?</span><span class="mm-face">${iconSvg(Math.max(0, idx), color)}</span></span>`;
      b.setAttribute('aria-label', t('mg.mm.closed', { n: i + 1 }));
      this.board.appendChild(b);
      this.cards.push(b);
    });

    const opts = { signal: this.abort.signal };
    for (const b of this.cards) {
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.queueInput({ card: Number(b.dataset.card) }, e.timeStamp);
      }, opts);
    }
    this.peekBtn?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.queueInput({ peek: true }, e.timeStamp);
    }, opts);
    // Keyboard: arrows move focus over the logical grid, Enter/Space opens the focused card.
    this.board.addEventListener('keydown', (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const n = level.cards.length;
      const cols = level.cols;
      let next = this.focusIdx;
      if (e.code === 'ArrowRight') next = Math.min(n - 1, next + 1);
      else if (e.code === 'ArrowLeft') next = Math.max(0, next - 1);
      else if (e.code === 'ArrowDown') next = Math.min(n - 1, next + cols);
      else if (e.code === 'ArrowUp') next = Math.max(0, next - cols);
      else if ((e.code === 'Enter' || e.code === 'Space') && !e.repeat) {
        e.preventDefault();
        this.queueInput({ card: this.focusIdx }, e.timeStamp);
        return;
      } else return;
      e.preventDefault();
      this.setFocus(next, true);
    }, opts);
    this.board.addEventListener('focusin', (e) => {
      const i = this.cards.indexOf(e.target as HTMLButtonElement);
      if (i >= 0) this.setFocus(i, false);
    }, opts);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyH' && level.peekAvailable && !e.repeat) this.queueInput({ peek: true }, e.timeStamp);
    }, opts);

    this.resizeObserver = new ResizeObserver(() => this.layout());
    this.resizeObserver.observe(container);
    this.layout();
    this.draw();
  }

  private setFocus(i: number, focus: boolean): void {
    this.focusIdx = i;
    this.cards.forEach((c, k) => { c.tabIndex = k === i ? 0 : -1; });
    if (focus) this.cards[i]?.focus();
  }

  /**
   * Size the cells from the space available and pick portrait (cols x rows) or landscape (the
   * transposed rows x cols) whichever gives bigger cards. Indices never change; the half-full
   * last line is centred with a transform.
   */
  private layout(): void {
    const stage = this.board.parentElement as HTMLElement;
    const w = Math.max(1, stage.clientWidth - 32);
    const h = Math.max(1, stage.clientHeight - 16);
    const { cols, rows, cards } = this.level;
    const cellFor = (c: number, r: number) => Math.min(MAX_CELL_PX, (w - GAP_PX * (c - 1)) / c, (h - GAP_PX * (r - 1)) / r);
    const portrait = cellFor(cols, rows);
    const landscape = cellFor(rows, cols);
    this.orient = landscape > portrait ? 'landscape' : 'portrait';
    const cell = Math.floor(Math.max(landscape > portrait ? landscape : portrait, 40));
    const lineCols = this.orient === 'portrait' ? cols : rows; // grid columns on screen
    this.board.dataset.orient = this.orient;
    this.board.style.setProperty('--cell', `${cell}px`);
    this.board.style.gridTemplateColumns = `repeat(${lineCols}, ${cell}px)`;
    const lastCount = cards.length - (rows - 1) * cols; // cards in the final (logical) row
    this.cards.forEach((b, i) => {
      const r = Math.floor(i / cols);
      const c = i % cols;
      const [gx, gy] = this.orient === 'portrait' ? [c, r] : [r, c];
      b.style.gridColumn = String(gx + 1);
      b.style.gridRow = String(gy + 1);
      let tx = 0;
      let ty = 0;
      if (r === rows - 1 && lastCount < cols) {
        const off = ((cols - lastCount) * (cell + GAP_PX)) / 2;
        if (this.orient === 'portrait') tx = off;
        else ty = off;
      }
      b.style.transform = tx || ty ? `translate(${tx}px, ${ty}px)` : '';
    });
  }

  protected onStateChange(prev: MemoryState, next: MemoryState): void {
    const lt = next.lastTry;
    if (lt && lt !== prev.lastTry) {
      if (lt.kind === 'match') {
        this.combo += 1;
        this.ting(this.combo);
        this.live.textContent = t('mg.mm.announceMatch');
        for (const c of lt.cards) this.pulse(this.cards[c] as HTMLElement, 'fx-match');
      } else {
        this.combo = 0;
        this.bonk();
        this.live.textContent = t('mg.mm.announceMismatch');
      }
    }
  }

  protected override onDestroy(): void {
    this.resizeObserver.disconnect();
    this.root.remove();
  }

  protected draw(): void {
    const { level, state, playT } = this;
    const playMs = Math.max(0, playT - level.previewMs);
    this.drawTimer(this.timerFill, level.durationMs - playMs, level.durationMs);
    this.progress.textContent = `${state.matched.length / 2}/${level.pairs}`;
    this.progress.dataset.matched = String(state.matched.length / 2);
    const phase = inPreview(level, playT) ? 'preview' : isPeeking(level, state, playT) ? 'peek' : 'play';
    this.root.dataset.phase = phase;
    this.status.textContent = phase === 'preview' ? t('mg.mm.memorize') : '';
    if (this.peekBtn) this.peekBtn.hidden = state.peekUsed || phase === 'preview';
    // A closing mismatch is shown shaking until it shuts.
    const closing: readonly number[] = state.closing && playT < state.closing.closeAtMs ? state.closing.cards : [];
    this.cards.forEach((b, i) => {
      const matched = state.matched.includes(i);
      const up = isFaceUp(level, state, i, playT);
      const st = matched ? 'matched' : up ? 'open' : 'closed';
      if (b.dataset.state !== st) {
        b.dataset.state = st;
        b.setAttribute('aria-label', st === 'closed' ? t('mg.mm.closed', { n: i + 1 }) : t(st === 'matched' ? 'mg.mm.matched' : 'mg.mm.open', { n: i + 1 }) + `: ${this.names[i]}`);
      }
      b.classList.toggle('wrong', closing.includes(i));
    });
  }
}

export const memoryDefinition: MinigameDefinition<MemoryLevel> = {
  ...memoryMatchLogic,
  introIconHtml: '<span class="icon-memory" aria-hidden="true"><i></i><i></i></span>',
  create: (container, ctx, level): MinigameInstance => new MemoryInstance(container, ctx, level),
};
