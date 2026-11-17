/**
 * CP3b smoke tests (docs/qa/test-plan.md, CP3): Simon (2D), Hindari Rintangan (3D, own renderer),
 * pick rule, cooldown 8/6/4. Runs on the `desktop` and `mobile` projects.
 *
 * Seeds are not hard-coded: the helpers replay the pure reducer in node (same code as the game)
 * to find a seed whose attempt is the wanted minigame, and the test asserts the browser agrees.
 * Swipes use synthetic pointer events with explicit timestamps (headless runs at ~6 fps, where a
 * real mouse swipe can be decided as a 100 ms hold tap by the frame loop; see cp3b-report).
 */
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import {
  applyAction,
  createInitialState,
  dodgeRunnerLogic,
  loadMap,
  minigamePool,
  MINIGAME_LOGIC,
  simonLogic,
  type Attempt,
  type DodgeLevel,
  type GameState,
  type MinigameContext,
  type SimonLevel,
} from '../../src/logic';
import { byId, conquer, consoleErrors, dispatch, force, forceWin, getState, isTouch, me, open, press, setTimeScale, waitIdle } from './helpers';

// ---------- node-side replay of the reducer (finds seeds, derives levels) ----------

const mapData = () => JSON.parse(readFileSync('public/maps/indonesia/map.json', 'utf8'));
const map = loadMap(mapData(), 'standard', MINIGAME_LOGIC);
const pool = minigamePool(map.data);
type Path = string[]; // regions conquered (2 wins each) before the target
const ctxOf = (a: Attempt): MinigameContext => ({
  seed: a.seed, difficulty: a.difficulty, modifiers: [], map: mapData(), regionId: a.targetId,
  inputMode: 'mouse', settings: { reducedMotion: false, reducedFlash: false, sfxVolume: 1 },
});
const simonLevel = (a: Attempt): SimonLevel => simonLogic.generateLevel(ctxOf(a));
const dodgeLevel = (a: Attempt): DodgeLevel => dodgeRunnerLogic.generateLevel(ctxOf(a));

/** The first attempt of `target` after conquering `path`, replayed exactly like the e2e flow does. */
function attemptFor(seed: number, path: Path, target: string): Attempt {
  let s: GameState = createInitialState(map, [{ id: 'p1', name: 'p1', kind: 'human' }], seed, pool);
  const run = (a: Parameters<typeof applyAction>[2]) => {
    s = applyAction(map, s, a).state;
    // CP4a: a win opens the card offer; the browser flow settles it with the auto rules, so do the same here.
    for (let i = 0; i < 4 && (s.players[0]?.offer || s.players[0]?.discard); i++) s = applyAction(map, s, { type: 'autoCards', playerId: 'p1' }).state;
  };
  for (const r of path) {
    run({ type: 'selectTarget', playerId: 'p1', targetId: r });
    run({ type: 'startAttempt', playerId: 'p1' });
    run({ type: 'minigameResult', playerId: 'p1', passed: true });
    run({ type: 'startAttempt', playerId: 'p1' });
    run({ type: 'minigameResult', playerId: 'p1', passed: true });
  }
  run({ type: 'selectTarget', playerId: 'p1', targetId: target });
  run({ type: 'startAttempt', playerId: 'p1' });
  return s.players[0]?.attempt as Attempt;
}

function findSeed(id: string, path: Path, target: string, ok: (a: Attempt) => boolean = () => true): number {
  for (let seed = 1; seed <= 600; seed++) {
    const a = attemptFor(seed, path, target);
    if (a?.minigameId === id && ok(a)) return seed;
  }
  throw new Error(`no seed found for ${id} at ${target}`);
}

/** Doing nothing in lane 0 loses (or not) on this level, by the pure logic. */
const idleDodgeFails = (a: Attempt): boolean => {
  const level = dodgeLevel(a);
  let st = dodgeRunnerLogic.initState(level);
  st = dodgeRunnerLogic.step(level, st, null, level.durationMs + 1000);
  return dodgeRunnerLogic.result(level, st)?.passed === false;
};

const EASY_PATH: Path = ['medan', 'jakarta']; // then 'yogyakarta' (sawah = easy)

// ---------- page helpers ----------

async function attemptOf(page: Page): Promise<Attempt> {
  await expect.poll(async () => (await me(page)).attempt, { timeout: 15_000 }).not.toBeNull();
  return (await me(page)).attempt as Attempt;
}

