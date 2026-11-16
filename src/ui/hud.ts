/**
 * HTML/CSS HUD overlay. Reads state, never writes it: buttons call back into main.ts,
 * which turns them into GameActions on the human controller.
 */
import { COOLDOWN_MS, legalMoves, nodeDifficulty, type GameEvent, type GameState, type MapGraph } from '../logic';
import './hud.css';

export interface HudCallbacks {
  onMoveTo(nodeId: string): void;
  /** PLACEHOLDER for the minigame system: resolves the current region instantly. */
  onChallengeResult(success: boolean): void;
  onRestart(): void;
}

const PHASE_LABEL = { ready: 'siap jalan', challenge: 'main minigame', cooldown: 'cooldown', finished: 'finish' } as const;
const DIFF_LABEL = { easy: 'mudah', medium: 'sedang', hard: 'sulit' } as const;
const CSS_COLORS = ['#ff4d6d', '#3a86ff', '#2ec4b6', '#ffb703'];

export class Hud {
  private readonly top: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly log: HTMLElement;
  private readonly overlay: HTMLElement;
  private topKey = '';
  private panelKey = '';

  constructor(
    root: HTMLElement,
    private readonly map: MapGraph,
    private readonly humanId: string,
    private readonly cb: HudCallbacks,
  ) {
    root.innerHTML = `
      <header class="hud-top"></header>
      <div class="hud-log" aria-live="polite"></div>
      <section class="hud-panel"></section>
      <div class="hud-overlay" hidden></div>`;
    this.top = root.querySelector('.hud-top') as HTMLElement;
    this.log = root.querySelector('.hud-log') as HTMLElement;
    this.panel = root.querySelector('.hud-panel') as HTMLElement;
    this.overlay = root.querySelector('.hud-overlay') as HTMLElement;

    root.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('button');
      if (!btn) return;
      const { move, result, restart } = btn.dataset;
      if (move) this.cb.onMoveTo(move);
      else if (result) this.cb.onChallengeResult(result === 'win');
      else if (restart !== undefined) this.cb.onRestart();
    });
  }

  /** Cheap to call every frame: DOM is only touched when the visible text changes. */
  render(state: Readonly<GameState>): void {
    const nodeName = (id: string) => this.map.nodes.get(id)?.name ?? id;

    const chips = state.players.map((p) => {
      const cd = p.phase === 'cooldown' ? ` ${Math.ceil((p.cooldownUntilMs - state.timeMs) / 1000)}s` : '';
      return `<li class="chip${p.id === this.humanId ? ' me' : ''}">
        <span class="dot" style="background:${CSS_COLORS[p.colorIndex % CSS_COLORS.length]}"></span>
        <b>${esc(p.name)}</b> <span>${esc(nodeName(p.nodeId))}</span>
        <small>${PHASE_LABEL[p.phase]}${cd}${p.place ? ` #${p.place}` : ''}</small></li>`;
    });
    const topHtml = `<h1>Atlas Dash <span>${esc(this.map.data.name)}</span></h1><ul class="chips">${chips.join('')}</ul>`;
    if (topHtml !== this.topKey) {
      this.top.innerHTML = topHtml;
      this.topKey = topHtml;
    }

    const me = state.players.find((p) => p.id === this.humanId);
    let panelHtml = '';
    if (me && state.status === 'running') {
      if (me.phase === 'ready') {
        const moves = legalMoves(this.map, me);
        panelHtml = `<p>Pilih region berikutnya: tap tile yang bersinar, atau tekan angka.</p>
          <div class="row">${moves
            .map((id, i) => `<button data-move="${id}"><kbd>${i + 1}</kbd> ${esc(nodeName(id))}</button>`)
            .join('')}</div>`;
      } else if (me.phase === 'challenge') {
        const diff = nodeDifficulty(this.map, me.nodeId);
        panelHtml = `<p><b>${esc(nodeName(me.nodeId))}</b>: minigame ${DIFF_LABEL[diff]} (placeholder)</p>
          <div class="row"><button data-result="win" class="ok">Menang</button>
          <button data-result="lose" class="bad">Kalah (cooldown ${COOLDOWN_MS[diff] / 1000}s)</button></div>`;
      } else if (me.phase === 'cooldown') {
        const s = Math.max(0, Math.ceil((me.cooldownUntilMs - state.timeMs) / 1000));
        panelHtml = `<p>Kalah. Coba lagi dalam <b>${s}s</b>…</p>`;
      }
    }
    if (panelHtml !== this.panelKey) {
      this.panel.innerHTML = panelHtml;
      this.panel.hidden = panelHtml === '';
      this.panelKey = panelHtml;
    }

    if (state.status === 'finished') {
      const winner = state.players.find((p) => p.id === state.winnerId);
      const html = `<div class="card"><h2>${winner?.id === this.humanId ? 'Kamu menang!' : `${esc(winner?.name ?? '?')} menang`}</h2>
        <button data-restart class="ok">Main lagi</button></div>`;
      if (this.overlay.hidden || this.overlay.innerHTML !== html) this.overlay.innerHTML = html;
      this.overlay.hidden = false;
    } else {
      this.overlay.hidden = true;
    }
  }

  /** One-line feed of what other players did. */
  showEvents(state: Readonly<GameState>, events: readonly GameEvent[]): void {
    const name = (id: string) => state.players.find((p) => p.id === id)?.name ?? id;
    const nodeName = (id: string) => this.map.nodes.get(id)?.name ?? id;
    for (const e of events) {
      if (e.type === 'playerMoved') this.log.textContent = `${name(e.playerId)} → ${nodeName(e.to)}`;
      else if (e.type === 'challengeResolved' && e.playerId !== this.humanId) {
        this.log.textContent = `${name(e.playerId)} ${e.success ? 'menang' : 'kalah'} di ${nodeName(e.nodeId)}`;
      }
    }
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}
