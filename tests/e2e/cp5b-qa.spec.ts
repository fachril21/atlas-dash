/**
 * CP5b QA smoke tests (docs/qa/cp5b-report.md), desktop + mobile. Added on top of tests/e2e/cp5b.spec.ts:
 *   L  layout of all four minigames at 1280x720, 390x844 and 844x390 (touch-target sizes, nothing clipped, no overlaps)
 *   I  real input paths: a real touch drag (CDP) and Esc during a drag for Ketapel, two fingers at once on Whack, Tab + Enter on Tebak Lokasi
 *   C  card x minigame through the REAL flow: cards in pending -> Mulai -> the host opens the level the logic would generate for those modifiers,
 *      and the effect is visible in the DOM (fog, hint, tempo badge, extra rows, ...)
 *   P  pause per minigame with the real Esc key / tab-hidden event, and whether the HUD Pause button can be reached during a minigame
 *   G  Ketapel: 45 open/close cycles, GPU counters, WebGL context warnings, race renderer still alive, JS heap
 * The machine has no fonts: assertions use data attributes, geometry and element counts.
 */
import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  getCard,
  getMinigameLogic,
  resolveAttemptEffects,
  type GuessLevel,
  type MapData,
  type MemoryLevel,
  type MinigameModifier,
  type SlingLevel,
  type WhackLevel,
} from '../../src/logic';
import type { AtlasTestApi, SandboxOptions } from '../../src/ui/debug';
import { box, byId, consoleErrors, dispatch, force, isTouch, open, overlaps, press, setTimeScale, waitIdle } from './helpers';

type Api = AtlasTestApi;
const api = <T>(page: Page, fn: (a: Api) => T): Promise<T> => page.evaluate(`(${fn.toString()})(window.__atlasTest)`) as Promise<T>;
const MAP = JSON.parse(readFileSync(join(import.meta.dirname, '../../public/maps/indonesia/map.json'), 'utf8')) as MapData;

async function startMini(page: Page, id: string, opts: SandboxOptions = {}): Promise<void> {
  const ok = await page.evaluate(([i, o]) => (window as unknown as { __atlasTest: Api }).__atlasTest.openMinigame(i as string, o as SandboxOptions), [id, { introMs: 300, seed: 11, ...opts }] as const);
  expect(ok).toBe(true);
  await expect(byId(page, 'mg-overlay')).toHaveAttribute('data-minigame', id);
  await expect(byId(page, 'mg-overlay')).toHaveAttribute('data-phase', 'play', { timeout: 60_000 });
}
const info = (page: Page) => page.evaluate(() => (window as unknown as { __atlasTest: Api }).__atlasTest.getMinigame());
const playMs = async (page: Page): Promise<number> => (await info(page))!.playMs;
async function noHorizontalScroll(page: Page): Promise<void> {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, bw: document.body.scrollWidth, sh: document.documentElement.scrollHeight, ih: window.innerHeight }));
  expect(o.sw, 'document wider than the viewport').toBeLessThanOrEqual(o.iw);
  expect(o.bw).toBeLessThanOrEqual(o.iw);
  expect(o.sh, 'document taller than the viewport').toBeLessThanOrEqual(o.ih);
}
type Rect = { x: number; y: number; width: number; height: number };
const inside = (b: Rect, vp: { width: number; height: number }, tol = 1): boolean => b.x >= -tol && b.y >= -tol && b.x + b.width <= vp.width + tol && b.y + b.height <= vp.height + tol;

const SIZES: { name: string; width: number; height: number }[] = [
  { name: 'desktop 1280x720', width: 1280, height: 720 },
  { name: 'phone portrait 390x844', width: 390, height: 844 },
  { name: 'phone landscape 844x390', width: 844, height: 390 },
];

/**
 * Resize, then poll until `problems()` is empty (the layout follows a ResizeObserver, which software rendering delays by
 * seconds). On timeout the last list of problems is the failure message, so a real clipping bug reads as a bug.
 */
async function settled(page: Page, size: { name: string; width: number; height: number }, problems: () => Promise<string[]>): Promise<void> {
  await page.setViewportSize({ width: size.width, height: size.height });
  let last: string[] = ['not measured yet'];
  try {
    await expect.poll(async () => { last = await problems(); return last.length; }, { timeout: 25_000, intervals: [300] }).toBe(0);
  } catch {
    throw new Error(`${size.name}: ${last.join('; ')}`);
  }
}

test.beforeEach(async ({ page }) => {
  await open(page, { seed: 5 });
});

