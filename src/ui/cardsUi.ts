/**
 * Card UI (ui-flow §4-§6): hand bar, card detail popover, offer screen, discard screen and
 * pending-effect badges. HTML/CSS only. It reads state (render() is cheap, per frame) and never
 * writes it: every control calls back into main.ts, which submits GameActions.
 * The 15 s bars are driven by game time (state.timeMs vs expiresAtMs), so pause freezes them.
 */
import {
  cardPlayability,
  CARD_SCREEN_MS,
  cardWarnings,
  discardNeeded,
  getCard,
  HAND_MAX,
  type CardDef,
  type CardInstance,
  type GameState,
  type MapGraph,
  type PlayerState,
} from '../logic';
import { t } from './strings';
import './cards.css';

export interface CardsCallbacks {
  onPlay(uid: string): void;
  onMark(uid: string): void;
  onConfirm(): void;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

/** Card face: type is shown by frame shape + glyph (not colour alone), rarity by a gem. */
export function cardFace(def: CardDef, opts: { showDesc?: boolean } = {}): string {
  const glyph = def.type === 'boost' ? '▲' : '⚡';
  return `<span class="cface t-${def.type} r-${def.rarity}" data-type="${def.type}" data-rarity="${def.rarity}">
    <span class="ctype" aria-hidden="true">${glyph}</span>
    <span class="cicon" aria-hidden="true">${def.icon}</span>
    <span class="cname">${esc(t(def.nameKey))}</span>
    ${opts.showDesc ? `<span class="cdesc">${esc(t(def.descKey))}</span>` : ''}
    <span class="gem" title="${t(`rarity.${def.rarity}`)}" aria-label="${t(`rarity.${def.rarity}`)}"></span>
  </span>`;
}

export class CardsUi {
  private readonly root: HTMLElement;
  private readonly el: Record<'pending' | 'hand' | 'detail' | 'offer' | 'discard', HTMLElement>;
  private readonly cache = new Map<HTMLElement, string>();
  private selectedUid: string | null = null;