async function startAt(page: Page, seed: number, path: Path, target: string): Promise<Attempt> {
  await open(page, { seed });
  await setTimeScale(page, 10);
  await conquer(page, path);
  await dispatch(page, { type: 'selectTarget', playerId: 'p1', targetId: target });
  await expect(byId(page, 'btn-start')).toBeEnabled({ timeout: 30_000 });
  await setTimeScale(page, 1);
  await press(byId(page, 'btn-start'));
  await expect(byId(page, 'mg-overlay')).toHaveAttribute('data-phase', /intro|play/);
  const a = await attemptOf(page);
  return a;
}

// QA-CP4b-05: the 3D minigame clock slows down with the frame rate (dt is clamped), so the 3 s intro can take far longer than 20 s of wall time on a busy machine.
const waitPlay = (page: Page) => expect(byId(page, 'mg-overlay')).toHaveAttribute('data-phase', 'play', { timeout: 60_000 });
const banner = (page: Page) => byId(page, 'mg-banner');

async function canvasCount(page: Page): Promise<number> {
  return page.locator('canvas').count();
}
const raceFrames = (page: Page): Promise<number> =>
  page.evaluate(() => (window as unknown as { atlas: { renderer: { info: { render: { frame: number } } } } }).atlas.renderer.info.render.frame);

// ---------- Simon ----------

const padPhase = (page: Page) => byId(page, 'mg-pads').getAttribute('data-phase');
async function waitInput(page: Page): Promise<void> {
  await expect.poll(() => padPhase(page), { timeout: 30_000 }).toBe('input');
}
const misses = async (page: Page) => Number(await byId(page, 'mg-misses').getAttribute('data-left'));
const entered = async (page: Page) => Number(await byId(page, 'mg-simon-status').getAttribute('data-entered'));
const roundOf = async (page: Page) => Number(await byId(page, 'mg-progress').getAttribute('data-round'));