// ============================================================================ L. layout
test.describe('L layout at three sizes', () => {
  test.describe.configure({ timeout: 180_000 });
  const vpOf = (page: Page) => page.viewportSize()!;

  test('Whack hard (4x3) with Zona Lebar + Kabut + Teropong: holes >= 64 px, inside the viewport, HUD not overlapping, no scroll', async ({ page }) => {
    await startMini(page, 'whack_a_mole', { difficulty: 'hard', modifiers: [{ kind: 'tolerance', mult: 1.3 }, { kind: 'fog' }, { kind: 'hint' }] as MinigameModifier[] });
    await setTimeScale(page, 0.3);
    const out: string[] = [];
    for (const size of SIZES) {
      let minSide = 0;
      await settled(page, size, async () => {
        const vp = vpOf(page);
        const holes = await Promise.all(Array.from({ length: 12 }, (_, i) => box(byId(page, `mg-hole-${i}`))));
        const timer = await box(byId(page, 'mg-timer'));
        const progress = await box(byId(page, 'mg-progress'));
        const bad: string[] = [];
        minSide = Math.min(...holes.map((h) => Math.min(h.width, h.height)));
        if (minSide < 64) bad.push(`smallest hole side ${minSide.toFixed(0)} < 64`);
        holes.forEach((h, i) => { if (!inside(h, vp)) bad.push(`hole ${i} outside ${JSON.stringify(h)}`); if (overlaps(h, timer) || overlaps(h, progress)) bad.push(`hole ${i} under the HUD`); });
        if (!inside(timer, vp) || !inside(progress, vp)) bad.push('HUD outside the viewport');
        return bad;
      });
      await noHorizontalScroll(page);
      out.push(`${size.name}: smallest hole ${minSide.toFixed(0)} px`);
    }
    console.log(`[CP5b-QA e2e] whack ${test.info().project.name}: ${out.join(' | ')}`);
  });

  test('Cocokkan Kartu hard + 2 extra (24 cards) with Teropong: cards >= 64 px, Intip >= 48 px and clear of the cards, inside the viewport', async ({ page }) => {
    await startMini(page, 'memory_match', { difficulty: 'hard', modifiers: [{ kind: 'extraTarget', count: 2 }, { kind: 'hint' }] as MinigameModifier[] });
    await expect(page.locator('.mg-memory')).not.toHaveAttribute('data-phase', 'preview', { timeout: 30_000 });
    const out: string[] = [];
    for (const size of SIZES) {
      let min = 0;
      let peekSize = '';
      await settled(page, size, async () => {
        const vp = vpOf(page);
        const boxes = await Promise.all(Array.from({ length: 24 }, (_, i) => box(byId(page, `mg-card-${i}`))));
        const peek = await box(byId(page, 'mg-peek'));
        min = Math.min(...boxes.map((b) => Math.min(b.width, b.height)));
        peekSize = `${peek.width.toFixed(0)}x${peek.height.toFixed(0)}`;
        const bad: string[] = [];
        if (min < 64) bad.push(`smallest card ${min.toFixed(0)} < 64`);
        if (peek.width < 48 || peek.height < 48) bad.push(`Intip ${peekSize} < 48`);
        if (!inside(peek, vp)) bad.push('Intip outside');
        boxes.forEach((b, i) => { if (!inside(b, vp)) bad.push(`card ${i} outside ${JSON.stringify(b)}`); if (overlaps(b, peek)) bad.push(`card ${i} under Intip`); });
        return bad;
      });
      await noHorizontalScroll(page);
      out.push(`${size.name}: smallest card ${min.toFixed(0)} px, Intip ${peekSize}`);
    }
    console.log(`[CP5b-QA e2e] memory ${test.info().project.name}: ${out.join(' | ')}`);
  });

  test('Tebak Lokasi medium with Kabut: choices >= 56 px high, every choice inside the viewport and clear of the picture, columns 1 on phones / 2x2 on desktop, no scroll', async ({ page }) => {
    await startMini(page, 'guess_location', { difficulty: 'medium', modifiers: [{ kind: 'fog' }] as MinigameModifier[] });
    await setTimeScale(page, 0.2);
    const out: string[] = [];
    for (const size of SIZES) {
      let desc = '';
      await settled(page, size, async () => {
        const vp = vpOf(page);
        const boxes = await Promise.all(Array.from({ length: 4 }, (_, i) => box(byId(page, `mg-choice-${i}`))));
        const pic = await box(byId(page, 'mg-picture'));
        const cols = new Set(boxes.map((b) => Math.round(b.x))).size;
        desc = `${cols} column(s), choices ${boxes.map((b) => b.height.toFixed(0)).join('/')} px high, lowest bottom ${Math.max(...boxes.map((b) => b.y + b.height)).toFixed(0)} of ${vp.height}`;
        const bad: string[] = [];
        boxes.forEach((b, i) => {
          if (b.height < 56) bad.push(`choice ${i} height ${b.height.toFixed(0)} < 56`);
          if (!inside(b, vp)) bad.push(`choice ${i} clipped ${JSON.stringify(b)}`);
          if (overlaps(b, pic)) bad.push(`choice ${i} over the picture`);
        });
        return bad;
      });
      await noHorizontalScroll(page);
      out.push(`${size.name}: ${desc}`);
    }
    console.log(`[CP5b-QA e2e] guess ${test.info().project.name}: ${out.join(' | ')}`);
  });

  test('Ketapel hard + 2 extra (8 bullets): timer, progress, bullets and wind are inside the viewport and do not overlap; the canvas fills the screen', async ({ page }) => {
    await startMini(page, 'slingshot', { difficulty: 'hard', modifiers: [{ kind: 'extraTarget', count: 2 }] as MinigameModifier[] });
    const out: string[] = [];
    for (const size of SIZES) {
      let canvas = '';
      await settled(page, size, async () => {
        const vp = vpOf(page);
        const parts = {
          progress: await box(byId(page, 'mg-progress')),
          bullets: await box(byId(page, 'mg-bullets')),
          wind: await box(byId(page, 'mg-wind')),
          timer: await box(byId(page, 'mg-timer')),
        };
        const c = await box(byId(page, 'mg-canvas'));
        canvas = `${c.width.toFixed(0)}x${c.height.toFixed(0)}`;
        const bad: string[] = [];
        for (const [k, b] of Object.entries(parts)) if (!inside(b, vp)) bad.push(`${k} outside ${JSON.stringify(b)}`);
        if (overlaps(parts.progress, parts.bullets)) bad.push('progress overlaps bullets');
        if (overlaps(parts.progress, parts.wind)) bad.push('progress overlaps wind');
        if (overlaps(parts.bullets, parts.wind)) bad.push('bullets overlap wind');
        if (c.width < vp.width - 2 || c.height < vp.height - 2) bad.push(`canvas ${canvas} does not fill ${vp.width}x${vp.height}`);
        return bad;
      });
      await noHorizontalScroll(page);
      out.push(`${size.name}: HUD ok, canvas ${canvas}`);
    }
    console.log(`[CP5b-QA e2e] sling ${test.info().project.name}: ${out.join(' | ')}`);
  });
});

