/**
 * Shared Playwright helpers for the CP3a smoke tests. The game exposes a debug-only test
 * API (`window.__atlasTest`, src/ui/debug.ts) when the URL has ?debug=1.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { GameAction, GameState, PlayerState } from '../../src/logic';
import type { AtlasTestApi } from '../../src/ui/debug';

export interface OpenOptions {
  seed?: string | number;
  bots?: number;
  botLevel?: 'easy' | 'normal' | 'hard';
}

/** Console errors and page errors seen since open(); checked by tests that care. */
export const consoleErrors = new WeakMap<Page, string[]>();

export function isTouch(): boolean {
  return test.info().project.name === 'mobile';
}

/** Open the game with the debug hooks and wait until the board has rendered once. */
export async function open(page: Page, opts: OpenOptions = {}): Promise<void> {
  const errors: string[] = [];
  consoleErrors.set(page, errors);
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  const q = new URLSearchParams({
    seed: String(opts.seed ?? 42),
    debug: '1',
    bots: String(opts.bots ?? 1),
    botLevel: opts.botLevel ?? 'easy',
  });
  await page.goto(`/?${q.toString()}`);
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __atlasTest?: unknown; atlas?: { renderer?: { info: { render: { frame: number } } } } };
      return !!w.__atlasTest && (w.atlas?.renderer?.info.render.frame ?? 0) > 1;
    },
    null,
    { timeout: 30_000 },
  );
}

export const getState = (page: Page): Promise<GameState> => page.evaluate(() => (window as unknown as { __atlasTest: AtlasTestApi }).__atlasTest.getState());

export async function me(page: Page): Promise<PlayerState> {
  const s = await getState(page);
  return s.players.find((p) => p.id === 'p1') as PlayerState;
}

export const dispatch = (page: Page, action: GameAction) =>
  page.evaluate((a) => (window as unknown as { __atlasTest: AtlasTestApi }).__atlasTest.dispatch(a), action);

export const force = (page: Page, passed: boolean): Promise<boolean> =>
  page.evaluate((p) => (window as unknown as { __atlasTest: AtlasTestApi }).__atlasTest.forceMinigameResult(p), passed);

export const setTimeScale = (page: Page, x: number) =>
  page.evaluate((v) => (window as unknown as { __atlasTest: AtlasTestApi }).__atlasTest.setTimeScale(v), x);

export const exportLog = (page: Page): Promise<string> =>
  page.evaluate(() => (window as unknown as { __atlasTest: AtlasTestApi }).__atlasTest.exportLog());

/** A real pointer press: a tap on the mobile project, a mouse click on desktop. */
export async function press(loc: Locator): Promise<void> {
  if (isTouch()) await loc.tap();
  else await loc.click();
}

export const byId = (page: Page, id: string): Locator => page.getByTestId(id);

/** Wait until the human is back in the race view (minigame + banner closed). */
export async function waitIdle(page: Page): Promise<void> {
  await expect.poll(async () => (await me(page)).phase, { timeout: 30_000 }).not.toBe('playing');
  await expect(byId(page, 'mg-overlay')).toBeHidden();
}

/** Force one win on the current target through the real host (banner included). */
export async function forceWin(page: Page): Promise<void> {
  await expect.poll(() => force(page, true), { timeout: 20_000 }).toBe(true);
  await waitIdle(page);
}

/** Conquer a sequence of regions with forced wins (target selected via the test API). */
export async function conquer(page: Page, regions: string[]): Promise<void> {
  for (const r of regions) {
    await dispatch(page, { type: 'selectTarget', playerId: 'p1', targetId: r });
    await forceWin(page);
    await forceWin(page);
  }
}

/** Boxes of visible elements, for layout checks. */
export async function box(loc: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const b = await loc.boundingBox();
  if (!b) throw new Error('element has no bounding box (hidden?)');
  return b;
}

export function overlaps(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}