test.describe('simon', () => {
  // QA-CP4b-05: the mobile Simon runs are load-sensitive (software WebGL + full suite); give them room.
  test.describe.configure({ timeout: 180_000 });
  test('mg_simon_ui: pads, glyphs, misses, status testids; pad count follows difficulty; touch targets >= 48', async ({ page }) => {
    const seed = findSeed('simon', EASY_PATH, 'yogyakarta');
    const a = await startAt(page, seed, EASY_PATH, 'yogyakarta');
    expect(a.minigameId).toBe('simon');
    expect(a.seed).toBe(attemptFor(seed, EASY_PATH, 'yogyakarta').seed);
    const lvl = simonLevel(a);
    await expect(byId(page, 'mg-pads')).toBeVisible();
    for (let i = 0; i < lvl.padCount; i++) {
      const b = await byId(page, `mg-pad-${i}`).boundingBox();
      expect(b && b.width >= 48 && b.height >= 48, `pad ${i} size ${JSON.stringify(b)}`).toBeTruthy();
      await expect(byId(page, `mg-pad-${i}`)).toHaveText(/[●■▲◆★⬢]/);
    }
    await expect(byId(page, `mg-pad-${lvl.padCount}`)).toHaveCount(0);
    await expect(byId(page, 'mg-misses')).toHaveAttribute('data-left', String(lvl.mistakesAllowed));
    await expect(byId(page, 'mg-timer')).toHaveCount(1);
    expect(consoleErrors.get(page)).toEqual([]);
    // inside the 390 px viewport, no horizontal scroll
    const dims = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    expect(dims.sw).toBeLessThanOrEqual(dims.iw);
  });

  test('a correct round advances the round without a miss; taps during playback/delay are ignored', async ({ page }) => {
    const seed = findSeed('simon', EASY_PATH, 'yogyakarta');
    const a = await startAt(page, seed, EASY_PATH, 'yogyakarta');
    const lvl = simonLevel(a);
    await waitPlay(page);
    await setTimeScale(page, 2);
    // not the input phase yet: a tap on a wrong pad must not count as a mistake
    expect(await padPhase(page)).not.toBe('input');
    await press(byId(page, `mg-pad-${((lvl.sequence[0] as number) + 1) % lvl.padCount}`));
    await page.waitForTimeout(300);
    expect(await misses(page)).toBe(lvl.mistakesAllowed);
    await waitInput(page);
    expect(await roundOf(page)).toBe(0);
    for (let i = 0; i < 3; i++) {
      expect(await entered(page)).toBe(i);
      await press(byId(page, `mg-pad-${lvl.sequence[i]}`));
      if (i < 2) await expect.poll(() => entered(page)).toBe(i + 1);
    }
    await expect.poll(() => roundOf(page), { timeout: 10_000 }).toBe(1);
    expect(await misses(page)).toBe(lvl.mistakesAllowed);
  });

  test('a wrong pad costs one miss and repeats the round from the start', async ({ page }) => {
    const seed = findSeed('simon', EASY_PATH, 'yogyakarta');
    const a = await startAt(page, seed, EASY_PATH, 'yogyakarta');
    const lvl = simonLevel(a);
    await waitPlay(page);
    await setTimeScale(page, 2);
    await waitInput(page);
    await press(byId(page, `mg-pad-${lvl.sequence[0]}`));
    await expect.poll(() => entered(page)).toBe(1);
    await press(byId(page, `mg-pad-${((lvl.sequence[1] as number) + 1) % lvl.padCount}`));
    await expect(byId(page, 'mg-misses')).toHaveAttribute('data-left', String(lvl.mistakesAllowed - 1));
    expect(await roundOf(page)).toBe(0); // same round again
    await expect.poll(() => padPhase(page)).not.toBe('input'); // replay of the same sequence first
    await waitInput(page);
    expect(await entered(page)).toBe(0);
  });

  test('idle for 3 s in the input phase is a miss (DR-19)', async ({ page }) => {
    const seed = findSeed('simon', EASY_PATH, 'yogyakarta');
    const a = await startAt(page, seed, EASY_PATH, 'yogyakarta');
    const lvl = simonLevel(a);
    await waitPlay(page);
    await setTimeScale(page, 2);
    await waitInput(page);
    await setTimeScale(page, 4); // 3 s of game time = 0.75 s real; the next idle needs > 3.8 s game time
    await expect.poll(() => misses(page), { timeout: 10_000 }).toBe(lvl.mistakesAllowed - 1);
    await setTimeScale(page, 1);
    expect(await misses(page)).toBe(lvl.mistakesAllowed - 1);
  });

  test('pass: perfect play wins the attempt, the win counts for the race', async ({ page }) => {
    test.setTimeout(150_000);
    const seed = findSeed('simon', EASY_PATH, 'yogyakarta');
    const a = await startAt(page, seed, EASY_PATH, 'yogyakarta');
    const lvl = simonLevel(a);
    await waitPlay(page);
    await setTimeScale(page, 2);
    const snap = () => page.evaluate(() => {
      const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
      return {
        banner: !!q('mg-banner') && !(q('mg-banner') as HTMLElement).hidden,
        phase: q('mg-pads')?.dataset.phase ?? '',
        round: q('mg-progress')?.dataset.round ?? '',
        entered: q('mg-simon-status')?.dataset.entered ?? '',
        left: q('mg-misses')?.dataset.left ?? '',
      };
    });
    let lastKey = '';
    let lastAt = 0;
    const t0 = Date.now();
    for (;;) {
      const s = await snap();
      if (s.banner) break;
      if (Date.now() - t0 > 120_000) throw new Error('perfect play did not finish in 120 s');
      const key = `${s.round}:${s.entered}`;
      if (s.phase === 'input' && (key !== lastKey || Date.now() - lastAt > 3000)) {
        lastKey = key;
        lastAt = Date.now();
        await press(byId(page, `mg-pad-${lvl.sequence[Number(s.entered)]}`));
      } else {
        await page.waitForTimeout(40);
      }
    }
    await expect(banner(page)).toHaveAttribute('data-result', 'pass');
    await waitIdle(page);
    expect((await me(page)).winsAtTarget).toBe(1);
    expect(consoleErrors.get(page)).toEqual([]);
  });

  test('fail: more wrong pads than allowed fails the attempt, cooldown starts', async ({ page }) => {
    const seed = findSeed('simon', EASY_PATH, 'yogyakarta');
    const a = await startAt(page, seed, EASY_PATH, 'yogyakarta');
    const lvl = simonLevel(a);
    await waitPlay(page);
    await setTimeScale(page, 2);
    const wrong = `mg-pad-${((lvl.sequence[0] as number) + 1) % lvl.padCount}`;
    let minLeft = lvl.mistakesAllowed;
    const t0 = Date.now();
    // keep tapping a wrong pad whenever input is open; idle misses may add to the count (slow devices)
    while (await banner(page).isHidden()) {
      if (Date.now() - t0 > 70_000) throw new Error('attempt did not fail');
      if ((await padPhase(page).catch(() => '')) === 'input') {
        await byId(page, wrong).dispatchEvent('pointerdown', { pointerType: isTouch() ? 'touch' : 'mouse', isPrimary: true }).catch(() => undefined);
        minLeft = Math.min(minLeft, await misses(page).catch(() => minLeft));
      }
      await page.waitForTimeout(150);
    }
    await expect(banner(page)).toHaveAttribute('data-result', 'fail');
    expect(minLeft).toBeLessThan(lvl.mistakesAllowed); // it took misses to get there
    await waitIdle(page);
    await expect(byId(page, 'cooldown-timer')).toHaveText(/\d/);
    expect((await me(page)).winsAtTarget).toBe(0);
  });

  test('desktop: digit keys play pads (keyboard 1-N)', async ({ page }) => {
    test.skip(isTouch(), 'keyboard is desktop only');
    const seed = findSeed('simon', EASY_PATH, 'yogyakarta');
    const a = await startAt(page, seed, EASY_PATH, 'yogyakarta');
    const lvl = simonLevel(a);
    await waitPlay(page);
    await setTimeScale(page, 2);
    await waitInput(page);
    await page.keyboard.press(`Digit${(lvl.sequence[0] as number) + 1}`);
    await expect.poll(() => entered(page)).toBe(1);
    await page.keyboard.press(`Digit${(((lvl.sequence[1] as number) + 1) % lvl.padCount) + 1}`);
    await expect(byId(page, 'mg-misses')).toHaveAttribute('data-left', String(lvl.mistakesAllowed - 1));
  });
});