// ============================================================================ I. real input paths
test.describe('I real input paths', () => {
  test.describe.configure({ timeout: 180_000 });

  /** A real finger: Chrome DevTools Protocol touch events (they go through the browser's touch pipeline, touch-action included). */
  async function touchDrag(cdp: CDPSession, from: { x: number; y: number }, to: { x: number; y: number }, steps = 6): Promise<void> {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y, id: 1 }] });
    for (let i = 1; i <= steps; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps, id: 1 }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  const bulletsLeft = async (page: Page) => Number(await byId(page, 'mg-bullets').getAttribute('data-left'));

  test('Ketapel, a REAL touch drag (mobile): shoots with power from the drag length; < 5% cancels and keeps the bullet; the upper half does nothing; no pointercancel, no page scroll', async ({ page }) => {
    test.skip(!isTouch(), 'touch only');
    await startMini(page, 'slingshot', { difficulty: 'easy' });
    await page.evaluate(() => {
      (window as unknown as { __pc: string[] }).__pc = [];
      for (const t of ['pointercancel', 'pointerup', 'pointerdown']) window.addEventListener(t, (e) => (window as unknown as { __pc: string[] }).__pc.push(`${t}:${(e as PointerEvent).pointerType}`), true);
    });
    const cdp = await page.context().newCDPSession(page);
    const b = await box(byId(page, 'mg-play-area'));
    const cx = b.x + b.width / 2;
    const y0 = b.y + b.height * 0.62;
    await touchDrag(cdp, { x: cx, y: y0 }, { x: cx, y: y0 + b.height * 0.03 }); // 3% of the height: cancel
    await page.waitForTimeout(300);
    expect(await bulletsLeft(page)).toBe(6);
    await touchDrag(cdp, { x: cx, y: y0 - b.height * 0.3 }, { x: cx, y: y0 - b.height * 0.3 + 120 }); // starts in the upper half
    await page.waitForTimeout(300);
    expect(await bulletsLeft(page)).toBe(6);
    await touchDrag(cdp, { x: cx, y: y0 }, { x: cx + 24, y: y0 + b.height * 0.15 }); // 15% of the height = 0.6 power
    await expect.poll(() => bulletsLeft(page)).toBe(5);
    const st = (await info(page))!.state as { flight: { aim: { yawDeg: number; power: number } } | null; landed: { aim: { yawDeg: number; power: number } }[] };
    const aim = (st.flight ?? st.landed[0])!.aim;
    expect(aim.power).toBeGreaterThan(0.55);
    expect(aim.power).toBeLessThan(0.72);
    expect(aim.yawDeg).toBeLessThan(0);
    const events = await page.evaluate(() => (window as unknown as { __pc: string[] }).__pc);
    expect(events.filter((e) => e.startsWith('pointercancel')), `pointercancel during real touch drags: ${events.join(',')}`).toEqual([]);
    expect(events.filter((e) => e === 'pointerdown:touch').length).toBeGreaterThanOrEqual(3);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test('Ketapel, a second finger while the first is dragging does not shoot a second bullet (mobile)', async ({ page }) => {
    test.skip(!isTouch(), 'touch only');
    await startMini(page, 'slingshot', { difficulty: 'easy' });
    const cdp = await page.context().newCDPSession(page);
    const b = await box(byId(page, 'mg-play-area'));
    const x1 = b.x + b.width * 0.35;
    const x2 = b.x + b.width * 0.7;
    const y0 = b.y + b.height * 0.62;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y: y0, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y: y0, id: 1 }, { x: x2, y: y0, id: 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x1, y: y0 + 80, id: 1 }, { x: x2, y: y0 + 90, id: 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: x1, y: y0 + 80, id: 1 }] }); // finger 2 lifts last... the first one is released
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(400);
    expect(await bulletsLeft(page)).toBeGreaterThanOrEqual(5); // 0 or 1 bullet used, never 2
  });

  test('Ketapel, mouse (desktop): Esc in the middle of a drag cancels the aim and does NOT pause; Esc with no aim pauses; Esc again resumes (interpretation 7)', async ({ page }) => {
    test.skip(isTouch(), 'keyboard is a desktop input');
    await startMini(page, 'slingshot', { difficulty: 'easy' });
    const b = await box(byId(page, 'mg-play-area'));
    const x = b.x + b.width / 2;
    const y = b.y + b.height * 0.62;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 10, y + 60);
    await expect(byId(page, 'mg-play-area')).toHaveAttribute('data-aiming', 'drag');
    await page.keyboard.press('Escape');
    await expect(byId(page, 'mg-play-area')).toHaveAttribute('data-aiming', 'none');
    await page.mouse.up();
    await page.waitForTimeout(300);
    expect(await bulletsLeft(page)).toBe(6); // the release after Esc is not a shot
    await expect(byId(page, 'pause-overlay')).toBeHidden(); // the first Esc was eaten by the aim
    const t0 = await playMs(page);
    await page.waitForTimeout(300);
    expect(await playMs(page)).toBeGreaterThan(t0);
    await page.keyboard.press('Escape'); // nothing to cancel: pause
    await expect(byId(page, 'pause-overlay')).toBeVisible();
    const t1 = await playMs(page);
    await page.waitForTimeout(500);
    expect(await playMs(page)).toBe(t1);
    await page.keyboard.press('Escape');
    await expect(byId(page, 'pause-overlay')).toBeHidden();
  });

  test('Whack, two fingers at the same moment on two live targets both count (mobile)', async ({ page }) => {
    test.skip(!isTouch(), 'touch only');
    await startMini(page, 'whack_a_mole', { difficulty: 'hard', seed: 3 }); // hard: up to 2 characters up at once, most often
    await setTimeScale(page, 0.2);
    const cdp = await page.context().newCDPSession(page);
    let done = false;
    for (let attempt = 0; attempt < 300 && !done; attempt++) {
      const live = await page.evaluate(() => [...document.querySelectorAll('.wm-hole[data-state="target"]')].map((e) => { const r = e.getBoundingClientRect(); return { h: Number((e as HTMLElement).dataset.hole), x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
      if (live.length >= 2) {
        const a = live[0]!;
        const c = live[1]!;
        const before = Number(await byId(page, 'mg-progress').getAttribute('data-hits'));
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y, id: 1 }, { x: c.x, y: c.y, id: 2 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await page.waitForTimeout(700);
        const after = Number(await byId(page, 'mg-progress').getAttribute('data-hits'));
        expect(after - before, `two simultaneous taps on holes ${a.h} and ${c.h}`).toBe(2);
        done = true;
      } else await page.waitForTimeout(100);
    }
    expect(done, 'never saw two live targets at once').toBe(true);
  });

  test('Whack, one real tap on a live target is exactly +1 hit (no double count from synthesized mouse events)', async ({ page }) => {
    await startMini(page, 'whack_a_mole', { difficulty: 'easy', seed: 4 });
    await setTimeScale(page, 0.2);
    const target = page.locator('.wm-hole[data-state="target"]').first();
    await expect(target).toBeVisible({ timeout: 30_000 });
    await press(target);
    await page.waitForTimeout(900);
    expect(await byId(page, 'mg-progress').getAttribute('data-hits')).toBe('1');
  });

  test('Tebak Lokasi: Tab to a choice + Enter answers (keyboard path); a mouse click answers exactly once (desktop)', async ({ page }) => {
    test.skip(isTouch(), 'keyboard is a desktop input');
    await startMini(page, 'guess_location', { difficulty: 'medium', seed: 6 });
    await setTimeScale(page, 0.3);
    const lv = (await info(page))!.level as GuessLevel;
    const right = (q: number): number => (lv.items[q] as { choices: string[]; correctRegionId: string }).choices.indexOf((lv.items[q] as { correctRegionId: string }).correctRegionId);
    // question 0: focus choice 0, Tab to the right one, Enter
    await byId(page, 'mg-choice-0').focus();
    for (let i = 0; i < right(0); i++) await page.keyboard.press('Tab');
    await expect(byId(page, `mg-choice-${right(0)}`)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect.poll(async () => ((await info(page))?.state as { q: number; answer: { choice: number; correct: boolean } | null } | undefined)?.answer, { timeout: 10_000 }).toMatchObject({ choice: right(0), correct: true });
    // question 1: one mouse click must be exactly one answer
    await expect.poll(async () => ((await info(page))?.state as { q: number } | undefined)?.q, { timeout: 15_000 }).toBe(1);
    await byId(page, `mg-choice-${right(1)}`).click();
    await expect.poll(async () => ((await info(page))?.state as { q: number; correct: number } | undefined)?.correct, { timeout: 10_000 }).toBe(2);
    await page.waitForTimeout(300);
    const st = (await info(page))!.state as { q: number; correct: number };
    expect([st.q, st.correct]).toEqual([1, 2]); // the click was not also taken as an answer to question 3
  });
});

// ============================================================================ C. card x minigame, real flow
test.describe('C cards through the real flow', () => {
  test.describe.configure({ timeout: 240_000 });

  type Round = { name: string; boosts: string[]; sabotages: string[] };
  const ROUNDS: Round[] = [
    { name: 'boosts (Jam Pasir, Zona Lebar, Teropong)', boosts: ['jam_pasir', 'zona_lebar', 'teropong'], sabotages: [] },
    { name: 'sabotage (Jam Rusak, Kabut Asap)', boosts: [], sabotages: ['jam_rusak', 'kabut_asap'] },
    { name: 'sabotage (Ngebut, Tambah Beban)', boosts: [], sabotages: ['ngebut', 'tambah_beban'] },
  ];

  async function playRound(page: Page, id: string, round: Round, first: boolean): Promise<{ level: unknown; attempt: { modifiers: MinigameModifier[]; difficulty: 'easy' | 'medium' | 'hard'; baseDifficulty: 'easy' | 'medium' | 'hard'; seed: number; targetId: string } }> {
    await api(page, (a) => a.pause()); // hold the bot while the cards are set up
    if (first) {
      await dispatch(page, { type: 'selectTarget', playerId: 'p1', targetId: 'medan' });
    }
    expect(await api(page, (a) => a.clearHand())).toBe(true);
    expect(await page.evaluate((m) => (window as unknown as { __atlasTest: Api }).__atlasTest.forceMinigame(m), id)).toBe(true);
    for (const c of round.boosts) {
      expect(await page.evaluate((x) => (window as unknown as { __atlasTest: Api }).__atlasTest.giveCard(x), c), `give ${c}`).toBe(true);
      const r = await page.evaluate((x) => (window as unknown as { __atlasTest: Api }).__atlasTest.playCard(x), c);
      expect(r, `play ${c}`).toEqual({ ok: true });
    }
    for (const c of round.sabotages) {
      let sent = false;
      for (let tries = 0; tries < 12 && !sent; tries++) {
        await dispatch(page, { type: 'debugClearHand', playerId: 'bot1' });
        await page.evaluate((x) => (window as unknown as { __atlasTest: Api }).__atlasTest.giveCardTo('bot1', x), c);
        const r = await page.evaluate((x) => (window as unknown as { __atlasTest: Api }).__atlasTest.playSabotage(x, 'p1', 'bot1'), c);
        sent = r.ok;
        if (!sent) { // the bot is busy in its own attempt: let it finish, then try again
          await api(page, (a) => a.resume());
          await setTimeScale(page, 10);
          await page.waitForTimeout(1500);
          await setTimeScale(page, 1);
          await api(page, (a) => a.pause());
        }
      }
      expect(sent, `bot1 could not send ${c}`).toBe(true);
    }
    await api(page, (a) => a.resume());
    await expect(byId(page, 'btn-start')).toBeEnabled({ timeout: 40_000 });
    await press(byId(page, 'btn-start'));
    await expect(byId(page, 'mg-overlay')).toHaveAttribute('data-minigame', id);
    const st = await api(page, (a) => a.getState());
    const at = st.players.find((p) => p.id === 'p1')!.attempt!;
    const m = await info(page);
    return { level: m!.level, attempt: { modifiers: at.modifiers, difficulty: at.difficulty, baseDifficulty: at.baseDifficulty, seed: at.seed, targetId: at.targetId } };
  }

  for (const id of ['whack_a_mole', 'slingshot', 'memory_match', 'guess_location']) {
    test(`${id}: every modifier of the 9 modifier cards reaches the level and shows up on screen (3 rounds of cards)`, async ({ page }) => {
      const logic = getMinigameLogic(id);
      for (const [n, round] of ROUNDS.entries()) {
        const { level: lvl, attempt } = await playRound(page, id, round, n === 0);
        // 1. the attempt snapshot is what the card table says
        const expected = resolveAttemptEffects([...round.boosts, ...round.sabotages].map(getCard), attempt.baseDifficulty, logic.baseDurationMs);
        expect(attempt.modifiers, `${round.name}: snapshot`).toEqual(expected.modifiers);
        expect(attempt.difficulty).toBe(expected.difficulty);
        // 2. the host opened exactly the level the pure logic generates for that snapshot
        const want = logic.generateLevel({ seed: attempt.seed, difficulty: attempt.difficulty, modifiers: attempt.modifiers, map: MAP, regionId: attempt.targetId, inputMode: 'touch', settings: { reducedMotion: false, reducedFlash: false, sfxVolume: 1 } });
        expect(JSON.parse(JSON.stringify(lvl)), `${round.name}: level in the page`).toEqual(JSON.parse(JSON.stringify(want)));
        expect((want as { warnings: string[] }).warnings).toEqual([]);
        // 3. badges for every kind in the snapshot
        for (const m of attempt.modifiers) await expect(byId(page, `mg-badge-${m.kind}`), `${round.name}: badge ${m.kind}`).toBeVisible();
        // 4. visible / measurable on screen once play starts
        await expect(byId(page, 'mg-overlay')).toHaveAttribute('data-phase', 'play', { timeout: 30_000 });
        const kinds = new Set(attempt.modifiers.map((m) => m.kind));
        if (id === 'whack_a_mole') {
          const lv = lvl as WhackLevel;
          if (kinds.has('fog')) await expect.poll(() => page.locator('.wm-hole.fogged').count(), { timeout: 8000 }).toBeGreaterThan(0);
          if (kinds.has('hint')) await expect.poll(() => page.locator('.wm-hole.soon').count(), { timeout: 8000 }).toBeGreaterThan(0);
          if (kinds.has('tolerance')) expect(await page.locator('.wm-hole.wide').count()).toBe(lv.gridCols * lv.gridRows);
          if (kinds.has('extraTarget')) expect(await byId(page, 'mg-progress').textContent()).toBe(`0/${lv.hitsRequired}`);
          if (kinds.has('timeDelta') || kinds.has('speed')) expect(lv.tempo).not.toBe(1);
        } else if (id === 'memory_match') {
          const lv = lvl as MemoryLevel;
          if (kinds.has('fog')) await expect(page.locator('.mg-memory')).toHaveClass(/fog/);
          if (kinds.has('hint')) await expect(byId(page, 'mg-peek')).toBeVisible({ timeout: 15_000 });
          if (kinds.has('extraTarget')) expect(await page.locator('.mm-card').count()).toBe(lv.pairs * 2);
          if (kinds.has('tolerance')) expect(lv.previewMs).toBeGreaterThan(0);
        } else if (id === 'guess_location') {
          const lv = lvl as GuessLevel;
          if (kinds.has('hint')) await expect.poll(() => page.locator('.gl-choice[hidden]').count()).toBe(1);
          if (kinds.has('fog')) await expect.poll(() => byId(page, 'mg-picture').evaluate((e) => (e as HTMLElement).style.filter)).toMatch(/blur/);
          if (kinds.has('extraTarget')) expect(await byId(page, 'mg-progress').textContent()).toMatch(new RegExp(`/${lv.questions}$`));
          expect(lv.timePerQuestionMs).toBeGreaterThanOrEqual(3000);
        } else {
          const lv = lvl as SlingLevel;
          if (kinds.has('extraTarget')) await expect(byId(page, 'mg-bullets')).toHaveAttribute('data-left', String(lv.bullets));
          await expect(byId(page, 'mg-progress')).toHaveText(`0/${lv.targetsRequired}`);
          if (kinds.has('hint')) expect([lv.hitPreview, lv.aimLineFrac]).toEqual([true, 1]);
          if (kinds.has('fog')) expect(lv.fog).toBe(true);
        }
        // finish the round by failing it (goes through the real banner), then skip the cooldown
        await setTimeScale(page, 10);
        expect(await force(page, false)).toBe(true);
        await waitIdle(page);
        await setTimeScale(page, 30);
        await expect(byId(page, 'btn-start')).toBeEnabled({ timeout: 30_000 });
        await setTimeScale(page, 1);
      }
      expect(consoleErrors.get(page) ?? []).toEqual([]);
    });
  }

  test('Ketapel Kabut is visible: the canvas pixels differ from the same frame without fog', async ({ page }) => {
    test.setTimeout(120_000);
    const shot = async (mods: MinigameModifier[]): Promise<Buffer> => {
      await startMini(page, 'slingshot', { difficulty: 'medium', seed: 21, modifiers: mods });
      await setTimeScale(page, 0.001); // (the pause overlay would hide the canvas) near-frozen game time, frames keep coming
      await page.waitForTimeout(800);
      const cb = await box(byId(page, 'mg-canvas'));
      const png = await page.screenshot({ clip: { x: cb.x, y: cb.y, width: cb.width, height: cb.height }, timeout: 30_000 });
      await setTimeScale(page, 10);
      await force(page, false);
      await expect(byId(page, 'mg-overlay')).toBeHidden({ timeout: 30_000 });
      await setTimeScale(page, 1);
      return png;
    };
    const diff = (x: Buffer, y: Buffer): Promise<number> => page.evaluate(async ([ax, by]) => {
      const load = async (b64: string): Promise<ImageData> => {
        const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
        const c = document.createElement('canvas');
        c.width = bmp.width; c.height = bmp.height;
        const g = c.getContext('2d') as CanvasRenderingContext2D;
        g.drawImage(bmp, 0, 0);
        return g.getImageData(0, 0, bmp.width, bmp.height);
      };
      const [p1, p2] = [await load(ax as string), await load(by as string)];
      let n = 0;
      for (let i = 0; i < p1.data.length; i += 4) {
        if (Math.abs((p1.data[i] as number) - (p2.data[i] as number)) + Math.abs((p1.data[i + 1] as number) - (p2.data[i + 1] as number)) + Math.abs((p1.data[i + 2] as number) - (p2.data[i + 2] as number)) > 24) n++;
      }
      return n;
    }, [x.toString('base64'), y.toString('base64')] as const);
    const plain = await shot([]);
    const fog = await shot([{ kind: 'fog' }]);
    const plain2 = await shot([]);
    const noise = await diff(plain, plain2);
    const withFog = await diff(plain, fog);
    console.log(`[CP5b-QA e2e] Ketapel Kabut (${test.info().project.name}): pixels changed plain vs plain ${noise}, plain vs fog ${withFog}`);
    expect(withFog, 'fog must change the picture more than the frame-to-frame noise does').toBeGreaterThan(noise + 30);
  });
});

// ============================================================================ P. pause
test.describe('P pause per minigame', () => {
  test.describe.configure({ timeout: 150_000 });
  for (const id of ['whack_a_mole', 'slingshot', 'memory_match', 'guess_location']) {
    test(`${id}: Esc pauses and resumes (desktop); a hidden tab auto-pauses (all); play time stands still and the content is covered`, async ({ page }) => {
      await startMini(page, id, { difficulty: 'medium' });
      if (!isTouch()) {
        await page.keyboard.press('Escape');
        await expect(byId(page, 'pause-overlay')).toBeVisible();
        await expect(byId(page, 'mg-play-area')).toBeHidden();
        const t0 = await playMs(page);
        await page.waitForTimeout(700);
        expect(await playMs(page)).toBe(t0);
        await page.keyboard.press('Escape');
        await expect(byId(page, 'pause-overlay')).toBeHidden();
        await expect.poll(() => playMs(page)).toBeGreaterThan(t0);
      }
      // tab hidden -> auto-pause (ui-flow section 9)
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { value: true, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await expect(byId(page, 'pause-overlay')).toBeVisible();
      const t1 = await playMs(page);
      await page.waitForTimeout(700);
      expect(await playMs(page)).toBe(t1);
      await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); });
      await api(page, (a) => a.resume());
      await expect.poll(() => playMs(page)).toBeGreaterThan(t1);
    });
  }

  test('the Pause button of the HUD can be pressed while a minigame is open (ui-flow: "tombol pause di kanan atas")', async ({ page }) => {
    await dispatch(page, { type: 'selectTarget', playerId: 'p1', targetId: 'medan' });
    expect(await page.evaluate(() => (window as unknown as { __atlasTest: Api }).__atlasTest.forceMinigame('whack_a_mole'))).toBe(true);
    await expect(byId(page, 'btn-start')).toBeEnabled({ timeout: 30_000 });
    await press(byId(page, 'btn-start'));
    const probe = async (): Promise<string> => {
      const b = await box(byId(page, 'btn-pause'));
      return page.evaluate(([x, y]) => (document.elementFromPoint(x as number, y as number) as HTMLElement | null)?.closest('[data-testid]')?.getAttribute('data-testid') ?? 'none', [b.x + b.width / 2, b.y + b.height / 2] as const);
    };
    await expect(byId(page, 'mg-overlay')).toHaveAttribute('data-phase', 'intro');
    const inIntro = await probe();
    await setTimeScale(page, 6);
    await expect(byId(page, 'mg-overlay')).toHaveAttribute('data-phase', 'play', { timeout: 30_000 });
    await setTimeScale(page, 1);
    const inPlay = await probe();
    console.log(`[CP5b-QA e2e] element on top of the Pause button (${test.info().project.name}): intro -> ${inIntro}, play -> ${inPlay}`);
    // KNOWN BUG QA-CP5b-01 (also on the CP3 minigames): the overlay covers the HUD Pause button, so a phone cannot pause a minigame by hand.
    test.fail(inPlay !== 'btn-pause' || inIntro !== 'btn-pause', 'QA-CP5b-01: the HUD Pause button is under the minigame overlay');
    expect(inIntro, 'intro').toBe('btn-pause');
    expect(inPlay, 'play').toBe('btn-pause');
  });
});

// ============================================================================ G. Ketapel GPU, many opens
test.describe('G Ketapel leak check', () => {
  test.describe.configure({ timeout: 280_000 });
  test('45 open/close cycles over all difficulties and modifiers: counters return to 0 every time, no canvas is left, no WebGL-context warning, the race renderer keeps rendering, JS heap does not grow', async ({ page }) => {
    const warnings: string[] = [];
    page.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'error') warnings.push(`${m.type()}: ${m.text()}`); });
    const cdp = await page.context().newCDPSession(page);
    const heap = async (): Promise<number> => {
      await cdp.send('HeapProfiler.collectGarbage');
      const { metrics } = await cdp.send('Performance.getMetrics');
      return (metrics.find((x) => x.name === 'JSHeapUsedSize')?.value ?? 0) / 1e6;
    };
    await cdp.send('Performance.enable');
    const base = await page.locator('canvas').count();
    const frame = () => page.evaluate(() => (window as unknown as { atlas: { renderer: { info: { render: { frame: number } } } } }).atlas.renderer.info.render.frame);
    const diffs: ('easy' | 'medium' | 'hard')[] = ['easy', 'medium', 'hard'];
    const mods: MinigameModifier[][] = [[], [{ kind: 'fog' }], [{ kind: 'hint' }], [{ kind: 'extraTarget', count: 2 }, { kind: 'tolerance', mult: 1.3 }]];
    let firstGeom = 0;
    let lastGeom = 0;
    let h0 = 0;
    for (let i = 0; i < 45; i++) {
      if (i === 5) h0 = await heap(); // after warm-up
      await startMini(page, 'slingshot', { difficulty: diffs[i % 3]!, modifiers: mods[i % 4]!, seed: 100 + i });
      const gpu = await api(page, (a) => a.minigameGpu());
      expect(gpu!.geometries).toBeGreaterThan(5);
      if (i === 0) firstGeom = gpu!.geometries;
      lastGeom = gpu!.geometries;
      await setTimeScale(page, 10);
      expect(await force(page, i % 2 === 0)).toBe(true);
      await expect(byId(page, 'mg-overlay')).toBeHidden({ timeout: 30_000 });
      await setTimeScale(page, 1);
      expect(await page.locator('canvas').count()).toBe(base);
      expect(await api(page, (a) => a.lastDisposedGpu())).toMatchObject({ geometries: 0, textures: 0 });
    }
    const h1 = await heap();
    const f0 = await frame();
    await page.waitForTimeout(700);
    const f1 = await frame();
    const lost = await page.evaluate(() => (window as unknown as { atlas: { renderer: { getContext(): WebGLRenderingContext } } }).atlas.renderer.getContext().isContextLost());
    console.log(`[CP5b-QA e2e] sling 45 opens (${test.info().project.name}): geometries first ${firstGeom} / last ${lastGeom}; JS heap ${h0.toFixed(1)} -> ${h1.toFixed(1)} MB; race frames ${f0} -> ${f1}; race context lost: ${lost}; console warnings/errors: ${warnings.length}`);
    for (const w of warnings.slice(0, 5)) console.log(`[CP5b-QA e2e]   ${w}`);
    expect(lost, 'the race renderer lost its WebGL context').toBe(false);
    expect(f1, 'the race renderer renders again after the opens').toBeGreaterThan(f0);
    expect(warnings.filter((w) => /webgl|context/i.test(w))).toEqual([]);
    expect(h1 - h0, `JS heap grew by ${(h1 - h0).toFixed(1)} MB over 40 opens`).toBeLessThan(15);
  });
});

