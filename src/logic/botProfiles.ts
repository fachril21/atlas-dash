/**
 * Bot tunables (bots.md §8) as data. The controller and the decision functions hold no bot
 * numbers of their own: everything that can be tuned is in BOT_PROFILE, BOT_CARD_VALUE and the
 * small order lists below. HUMAN_PROFILE holds the reference humans of bots.md §9, which run on
 * the same controller class with the leader brake switched off (used by the headless simulator).
 */
import type { Difficulty } from './map';
import type { BotLevel } from './state';

export type Range = readonly [number, number];
export type RoutePolicy = 'random' | 'shortest' | 'expectedCost';
export type OfferPolicy = 'random' | 'value' | 'valueContext';
export type DiscardPolicy = 'autoRule' | 'lowestValue';
/** Which card rule set runs: Easy plays at random, Normal/Hard use the §7 priority list. */
export type CardLogic = 'random' | 'normal' | 'hard';

export interface BotProfile {
  name: string;
  /** Pass chance by effective difficulty of the attempt (§3). */
  passChance: Readonly<Record<Difficulty, number>>;
  /** Fraction of the level duration a passing / failing attempt takes (uniform in the range). */
  passTimeFrac: Range;
  failTimeFrac: Range;
  /** +- points per modifier kind (DR-35) and the clamp. */
  modifierPoints: number;
  passMin: number;
  passMax: number;
  /** Delay before choosing a target / pressing Mulai, and after a won attempt (§3). */
  thinkMs: Range;
  afterWinMs: Range;
  /** Card evaluation period, minimum gap between two cards, chance an evaluation acts at all. */
  tickMs: Range;
  cardGapMs: number;
  cardPlayChance: number;
  /** Boost cards for the next attempt are only played while p_next <= this (Normal/Hard). */
  boostMaxPass: number;
  /** Hand size from which the overflow rule plays the lowest-value card. */
  overflowHand: number;
  cardLogic: CardLogic;
  routePolicy: RoutePolicy;
  /** Normal: chance to pick a random non-best neighbour instead of the shortest route. */
  routeMistake: number;
  /** Hard route cost: value of one card in ms, and the average minigame duration estimate. */
  cardValueMs: number;
  estDurationMs: number;
  offerPolicy: OfferPolicy;
  discardPolicy: DiscardPolicy;
  copetMinHand: number;
  copetMinGapMs: number;
  gunungMinValid: number;
  /** Leader brake (§4); Infinity switches it off. */
  paceTargetMs: number;
  paceSlackMs: number;
  restRecheckMs: number;
}

/** Pass chance per bot level and difficulty (gdd.md, Bot table); unchanged since CP3a. */
export const BOT_PASS_CHANCE: Readonly<Record<BotLevel, Record<Difficulty, number>>> = {
  easy: { easy: 0.7, medium: 0.5, hard: 0.3 },
  normal: { easy: 0.85, medium: 0.65, hard: 0.45 },
  hard: { easy: 0.92, medium: 0.8, hard: 0.65 },
};
/** DR-35: each modifier kind (after netting) moves a bot's pass chance by this many points. */
export const BOT_MODIFIER_POINTS = 0.08;
export const BOT_PASS_MIN = 0.05;
export const BOT_PASS_MAX = 0.98;
/** Fraction of the minigame duration a passing attempt takes (gdd.md, Bot table). */
export const BOT_TIME_RANGE: Readonly<Record<BotLevel, Range>> = {
  easy: [0.85, 1.0],
  normal: [0.7, 0.95],
  hard: [0.55, 0.85],
};

/** Minigames a bot wins by surviving to the end: a pass takes 100% of the duration (§3 step 3). */
export const SURVIVAL_MINIGAMES: ReadonlySet<string> = new Set(['dodge_runner']);

const COMMON = {
  modifierPoints: BOT_MODIFIER_POINTS,
  passMin: BOT_PASS_MIN,
  passMax: BOT_PASS_MAX,
  failTimeFrac: [0.4, 1.0] as Range,
  cardValueMs: 5000,
  estDurationMs: 25_000,
  paceSlackMs: 20_000,
  restRecheckMs: 1000,
};