// ---------- Hindari Rintangan (dodge_runner, 3D) ----------

const lane = async (page: Page) => Number(await byId(page, 'mg-play-area').getAttribute('data-lane'));
const expectLane = (page: Page, n: number) => expect(byId(page, 'mg-play-area')).toHaveAttribute('data-lane', String(n));

/** A synthetic swipe with explicit event timestamps, starting at `startFrac` of the play area width. */
async function swipe(page: Page, startFrac: number, dx: number): Promise<void> {
  await page.evaluate(([frac, delta, touch]) => {
    const el = document.querySelector('[data-testid="mg-play-area"]') as HTMLElement;
    const r = el.getBoundingClientRect();
    const x0 = r.left + r.width * (frac as number);
    const y0 = r.top + r.height / 2;
    const t0 = performance.now();
    const mk = (type: string, x: number, ts: number) => {
      const e = new PointerEvent(type, { pointerId: 77, isPrimary: true, pointerType: touch ? 'touch' : 'mouse', clientX: x, clientY: y0, bubbles: true, cancelable: true, button: 0 });
      Object.defineProperty(e, 'timeStamp', { value: ts });
      el.dispatchEvent(e);
    };
    mk('pointerdown', x0, t0);
    mk('pointermove', x0 + (delta as number) / 2, t0 + 20);
    mk('pointermove', x0 + (delta as number), t0 + 40);
    mk('pointerup', x0 + (delta as number), t0 + 50);
  }, [startFrac, dx, isTouch()] as const);
}

