/**
 * CP5b smoke tests, desktop + mobile: Whack-a-Mole, Ketapel, Cocokkan Kartu, Tebak Lokasi.
 * Each minigame is opened straight through the debug hook `__atlasTest.openMinigame` (no race
 * needed) with a fixed seed, so the level is known from `getMinigame().level`. The machine has no
 * fonts: assertions use data attributes, toHaveText on strings we control, and geometry.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  memoryPerfectScript,
  whackPerfectScript,
  type GuessLevel,
  type MemoryLevel,
  type MinigameModifier,
  type SlingLevel,
  type WhackLevel,
} from '../../src/logic';
import type { AtlasTestApi, SandboxOptions } from '../../src/ui/debug';
import { box, byId, consoleErrors, dispatch, isTouch, open, press, setTimeScale } from './helpers';

type Api = AtlasTestApi;
const api = <T>(page: Page, fn: (a: Api) => T): Promise<T> => page.evaluate(`(${fn.toString()})(window.__atlasTest)`) as Promise<T>;

async function startMini(page: Page, id: string, opts: SandboxOptions = {}): Promise<void> {
  const ok = await page.evaluate(([i, o]) => (window as unknown as { __atlasTest: Api }).__atlasTest.openMinigame(i as string, o as SandboxOptions), [id, { introMs: 300, seed: 11, ...opts }] as const);
  expect(ok).toBe(true);
  await expect(byId(page, 'mg-overlay')).toHaveAttribute('data-minigame', id);
  await expect(byId(page, 'mg-overlay')).toHaveAttribute('data-phase', 'play', { timeout: 60_000 });
}

const info = (page: Page) => page.evaluate(() => (window as unknown as { __atlasTest: Api }).__atlasTest.getMinigame());
const level = async <L>(page: Page): Promise<L> => (await info(page))!.level as L;
const playMs = async (page: Page): Promise<number> => (await info(page))!.playMs;

/** Run a timed input script inside the page: each entry is injected once play time reaches its tMs. */
async function runInPage(page: Page, script: { tMs: number; input: unknown }[]): Promise<void> {
  await page.evaluate((s) => {
    const a = (window as unknown as { __atlasTest: Api }).__atlasTest;
    let i = 0;
    const tick = () => {
      const m = a.getMinigame();
      if (!m || i >= s.length) return;
      while (i < s.length && m.playMs >= (s[i] as { tMs: number }).tMs) a.minigameInput((s[i++] as { input: unknown }).input);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, script);
}

/** Tebak Lokasi driver: answer each question correctly shortly after it opens (state-aware: the gap length depends on when we answered). */
async function driveGuess(page: Page, lv: GuessLevel): Promise<void> {
  await page.evaluate((level) => {
    const a = (window as unknown as { __atlasTest: Api }).__atlasTest;
    let answered = -1;
    const tick = () => {
      const m = a.getMinigame();
      if (!m) return;
      const st = m.state as { q: number; qStartMs: number; answer: unknown; result: unknown };
      if (!st.answer && !st.result && answered !== st.q && m.playMs >= st.qStartMs + 50) {
        const it = level.items[st.q] as { choices: string[]; correctRegionId: string };
        a.minigameInput({ choice: it.choices.indexOf(it.correctRegionId) });
        answered = st.q;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, lv);
}

/** Ketapel driver (static targets): fire the ideal aim of the first target still up whenever the slingshot is ready. */
async function driveSling(page: Page, lv: SlingLevel): Promise<void> {
  await page.evaluate((level) => {
    const a = (window as unknown as { __atlasTest: Api }).__atlasTest;
    let firedAt = -1;
    const tick = () => {
      const m = a.getMinigame();
      if (!m) return;
      const st = m.state as { flight: unknown; bulletsLeft: number; reloadUntilMs: number; down: { index: number }[]; result: unknown };
      if (!st.flight && !st.result && st.bulletsLeft > 0 && m.playMs >= st.reloadUntilMs && firedAt !== st.bulletsLeft) {
        const i = level.targets.findIndex((_: unknown, k: number) => !st.down.some((d) => d.index === k));
        const ideal = (level.targets[i] as { ideal: { yawDeg: number; power: number } }).ideal;
        a.minigameInput({ yawDeg: ideal.yawDeg, power: ideal.power });
        firedAt = st.bulletsLeft;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, lv);
}

/** The result the sandbox host delivered (after the 1.2 s banner), polled until it is there. */
async function lastResult(page: Page) {
  await expect.poll(() => page.evaluate(() => (window as unknown as { __atlasTest: Api }).__atlasTest.lastMinigameResult()), { timeout: 60_000 }).not.toBeNull();
  return page.evaluate(() => (window as unknown as { __atlasTest: Api }).__atlasTest.lastMinigameResult());
}
const banner = (page: Page) => byId(page, 'mg-banner');
async function expectBanner(page: Page, kind: 'pass' | 'fail', timeout = 60_000): Promise<void> {
  await expect(banner(page)).toHaveAttribute('data-result', kind, { timeout });
}
async function noHorizontalScroll(page: Page): Promise<void> {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, bw: document.body.scrollWidth }));
  expect(o.sw).toBeLessThanOrEqual(o.iw);
  expect(o.bw).toBeLessThanOrEqual(o.iw);
}
async function expectNoErrors(page: Page): Promise<void> {
  expect(consoleErrors.get(page) ?? []).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await open(page, { seed: 5 });
});

// ================================================================== Whack-a-Mole
test.describe('whack_a_mole', () => {
  test('opens, holes are >= 64 px, a real tap on a target counts, an empty hole is ignored', async ({ page }) => {
    await startMini(page, 'whack_a_mole', { difficulty: 'easy' });
    await setTimeScale(page, 0.5); // software rendering is slow: give a real tap room
    await expect(byId(page, 'mg-holes').locator('.wm-hole')).toHaveCount(9);
    for (let i = 0; i < 9; i++) {
      const b = await box(byId(page, `mg-hole-${i}`));
      expect(b.width).toBeGreaterThanOrEqual(64);
      expect(b.height).toBeGreaterThanOrEqual(64);
    }
    await noHorizontalScroll(page);
    // tap an empty hole first: nothing changes
    await page.waitForSelector('[data-testid^="mg-hole-"][data-state="empty"]');
    const emptyHole = await page.locator('[data-testid^="mg-hole-"][data-state="empty"]').first();
    await press(emptyHole);
    await expect(byId(page, 'mg-progress')).toHaveAttribute('data-hits', '0');
    // wait for a character and tap it
    const target = page.locator('[data-testid^="mg-hole-"][data-state="target"]').first();
    await target.waitFor({ state: 'attached', timeout: 20_000 });
    await press(target);
    await expect(byId(page, 'mg-progress')).toHaveAttribute('data-hits', '1');
    await expect(byId(page, 'mg-progress')).toHaveText(/^1\/8$/);
    await expectNoErrors(page);
  });

  test('target and decoy differ by shape (svg) and the decoy carries a cross badge', async ({ page }) => {
    await startMini(page, 'whack_a_mole', { difficulty: 'medium' });
    const lv = await level<WhackLevel>(page);
    expect(lv.spawns.some((s) => s.kind === 'decoy')).toBe(true);
    await page.locator('[data-state="decoy"]').first().waitFor({ state: 'attached', timeout: 40_000 });
    const decoy = await page.locator('[data-state="decoy"] .wm-char svg').first().innerHTML();
    expect(decoy).toContain('#e63946'); // red badge
    expect(decoy).toContain('M50 6l8 8'); // the cross
    const mole = await page.evaluate(() => (document.querySelector('[data-state="target"] .wm-char svg') ?? { innerHTML: '' }).innerHTML);
    expect(mole.includes('M50 6l8 8')).toBe(false);
    // aria-label says which character is up
    await expect(page.locator('[data-state="decoy"]').first()).toHaveAttribute('aria-label', /Lubang \d+, ada kucing/);
  });

  test('idle run times out into a fail banner; the result reason is timeout', async ({ page }) => {
    await startMini(page, 'whack_a_mole', { difficulty: 'medium' });
    await setTimeScale(page, 10);
    await expectBanner(page, 'fail');
    expect((await lastResult(page))?.reason).toBe('timeout');
  });

  test('a perfect player passes through the real host and banner', async ({ page }) => {
    await startMini(page, 'whack_a_mole', { difficulty: 'easy' });
    const lv = await level<WhackLevel>(page);
    await runInPage(page, whackPerfectScript(lv));
    await expectBanner(page, 'pass');
    expect((await lastResult(page))).toMatchObject({ passed: true, reason: 'success' });
  });

  test('keyboard: 1 2 3 / Q W E / A S D hit holes by position (desktop)', async ({ page }) => {
    test.skip(isTouch(), 'keyboard is a desktop input');
    await startMini(page, 'whack_a_mole', { difficulty: 'easy' });
    await setTimeScale(page, 0.5);
    const keys = ['Digit1', 'Digit2', 'Digit3', 'KeyQ', 'KeyW', 'KeyE', 'KeyA', 'KeyS', 'KeyD'];
    const target = page.locator('[data-testid^="mg-hole-"][data-state="target"]').first();
    await target.waitFor({ state: 'attached', timeout: 20_000 });
    const hole = Number((await target.getAttribute('data-hole')) as string);
    await page.keyboard.press(keys[hole] as string);
    await expect(byId(page, 'mg-progress')).toHaveAttribute('data-hits', '1');
  });

  test('hard grid is 4 x 3 in landscape and 3 columns x 4 rows in portrait, indices unchanged', async ({ page }) => {
    await startMini(page, 'whack_a_mole', { difficulty: 'hard' });
    await expect(byId(page, 'mg-holes').locator('.wm-hole')).toHaveCount(12);
    const portrait = await page.evaluate(() => window.innerHeight > window.innerWidth);
    const b = await Promise.all([0, 1, 2, 3, 4].map((i) => box(byId(page, `mg-hole-${i}`))));
    if (portrait) {
      expect(Math.abs(b[0]!.y - b[2]!.y)).toBeLessThan(2); // 0..2 share a row
      expect(b[3]!.y).toBeGreaterThan(b[0]!.y + 10); // 3 starts the next row
    } else {
      expect(Math.abs(b[0]!.y - b[3]!.y)).toBeLessThan(2); // 0..3 share a row
      expect(b[4]!.y).toBeGreaterThan(b[0]!.y + 10);
    }
    for (let i = 0; i < 12; i++) expect((await box(byId(page, `mg-hole-${i}`))).width).toBeGreaterThanOrEqual(64);
    await noHorizontalScroll(page);
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(byId(page, 'mg-holes')).toBeVisible();
    await noHorizontalScroll(page);
    const l = await Promise.all([0, 3, 4].map((i) => box(byId(page, `mg-hole-${i}`))));
    expect(Math.abs(l[0]!.y - l[1]!.y)).toBeLessThan(2); // landscape: 4 per row
    expect(l[2]!.y).toBeGreaterThan(l[0]!.y + 10);
    expect(l[0]!.width).toBeGreaterThanOrEqual(64);
  });

  test('pause freezes play time and covers the board', async ({ page }) => {
    await startMini(page, 'whack_a_mole', { difficulty: 'easy' });
    await page.waitForTimeout(600);
    await api(page, (a) => a.pause());
    const t0 = await playMs(page);
    await page.waitForTimeout(700);
    expect(await playMs(page)).toBe(t0);
    await expect(byId(page, 'mg-play-area')).toBeHidden();
    await api(page, (a) => a.resume());
    await expect(byId(page, 'mg-play-area')).toBeVisible();
    await expect.poll(() => playMs(page)).toBeGreaterThan(t0);
  });

  test('card modifiers show up: fog covers holes, hint shakes a hole before it fills, tempo badge for time cards', async ({ page }) => {
    await startMini(page, 'whack_a_mole', { difficulty: 'easy', modifiers: [{ kind: 'fog' }, { kind: 'hint' }] as MinigameModifier[] });
    const lv = await level<WhackLevel>(page);
    expect(lv.fog.length).toBeGreaterThan(0);
    expect(lv.hintLeadMs).toBe(300);
    await expect(page.locator('.wm-hole.fogged').first()).toBeAttached();
  });
});

// ================================================================== Cocokkan Kartu
test.describe('memory_match', () => {
  const states = (page: Page) => page.evaluate(() => [...document.querySelectorAll('.mm-card')].map((c) => (c as HTMLElement).dataset.state));
  const pairOf = (lv: MemoryLevel): [number, number] => {
    const first = lv.cards.indexOf(lv.cards[0] as string);
    return [first, lv.cards.indexOf(lv.cards[0] as string, first + 1)];
  };
  const wrongPair = (lv: MemoryLevel): [number, number] => [0, lv.cards.findIndex((c) => c !== lv.cards[0])];

  async function startPlay(page: Page, o: SandboxOptions = {}): Promise<MemoryLevel> {
    await startMini(page, 'memory_match', o);
    await expect(byId(page, 'mg-cards')).toHaveAttribute('data-orient', /portrait|landscape/);
    // wait for the preview to end
    await expect(page.locator('.mg-memory')).not.toHaveAttribute('data-phase', 'preview', { timeout: 30_000 });
    return level<MemoryLevel>(page);
  }

  test('preview shows every card face up and then hides them; cards are >= 64 px; no horizontal scroll', async ({ page }) => {
    await startMini(page, 'memory_match', { difficulty: 'easy' });
    await expect(page.locator('.mg-memory')).toHaveAttribute('data-phase', 'preview');
    await expect(byId(page, 'mg-status')).toHaveText('Hafalkan!');
    await expect(page.locator('.mg-memory')).not.toHaveAttribute('data-phase', 'preview', { timeout: 30_000 });
    expect((await states(page)).every((s) => s === 'closed')).toBe(true);
    for (let i = 0; i < 12; i++) expect((await box(byId(page, `mg-card-${i}`))).width).toBeGreaterThanOrEqual(64);
    await noHorizontalScroll(page);
    await expectNoErrors(page);
  });

  test('a matching pair stays matched, a wrong pair closes after the delay, peek-ahead closes it at once', async ({ page }) => {
    const lv = await startPlay(page, { difficulty: 'easy' });
    const [a, b] = pairOf(lv);
    await press(byId(page, `mg-card-${a}`));
    await expect(byId(page, `mg-card-${a}`)).toHaveAttribute('data-state', 'open');
    await press(byId(page, `mg-card-${b}`));
    await expect(byId(page, `mg-card-${a}`)).toHaveAttribute('data-state', 'matched');
    await expect(byId(page, `mg-card-${b}`)).toHaveAttribute('data-state', 'matched');
    await expect(byId(page, 'mg-progress')).toHaveText(/^1\/6$/);
    // a wrong pair among the rest
    const rest = lv.cards.map((c, i) => [c, i] as const).filter(([, i]) => i !== a && i !== b);
    const x = rest[0]!;
    const y = rest.find(([c]) => c !== x[0])!;
    const z = rest.find(([c, i]) => c !== x[0] && i !== y[1])!;
    await press(byId(page, `mg-card-${x[1]}`));
    await press(byId(page, `mg-card-${y[1]}`));
    await expect(byId(page, `mg-card-${x[1]}`)).toHaveAttribute('data-state', 'open');
    await expect(byId(page, `mg-card-${y[1]}`)).toHaveAttribute('data-state', 'open');
    await expect(byId(page, `mg-card-${x[1]}`)).toHaveAttribute('data-state', 'closed', { timeout: 5000 }); // delay 800 ms
    // peek-ahead: second wrong pair, then a third card before the delay is over
    await press(byId(page, `mg-card-${x[1]}`));
    await press(byId(page, `mg-card-${y[1]}`));
    await press(byId(page, `mg-card-${z[1]}`));
    await expect(byId(page, `mg-card-${x[1]}`)).toHaveAttribute('data-state', 'closed');
    await expect(byId(page, `mg-card-${y[1]}`)).toHaveAttribute('data-state', 'closed');
    await expect(byId(page, `mg-card-${z[1]}`)).toHaveAttribute('data-state', 'open');
  });

  test('tapping an open or matched card does nothing; aria-labels follow the state', async ({ page }) => {
    const lv = await startPlay(page, { difficulty: 'easy' });
    const [a, b] = pairOf(lv);
    await expect(byId(page, `mg-card-${a}`)).toHaveAttribute('aria-label', `kartu tertutup ${a + 1}`);
    await press(byId(page, `mg-card-${a}`));
    await expect(byId(page, `mg-card-${a}`)).toHaveAttribute('aria-label', new RegExp(`^kartu ${a + 1}, terbuka`));
    await press(byId(page, `mg-card-${a}`)); // same card again: ignored
    await expect(byId(page, `mg-card-${a}`)).toHaveAttribute('data-state', 'open');
    await press(byId(page, `mg-card-${b}`));
    await expect(byId(page, `mg-card-${a}`)).toHaveAttribute('aria-label', new RegExp(`^kartu ${a + 1}, sudah cocok`));
    // a matched card is out of the game (pointer-events: none): a forced tap goes nowhere
    if (isTouch()) await byId(page, `mg-card-${a}`).tap({ force: true });
    else await byId(page, `mg-card-${a}`).click({ force: true });
    await expect(byId(page, `mg-card-${a}`)).toHaveAttribute('data-state', 'matched');
    await expect(byId(page, 'mg-progress')).toHaveText(/^1\/6$/);
  });

  test('12 pairs (4 x 6) fit without scrolling with cards >= 64 px (390 x 844 and landscape)', async ({ page }) => {
    await startMini(page, 'memory_match', { difficulty: 'hard', modifiers: [{ kind: 'extraTarget', count: 2 }] });
    const lv = await level<MemoryLevel>(page);
    expect([lv.pairs, lv.cols, lv.rows]).toEqual([12, 4, 6]);
    for (const size of [null, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
      if (size) await page.setViewportSize(size);
      const vp = page.viewportSize()!;
      // the layout follows a ResizeObserver, which software rendering delays: poll until it has settled
      await expect.poll(async () => {
        const boxes = await Promise.all(Array.from({ length: 24 }, (_, i) => box(byId(page, `mg-card-${i}`))));
        return boxes.every((b) => b.width >= 64 && b.x >= 0 && b.x + b.width <= vp.width + 1 && b.y + b.height <= vp.height + 1);
      }, { timeout: 15_000 }).toBe(true);
      await noHorizontalScroll(page);
    }
  });

  test('Teropong: the Intip button shows every unmatched card for one second, once', async ({ page }) => {
    await startPlay(page, { difficulty: 'hard', modifiers: [{ kind: 'hint' }] });
    await expect(byId(page, 'mg-peek')).toBeVisible();
    expect((await box(byId(page, 'mg-peek'))).height).toBeGreaterThanOrEqual(48);
    await press(byId(page, 'mg-peek'));
    await expect(page.locator('.mg-memory')).toHaveAttribute('data-phase', 'peek');
    await expect(page.locator('.mg-memory')).toHaveAttribute('data-phase', 'play', { timeout: 5000 });
    await expect(byId(page, 'mg-peek')).toBeHidden(); // once per minigame
  });

  test('keyboard: arrows move focus over the grid, Enter opens the focused card (desktop)', async ({ page }) => {
    test.skip(isTouch(), 'keyboard is a desktop input');
    await startPlay(page, { difficulty: 'easy' });
    await byId(page, 'mg-card-0').focus();
    await page.keyboard.press('ArrowRight');
    await expect(byId(page, 'mg-card-1')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(byId(page, 'mg-card-4')).toBeFocused(); // 3 columns on easy
    await page.keyboard.press('Enter');
    await expect(byId(page, 'mg-card-4')).toHaveAttribute('data-state', 'open');
  });

  test('reducedMotion: the board switches to the crossfade class', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, { seed: 5 });
    await startMini(page, 'memory_match', { difficulty: 'easy' });
    await expect(page.locator('.mg-memory')).toHaveClass(/reduced-motion/);
  });

  test('idle run times out into a fail banner; a perfect player passes', async ({ page }) => {
    await startMini(page, 'memory_match', { difficulty: 'medium' });
    await setTimeScale(page, 10);
    await expectBanner(page, 'fail');
    expect((await lastResult(page))?.reason).toBe('timeout');
  });

  test('a perfect player passes through the real host', async ({ page }) => {
    await startMini(page, 'memory_match', { difficulty: 'medium' });
    const lv = await level<MemoryLevel>(page);
    await runInPage(page, memoryPerfectScript(lv));
    await expectBanner(page, 'pass');
    expect(await lastResult(page)).toMatchObject({ passed: true, reason: 'success', progress: 1 });
  });

  test('pause freezes the mismatch delay and the timer', async ({ page }) => {
    const lv = await startPlay(page, { difficulty: 'easy' });
    const [a, b] = wrongPair(lv);
    await press(byId(page, `mg-card-${a}`));
    await press(byId(page, `mg-card-${b}`));
    await api(page, (x) => x.pause());
    const t0 = await playMs(page);
    await page.waitForTimeout(1200); // longer than the 800 ms delay
    expect(await playMs(page)).toBe(t0);
    await api(page, (x) => x.resume());
    await expect(byId(page, `mg-card-${a}`)).toHaveAttribute('data-state', 'closed', { timeout: 5000 });
  });
});

// ================================================================== Tebak Lokasi
test.describe('guess_location', () => {
  async function items(page: Page) {
    const lv = await level<GuessLevel>(page);
    return lv;
  }

  test('layout: choices are >= 56 px high; one column on phones, 2 x 2 on desktop; no horizontal scroll', async ({ page }) => {
    await startMini(page, 'guess_location', { difficulty: 'medium' });
    const bs = await Promise.all([0, 1, 2, 3].map((i) => box(byId(page, `mg-choice-${i}`))));
    for (const b of bs) expect(b.height).toBeGreaterThanOrEqual(56);
    if (isTouch()) {
      expect(Math.abs(bs[0]!.x - bs[1]!.x)).toBeLessThan(2);
      expect(bs[1]!.y).toBeGreaterThan(bs[0]!.y + 40);
    } else {
      expect(Math.abs(bs[0]!.y - bs[1]!.y)).toBeLessThan(2);
      expect(bs[1]!.x).toBeGreaterThan(bs[0]!.x + 40);
    }
    await noHorizontalScroll(page);
    await expectNoErrors(page);
  });

  test('a correct tap shows a tick on the right button; a wrong tap shows a cross and the right answer', async ({ page }) => {
    await startMini(page, 'guess_location', { difficulty: 'medium' });
    const lv = await items(page);
    const it0 = lv.items[0]!;
    const right = it0.choices.indexOf(it0.correctRegionId);
    await press(byId(page, `mg-choice-${right}`));
    await expect(byId(page, `mg-choice-${right}`)).toHaveAttribute('data-state', 'right');
    await expect(byId(page, `mg-choice-${right}`).locator('.gl-mark')).toHaveText('✓');
    await expect(byId(page, 'mg-progress')).toHaveAttribute('data-correct', '1');
    // next question starts after the gap; answer wrong
    await expect(page.locator('.mg-guess')).toHaveAttribute('data-q', '1', { timeout: 10_000 });
    const it1 = lv.items[1]!;
    const right1 = it1.choices.indexOf(it1.correctRegionId);
    const wrong = [0, 1, 2, 3].find((i) => i !== right1)!;
    await press(byId(page, `mg-choice-${wrong}`));
    await expect(byId(page, `mg-choice-${wrong}`)).toHaveAttribute('data-state', 'wrong');
    await expect(byId(page, `mg-choice-${wrong}`).locator('.gl-mark')).toHaveText('✗');
    await expect(byId(page, `mg-choice-${right1}`).locator('.gl-mark')).toHaveText('✓');
    // input during the gap is ignored
    await press(byId(page, `mg-choice-${right1}`));
    await expect(byId(page, 'mg-progress')).toHaveAttribute('data-correct', '1');
  });

  test('keys 1-4 answer (desktop)', async ({ page }) => {
    test.skip(isTouch(), 'keyboard is a desktop input');
    await startMini(page, 'guess_location', { difficulty: 'medium' });
    const lv = await items(page);
    const it0 = lv.items[0]!;
    const right = it0.choices.indexOf(it0.correctRegionId);
    await page.keyboard.press(String(right + 1));
    await expect(byId(page, `mg-choice-${right}`)).toHaveAttribute('data-state', 'right');
  });

  test('clue per difficulty: easy shows the name, medium the hint, hard shows no text and an alt that does not leak', async ({ page }) => {
    await startMini(page, 'guess_location', { difficulty: 'easy' });
    let lv = await items(page);
    await expect(byId(page, 'mg-clue')).toHaveText(/\S/); // no fonts on this machine: text boxes may be 0 px wide
    const easyClue = await byId(page, 'mg-clue').textContent();
    expect(easyClue!.length).toBeGreaterThan(0);
    expect(await byId(page, 'mg-picture').getAttribute('aria-label')).toBe(easyClue);
    expect(lv.clueMode).toBe('nameAndImage');
    // hard
    await setTimeScale(page, 10);
    await expectBanner(page, 'fail');
    await page.waitForTimeout(100);
    await page.evaluate(() => (window as unknown as { __atlasTest: Api }).__atlasTest.setTimeScale(1));
    await expect(byId(page, 'mg-overlay')).toBeHidden({ timeout: 20_000 });
    await startMini(page, 'guess_location', { difficulty: 'hard' });
    lv = await items(page);
    expect(lv.clueMode).toBe('imageOnly');
    await expect(byId(page, 'mg-clue')).toHaveAttribute('hidden', '');
    await expect(byId(page, 'mg-clue')).toHaveText('');
    await expect(byId(page, 'mg-picture')).toHaveAttribute('aria-label', 'Gambar tempat (tanpa teks petunjuk)');
    expect(await byId(page, 'mg-picture').innerHTML()).not.toMatch(/<text/);
  });

  test('Teropong hides one wrong option per question; Kabut blurs the picture but never the choice texts', async ({ page }) => {
    await startMini(page, 'guess_location', { difficulty: 'easy', modifiers: [{ kind: 'hint' }, { kind: 'fog' }] as MinigameModifier[] });
    const lv = await items(page);
    const it0 = lv.items[0]!;
    await expect(byId(page, `mg-choice-${it0.hintRemovedIndex}`)).toBeHidden();
    expect(await page.locator('.gl-choice:visible').count()).toBe(2);
    expect(await byId(page, 'mg-picture').evaluate((e) => (e as HTMLElement).style.filter)).toMatch(/blur\(/);
    expect(await page.locator('.gl-choice').evaluateAll((els) => els.map((e) => getComputedStyle(e).filter))).toEqual(['none', 'none', 'none']);
  });

  test('timeouts count as wrong: an idle run ends in failLimit', async ({ page }) => {
    await startMini(page, 'guess_location', { difficulty: 'easy' });
    await setTimeScale(page, 10);
    await expectBanner(page, 'fail');
    expect((await lastResult(page))?.reason).toBe('failLimit');
  });

  test('a perfect player passes through the real host', async ({ page }) => {
    await startMini(page, 'guess_location', { difficulty: 'hard' });
    const lv = await items(page);
    await driveGuess(page, lv);
    await expectBanner(page, 'pass');
    expect(await lastResult(page)).toMatchObject({ passed: true, reason: 'success' });
  });

  test('pause freezes the per-question timer', async ({ page }) => {
    await startMini(page, 'guess_location', { difficulty: 'easy' });
    await page.waitForTimeout(500);
    await api(page, (a) => a.pause());
    const t0 = await playMs(page);
    const s0 = await byId(page, 'mg-seconds').textContent();
    await page.waitForTimeout(900);
    expect(await playMs(page)).toBe(t0);
    expect(await byId(page, 'mg-seconds').textContent()).toBe(s0);
    await expect(byId(page, 'mg-play-area')).toBeHidden();
  });
});

// ================================================================== Ketapel (3D)
test.describe('slingshot', () => {
  test.describe.configure({ timeout: 180_000 });

  /** A drag in the lower half of the play area: real mouse on desktop, synthetic touch pointer events on mobile. */
  async function drag(page: Page, dx: number, dy: number): Promise<void> {
    const b = await box(byId(page, 'mg-play-area'));
    const x0 = b.x + b.width / 2;
    const y0 = b.y + b.height * 0.65;
    if (!isTouch()) {
      await page.mouse.move(x0, y0);
      await page.mouse.down();
      await page.mouse.move(x0 + dx / 2, y0 + dy / 2);
      await page.mouse.move(x0 + dx, y0 + dy);
      await page.mouse.up();
      return;
    }
    await page.evaluate(([x, y, ddx, ddy]) => {
      const el = document.querySelector('[data-testid="mg-play-area"]') as HTMLElement;
      const t0 = performance.now();
      const mk = (type: string, px: number, py: number, ts: number) => {
        const e = new PointerEvent(type, { pointerId: 91, isPrimary: true, pointerType: 'touch', clientX: px, clientY: py, bubbles: true, cancelable: true, button: 0 });
        Object.defineProperty(e, 'timeStamp', { value: ts });
        el.dispatchEvent(e);
      };
      mk('pointerdown', x as number, y as number, t0);
      mk('pointermove', (x as number) + (ddx as number) / 2, (y as number) + (ddy as number) / 2, t0 + 20);
      mk('pointermove', (x as number) + (ddx as number), (y as number) + (ddy as number), t0 + 40);
      mk('pointerup', (x as number) + (ddx as number), (y as number) + (ddy as number), t0 + 50);
    }, [x0, y0, dx, dy] as const);
  }
  const bulletsLeft = async (page: Page) => Number(await byId(page, 'mg-bullets').getAttribute('data-left'));

  test('3D canvas appears with the minigame, the race renderer stops, wind and bullets are on screen, both clean up', async ({ page }) => {
    const base = await page.locator('canvas').count();
    await startMini(page, 'slingshot', { difficulty: 'hard' });
    await expect(byId(page, 'mg-canvas')).toHaveCount(1);
    expect(await page.locator('canvas').count()).toBe(base + 1);
    const dims = await byId(page, 'mg-canvas').evaluate((c: HTMLCanvasElement) => ({ w: c.width, h: c.height }));
    expect(dims.w).toBeGreaterThan(0);
    expect(dims.h).toBeGreaterThan(0);
    const lv = await level<SlingLevel>(page);
    expect(Math.abs(lv.windMps)).toBe(2);
    await expect(byId(page, 'mg-wind')).toHaveAttribute('data-wind', lv.windMps.toFixed(2));
    await expect(byId(page, 'mg-bullets')).toHaveAttribute('data-left', '6');
    const f = () => page.evaluate(() => (window as unknown as { atlas: { renderer: { info: { render: { frame: number } } } } }).atlas.renderer.info.render.frame);
    const f1 = await f();
    await page.waitForTimeout(800);
    expect(await f()).toBe(f1); // race renderer is idle under the 3D minigame
    await noHorizontalScroll(page);
    await setTimeScale(page, 10);
    await expectBanner(page, 'fail');
    expect((await lastResult(page))?.reason).toBe('timeout'); // idle: timeout
    await expect(byId(page, 'mg-overlay')).toBeHidden({ timeout: 30_000 });
    await expect(byId(page, 'mg-canvas')).toHaveCount(0);
    expect(await page.locator('canvas').count()).toBe(base);
    await expectNoErrors(page);
  });

  test('a drag in the lower half shoots (power and yaw from the drag); a drag < 5% of the height cancels and keeps the bullet', async ({ page }) => {
    await startMini(page, 'slingshot', { difficulty: 'easy' });
    const vp = page.viewportSize()!;
    await drag(page, 0, Math.round(vp.height * 0.03)); // 3% < 5%: cancel
    await page.waitForTimeout(150);
    expect(await bulletsLeft(page)).toBe(6);
    await drag(page, 20, Math.round(vp.height * 0.15));
    await expect.poll(() => bulletsLeft(page)).toBe(5);
    const m = await info(page);
    const st = m!.state as { flight: { aim: { yawDeg: number; power: number } } | null; landed: unknown[] };
    const aim = (st.flight ?? (st as unknown as { landed: { aim: { yawDeg: number; power: number } }[] }).landed[0] as unknown as { aim: { yawDeg: number; power: number } })?.aim;
    expect(aim.power).toBeGreaterThan(0.5); // 15% / 25% = 0.6
    expect(aim.power).toBeLessThan(0.7);
    expect(aim.yawDeg).toBeLessThan(0); // dragged right: shoots left
    // a second drag during flight/reload uses no bullet
    await drag(page, 0, Math.round(vp.height * 0.2));
    await page.waitForTimeout(100);
    expect(await bulletsLeft(page)).toBeGreaterThanOrEqual(4);
    await expectNoErrors(page);
  });

  test('a drag in the upper half does nothing', async ({ page }) => {
    await startMini(page, 'slingshot', { difficulty: 'easy' });
    const b = await box(byId(page, 'mg-play-area'));
    if (isTouch()) {
      await page.evaluate(([x, y]) => {
        const el = document.querySelector('[data-testid="mg-play-area"]') as HTMLElement;
        const mk = (type: string, py: number) => el.dispatchEvent(new PointerEvent(type, { pointerId: 92, isPrimary: true, pointerType: 'touch', clientX: x as number, clientY: py, bubbles: true, cancelable: true, button: 0 }));
        mk('pointerdown', y as number); mk('pointermove', (y as number) + 80); mk('pointerup', (y as number) + 80);
      }, [b.x + b.width / 2, b.y + b.height * 0.25] as const);
    } else {
      await page.mouse.move(b.x + b.width / 2, b.y + b.height * 0.25);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height * 0.25 + 80);
      await page.mouse.up();
    }
    await page.waitForTimeout(200);
    expect(await bulletsLeft(page)).toBe(6);
  });

  test('keyboard: arrows aim, Space shoots, Esc cancels the aim without pausing (desktop)', async ({ page }) => {
    test.skip(isTouch(), 'keyboard is a desktop input');
    await startMini(page, 'slingshot', { difficulty: 'easy' });
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowUp');
    await expect(byId(page, 'mg-play-area')).toHaveAttribute('data-aiming', 'keys');
    await expect(byId(page, 'mg-aim')).toBeVisible();
    await expect(byId(page, 'mg-play-area')).toHaveAttribute('data-yaw', '2.0');
    await expect(byId(page, 'mg-play-area')).toHaveAttribute('data-power', '0.51');
    await page.keyboard.press('Escape');
    await expect(byId(page, 'mg-play-area')).toHaveAttribute('data-aiming', 'none');
    const t0 = await playMs(page);
    await page.waitForTimeout(300);
    expect(await playMs(page)).toBeGreaterThan(t0); // Esc did not pause the run
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Space');
    await expect.poll(() => bulletsLeft(page)).toBe(5);
    const st = (await info(page))!.state as { flight: { aim: { yawDeg: number; power: number } } | null; landed: { aim: { yawDeg: number; power: number } }[] };
    const aim = (st.flight ?? st.landed[0])!.aim;
    expect(aim.yawDeg).toBe(-1);
    expect(aim.power).toBeCloseTo(0.5, 5);
  });

  test('a perfect player drops the targets: the pass is counted at landing', async ({ page }) => {
    await startMini(page, 'slingshot', { difficulty: 'easy' });
    await setTimeScale(page, 2);
    const lv = await level<SlingLevel>(page);
    await driveSling(page, lv);
    await expectBanner(page, 'pass', 120_000);
    const r = await lastResult(page);
    expect(r).toMatchObject({ passed: true, reason: 'success', progress: 1 });
  });

  test('pause freezes a bullet in the air', async ({ page }) => {
    await startMini(page, 'slingshot', { difficulty: 'easy' });
    const vp = page.viewportSize()!;
    await setTimeScale(page, 0.25);
    await drag(page, 0, Math.round(vp.height * 0.25));
    await expect.poll(() => bulletsLeft(page)).toBe(5);
    await api(page, (a) => a.pause());
    const m0 = await info(page);
    await page.waitForTimeout(800);
    const m1 = await info(page);
    expect(m1!.playMs).toBe(m0!.playMs);
    expect(JSON.stringify((m1!.state as { flight: unknown }).flight)).toBe(JSON.stringify((m0!.state as { flight: unknown }).flight));
    await expect(byId(page, 'mg-play-area')).toBeHidden();
  });

  test('10 x open and close leaves no canvas, listener-driven state or GPU memory behind', async ({ page }) => {
    const base = await page.locator('canvas').count();
    for (let i = 0; i < 10; i++) {
      await startMini(page, 'slingshot', { difficulty: 'medium', seed: i + 1 });
      const gpu = await api(page, (a) => a.minigameGpu());
      expect(gpu!.geometries).toBeGreaterThan(5);
      await setTimeScale(page, 10);
      expect(await page.evaluate(() => (window as unknown as { __atlasTest: Api }).__atlasTest.forceMinigameResult(false))).toBe(true);
      await expect(byId(page, 'mg-overlay')).toBeHidden({ timeout: 30_000 });
      await setTimeScale(page, 1);
      expect(await page.locator('canvas').count()).toBe(base);
      const gone = await api(page, (a) => a.lastDisposedGpu());
      expect(gone).toMatchObject({ geometries: 0, textures: 0 });
    }
    await expectNoErrors(page);
  });

  test('Kabut and Teropong levels render without errors', async ({ page }) => {
    await startMini(page, 'slingshot', { difficulty: 'medium', modifiers: [{ kind: 'fog' }, { kind: 'hint' }, { kind: 'extraTarget', count: 2 }] as MinigameModifier[] });
    const lv = await level<SlingLevel>(page);
    expect([lv.fog, lv.hitPreview, lv.aimLineFrac, lv.targets.length, lv.bullets]).toEqual([true, true, 1, 7, 8]);
    await expect(byId(page, 'mg-bullets')).toHaveAttribute('data-left', '8');
    await page.waitForTimeout(500);
    await expectNoErrors(page);
  });
});

// ================================================================== debug hooks: forcing a minigame in a real match
test.describe('forcing a minigame (QA hooks)', () => {
  for (const id of ['whack_a_mole', 'slingshot', 'memory_match', 'guess_location']) {
    test(`?minigame=${id} makes every draw ${id}; forceMinigame(id) does it for one draw`, async ({ page }) => {
      test.setTimeout(150_000);
      await page.goto(`/?seed=7&debug=1&bots=1&botLevel=easy&minigame=${id}`);
      await page.waitForFunction(() => !!(window as unknown as { __atlasTest?: unknown }).__atlasTest);
      await dispatch(page, { type: 'selectTarget', playerId: 'p1', targetId: 'medan' });
      await expect(byId(page, 'btn-start')).toBeEnabled({ timeout: 30_000 });
      await press(byId(page, 'btn-start'));
      await expect(byId(page, 'mg-overlay')).toHaveAttribute('data-minigame', id);
      expect(await page.evaluate(() => (window as unknown as { __atlasTest: Api }).__atlasTest.forceMinigameResult(true))).toBe(true);
      await expect(byId(page, 'mg-overlay')).toBeHidden({ timeout: 30_000 });
    });
  }

  test('forceMinigame is rejected without a target or with an id outside the pool', async ({ page }) => {
    expect(await api(page, (a) => a.forceMinigame('simon'))).toBe(false); // no target yet
    await dispatch(page, { type: 'selectTarget', playerId: 'p1', targetId: 'medan' });
    expect(await api(page, (a) => a.forceMinigame('not_a_minigame'))).toBe(false);
    expect(await api(page, (a) => a.forceMinigame('guess_location'))).toBe(true);
    const s = await api(page, (a) => a.getState());
    expect(s.players.find((p) => p.id === 'p1')!.nextMinigameId).toBe('guess_location');
  });
});