// ============================================================================ O. lifecycle: listeners (A10)
test.describe('O lifecycle', () => {
  test.describe.configure({ timeout: 200_000 });
  test('window and document listeners are back to the baseline after 5 open/close cycles of each of the four minigames (A10)', async ({ page }) => {
    const cdp = await page.context().newCDPSession(page);
    const counts = async (): Promise<Record<string, number>> => {
      const out: Record<string, number> = {};
      for (const target of ['window', 'document']) {
        const { result } = await cdp.send('Runtime.evaluate', { expression: target });
        const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId as string });
        for (const l of listeners) out[`${target}:${l.type}${l.useCapture ? ':capture' : ''}`] = (out[`${target}:${l.type}${l.useCapture ? ':capture' : ''}`] ?? 0) + 1;
      }
      return out;
    };
    const base = await counts();
    for (const id of ['whack_a_mole', 'slingshot', 'memory_match', 'guess_location']) {
      for (let i = 0; i < 5; i++) {
        await startMini(page, id, { difficulty: 'medium', seed: 30 + i });
        const during = await counts();
        expect(Object.values(during).reduce((a, b) => a + b, 0), `${id}: listeners during play`).toBeGreaterThan(Object.values(base).reduce((a, b) => a + b, 0));
        await setTimeScale(page, 10);
        expect(await force(page, i % 2 === 0)).toBe(true);
        await expect(byId(page, 'mg-overlay')).toBeHidden({ timeout: 30_000 });
        await setTimeScale(page, 1);
      }
      expect(await counts(), `${id}: listeners after 5 cycles`).toEqual(base);
    }
  });
});

