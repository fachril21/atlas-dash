/**
 * Race HUD (HTML/CSS overlay, ui-flow §3, §10). Reads state, never writes it: controls call
 * back into main.ts, which turns them into GameActions on the human controller.
 * render() is cheap to call every frame; each section's DOM only changes when its HTML does.
 */
import {
  cooldownRemainingMs,
  localize,
  ranking,
  getCard,
  regionDifficulty,
  sabotageSlotsUsed,
  totalWins,
  type BotActivity,
  type GameEvent,
  type GameState,
  type MapGraph,
  type PlayerState,
} from '../logic';
import { PLAYER_CSS_COLORS } from '../render/palette';
import { slotDots, statusIcon, statusText } from './status';
import { t } from './strings';
import './hud.css';

export interface HudCallbacks {
  onSelectTarget(regionId: string): void;
  onStart(): void;
  onPause(): void;
  onResume(): void;
  onQuit(): void;
  onPlayAgain(): void;
  /** What a waiting bot is doing, if anything (SmartBotController.activity). */
  activityOf?(playerId: string): BotActivity | null;
}

export class Hud {
  private readonly el: Record<'progress' | 'panel' | 'toast' | 'dialog' | 'pause' | 'results', HTMLElement>;
  private readonly cache = new Map<HTMLElement, string>();
  private toastUntil = 0;
  private pendingSwitch: string | null = null;
  private confirmingQuit = false;
  private paused = false;
  private resultsVisible = false;
  private locked = false;

  private readonly root: HTMLElement;