async function tapSide(page: Page, side: 'left' | 'right'): Promise<void> {
  const b = await byId(page, 'mg-play-area').boundingBox();
  if (!b) throw new Error('no play area');
  const x = b.x + b.width * (side === 'left' ? 0.2 : 0.8);
  const y = b.y + b.height * 0.5;
  if (isTouch()) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

/** Start a dodge run on medan (medium: 2 lives) whose idle outcome is a loss, game running slowly. */
async function startDodgeSlow(page: Page): Promise<Attempt> {
  const seed = findSeed('dodge_runner', [], 'medan', idleDodgeFails);
  await open(page, { seed });
  await setTimeScale(page, 1);
  await press(byId(page, 'region-medan'));
  await press(byId(page, 'btn-start'));
  const a = await attemptOf(page);
  expect(a.minigameId).toBe('dodge_runner');
  await waitPlay(page);
  await setTimeScale(page, 0.25);
  return a;
}

test.describe('dodge_runner', () => {
  test('3D canvas: created with the minigame, race renderer pauses, both cleaned up after', async ({ page }) => {
    const seed = findSeed('dodge_runner', [], 'medan', idleDodgeFails);
    await open(page, { seed });
    const base = await canvasCount(page);
    expect(base).toBeGreaterThanOrEqual(1);
    await expect(byId(page, 'mg-canvas')).toHaveCount(0);
    await setTimeScale(page, 1);
    await press(byId(page, 'region-medan'));
    await press(byId(page, 'btn-start'));
    await expect(byId(page, 'mg-canvas')).toHaveCount(1);
    expect(await canvasCount(page)).toBe(base + 1);
    await waitPlay(page);
    await setTimeScale(page, 0.25);
    const dims = await byId(page, 'mg-canvas').evaluate((c: HTMLCanvasElement) => ({ w: c.width, h: c.height }));
    expect(dims.w).toBeGreaterThan(0);
    expect(dims.h).toBeGreaterThan(0);
    // race renderer does not render while the 3D minigame covers it
    const f1 = await raceFrames(page);
    await page.waitForTimeout(800);
    expect(await raceFrames(page)).toBe(f1);
    // close it (forced fail goes through the real banner and host.close)
    expect(await force(page, false)).toBe(true);
    await waitIdle(page);
    await expect(byId(page, 'mg-canvas')).toHaveCount(0);
    expect(await canvasCount(page)).toBe(base);
    const f2 = await raceFrames(page);
    await expect.poll(() => raceFrames(page)).toBeGreaterThan(f2); // race view renders again
    // and the board still answers: switch target to padang works through the UI
    await press(byId(page, 'region-padang'));
    await expect.poll(async () => (await me(page)).targetId).toBe('padang');
    expect(consoleErrors.get(page)).toEqual([]);
  });

  test('lane change by tap (left/right half) and by swipe (direction wins over the half)', async ({ page }) => {
    await startDodgeSlow(page);
    await expectLane(page, 0);
    await tapSide(page, 'left');
    await expectLane(page, -1);
    await tapSide(page, 'right');
    await expectLane(page, 0);
    await swipe(page, 0.25, 80); // starts on the LEFT half, moves right
    await expectLane(page, 1);
    await swipe(page, 0.75, -80); // starts on the RIGHT half, moves left
    await expectLane(page, 0);
    await swipe(page, 0.5, 80);
    await expectLane(page, 1);
    expect(await lane(page)).toBe(1);
  });

  test('one gesture = one move: a long press and a vertical drag do not move twice', async ({ page }) => {
    await startDodgeSlow(page);
    await tapSide(page, 'left');
    await expectLane(page, -1);
    const b = await byId(page, 'mg-play-area').boundingBox();
    if (!b) throw new Error('no play area');
    const x = b.x + b.width * 0.8;
    const y = b.y + b.height * 0.5;
    if (isTouch()) {
      // touchscreen has no long press API: a pointer-event hold with explicit timestamps instead
      await page.evaluate(([px, py]) => {
        const el = document.querySelector('[data-testid="mg-play-area"]') as HTMLElement;
        const t0 = performance.now();
        const mk = (type: string, ts: number) => {
          const e = new PointerEvent(type, { pointerId: 78, isPrimary: true, pointerType: 'touch', clientX: px as number, clientY: py as number, bubbles: true, cancelable: true, button: 0 });
          Object.defineProperty(e, 'timeStamp', { value: ts });
          el.dispatchEvent(e);
        };
        mk('pointerdown', t0);
        mk('pointerup', t0 + 600);
      }, [x, y] as const);
    } else {
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.waitForTimeout(500);
      await page.mouse.up();
    }
    await expectLane(page, 0); // one move right (-1 -> 0), not two (-> +1)
    await page.waitForTimeout(500);
    await expectLane(page, 0);
    // vertical drag: no move
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="mg-play-area"]') as HTMLElement;
      const r = el.getBoundingClientRect();
      const t0 = performance.now();
      const mk = (type: string, y: number, ts: number) => {
        const e = new PointerEvent(type, { pointerId: 79, isPrimary: true, pointerType: 'touch', clientX: r.left + r.width * 0.8, clientY: y, bubbles: true, cancelable: true, button: 0 });
        Object.defineProperty(e, 'timeStamp', { value: ts });
        el.dispatchEvent(e);
      };
      mk('pointerdown', r.top + 200, t0);
      mk('pointermove', r.top + 260, t0 + 30);
      mk('pointerup', r.top + 260, t0 + 50);
    });
    await page.waitForTimeout(500);
    await expectLane(page, 0);
  });

  test('desktop: arrow keys and A/D change lane', async ({ page }) => {
    test.skip(isTouch(), 'keyboard is desktop only');
    await startDodgeSlow(page);
    await page.keyboard.press('ArrowLeft');
    await expectLane(page, -1);
    await page.keyboard.press('KeyD');
    await expectLane(page, 0);
    await page.keyboard.press('ArrowRight');
    await expectLane(page, 1);
    await page.keyboard.press('KeyA');
    await expectLane(page, 0);
  });

  test('losing lives: hits lower mg-lives step by step, the last one fails the attempt', async ({ page }) => {
    const a = await startDodgeSlow(page);
    const lvl = dodgeLevel(a);
    expect(lvl.lives).toBe(2);
    await expect(byId(page, 'mg-lives')).toHaveAttribute('data-lives', String(lvl.lives));
    await page.evaluate(() => {
      const w = window as unknown as { __lives: string[] };
      w.__lives = [];
      const el = document.querySelector('[data-testid="mg-lives"]') as HTMLElement;
      new MutationObserver(() => w.__lives.push(el.dataset.lives as string)).observe(el, { attributes: true, attributeFilter: ['data-lives'] });
    });
    await setTimeScale(page, 3);
    await expect(banner(page)).toHaveAttribute('data-result', 'fail', { timeout: 60_000 });
    const raw = await page.evaluate(() => (window as unknown as { __lives: string[] }).__lives);
    const seen = raw.filter((v, i) => i === 0 || v !== raw[i - 1]); // the view rewrites the attribute every frame
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.at(-1)).toBe('0');
    expect(seen.map(Number).every((v, i, arr) => i === 0 || v < (arr[i - 1] as number))).toBe(true); // only goes down
    await waitIdle(page);
    await expect(byId(page, 'cooldown-timer')).toHaveText(/\d/);
    expect((await me(page)).winsAtTarget).toBe(0);
  });

  test('pass: surviving to the end (bot dodges using the level rows) wins the attempt', async ({ page }) => {
    const seed = findSeed('dodge_runner', EASY_PATH, 'yogyakarta');
    const a = await startAt(page, seed, EASY_PATH, 'yogyakarta');
    expect(a.difficulty).toBe('easy');
    const lvl = dodgeLevel(a);
    await waitPlay(page);
    const playStartMs = a.startedAtMs + a.introMs;
    // In-page bot: every 30 ms look at game time and the next row; sidestep into a free lane when needed.
    await page.evaluate(([rows, hw, start]) => {
      const R = rows as { tHitMs: number; blocked: number[] }[];
      let lockUntil = 0;
      const id = setInterval(() => {
        const area = document.querySelector('[data-testid="mg-play-area"]') as HTMLElement | null;
        const w = window as unknown as { atlas: { session: { state: { timeMs: number } } } };
        if (!area) { clearInterval(id); return; }
        const t = w.atlas.session.state.timeMs - (start as number);
        const cur = Number(area.dataset.lane);
        const k = R.findIndex((r) => r.tHitMs + (hw as number) > t);
        if (k < 0 || performance.now() < lockUntil) return;
        const row = R[k] as { tHitMs: number; blocked: number[] };
        const prevEnd = k > 0 ? (R[k - 1] as { tHitMs: number }).tHitMs + (hw as number) : -1;
        if (!row.blocked.includes(cur) || t < prevEnd - 40 || t > row.tHitMs - (hw as number) - 150) return;
        const free = [-1, 0, 1].filter((l) => !row.blocked.includes(l)).sort((p, q) => Math.abs(p - cur) - Math.abs(q - cur))[0] as number;
        const dir = Math.sign(free - cur);
        window.dispatchEvent(new KeyboardEvent('keydown', { code: dir < 0 ? 'ArrowLeft' : 'ArrowRight', bubbles: true, cancelable: true }));
        lockUntil = performance.now() + 250;
      }, 30);
    }, [lvl.rows, lvl.hitHalfWindowMs, playStartMs] as const);
    await expect(banner(page)).toBeVisible({ timeout: 60_000 });
    await expect(banner(page)).toHaveAttribute('data-result', 'pass');
    await waitIdle(page);
    expect((await me(page)).winsAtTarget).toBe(1);
    expect(consoleErrors.get(page)).toEqual([]);
  });

  test('mg_destroy_releases: 10 open/close cycles keep one canvas, free every GL context, no console noise', async ({ page }) => {
    test.setTimeout(240_000);
    await page.addInitScript(() => {
      const w = window as unknown as { __gl: { created: number; lost: number } };
      w.__gl = { created: 0, lost: 0 };
      const orig = HTMLCanvasElement.prototype.getContext;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      HTMLCanvasElement.prototype.getContext = function (this: any, type: string, ...rest: any[]) {
        const c = (orig as any).call(this, type, ...rest);
        if (c && /webgl/.test(type) && !this.__tracked) {
          this.__tracked = true;
          w.__gl.created++;
          this.addEventListener('webglcontextlost', () => { w.__gl.lost++; });
        }
        return c;
      };
    });
    const noise: string[] = [];
    page.on('console', (m) => {
      if ((m.type() === 'warning' || m.type() === 'error') && /webgl|context|gpu|three/i.test(m.text())) noise.push(`${m.type()}: ${m.text()}`);
    });
    const seed = findSeed('dodge_runner', [], 'medan');
    await open(page, { seed });
    const base = await canvasCount(page);
    await setTimeScale(page, 10);
    await press(byId(page, 'region-medan'));
    const cdp = await page.context().newCDPSession(page);
    const heap = async () => {
      await cdp.send('HeapProfiler.collectGarbage');
      return (await cdp.send('Runtime.getHeapUsage')).usedSize;
    };
    let heapAfterFirst = 0;
    const N = 10;
    for (let i = 0; i < N; i++) {
      await expect(byId(page, 'btn-start')).toBeEnabled({ timeout: 30_000 });
      await press(byId(page, 'btn-start')); // a fail replays the same minigame, so every cycle is dodge_runner
      await expect(byId(page, 'mg-canvas')).toHaveCount(1);
      expect((await attemptOf(page)).minigameId).toBe('dodge_runner');
      await waitPlay(page);
      await page.waitForTimeout(200); // let a few 3D frames render
      // Under load the run can end by itself (3 hits at 10x speed) before the forced result lands; either way the cycle closes.
      await force(page, false);
      await waitIdle(page);
      await expect(byId(page, 'mg-canvas')).toHaveCount(0);
      expect(await canvasCount(page)).toBe(base);
      if (i === 0) heapAfterFirst = await heap();
    }
    const heapEnd = await heap();
    const gl = await page.evaluate(() => (window as unknown as { __gl: { created: number; lost: number } }).__gl);
    await expect.poll(async () => (await page.evaluate(() => (window as unknown as { __gl: { lost: number } }).__gl.lost))).toBe(N);
    console.log(`[leak] cycles=${N} canvases=${base} glCreated=${gl.created} heap first=${heapAfterFirst} end=${heapEnd}`);
    expect(gl.created).toBe(N + 1); // race stage + one per run
    expect(heapEnd).toBeLessThan(heapAfterFirst * 1.5 + 5_000_000);
    expect(noise).toEqual([]);
    expect(consoleErrors.get(page)).toEqual([]);
    // the race view still works after all that
    const f = await raceFrames(page);
    await expect.poll(() => raceFrames(page)).toBeGreaterThan(f);
  });
});

