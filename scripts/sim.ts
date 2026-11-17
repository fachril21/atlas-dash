/**
 * Headless match simulator CLI (bots.md §9-§11): `npm run sim -- [--n 1000] [--seed 1] [--only solo|c1|win|botbot|all] [--human casual|attentive|expert] [--level easy|normal|hard] [--pool id,id,...] [--json]`.
 * Prints median match time and win rates per cell, with the §10 bands, for the QA gates.
 * Bundled with rolldown and run with node (see package.json), so it needs no extra tooling.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BOT_PROFILE,
  HUMAN_PROFILE,
  loadMap,
  minigamePool,
  MINIGAME_LOGIC,
  runCell,
  type BotLevel,
  type CellSummary,
  type HumanProfileId,
  type MapData,
  type SimSeat,
} from '../src/logic';

const args = process.argv.slice(2);
const opt = (name: string, def: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? def) : def;
};
const N = Number(opt('n', '1000'));
const SEED = Number(opt('seed', '1'));
const ONLY = opt('only', 'all');
const JSON_OUT = args.includes('--json');
// Optional cell filters for quick tuning runs: --human casual --level hard (both default to all).
const HUMAN_FILTER = opt('human', 'all');
const LEVEL_FILTER = opt('level', 'all');

const data = JSON.parse(readFileSync(join(process.cwd(), 'public/maps/indonesia/map.json'), 'utf8')) as MapData;
const map = loadMap(data, 'standard', MINIGAME_LOGIC);
// --pool a,b,c restricts the pool (e.g. the CP5a three: tap_timing,simon,dodge_runner) to measure what the new minigames change.
const POOL_FILTER = opt('pool', '');
const pool = minigamePool(map.data).filter((id) => POOL_FILTER === '' || POOL_FILTER.split(',').includes(id));

const LEVELS: BotLevel[] = ['easy', 'normal', 'hard'];
const HUMANS: HumanProfileId[] = ['casual', 'attentive', 'expert'];

/** bots.md §10 win-rate bands (percent), human seat vs k bots. */
const BANDS: Record<HumanProfileId, Record<BotLevel, Record<1 | 3, [number, number]>>> = {
  casual: { easy: { 1: [75, 90], 3: [50, 75] }, normal: { 1: [35, 55], 3: [8, 22] }, hard: { 1: [15, 35], 3: [3, 12] } },
  attentive: { easy: { 1: [90, 99], 3: [85, 97] }, normal: { 1: [60, 80], 3: [25, 45] }, hard: { 1: [35, 55], 3: [12, 25] } },
  expert: { easy: { 1: [97, 100], 3: [95, 100] }, normal: { 1: [80, 92], 3: [45, 65] }, hard: { 1: [55, 75], 3: [25, 45] } },
};
const SOLO_TARGET: Record<HumanProfileId, number> = { casual: 11.0, attentive: 8.0, expert: 6.5 };

const humanSeat = (h: HumanProfileId): SimSeat => ({ id: 'p1', kind: 'human', profile: HUMAN_PROFILE[h] });
const botSeats = (level: BotLevel, k: number): SimSeat[] =>
  Array.from({ length: k }, (_, i) => ({ id: `bot${i + 1}`, kind: 'bot' as const, profile: BOT_PROFILE[level], botLevel: level }));
const fmt = (x: number, d = 1): string => x.toFixed(d);
const inBand = (pct: number, [lo, hi]: [number, number]): boolean => pct >= lo && pct <= hi;

const out: Record<string, unknown> = { n: N, seed: SEED, maxRejected: 0 };
const log = (s: string): void => { if (!JSON_OUT) console.log(s); };
let totalRejected = 0;
const t0 = Date.now();
const cell = (seats: SimSeat[], label: string): CellSummary => {
  const r = runCell({ map, pool, seats }, label, N, SEED);
  totalRejected += r.rejected;
  return r;
};

