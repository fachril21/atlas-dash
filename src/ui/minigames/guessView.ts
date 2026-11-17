/**
 * Tebak Lokasi render half (HTML/CSS). Rules are pure (src/logic/minigames/guessLocation.ts);
 * all question data comes from the active map (`places`, `regions`). The "picture" is an inline
 * SVG placeholder (final illustrations arrive in CP6). Choices: 1 column on phones, 2x2 on
 * desktop, keys 1-4 select.
 */
import {
  guessLocationLogic,
  localize,
  questionDeadlineMs,
  type GuessInput,
  type GuessLevel,
  type GuessState,
  type MinigameContext,
} from '../../logic';
import { t } from '../strings';
import { MinigameViewBase } from './instanceBase';
import { placeSceneSvg } from './pictograms';
import type { MinigameDefinition, MinigameInstance } from './types';
import './guess.css';

const FOG_FADE_MS = 2000;
const FOG_STATIC_REDUCED_PX = 3;
const LANG = 'id';

class GuessInstance extends MinigameViewBase<GuessLevel, GuessInput, GuessState> {
  private readonly root: HTMLElement;
  private readonly timerFill: HTMLElement;
  private readonly seconds: HTMLElement;
  private readonly progress: HTMLElement;
  private readonly pic: HTMLElement;
  private readonly clue: HTMLElement;
  private readonly choices: HTMLButtonElement[] = [];
  private readonly live: HTMLElement;
  private shownQ = -1;
  private combo = 0;