// ---------- pick rule (7-minigame pool since CP5b) ----------

test.describe('pick rule', () => {
  test('the pick stays hidden until Mulai, then the minigame opens', async ({ page }) => {
    await open(page, { seed: 1337 });
    await expect(page.locator('[data-minigame]')).toHaveCount(0);
    await press(byId(page, 'region-medan'));
    await expect.poll(async () => (await me(page)).targetId).toBe('medan');
    expect((await me(page)).nextMinigameId).toBeTruthy(); // drawn in the logic ...
    const hud = [await byId(page, 'target-panel').innerHTML(), await byId(page, 'toast').innerHTML(), await byId(page, 'progress-list').innerHTML()].join('\n');
    // ... but nothing in the HUD names it or shows its intro text / icon
    for (const leak of ['tap_timing', 'simon', 'dodge_runner', 'whack_a_mole', 'slingshot', 'memory_match', 'guess_location', 'Ulangi urutan', 'Geser kiri-kanan', 'Tap saat jarum', 'Pukul yang muncul', 'Tarik, bidik', 'Buka dua kartu', 'Tempat ini ada di mana', 'icon-simon', 'icon-dodge', 'icon-whack', 'icon-sling', 'icon-memory', 'icon-guess', 'data-minigame']) {
      expect(hud, `HUD leaks "${leak}" before Mulai`).not.toContain(leak);
    }
    await expect(page.locator('[data-minigame]')).toHaveCount(0);
    // changing target does not reveal it either
    await press(byId(page, 'region-padang'));
    await expect.poll(async () => (await me(page)).targetId).toBe('padang');
    expect(await byId(page, 'target-panel').innerHTML()).not.toMatch(/tap_timing|simon|dodge_runner|whack_a_mole|slingshot|memory_match|guess_location|icon-simon|icon-dodge|icon-whack|icon-sling|icon-memory|icon-guess/);
    await press(byId(page, 'btn-start'));
    await expect(byId(page, 'mg-overlay')).toBeVisible();
    await expect(byId(page, 'mg-overlay')).toHaveAttribute('data-minigame', (await attemptOf(page)).minigameId);
  });

  test('after a win the next minigame is never the same one (8 wins), all drawn from the pool', async ({ page }) => {
    await open(page, { seed: 42 });
    await setTimeScale(page, 10);
    const played: string[] = [];
    for (const r of ['medan', 'jakarta', 'yogyakarta', 'bali']) {
      await dispatch(page, { type: 'selectTarget', playerId: 'p1', targetId: r });
      for (let w = 0; w < 2; w++) {
        await forceWin(page);
        played.push((await me(page)).lastMinigameId as string);
      }
    }
    expect(played).toHaveLength(8);
    for (let i = 1; i < played.length; i++) expect(played[i], `win ${i + 1} repeats ${played[i - 1]}: ${played.join(',')}`).not.toBe(played[i - 1]);
    for (const id of played) expect(['tap_timing', 'simon', 'dodge_runner', 'whack_a_mole', 'slingshot', 'memory_match', 'guess_location']).toContain(id);
    expect(new Set(played).size).toBeGreaterThanOrEqual(2);
    expect(consoleErrors.get(page)).toEqual([]);
  });

  test('after a fail the same minigame replays with the short 1.5 s intro; after a win it re-rolls with 3 s', async ({ page }) => {
    await open(page, { seed: 42 });
    await setTimeScale(page, 10);
    await dispatch(page, { type: 'selectTarget', playerId: 'p1', targetId: 'medan' });
    await expect(byId(page, 'btn-start')).toBeEnabled();
    await press(byId(page, 'btn-start'));
    await expect.poll(async () => (await me(page)).attempt).not.toBeNull();
    const first = (await me(page)).attempt!;
    expect(first.introMs).toBe(3000);
    await expect(byId(page, 'mg-overlay')).toHaveAttribute('data-minigame', first.minigameId);
    expect(await force(page, false)).toBe(true);
    await waitIdle(page);
    await expect(byId(page, 'btn-start')).toBeEnabled({ timeout: 30_000 });
    await press(byId(page, 'btn-start'));
    await expect.poll(async () => (await me(page)).attempt).not.toBeNull();
    const retry = (await me(page)).attempt!;
    expect(retry.minigameId).toBe(first.minigameId);
    expect(retry.introMs).toBe(1500);
    expect(retry.seed).not.toBe(first.seed); // new level seed
    await expect(byId(page, 'mg-overlay')).toHaveAttribute('data-minigame', first.minigameId);
    expect(await force(page, true)).toBe(true);
    await waitIdle(page);
    await press(byId(page, 'btn-start'));
    await expect.poll(async () => (await me(page)).attempt).not.toBeNull();
    const second = (await me(page)).attempt!;
    expect(second.minigameId).not.toBe(first.minigameId);
    expect(second.introMs).toBe(3000);
  });
});