export const BOT_PROFILE: Readonly<Record<BotLevel, BotProfile>> = {
  easy: {
    ...COMMON,
    name: 'easy',
    passChance: BOT_PASS_CHANCE.easy,
    passTimeFrac: BOT_TIME_RANGE.easy,
    thinkMs: [1500, 4000],
    afterWinMs: [18_000, 30_000],
    tickMs: [3000, 4000],
    cardGapMs: 8000,
    cardPlayChance: 0.3,
    boostMaxPass: 1,
    overflowHand: Infinity,
    cardLogic: 'random',
    routePolicy: 'random',
    routeMistake: 1,
    offerPolicy: 'random',
    discardPolicy: 'autoRule',
    copetMinHand: 1,
    copetMinGapMs: 90_000,
    gunungMinValid: 1,
    paceTargetMs: 870_000,
  },
  normal: {
    ...COMMON,
    name: 'normal',
    passChance: BOT_PASS_CHANCE.normal,
    passTimeFrac: BOT_TIME_RANGE.normal,
    thinkMs: [1000, 3000],
    afterWinMs: [22_000, 34_000],
    tickMs: [2500, 3500],
    cardGapMs: 5000,
    cardPlayChance: 1,
    boostMaxPass: 0.8,
    overflowHand: 4,
    cardLogic: 'normal',
    routePolicy: 'shortest',
    routeMistake: 0.15,
    offerPolicy: 'value',
    discardPolicy: 'lowestValue',
    copetMinHand: 2,
    copetMinGapMs: 75_000,
    gunungMinValid: 1,
    paceTargetMs: 840_000,
  },
  hard: {
    ...COMMON,
    name: 'hard',
    passChance: BOT_PASS_CHANCE.hard,
    passTimeFrac: BOT_TIME_RANGE.hard,
    thinkMs: [500, 2000],
    afterWinMs: [18_000, 30_000],
    tickMs: [2000, 3000],
    cardGapMs: 4000,
    cardPlayChance: 1,
    boostMaxPass: 0.7,
    overflowHand: 4,
    cardLogic: 'hard',
    routePolicy: 'expectedCost',
    routeMistake: 0,
    offerPolicy: 'valueContext',
    discardPolicy: 'lowestValue',
    copetMinHand: 3,
    copetMinGapMs: 60_000,
    gunungMinValid: 2,
    paceTargetMs: 610_000,
  },
};

/**
 * Reference humans (bots.md §9): same controller, no brake. `afterWinMs` is the calibration knob
 * for "median solo time" (QA gate §11 #14).
 */
export type HumanProfileId = 'casual' | 'attentive' | 'expert';

export const HUMAN_PROFILE: Readonly<Record<HumanProfileId, BotProfile>> = {
  casual: {
    ...BOT_PROFILE.normal,
    name: 'casual',
    passChance: { easy: 0.8, medium: 0.6, hard: 0.4 },
    passTimeFrac: [0.85, 1.0],
    thinkMs: [1500, 3500],
    afterWinMs: [36_000, 50_000],
    cardPlayChance: 0.6,
    paceTargetMs: Infinity,
  },
  attentive: {
    ...BOT_PROFILE.hard,
    name: 'attentive',
    passChance: { easy: 0.9, medium: 0.75, hard: 0.55 },
    passTimeFrac: [0.75, 0.95],
    thinkMs: [1000, 2500],
    afterWinMs: [27_500, 39_500],
    paceTargetMs: Infinity,
  },
  expert: {
    ...BOT_PROFILE.hard,
    name: 'expert',
    passChance: { easy: 0.95, medium: 0.85, hard: 0.7 },
    passTimeFrac: [0.65, 0.9],
    thinkMs: [800, 2000],
    afterWinMs: [21_500, 31_500],
    paceTargetMs: Infinity,
  },
};

/** Value of a card to a bot (bots.md §6): offer picks, discards and the overflow rule. */
export const BOT_CARD_VALUE: Readonly<Record<string, number>> = {
  gunung_meletus: 9,
  cermin_balik: 8,
  tiket_pesawat: 7,
  ojek_kilat: 7,
  copet: 6,
  badai: 6,
  santai_dulu: 6,
  payung_tameng: 5,
  tambah_beban: 4.5,
  ngebut: 4.5,
  jam_pasir: 4,
  zona_lebar: 3.5,
  teropong: 3.5,
  jam_rusak: 3,
  kabut_asap: 3,
  nyawa_cadangan: 3,
  macet_total: 2.5,
  pelit_hadiah: 2.5,
  oleh_oleh: 2,
  kopi_tubruk: 1.5,
};

/** Hard offer context adjustments (§6, "Penyesuaian konteks"). */
export const BOT_CONTEXT = {
  duplicatePenalty: -3,
  duplicatePenaltyTwoStack: -1,
  catchUpGap: 3,
  catchUpBonus: 1.5,
  catchUpCards: ['tiket_pesawat', 'ojek_kilat', 'santai_dulu'] as readonly string[],
  copetBonus: 1,
  copetRichHand: 3,
  defensePenalty: -3,
  defenseCards: ['payung_tameng', 'cermin_balik'] as readonly string[],
  noRegionPenalty: -2,
  needsRegionCards: ['oleh_oleh', 'kopi_tubruk', 'tiket_pesawat'] as readonly string[],
};

/** Play order inside the §7 groups (data, so a tuning pass never touches code). */
export const BOT_BOOST_ORDER: readonly string[] = ['santai_dulu', 'nyawa_cadangan', 'teropong', 'zona_lebar', 'jam_pasir'];
export const BOT_DEFENSE_ORDER: readonly string[] = ['cermin_balik', 'payung_tameng'];
/** Sabotage by expected impact (descending); Copet follows its own rules but sits by value. */
export const BOT_SABOTAGE_ORDER: readonly string[] = [
  'gunung_meletus', 'badai', 'copet', 'tambah_beban', 'ngebut', 'jam_rusak', 'macet_total', 'kabut_asap', 'pelit_hadiah',
];

/** Card play thresholds that are not per-level (§7 groups 2-5). */
export const BOT_CARD_RULES = {
  /** Kopi Tubruk: only when at least this much cooldown is left. */
  kopiMinCooldownMs: 2000,
  /** Gunung Meletus when the bot trails by at least this many wins (Hard). */
  gunungCatchUpGap: 3,
  /** Tiket Pesawat on a medium region when the bot trails by at least this many wins (Hard). */
  tiketMediumGap: 3,
};