  constructor(container: HTMLElement, ctx: MinigameContext, level: GuessLevel) {
    super(ctx, level, guessLocationLogic);
    const root = document.createElement('div');
    root.className = 'mg-guess';
    root.dataset.testid = 'mg-play-area';
    root.innerHTML = `
      <div class="gl-top">
        <div class="gl-timer" data-testid="mg-timer"><div class="gl-timer-fill"></div></div>
        <div class="gl-stats">
          <span class="gl-progress" data-testid="mg-progress"></span>
          <span class="gl-seconds" data-testid="mg-seconds"></span>
        </div>
      </div>
      <div class="gl-stage">
        <div class="gl-pic" role="img" data-testid="mg-picture"></div>
        <p class="gl-clue" data-testid="mg-clue"></p>
        <div class="gl-choices" data-testid="mg-choices"></div>
      </div>
      <div class="gl-live" role="status" aria-live="polite" data-testid="mg-live"></div>`;
    container.appendChild(root);
    this.root = root;
    const q = (s: string) => root.querySelector(s) as HTMLElement;
    this.timerFill = q('.gl-timer-fill');
    this.seconds = q('.gl-seconds');
    this.progress = q('.gl-progress');
    this.pic = q('.gl-pic');
    this.clue = q('.gl-clue');
    this.live = q('.gl-live');
    const box = q('.gl-choices');
    for (let i = 0; i < level.choiceCount; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'gl-choice';
      b.dataset.testid = `mg-choice-${i}`;
      b.dataset.index = String(i);
      b.innerHTML = `<span class="gl-num" aria-hidden="true">${i + 1}</span><span class="gl-text"></span><span class="gl-mark" aria-hidden="true"></span>`;
      box.appendChild(b);
      this.choices.push(b);
    }
    if (ctx.settings.reducedMotion) root.classList.add('reduced-motion');
    if (ctx.settings.reducedFlash) root.classList.add('reduced-flash');

    const opts = { signal: this.abort.signal };
    for (const b of this.choices) {
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.queueInput({ choice: Number(b.dataset.index) }, e.timeStamp);
      }, opts);
      // Keyboard activation (Tab + Enter/Space) arrives as click without a pointer.
      b.addEventListener('click', (e) => {
        if (e.detail === 0) this.queueInput({ choice: Number(b.dataset.index) }, e.timeStamp);
      }, opts);
    }
    window.addEventListener('keydown', (e) => {
      if (e.repeat || e.altKey || e.ctrlKey || e.metaKey) return;
      const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
      if (m && Number(m[1]) <= level.choiceCount) {
        e.preventDefault();
        this.queueInput({ choice: Number(m[1]) - 1 }, e.timeStamp);
      }
    }, opts);
    this.showQuestion(0);
    this.draw();
  }

  private regionName(id: string): string {
    const r = this.ctx.map.regions.find((x) => x.id === id);
    return r ? localize(r.name, LANG) : id;
  }

  private showQuestion(q: number): void {
    const { level } = this;
    const item = level.items[q];
    if (!item) return;
    this.shownQ = q;
    const placeIndex = this.ctx.map.places.findIndex((p) => p.id === item.placeId);
    const place = this.ctx.map.places[placeIndex];
    this.pic.innerHTML = placeSceneSvg(Math.max(0, placeIndex), item.placeId);
    let clue = '';
    if (level.clueMode === 'nameAndImage') clue = localize(place?.name, LANG);
    else if (level.clueMode === 'hintAndImage') clue = localize(place?.hint, LANG);
    this.clue.textContent = clue;
    this.clue.hidden = clue === '';
    // alt must never leak the answer: hard shows the picture alone.
    this.pic.setAttribute('aria-label', clue !== '' ? clue : t('mg.gl.imageOnlyAlt'));
    this.choices.forEach((b, i) => {
      const id = item.choices[i] as string;
      (b.querySelector('.gl-text') as HTMLElement).textContent = this.regionName(id);
      (b.querySelector('.gl-mark') as HTMLElement).textContent = '';
      b.dataset.state = '';
      b.hidden = level.hintActive && i === item.hintRemovedIndex;
      b.disabled = false;
    });
    this.root.dataset.q = String(q);
  }

  protected onStateChange(prev: GuessState, next: GuessState): void {
    if (next.answer && next.answer !== prev.answer) {
      const item = this.level.items[next.q] as GuessLevel['items'][number];
      const right = item.choices.indexOf(item.correctRegionId);
      this.choices.forEach((b, i) => {
        b.disabled = true;
        if (i === right) {
          b.dataset.state = 'right';
          (b.querySelector('.gl-mark') as HTMLElement).textContent = '✓';
        } else if (i === next.answer?.choice) {
          b.dataset.state = 'wrong';
          (b.querySelector('.gl-mark') as HTMLElement).textContent = '✗';
        }
      });
      if (next.answer.correct) {
        this.combo += 1;
        this.ting(this.combo);
        this.live.textContent = t('mg.gl.correct');
      } else {
        this.combo = 0;
        this.bonk();
        this.live.textContent = next.answer.choice === null ? t('mg.gl.timeUp') : t('mg.gl.wrong');
        if (next.answer.choice === null && !this.ctx.settings.reducedFlash) this.pulse(this.root.querySelector('.gl-timer') as HTMLElement, 'blink');
      }
    }
    if (next.q !== this.shownQ && !next.result) this.showQuestion(next.q);
  }

  protected override onDestroy(): void {
    this.root.remove();
  }

  protected draw(): void {
    const { level, state, playT } = this;
    const open = !state.answer && !state.result;
    const left = open ? Math.max(0, questionDeadlineMs(level, state) - playT) : 0;
    this.drawTimer(this.timerFill, left, level.timePerQuestionMs);
    (this.timerFill.parentElement as HTMLElement).classList.toggle('low', open && left < 2000);
    this.seconds.textContent = open ? `${Math.ceil(left / 1000)} s` : '';
    this.progress.textContent = t('mg.gl.question', { n: Math.min(state.q + 1, level.questions), N: level.questions });
    this.progress.dataset.correct = String(state.correct);
    this.root.dataset.phase = state.answer ? 'gap' : 'question';
    this.root.dataset.correct = String(state.correct);
    // Fog: the picture is blurred and clears within 2 s of each question (texts never blur).
    if (level.fogBlurPx > 0) {
      const k = open ? Math.min(1, (playT - state.qStartMs) / FOG_FADE_MS) : 1;
      const px = this.ctx.settings.reducedMotion ? FOG_STATIC_REDUCED_PX : level.fogBlurPx * (1 - k);
      this.pic.style.filter = px > 0.05 ? `blur(${px.toFixed(1)}px)` : '';
    }
  }
}

export const guessDefinition: MinigameDefinition<GuessLevel> = {
  ...guessLocationLogic,
  introIconHtml: '<span class="icon-guess" aria-hidden="true"><i class="pic"></i><i class="q">?</i></span>',
  create: (container, ctx, level): MinigameInstance => new GuessInstance(container, ctx, level),
};
