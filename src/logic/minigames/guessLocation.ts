/**
 * Tebak Lokasi (`guess_location`), pure rules. Spec: minigames.md §8.
 * Multiple choice on the map's own data: a place picture, choose its region. Nothing about a
 * specific map lives in code; questions come from `map.places` and `map.regions`.
 */
import type { Difficulty, MapData } from '../map';
import { Rng } from '../rng';
import type { MinigameContext, MinigameLogic, MinigameResult } from './types';

export const GUESS_BASE_MS = 26_000;
export const GUESS_KNOBS: Readonly<Record<Difficulty, {
  questions: number;
  correctRequired: number;
  choiceCount: number;
  timePerQuestionMs: number;
  clueMode: GuessClueMode;
}>> = {
  easy: { questions: 3, correctRequired: 2, choiceCount: 3, timePerQuestionMs: 8000, clueMode: 'nameAndImage' },
  medium: { questions: 4, correctRequired: 3, choiceCount: 4, timePerQuestionMs: 6000, clueMode: 'hintAndImage' },
  hard: { questions: 5, correctRequired: 4, choiceCount: 4, timePerQuestionMs: 5000, clueMode: 'imageOnly' },
};
export const GUESS_GAP_MS = 500;
export const GUESS_TIME_MIN_MS = 3000;
export const GUESS_TIME_MAX_MS = 10_000;
export const GUESS_MAX_QUESTIONS = 7;
export const GUESS_MAX_EXTRA = 2;
export const GUESS_MIN_PLACES = 10;
export const GUESS_MIN_PLACE_REGIONS = 7;
export const GUESS_FOG_BLUR_PX = 6;

export type GuessClueMode = 'nameAndImage' | 'hintAndImage' | 'imageOnly';

export interface GuessItem {
  placeId: string;
  correctRegionId: string;
  /** Region ids, correct one included exactly once. */
  choices: string[];
  /** Index in `choices` of the wrong option removed by the hint card. */
  hintRemovedIndex: number;
}

export interface GuessLevel {
  durationMs: number;
  questions: number;
  correctRequired: number;
  timePerQuestionMs: number;
  gapMs: number;
  choiceCount: number;
  clueMode: GuessClueMode;
  items: GuessItem[];
  hintActive: boolean;
  /** Blur (px) of the picture at the start of each question; 0 without the fog card. */
  fogBlurPx: number;
  warnings: string[];
}

export type GuessInput = { choice: number };

export interface GuessState {
  tMs: number;
  /** Current question index (the one shown, or the one just answered during the gap). */
  q: number;
  qStartMs: number;
  /** The current question's resolution, set on an answer or on timeout; null while open. */
  answer: { choice: number | null; correct: boolean; atMs: number } | null;
  correct: number;
  result: MinigameResult | null;
}

export function guessRequires(map: MapData): boolean {
  const places = map.places ?? [];
  return places.length >= GUESS_MIN_PLACES && new Set(places.map((p) => p.regionId)).size >= GUESS_MIN_PLACE_REGIONS;
}

/** Effective time per question (DR-17): clamp(round((base + timeDelta / baseQuestions) x tol / speed), 3 s, 10 s). */
export function timePerQuestion(baseMs: number, timeDeltaS: number, baseQuestions: number, tolerance: number, speed: number): number {
  const raw = Math.round(((baseMs + (timeDeltaS * 1000) / baseQuestions) * tolerance) / speed);
  return Math.min(GUESS_TIME_MAX_MS, Math.max(GUESS_TIME_MIN_MS, raw));
}

export function questionDeadlineMs(level: GuessLevel, state: Pick<GuessState, 'qStartMs'>): number {
  return state.qStartMs + level.timePerQuestionMs;
}

function progressOf(level: GuessLevel, s: GuessState): number {
  return Math.min(1, s.correct / level.correctRequired);
}

/** Resolve the current question (answer or timeout); may finish the run. Mutates s. */
function resolveQuestion(level: GuessLevel, s: GuessState, choice: number | null, correct: boolean, atMs: number): void {
  s.answer = { choice, correct, atMs };
  if (correct) s.correct += 1;
  const remaining = level.questions - (s.q + 1);
  if (s.correct >= level.correctRequired) {
    s.result = { passed: true, timeTakenMs: atMs, progress: 1, reason: 'success' };
  } else if (s.correct + remaining < level.correctRequired) {
    s.result = { passed: false, timeTakenMs: atMs, progress: progressOf(level, s), reason: 'failLimit' };
  }
}