// ============================================================================ R. reduced motion on all four
test.describe('R accessibility switches', () => {
  for (const id of ['whack_a_mole', 'slingshot', 'memory_match', 'guess_location']) {
    test(`${id}: prefers-reduced-motion puts the reduced-motion class on the play area`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await open(page, { seed: 5 });
      await startMini(page, id, { difficulty: 'easy' });
      await expect(byId(page, 'mg-play-area')).toHaveClass(/reduced-motion/);
    });
  }
  test('the intro rule sentences are <= 8 words and the result banner of each minigame is one of two texts', async ({ page }) => {
    for (const id of ['whack_a_mole', 'slingshot', 'memory_match', 'guess_location']) {
      const ok = await page.evaluate(([i]) => (window as unknown as { __atlasTest: Api }).__atlasTest.openMinigame(i as string, { introMs: 5000 }), [id] as const);
      expect(ok).toBe(true);
      await expect(byId(page, 'mg-overlay')).toHaveAttribute('data-minigame', id);
      const text = (await byId(page, 'mg-intro').locator('.mg-rule').textContent()) ?? '';
      const words = text.trim().split(/\s+/).length;
      expect(words, `${id}: "${text}"`).toBeLessThanOrEqual(8);
      expect(await page.evaluate(() => (window as unknown as { __atlasTest: Api }).__atlasTest.forceMinigameResult(true))).toBe(true);
      await expect(byId(page, 'mg-banner')).toHaveAttribute('data-result', 'pass');
      await setTimeScale(page, 10);
      await expect(byId(page, 'mg-overlay')).toBeHidden({ timeout: 30_000 });
      await setTimeScale(page, 1);
    }
  });
});

