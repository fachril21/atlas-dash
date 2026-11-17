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
  checkTarget,
  discardNeeded,
  getCard,
  HAND_MAX,
  impactSummary,
  opponentChecks,
  ranking,
  sabotageSlotsUsed,
  type CardDef,
  type CardInstance,
  type GameAction,
  type GameEvent,
  type GameState,
  type MapGraph,
  type PlayerState,
  type RejectReason,
} from '../logic';
import { PLAYER_CSS_COLORS } from '../render/palette';
import { slotDots, statusIcon, statusText } from './status';
import { t } from './strings';
import './cards.css';

export interface CardsCallbacks {
  /** `targetId` is set for sabotage aimed at one opponent (picked in the picker). */
  onPlay(uid: string, targetId?: string): void;
  onMark(uid: string): void;
  onConfirm(): void;
}

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

function setAttr(el: HTMLElement, name: string, value: string): void {
  if (el.getAttribute(name) !== value) el.setAttribute(name, value);
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
  private readonly el: Record<'pending' | 'hand' | 'detail' | 'offer' | 'discard' | 'picker' | 'toasts', HTMLElement>;
  private readonly cache = new Map<HTMLElement, string>();
  private selectedUid: string | null = null;
  /** Card whose target picker (opponent sabotage) or Gunung confirmation is open. */
  private pickerUid: string | null = null;
  private confirmUid: string | null = null;
  /** QA-CP4b-04: the picker DOM is built once per open card; rows are updated in place. */
  private pickerDomUid: string | null = null;
  private readonly pickerRows = new Map<string, HTMLButtonElement>();
  private state: Readonly<GameState> | null = null;
  private toasts: { text: string; until: number; tone: 'good' | 'bad' | 'info' }[] = [];

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
      <div class="card-modal" data-testid="discard-screen" hidden></div>
      <div class="card-modal picker-modal" data-testid="target-picker" hidden></div>
      <div class="card-toasts" data-testid="card-toasts" aria-live="polite"></div>`;
    const q = (s: string) => root.querySelector(s) as HTMLElement;
    this.el = {
      pending: q('.pending-row'),
      hand: q('.hand-bar'),
      detail: q('.hand-detail'),
      offer: q('[data-testid="card-offer"]'),
      discard: q('[data-testid="discard-screen"]'),
      picker: q('[data-testid="target-picker"]'),
      toasts: q('[data-testid="card-toasts"]'),
    };
    root.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const btn = target.closest<HTMLElement>('[data-card-action]');
      if (!btn || (btn as HTMLButtonElement).disabled) return;
      const uid = btn.dataset.uid ?? '';
      switch (btn.dataset.cardAction) {
        case 'select': this.selectedUid = this.selectedUid === uid ? null : uid; this.pickerUid = null; this.confirmUid = null; break;
        case 'cancel': this.selectedUid = null; this.pickerUid = null; this.confirmUid = null; break;
        case 'play': this.onPlayClicked(); break;
        case 'picker-cancel': this.pickerUid = null; break; // back to the card detail
        case 'pick': if (this.pickerUid && btn.dataset.target) this.cb.onPlay(this.pickerUid, btn.dataset.target); break;
        case 'confirm-yes': { const u = this.confirmUid; this.confirmUid = null; this.selectedUid = null; if (u) this.cb.onPlay(u); break; }
        case 'confirm-no': this.confirmUid = null; break;
        case 'mark': this.cb.onMark(uid); break;
        case 'confirm': this.cb.onConfirm(); break;
      }
    });
  }

  dispose(): void {
    this.root.remove();
  }

  /** True when a picker / confirmation / detail was open (Esc closes it instead of pausing). */
  closeCardPopovers(): boolean {
    const was = this.pickerUid !== null || this.confirmUid !== null || this.selectedUid !== null;
    this.pickerUid = null;
    this.confirmUid = null;
    this.selectedUid = null;
    return was;
  }

  /** Esc closes a card popover before it pauses: main asks first. */
  hasOpenPopover(): boolean {
    return this.pickerUid !== null || this.confirmUid !== null || this.selectedUid !== null;
  }

  private onPlayClicked(): void {
    const state = this.state;
    const uid = this.selectedUid;
    const me = state?.players.find((p) => p.id === this.humanId);
    const card = uid ? me?.hand.find((c) => c.uid === uid) : undefined;
    if (!state || !me || !uid || !card) return;
    const def = getCard(card.defId);
    if (def.type === 'sabotage' && def.target === 'opponent') {
      const others = state.players.filter((p) => p.id !== this.humanId);
      if (others.length === 1) {
        // One opponent in the match: the picker is skipped (ui-flow §7).
        this.selectedUid = null;
        this.cb.onPlay(uid, (others[0] as PlayerState).id);
      } else this.pickerUid = uid;
    } else if (def.target === 'all_opponents') {
      this.confirmUid = uid;
    } else {
      this.selectedUid = null;
      this.cb.onPlay(uid);
    }
  }

  /** The reducer refused a play (cards.md §2.2.1 (c)): say why, keep the picker open, nothing was spent. */
  onRejected(state: Readonly<GameState>, action: GameAction, reason: RejectReason): void {
    if (action.type !== 'playCard' || action.playerId !== this.humanId) return;
    if (reason !== 'bad-target' && reason !== 'card-unplayable') return;
    const me = state.players.find((p) => p.id === this.humanId);
    const card = me?.hand.find((c) => c.uid === action.cardUid);
    const target = state.players.find((p) => p.id === action.targetId);
    if (!me || !card || !target) return;
    const check = checkTarget(state, me, getCard(card.defId), target);
    if (!check.ok && check.label) this.toast(t('toast.targetInvalid', { name: target.name, label: t(`target.label.${check.label}`) }), 'bad');
  }

  /** Toasts for card events (cards.md §2.2.5, ui-flow §7 "Umpan balik"). Card names only for sender and target (DR-33). */
  onEvents(state: Readonly<GameState>, events: readonly GameEvent[]): void {
    const nm = (id: string): string => (id === this.humanId ? t('you') : (state.players.find((p) => p.id === id)?.name ?? id));
    const cn = (cardId: string): string => t(getCard(cardId).nameKey);
    const me = this.humanId;
    for (const e of events) {
      if (e.type === 'sabotagePlayed') {
        const mineSent = e.senderId === me;
        const mineTarget = e.targetId === me;
        const card = cn(e.cardId);
        if (mineSent) {
          switch (e.outcome) {
            case 'landed': this.toast(t('toast.sentLanded', { card, target: nm(e.targetId) }), 'info'); break;
            case 'blocked': this.toast(t('toast.sentBlocked', { target: nm(e.targetId) }), 'bad'); break;
            case 'reflected': this.toast(t('toast.sentReflected'), 'bad'); break;
            case 'reflectBurned': this.toast(t('toast.sentReflectBurned'), 'info'); break;
            case 'reflectEmpty': this.toast(t('toast.sentReflectEmpty', { target: nm(e.targetId) }), 'info'); break;
            default: break; // stolen / reflectStolen: the cardStolen event speaks
          }
        } else if (mineTarget) {
          const sender = nm(e.senderId);
          switch (e.outcome) {
            case 'landed': this.toast(t('toast.gotSabotaged', { sender, card }), 'bad'); break;
            case 'blocked': this.toast(t('toast.gotBlocked', { sender, card }), 'good'); break;
            case 'reflected': this.toast(t('toast.gotReflected', { sender, card }), 'good'); break;
            case 'reflectBurned': this.toast(t('toast.gotReflectBurned', { sender, card }), 'good'); break;
            case 'reflectEmpty': this.toast(t('toast.gotReflectEmpty', { sender }), 'good'); break;
            default: break;
          }
        } else if (e.outcome === 'landed') {
          this.toast(t('toast.othersSabotage', { sender: nm(e.senderId), target: nm(e.targetId) }), 'info');
        }
      } else if (e.type === 'cardStolen') {
        const card = cn(e.cardId);
        if (e.thiefId === me) this.toast(t('toast.youStole', { card, victim: nm(e.victimId) }), 'good');
        else if (e.victimId === me) {
          this.toast(t('toast.stolenFromYou', { thief: nm(e.thiefId), card }), 'bad');
          // DR-27: the popover / picker of the stolen card closes; popovers for other cards stay.
          const gone = e.uid === this.selectedUid || e.uid === this.pickerUid || e.uid === this.confirmUid;
          if (gone) {
            this.selectedUid = null;
            this.pickerUid = null;
            this.confirmUid = null;
            this.toast(t('toast.cardStolen', { card }), 'bad');
          }
        } else this.toast(t('toast.othersStole', { thief: nm(e.thiefId), victim: nm(e.victimId) }), 'info');
      } else if (e.type === 'discardCancelled' && e.playerId === me) {
        this.toast(t('toast.noNeedDiscard'), 'info');
      }
    }
  }

  private toast(text: string, tone: 'good' | 'bad' | 'info'): void {
    this.toasts.push({ text, tone, until: performance.now() + 2800 });
    if (this.toasts.length > 3) this.toasts.shift();
    this.renderToasts();
  }

  private renderToasts(): void {
    const now = performance.now();
    this.toasts = this.toasts.filter((x) => x.until > now);
    this.patch(this.el.toasts, this.toasts.map((x, i) => `<p class="ctoast ${x.tone}" data-testid="card-toast-${i}">${esc(x.text)}</p>`).join(''));
  }

  render(state: Readonly<GameState>): void {
    this.state = state;
    const me = state.players.find((p) => p.id === this.humanId);
    const visible = !!me && state.status === 'running' && me.phase !== 'finished';
    this.root.hidden = !visible;
    if (!me || !visible) return;
    const screenOpen = !!(me.offer || me.discard);
    if (this.selectedUid && (screenOpen || me.phase !== 'idle' || !me.hand.some((c) => c.uid === this.selectedUid))) this.selectedUid = null;
    if (this.pickerUid && (this.pickerUid !== this.selectedUid || screenOpen || me.phase !== 'idle')) this.pickerUid = null;
    if (this.confirmUid && this.confirmUid !== this.selectedUid) this.confirmUid = null;
    this.guardPicker(state, me);
    this.renderToasts();

    this.renderPending(me);
    this.renderHand(state, me);
    this.renderDetail(state, me);
    this.renderPicker(state, me);
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

  /** Picker auto-close: card gone, or no valid opponent left (then with a toast). */
  private guardPicker(state: Readonly<GameState>, me: PlayerState): void {
    const uid = this.pickerUid;
    if (!uid) return;
    const card = me.hand.find((c) => c.uid === uid);
    if (!card) {
      this.pickerUid = null;
      return;
    }
    const def = getCard(card.defId);
    if (!opponentChecks(state, me, def).some((c) => c.check.ok)) {
      this.pickerUid = null;
      this.toast(t('toast.noTargets'), 'bad');
    }
  }

  /**
   * QA-CP4b-04: the picker is built once per open card and then updated per node (text, classes,
   * attributes), never by replacing innerHTML. A row that lives under a touch keeps its DOM node,
   * so the browser still delivers the click while bots change state around it.
   */
  private renderPicker(state: Readonly<GameState>, me: PlayerState): void {
    const card = this.pickerUid ? me.hand.find((c) => c.uid === this.pickerUid) : undefined;
    if (!card) {
      if (this.pickerDomUid !== null) {
        this.pickerDomUid = null;
        this.pickerRows.clear();
        this.el.picker.replaceChildren();
      }
      this.el.picker.hidden = true;
      return;
    }
    const def = getCard(card.defId);
    if (this.pickerDomUid !== card.uid) {
      this.pickerDomUid = card.uid;
      this.pickerRows.clear();
      this.el.picker.innerHTML = `<div class="card-screen picker">
        <h2 data-testid="picker-title">${t('picker.title', { card: esc(t(def.nameKey)) })}</h2>
        <div class="picker-list"></div>
        <button class="picker-cancel" data-card-action="picker-cancel" data-testid="btn-picker-cancel">${t('picker.cancel')}</button></div>`;
    }
    this.el.picker.hidden = false;
    const list = this.el.picker.querySelector('.picker-list') as HTMLElement;
    const checks = new Map(opponentChecks(state, me, def).map((c) => [c.id, c.check] as const));
    const order = ranking(state);
    const opponents = order.filter((p) => p.id !== this.humanId);
    opponents.forEach((p, index) => {
      const check = checks.get(p.id);
      const ok = !!check?.ok;
      const labelText = check && !check.ok && check.label ? t(`target.label.${check.label}`) : '';
      const rank = order.findIndex((q) => q.id === p.id) + 1;
      const sent = p.pending.filter((c) => c.source === this.humanId && getCard(c.defId).type === 'sabotage');
      const sentText = sent.map((c) => `${getCard(c.defId).icon} ${t(getCard(c.defId).nameKey)}`).join(', ');
      let row = this.pickerRows.get(p.id);
      if (!row) {
        const btn = document.createElement('button');
        btn.className = 'picker-row';
        btn.dataset.cardAction = 'pick';
        btn.dataset.target = p.id;
        btn.dataset.testid = `picker-row-${p.id}`;
        btn.innerHTML = `<span class="dot" style="background:${PLAYER_CSS_COLORS[p.colorIndex % PLAYER_CSS_COLORS.length]}"></span>
          <span class="prank" data-testid="picker-rank-${p.id}"></span>
          <span class="pname">${esc(p.name)}</span>
          <span class="pmeta"><span class="pm-wins"></span> · <span class="pm-status"></span> · <span class="pm-cards"></span> · <span data-testid="picker-slots-${p.id}"></span></span>`;
        row = btn;
        this.pickerRows.set(p.id, btn);
      }
      // Keep rows in ranking order, moving a node only when its position actually changed.
      if (list.children[index] !== row) list.insertBefore(row, list.children[index] ?? null);
      setAttr(row, 'data-valid', String(ok));
      row.disabled = !ok;
      row.classList.toggle('dim', !ok);
      const q = (sel: string) => row.querySelector(sel) as HTMLElement;
      setText(q('.prank'), `#${rank}`);
      setText(q('.pm-wins'), t('race.winsLeft', { n: p.remainingWins }));
      setText(q('.pm-status'), statusIcon(state, p));
      setAttr(q('.pm-status'), 'title', statusText(state, p));
      setText(q('.pm-cards'), t('picker.cards', { n: p.hand.length }));
      setText(q(`[data-testid="picker-slots-${p.id}"]`), slotDots(sabotageSlotsUsed(p)));
      this.optionalChild(row, 'pleader', rank === 1 ? t('picker.leader') : '', q('.pmeta'));
      this.optionalChild(row, 'plabel', labelText, null, `picker-label-${p.id}`);
      this.optionalChild(row, 'psent', sentText, null, undefined, t('picker.sent'));
    });
    for (const [id, row] of this.pickerRows) {
      if (!opponents.some((p) => p.id === id)) {
        row.remove();
        this.pickerRows.delete(id);
      }
    }
  }

  /** A span that exists only while it has text (so the DOM matches the old template exactly). */
  private optionalChild(row: HTMLElement, cls: string, text: string, before: HTMLElement | null, testid?: string, title?: string): void {
    let el = row.querySelector<HTMLElement>(`:scope > .${cls}`);
    if (!text) {
      el?.remove();
      return;
    }
    if (!el) {
      el = document.createElement('span');
      el.className = cls;
      if (testid) el.dataset.testid = testid;
      if (title) el.title = title;
      if (cls === 'pleader') row.insertBefore(el, before);
      else row.appendChild(el);
    }
    setText(el, text);
  }

  private renderDetail(state: Readonly<GameState>, me: PlayerState): void {
    const c = this.selectedUid && !this.pickerUid ? me.hand.find((x) => x.uid === this.selectedUid) : undefined;
    if (!c) {
      this.el.detail.hidden = true;
      this.patch(this.el.detail, '');
      return;
    }
    const def = getCard(c.defId);
    const play = cardPlayability(this.map, state, me, c);
    const warnings = play.ok ? cardWarnings(this.map, me, c) : [];
    const when = [t(`duration.${def.duration}`), def.trigger ? t(`trigger.${def.trigger}`) : ''].filter(Boolean).join(' · ');
    if (this.confirmUid === c.uid) {
      // Gunung Meletus: no picker, a confirmation that names the effect (ui-flow §7 point 6).
      const sum = impactSummary(state, me, def);
      const skipped = sum.skipped.map((x) => t('confirm.skipped', { name: state.players.find((p) => p.id === x.id)?.name ?? x.id, label: x.label ? t(`target.label.${x.label}`).toLowerCase() : '' }).trim());
      const text = t('confirm.all', { hit: sum.hit, total: sum.total }) + (skipped.length ? ` (${skipped.join(', ')})` : '');
      this.el.detail.hidden = false;
      this.patch(this.el.detail, `<div class="detail-card">${cardFace(def)}
        <div class="detail-text"><h3>${esc(t(def.nameKey))}</h3><p data-testid="confirm-text">${esc(text)}</p></div>
        <div class="detail-actions">
          <button class="ok" data-card-action="confirm-yes" data-testid="btn-confirm-yes">${t('confirm.yes')}</button>
          <button data-card-action="confirm-no" data-testid="btn-confirm-no">${t('confirm.no')}</button></div></div>`);
      return;
    }
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