  constructor(
    parent: HTMLElement,
    private readonly map: MapGraph,
    private readonly humanId: string,
    private readonly cb: CardsCallbacks,
  ) {
    const root = document.createElement('div');
    root.className = 'cards-root';
    parent.appendChild(root);
    this.root = root;
    root.innerHTML = `
      <div class="pending-row" data-testid="pending-row" aria-label="${t('pending.label')}"></div>
      <div class="hand-detail" data-testid="card-detail" hidden></div>
      <nav class="hand-bar" data-testid="hand-bar" aria-label="${t('hand.label')}"></nav>
      <div class="card-modal" data-testid="card-offer" hidden></div>
      <div class="card-modal" data-testid="discard-screen" hidden></div>`;
    const q = (s: string) => root.querySelector(s) as HTMLElement;
    this.el = {
      pending: q('.pending-row'),
      hand: q('.hand-bar'),
      detail: q('.hand-detail'),
      offer: q('[data-testid="card-offer"]'),
      discard: q('[data-testid="discard-screen"]'),
    };
    root.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const btn = target.closest<HTMLElement>('[data-card-action]');
      if (!btn || (btn as HTMLButtonElement).disabled) return;
      const uid = btn.dataset.uid ?? '';
      switch (btn.dataset.cardAction) {
        case 'select': this.selectedUid = this.selectedUid === uid ? null : uid; break;
        case 'cancel': this.selectedUid = null; break;
        case 'play': { const u = this.selectedUid; this.selectedUid = null; if (u) this.cb.onPlay(u); break; }
        case 'mark': this.cb.onMark(uid); break;
        case 'confirm': this.cb.onConfirm(); break;
      }
    });
    window.addEventListener('keydown', this.onKey);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey);
    this.root.remove();
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.code === 'Escape' && this.selectedUid) this.selectedUid = null;
  };

  render(state: Readonly<GameState>): void {
    const me = state.players.find((p) => p.id === this.humanId);
    const visible = !!me && state.status === 'running' && me.phase !== 'finished';
    this.root.hidden = !visible;
    if (!me || !visible) return;
    const screenOpen = !!(me.offer || me.discard);
    if (this.selectedUid && (screenOpen || me.phase !== 'idle' || !me.hand.some((c) => c.uid === this.selectedUid))) this.selectedUid = null;

    this.renderPending(me);
    this.renderHand(state, me);
    this.renderDetail(state, me);
    this.renderOffer(state, me);
    this.renderDiscard(state, me);
  }

  private renderPending(me: PlayerState): void {
    const html = me.pending.map((c, i) => {
      const def = getCard(c.defId);
      return `<span class="pbadge t-${def.type}" data-testid="pending-badge-${i}" data-card-id="${def.id}" title="${esc(t(def.descKey))}">
        <span aria-hidden="true">${def.icon}</span> ${esc(t(def.nameKey))}</span>`;
    }).join('');
    this.patch(this.el.pending, html);
  }

  private renderHand(state: Readonly<GameState>, me: PlayerState): void {
    const slots: string[] = [];
    for (let i = 0; i < HAND_MAX; i++) {
      const c = me.hand[i];
      if (!c) {
        slots.push(`<div class="hand-slot empty" data-testid="hand-slot-${i}"><span class="muted">${t('hand.empty')}</span></div>`);
        continue;
      }
      const def = getCard(c.defId);
      const play = cardPlayability(this.map, state, me, c);
      slots.push(`<div class="hand-slot" data-testid="hand-slot-${i}">
        <button class="card-btn hand-card${play.ok ? '' : ' dim'}${this.selectedUid === c.uid ? ' selected' : ''}" data-card-action="select" data-uid="${c.uid}"
          data-card-id="${def.id}" data-playable="${play.ok}" data-testid="hand-card-${i}" aria-pressed="${this.selectedUid === c.uid}">${cardFace(def)}</button></div>`);
    }
    this.patch(this.el.hand, slots.join(''));
  }

  private renderDetail(state: Readonly<GameState>, me: PlayerState): void {
    const c = this.selectedUid ? me.hand.find((x) => x.uid === this.selectedUid) : undefined;
    if (!c) {
      this.el.detail.hidden = true;
      this.patch(this.el.detail, '');
      return;
    }
    const def = getCard(c.defId);
    const play = cardPlayability(this.map, state, me, c);
    const warnings = play.ok ? cardWarnings(this.map, me, c) : [];
    const when = [t(`duration.${def.duration}`), def.trigger ? t(`trigger.${def.trigger}`) : ''].filter(Boolean).join(' · ');
    const html = `<div class="detail-card">
      ${cardFace(def)}
      <div class="detail-text">
        <h3 data-testid="card-detail-name">${esc(t(def.nameKey))}</h3>
        <p data-testid="card-detail-desc">${esc(t(def.descKey))}</p>
        <p class="muted" data-testid="card-detail-duration">${esc(when)} · ${t(`type.${def.type}`)} · ${t(`rarity.${def.rarity}`)}</p>
        ${play.ok ? '' : `<p class="reason" data-testid="card-reason">${t(`card.reason.${play.reason}`)}</p>`}
        ${warnings.map((w) => `<p class="warning" data-testid="card-warning" data-warning="${w}">⚠ ${t(`card.warn.${w}`)}</p>`).join('')}
      </div>
      <div class="detail-actions">
        <button class="ok" data-card-action="play" data-testid="btn-play-card" ${play.ok ? '' : 'disabled'}>${t('card.play')}</button>
        <button data-card-action="cancel" data-testid="btn-cancel-card">${t('card.cancel')}</button>
      </div></div>`;
    this.el.detail.hidden = false;
    this.patch(this.el.detail, html);
  }

  private renderOffer(state: Readonly<GameState>, me: PlayerState): void {
    const offer = me.offer;
    this.el.offer.hidden = !offer;
    if (!offer) {
      this.patch(this.el.offer, '');
      return;
    }
    const ready = offer.marked.length === offer.pick;
    const slots = offer.cards.map((c, i) => {
      const def = getCard(c.defId);
      const marked = offer.marked.includes(c.uid);
      return `<button class="card-btn offer-card${marked ? ' marked' : ''}" style="--i:${i}" data-card-action="mark" data-uid="${c.uid}" data-card-id="${def.id}"
        data-marked="${marked}" aria-pressed="${marked}" data-testid="card-slot-${i}">${cardFace(def, { showDesc: true })}${marked ? '<span class="check" aria-hidden="true">✓</span>' : ''}</button>`;
    });
    const html = `<div class="card-screen">
      <h2 data-testid="offer-title">${t('offer.title', { n: offer.pick })}</h2>
      ${this.timerHtml('offer-timer')}
      <div class="offer-row">${slots.join('')}</div>
      <p class="counter" data-testid="offer-count">${t('offer.counter', { m: offer.marked.length, n: offer.pick })}</p>
      <button class="ok big" data-card-action="confirm" data-testid="btn-take" ${ready ? '' : 'disabled'}>${t('offer.take')}</button></div>`;
    this.patch(this.el.offer, html);
    this.updateTimer(this.el.offer, state, offer.expiresAtMs);
  }

  private renderDiscard(state: Readonly<GameState>, me: PlayerState): void {
    const d = me.discard;
    this.el.discard.hidden = !d;
    if (!d) {
      this.patch(this.el.discard, '');
      return;
    }
    const need = discardNeeded(me);
    const cards = me.hand.map((c: CardInstance, i) => {
      const def = getCard(c.defId);
      const marked = d.marked.includes(c.uid);
      const isNew = d.newUids.includes(c.uid);
      return `<button class="card-btn discard-card${marked ? ' marked' : ''}" data-card-action="mark" data-uid="${c.uid}" data-card-id="${def.id}"
        data-marked="${marked}" data-new="${isNew}" aria-pressed="${marked}" data-testid="discard-card-${i}">${cardFace(def)}
        ${isNew ? `<span class="new-tag" data-testid="discard-new">${t('discard.new')}</span>` : ''}${marked ? '<span class="check" aria-hidden="true">🗑</span>' : ''}</button>`;
    });
    const html = `<div class="card-screen">
      <h2 data-testid="discard-title">${t('discard.title', { n: need })}</h2>
      ${this.timerHtml('discard-timer')}
      <div class="discard-grid" data-count="${cards.length}">${cards.join('')}</div>
      <p class="counter" data-testid="discard-count">${t('offer.counter', { m: d.marked.length, n: need })}</p>
      <button class="ok big" data-card-action="confirm" data-testid="btn-discard" ${d.marked.length === need ? '' : 'disabled'}>${t('discard.confirm')}</button></div>`;
    this.patch(this.el.discard, html);
    this.updateTimer(this.el.discard, state, d.expiresAtMs);
  }

  private timerHtml(testid: string): string {
    return `<div class="timer-bar" data-testid="${testid}" data-remaining="15"><span></span></div>`;
  }

  /** The timer lives outside the cached HTML so a click is never lost to a rebuild. */
  private updateTimer(container: HTMLElement, state: Readonly<GameState>, expiresAtMs: number): void {
    const bar = container.querySelector<HTMLElement>('.timer-bar');
    if (!bar) return;
    const left = Math.max(0, expiresAtMs - state.timeMs);
    bar.dataset.remaining = String(Math.ceil(left / 1000));
    (bar.firstElementChild as HTMLElement).style.width = `${Math.min(100, (left / CARD_SCREEN_MS) * 100)}%`;
  }

  private patch(el: HTMLElement, html: string): void {
    if (this.cache.get(el) === html) return;
    this.cache.set(el, html);
    el.innerHTML = html;
  }
}