  constructor(
    parent: HTMLElement,
    private readonly map: MapGraph,
    private readonly humanId: string,
    private readonly cb: HudCallbacks,
  ) {
    const root = document.createElement('div');
    root.className = 'hud-root';
    parent.appendChild(root);
    this.root = root;
    root.innerHTML = `
      <header class="hud-top">
        <ol class="progress" data-testid="progress-list"></ol>
        <button class="icon-btn" data-action="pause" data-testid="btn-pause" aria-label="${t('pause.title')}">⏸</button>
      </header>
      <div class="hud-toast" data-testid="toast" aria-live="polite" hidden></div>
      <section class="target-panel" data-testid="target-panel"></section>
      <div class="hud-modal" data-testid="confirm-switch" hidden></div>
      <div class="hud-modal" data-testid="pause-overlay" hidden></div>
      <div class="hud-modal results" data-testid="results-screen" hidden></div>`;
    const q = (s: string) => root.querySelector(s) as HTMLElement;
    this.el = {
      progress: q('.progress'),
      panel: q('.target-panel'),
      toast: q('.hud-toast'),
      dialog: q('[data-testid="confirm-switch"]'),
      pause: q('[data-testid="pause-overlay"]'),
      results: q('[data-testid="results-screen"]'),
    };

    root.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
      if (!btn || btn.disabled) return;
      switch (btn.dataset.action) {
        case 'start': this.cb.onStart(); break;
        case 'pause': if (!this.locked) this.cb.onPause(); break;
        case 'resume': this.confirmingQuit = false; this.cb.onResume(); break;
        case 'quit': this.confirmingQuit = true; this.renderPause(); break;
        case 'quit-yes': this.confirmingQuit = false; this.cb.onQuit(); break;
        case 'quit-no': this.confirmingQuit = false; this.renderPause(); break;
        case 'switch-yes': {
          const id = this.pendingSwitch;
          this.closeSwitch();
          if (id) this.cb.onSelectTarget(id);
          break;
        }
        case 'switch-no': this.closeSwitch(); break;
        case 'again': this.cb.onPlayAgain(); break;
      }
    });
  }

  /** Target choice from the board: asks for confirmation when partial wins would be lost. */
  requestTarget(state: Readonly<GameState>, regionId: string): void {
    const me = this.me(state);
    if (!me || this.locked) return;
    if (me.targetId && me.targetId !== regionId && me.winsAtTarget > 0) {
      this.pendingSwitch = regionId;
      this.el.dialog.innerHTML = `<div class="card">
        <p>${t('race.switchConfirm', { w: me.winsAtTarget, W: this.map.winsRequired })}</p>
        <div class="row">
          <button data-action="switch-no" data-testid="btn-switch-no">${t('race.switchNo')}</button>
          <button data-action="switch-yes" class="warn" data-testid="btn-switch-yes">${t('race.switchYes')}</button>
        </div></div>`;
      this.el.dialog.hidden = false;
      return;
    }
    this.cb.onSelectTarget(regionId);
  }

  dispose(): void {
    this.root.remove();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.renderPause();
  }

  /** DR-06: from playerFinished on, every control is disabled. */
  lock(): void {
    this.locked = true;
    this.closeSwitch();
    this.root.classList.add('locked');
  }

  render(state: Readonly<GameState>): void {
    const total = totalWins(this.map);
    const rows = ranking(state).map((p, i) => {
      const pct = Math.round((1 - p.remainingWins / total) * 100);
      // DR-33: everyone sees how many sabotage slots are filled; card names only the target (own
      // pending row) and the sender (the small chips here) see.
      const slots = sabotageSlotsUsed(p);
      const sent = p.id === this.humanId ? [] : p.pending.filter((c) => c.source === this.humanId && getCard(c.defId).type === 'sabotage');
      const activity = this.cb.activityOf?.(p.id) ?? null;
      return `<li class="prow${p.id === this.humanId ? ' me' : ''}" data-testid="progress-row-${p.id}" data-remaining="${p.remainingWins}" data-slots="${slots}" data-activity="${activity ?? ''}">
        <span class="rank">${i + 1}</span>
        <span class="dot" style="background:${PLAYER_CSS_COLORS[p.colorIndex % PLAYER_CSS_COLORS.length]}"></span>
        <span class="pname">${esc(p.id === this.humanId ? t('you') : p.name)}</span>
        <span class="bar"><span style="width:${pct}%"></span></span>
        <span class="left">${t('race.winsLeft', { n: p.remainingWins })}</span>
        <span class="slots${slots > 0 ? ' hit' : ''}" data-testid="slots-${p.id}" title="${t('slots.label')}" aria-label="${t('slots.label')}: ${slots}/2">${slots > 0 ? '⚡' : ''}${slotDots(slots)}</span>
        <span class="status${activity ? ' waiting' : ''}" data-testid="status-${p.id}" title="${statusText(state, p, activity)}">${statusIcon(state, p, activity)}</span>
        ${sent.length ? `<span class="sent" data-testid="sent-${p.id}">${sent.map((c) => `${getCard(c.defId).icon} ${esc(t(getCard(c.defId).nameKey))}`).join(', ')}</span>` : ''}</li>`;
    });
    this.patch(this.el.progress, rows.join(''));
    this.renderPanel(state);
    if (this.toastUntil > 0 && performance.now() > this.toastUntil) {
      this.el.toast.hidden = true;
      this.toastUntil = 0;
    }
  }

  showEvents(state: Readonly<GameState>, events: readonly GameEvent[]): void {
    for (const e of events) {
      if (e.type === 'playerFinished' && e.playerId !== this.humanId) {
        const p = state.players.find((x) => x.id === e.playerId);
        this.toast(t('race.finishedToast', { name: p?.name ?? e.playerId, finish: localize(this.map.regions.get(this.map.finishId)?.name) }));
      }
    }
  }

  showResults(state: Readonly<GameState>): void {
    if (this.resultsVisible) return;
    this.resultsVisible = true;
    const winner = state.players.find((p) => p.id === state.winnerId);
    const title = winner?.id === this.humanId ? t('results.youWin') : t('results.winner', { name: esc(winner?.name ?? '?') });
    const secs = Math.round((winner?.finishedAtMs ?? state.timeMs) / 1000);
    const rows = ranking(state).map((p, i) => `<li data-testid="results-row-${p.id}">
      <span class="rank">#${i + 1}</span>
      <span class="dot" style="background:${PLAYER_CSS_COLORS[p.colorIndex % PLAYER_CSS_COLORS.length]}"></span>
      <span class="pname">${esc(p.id === this.humanId ? t('you') : p.name)}</span>
      <span class="left">${p.place ? localize(this.map.regions.get(this.map.finishId)?.name) : t('race.winsLeft', { n: p.remainingWins })}</span></li>`);
    this.el.results.innerHTML = `<div class="card">
      <h2>${title}</h2>
      <ol class="podium">${rows.join('')}</ol>
      <p class="muted">${t('results.time')}: ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}</p>
      <button data-action="again" class="ok big" data-testid="btn-play-again">${t('results.again')}</button></div>`;
    this.el.results.hidden = false;
    (this.el.results.querySelector('button') as HTMLButtonElement).focus();
  }

  private renderPanel(state: Readonly<GameState>): void {
    const me = this.me(state);
    let html = '';
    if (me && !this.locked && state.status === 'running' && me.phase === 'idle') {
      if (!me.targetId) {
        html = `<p class="title">${t('race.pickTarget')}</p><p class="muted">${t('race.pickTargetHint')}</p>`;
      } else {
        const region = this.map.regions.get(me.targetId);
        const diff = regionDifficulty(this.map, me.targetId);
        const cd = cooldownRemainingMs(state, me);
        const final = this.map.finalRegions.has(me.targetId) ? `<p class="final" data-testid="target-final">${t('race.final')}</p>` : '';
        const button = cd > 0
          ? `<button class="start cooling" disabled data-action="start" data-testid="btn-start" data-cooldown="${Math.ceil(cd / 1000)}">
               <span class="cd" data-testid="cooldown-timer">⏱ ${Math.ceil(cd / 1000)}</span></button>`
          : `<button class="start" data-action="start" data-testid="btn-start">${t('race.start')}</button>`;
        html = `<p class="title"><span data-testid="target-name">${esc(localize(region?.name))}</span>
            <span class="badge d-${diff}">${t(`difficulty.${diff}`)}</span>
            <span class="wins" data-testid="target-wins">${me.winsAtTarget}/${this.map.winsRequired}</span></p>
          ${final}${button}`;
      }
    }
    this.el.panel.hidden = html === '';
    this.patch(this.el.panel, html);
  }

  private renderPause(): void {
    if (!this.paused) {
      this.el.pause.hidden = true;
      return;
    }
    this.el.pause.innerHTML = this.confirmingQuit
      ? `<div class="card"><p>${t('pause.quitConfirm')}</p><div class="row">
          <button data-action="quit-no" data-testid="btn-quit-no">${t('race.switchNo')}</button>
          <button data-action="quit-yes" class="warn" data-testid="btn-quit-yes">${t('pause.quit')}</button></div></div>`
      : `<div class="card"><h2>${t('pause.title')}</h2><div class="col">
          <button data-action="resume" class="ok big" data-testid="btn-resume">${t('pause.resume')}</button>
          <button data-action="quit" data-testid="btn-quit">${t('pause.quit')}</button></div></div>`;
    this.el.pause.hidden = false;
    (this.el.pause.querySelector('button.ok, button.warn') as HTMLButtonElement | null)?.focus();
  }

  private closeSwitch(): void {
    this.pendingSwitch = null;
    this.el.dialog.hidden = true;
  }

  private toast(text: string): void {
    this.el.toast.textContent = text;
    this.el.toast.hidden = false;
    this.toastUntil = performance.now() + 1500;
  }

  private me(state: Readonly<GameState>): PlayerState | undefined {
    return state.players.find((p) => p.id === this.humanId);
  }

  private patch(el: HTMLElement, html: string): void {
    if (this.cache.get(el) === html) return;
    this.cache.set(el, html);
    el.innerHTML = html;
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}