if (ONLY === 'all' || ONLY === 'solo') {
  log(`\n== Solo calibration (median minutes, target +-0.7; ${N} matches) ==`);
  const rows: unknown[] = [];
  for (const h of HUMANS) {
    const r = cell([humanSeat(h)], `solo:${h}`);
    const ok = Math.abs(r.medianMin - SOLO_TARGET[h]) <= 0.7;
    log(`${h.padEnd(10)} median ${fmt(r.medianMin, 2)}  p5 ${fmt(r.p5Min, 2)}  p95 ${fmt(r.p95Min, 2)}  target ${SOLO_TARGET[h]}  ${ok ? 'OK' : 'MISS'}`);
    rows.push({ human: h, ...r, target: SOLO_TARGET[h], ok });
  }
  out.solo = rows;
}

if (ONLY === 'all' || ONLY === 'c1' || ONLY === 'win') {
  const rows: unknown[] = [];
  log(`\n== Human vs bots: win rate of the human, and match time in minutes (${N} matches per cell) ==`);
  log('(* = attentive/expert bands are report only)');
  log('human      bots        win%   band        time: median  p5   p95   time gate (E/N: 10-13+p95<=18, H: 7-9)   p5>=8 (info)');
  for (const h of HUMANS) {
    if (HUMAN_FILTER !== 'all' && HUMAN_FILTER !== h) continue;
    for (const level of LEVELS) {
      if (LEVEL_FILTER !== 'all' && LEVEL_FILTER !== level) continue;
      for (const k of [1, 2, 3] as const) {
        const r = cell([humanSeat(h), ...botSeats(level, k)], `${h}:${level}:${k}`);
        const pct = r.winRate * 100;
        const band = k === 2 ? null : BANDS[h][level][k];
        const bandOk = band ? inBand(pct, band) : null;
        // Gate (PM, CP5a): casual vs Easy/Normal: median [10,13] and p95 <= 18; casual vs Hard: median [7,9]. p5 is reported only.
        const c1 = h === 'casual' ? (level === 'hard' ? r.medianMin >= 7 && r.medianMin <= 9 : r.medianMin >= 10 && r.medianMin <= 13 && r.p95Min <= 18) : null;
        const p5ok = h === 'casual' ? r.p5Min >= 8 : null;
        log(
          `${h.padEnd(10)} ${k} ${level.padEnd(7)} ${fmt(pct).padStart(5)}  ${band ? `${band[0]}-${band[1]}`.padEnd(8) : '-'.padEnd(8)} ${bandOk === null ? '   ' : h !== 'casual' ? (bandOk ? 'ok*' : 'out*') : bandOk ? 'OK ' : 'MISS'}  ${fmt(r.medianMin, 2).padStart(6)} ${fmt(r.p5Min, 1).padStart(5)} ${fmt(r.p95Min, 1).padStart(5)}  ${c1 === null ? '' : c1 ? 'OK  ' : 'MISS'}            ${p5ok === null ? '' : p5ok ? 'OK' : 'MISS'}`,
        );
        rows.push({ human: h, level, bots: k, ...r, winPct: pct, band, bandOk, c1, p5ok });
      }
    }
  }
  out.humanVsBots = rows;
}

if (ONLY === 'all' || ONLY === 'botbot') {
  log(`\n== Bot vs bot, 1 against 1 (win rate of the first, ${N} matches) ==`);
  const rows: unknown[] = [];
  const pairs: [BotLevel, BotLevel, [number, number]][] = [['hard', 'normal', [65, 80]], ['normal', 'easy', [75, 90]]];
  for (const [a, b, band] of pairs) {
    const seats: SimSeat[] = [
      { id: 'bot1', kind: 'bot', profile: BOT_PROFILE[a], botLevel: a },
      { id: 'bot2', kind: 'bot', profile: BOT_PROFILE[b], botLevel: b },
    ];
    const r = cell(seats, `bb:${a}:${b}`);
    const pct = r.winRate * 100;
    log(`${a} vs ${b}  win% ${fmt(pct)}  band ${band[0]}-${band[1]}  ${inBand(pct, band) ? 'OK' : 'MISS'}  median ${fmt(r.medianMin, 2)} min`);
    rows.push({ a, b, ...r, winPct: pct, band, ok: inBand(pct, band) });
  }
  out.botVsBot = rows;
}

out.totalRejected = totalRejected;
out.elapsedSec = (Date.now() - t0) / 1000;
log(`\nrejected bot actions: ${totalRejected}   elapsed ${fmt(out.elapsedSec as number)} s`);
if (JSON_OUT) console.log(JSON.stringify(out, null, 2));