export const guessLocationLogic: MinigameLogic<GuessLevel, GuessInput, GuessState> = {
  id: 'guess_location',
  render: '2d',
  introKey: 'mg.guess_location.intro',
  baseDurationMs: GUESS_BASE_MS,
  requires: guessRequires,

  generateLevel(ctx: MinigameContext): GuessLevel {
    const rng = new Rng(ctx.seed);
    const k = GUESS_KNOBS[ctx.difficulty];
    let timeDelta = 0;
    let tolerance = 1;
    let speed = 1;
    let extra = 0;
    let fog = false;
    let hint = false;
    const warnings: string[] = [];
    for (const m of ctx.modifiers) {
      switch (m.kind) {
        case 'timeDelta': timeDelta += m.seconds; break;
        case 'tolerance': tolerance *= m.mult; break;
        case 'speed': speed *= m.mult; break;
        case 'extraTarget': extra = Math.min(extra + m.count, GUESS_MAX_EXTRA); break;
        case 'fog': fog = true; break;
        case 'hint': hint = true; break;
        default: warnings.push(`guess_location: ignored modifier ${JSON.stringify(m)}`);
      }
    }
    const places = ctx.map.places ?? [];
    const regionIds = ctx.map.regions.map((r) => r.id);
    const questions = Math.min(k.questions + extra, GUESS_MAX_QUESTIONS, places.length);
    const correctRequired = Math.min(k.correctRequired + extra, questions);
    const choiceCount = Math.min(k.choiceCount, regionIds.length);
    const timePerQuestionMs = timePerQuestion(k.timePerQuestionMs, timeDelta, k.questions, tolerance, speed);

    // 1. shuffle the places; 2. first pass takes unused regions, second pass fills the rest.
    const shuffled = rng.shuffle(places);
    const picked: typeof places = [];
    const usedRegions = new Set<string>();
    for (const p of shuffled) {
      if (picked.length >= questions) break;
      if (!usedRegions.has(p.regionId)) {
        picked.push(p);
        usedRegions.add(p.regionId);
      }
    }
    for (const p of shuffled) {
      if (picked.length >= questions) break;
      if (!picked.includes(p)) picked.push(p);
    }

    // 3. per question: decoys prefer regions that appeared least as a choice so far.
    const appeared = new Map<string, number>(regionIds.map((id) => [id, 0]));
    const items: GuessItem[] = [];
    for (const place of picked) {
      const decoys = rng.shuffle(regionIds.filter((id) => id !== place.regionId));
      decoys.sort((a, b) => (appeared.get(a) as number) - (appeared.get(b) as number)); // stable: ties keep shuffle order
      const chosen = decoys.slice(0, choiceCount - 1);
      const choices = rng.shuffle([place.regionId, ...chosen]);
      const removed = chosen[rng.int(0, choiceCount - 2)] as string; // always drawn, hint or not
      for (const id of choices) appeared.set(id, (appeared.get(id) as number) + 1);
      items.push({ placeId: place.id, correctRegionId: place.regionId, choices, hintRemovedIndex: choices.indexOf(removed) });
    }

    return {
      durationMs: questions * timePerQuestionMs + (questions - 1) * GUESS_GAP_MS,
      questions,
      correctRequired,
      timePerQuestionMs,
      gapMs: GUESS_GAP_MS,
      choiceCount,
      clueMode: k.clueMode,
      items,
      hintActive: hint,
      fogBlurPx: fog ? GUESS_FOG_BLUR_PX : 0,
      warnings,
    };
  },

  initState(): GuessState {
    return { tMs: 0, q: 0, qStartMs: 0, answer: null, correct: 0, result: null };
  },

  step(level, prev, input, tMs) {
    if (prev.result) return prev;
    const t = Math.max(tMs, prev.tMs);
    const s: GuessState = { ...prev, tMs: t };

    // Time-driven part: a question times out at its deadline, the next starts gapMs later.
    for (let guard = 0; guard < 64 && !s.result; guard++) {
      if (!s.answer) {
        const deadline = questionDeadlineMs(level, s);
        if (t < deadline) break;
        resolveQuestion(level, s, null, false, deadline);
      } else {
        const nextStart = s.answer.atMs + level.gapMs;
        if (t < nextStart) break;
        s.q += 1;
        s.qStartMs = nextStart;
        s.answer = null;
      }
    }
    if (s.result || !input || s.answer) return s; // input during the gap is ignored
    const item = level.items[s.q] as GuessItem;
    const c = input.choice;
    if (!Number.isInteger(c) || c < 0 || c >= item.choices.length) return s;
    if (level.hintActive && c === item.hintRemovedIndex) return s; // the removed option is not selectable
    resolveQuestion(level, s, c, item.choices[c] === item.correctRegionId, t);
    return s;
  },

  result(_level, state) {
    return state.result;
  },
};