// ---------- cooldown 8/6/4 ----------

test.describe('cooldown', () => {
  test('race_cooldown_by_difficulty: easy 8 s, medium 6 s, hard 4 s after a fail; Mulai disabled meanwhile', async ({ page }) => {
    await open(page, { seed: 42 });
    const cases: { region: string; expect: number }[] = [
      { region: 'padang', expect: 4 }, // gunung = hard
      { region: 'medan', expect: 6 }, // kota = medium
    ];
    for (const c of cases) {
      await setTimeScale(page, 10);
      await dispatch(page, { type: 'selectTarget', playerId: 'p1', targetId: c.region });
      await expect(byId(page, 'btn-start')).toBeEnabled({ timeout: 30_000 });
      await setTimeScale(page, 1);
      await press(byId(page, 'btn-start'));
      expect(await force(page, false)).toBe(true);
      await waitIdle(page);
      const s = await getState(page);
      const p = await me(page);
      const left = (p.cooldownUntilMs - s.timeMs) / 1000;
      expect(left, `${c.region} cooldown left ${left}`).toBeGreaterThan(c.expect - 2);
      expect(left).toBeLessThanOrEqual(c.expect);
      expect(Math.ceil(left)).toBeLessThanOrEqual(c.expect);
      await expect(byId(page, 'btn-start')).toBeDisabled();
      await expect(byId(page, 'cooldown-timer')).toHaveText(/\d/);
      expect(Number(await byId(page, 'btn-start').getAttribute('data-cooldown'))).toBeLessThanOrEqual(c.expect);
    }
    // easy: conquer medan + jakarta, then fail on yogyakarta (sawah)
    await setTimeScale(page, 10);
    await expect(byId(page, 'btn-start')).toBeEnabled({ timeout: 30_000 });
    await conquer(page, ['medan', 'jakarta']);
    await dispatch(page, { type: 'selectTarget', playerId: 'p1', targetId: 'yogyakarta' });
    await expect(byId(page, 'btn-start')).toBeEnabled({ timeout: 30_000 });
    await setTimeScale(page, 1);
    await press(byId(page, 'btn-start'));
    expect(await force(page, false)).toBe(true);
    await waitIdle(page);
    const left = ((await me(page)).cooldownUntilMs - (await getState(page)).timeMs) / 1000;
    expect(left).toBeGreaterThan(6);
    expect(left).toBeLessThanOrEqual(8);
    expect(Number(await byId(page, 'btn-start').getAttribute('data-cooldown'))).toBeGreaterThan(6);
  });

  test('the race view stays interactive during cooldown (target switch allowed, cooldown keeps running)', async ({ page }) => {
    await open(page, { seed: 42 });
    await setTimeScale(page, 1);
    await dispatch(page, { type: 'selectTarget', playerId: 'p1', targetId: 'medan' });
    await press(byId(page, 'btn-start'));
    await force(page, false);
    await waitIdle(page);
    const before = (await me(page)).cooldownUntilMs;
    await press(byId(page, 'region-padang'));
    await expect.poll(async () => (await me(page)).targetId).toBe('padang');
    expect((await me(page)).cooldownUntilMs).toBe(before);
    await expect(byId(page, 'btn-start')).toBeDisabled();
  });
});
