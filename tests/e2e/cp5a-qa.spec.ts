/**
 * CP5a QA e2e: what only a browser can show about the Setup Bot screen and the "thinking" bots.
 * Runs on desktop (1280x720) and mobile (390x844, touch). No fonts on this machine: text is
 * checked with toHaveText / data attributes, layout with bounding boxes.
 */
import { expect, test, type Page } from '@playwright/test';
import { box, byId, consoleErrors, dispatch, getState, isTouch, open, press, setTimeScale } from './helpers';

const activityOf = (page: Page, id: string) => byId(page, `progress-row-${id}`).getAttribute('data-activity');
const noErrors = (page: Page) => expect(consoleErrors.get(page) ?? []).toEqual([]);

/** Open the Setup screen (no ?bots / ?botLevel) with the console watcher of open(). */
async function openSetup(page: Page, query = 'seed=42&debug=1'): Promise<void> {
  const errors: string[] = [];
  consoleErrors.set(page, errors);
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  await page.goto(`/?${query}`);
  await expect(byId(page, 'setup-screen')).toBeVisible({ timeout: 30_000 });
}

const pause = (page: Page) => page.evaluate(() => (window as unknown as { __atlasTest: { pause(): void } }).__atlasTest.pause());
const resume = (page: Page) => page.evaluate(() => (window as unknown as { __atlasTest: { resume(): void } }).__atlasTest.resume());

test.describe('setup screen: layout and touch targets', () => {
  test('everything is inside the viewport and every control is at least 44 px tall and wide (WCAG 2.5.5 / HIG)', async ({ page }) => {
    await openSetup(page);
    const vp = page.viewportSize()!;
    const ids = ['setup-bots-minus', 'setup-bots-plus', 'setup-level-easy', 'setup-level-normal', 'setup-level-hard', 'setup-start'];
    const small: string[] = [];
    const sizes: Record<string, string> = {};
    for (const id of ids) {
      const b = await box(byId(page, id));
      sizes[id] = `${Math.round(b.width)}x${Math.round(b.height)}`;
      expect(b.x, `${id} left`).toBeGreaterThanOrEqual(0);
      expect(b.y, `${id} top`).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width, `${id} right`).toBeLessThanOrEqual(vp.width);
      expect(b.y + b.height, `${id} bottom`).toBeLessThanOrEqual(vp.height);
      if (b.width < 44 || b.height < 44) small.push(`${id} ${sizes[id]}`);
    }
    test.info().annotations.push({ type: 'sizes', description: JSON.stringify(sizes) });
    expect(small, `controls under 44 px: ${JSON.stringify(sizes)}`).toEqual([]);
  });

  test('landscape phone (844x390): the whole card is reachable (inside the viewport or scrollable) and Mulai Balapan can be pressed', async ({ page }) => {
    test.skip(!isTouch(), 'phone-only');
    await page.setViewportSize({ width: 844, height: 390 });
    await openSetup(page);
    const start = byId(page, 'setup-start');
    await start.scrollIntoViewIfNeeded();
    const b = await box(start);
    expect(b.y + b.height).toBeLessThanOrEqual(390 + 1);
    await press(start);
    await expect(byId(page, 'setup-screen')).toBeHidden();
  });

  test('a tiny phone (320x568) still shows all controls', async ({ page }) => {
    test.skip(!isTouch(), 'phone-only');
    await page.setViewportSize({ width: 320, height: 568 });
    await openSetup(page);
    for (const id of ['setup-bots-minus', 'setup-bots-plus', 'setup-level-easy', 'setup-level-normal', 'setup-level-hard', 'setup-start']) {
      const b = await box(byId(page, id));
      expect(b.x, id).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width, id).toBeLessThanOrEqual(320);
      expect(b.y + b.height, id).toBeLessThanOrEqual(568);
    }
  });
});

test.describe('setup screen: flows', () => {
  test('the clock and the keyboard stay out of the match while the screen is open (Enter, Esc, Space do nothing)', async ({ page }) => {
    await openSetup(page);
    // the start button owns the focus on open, so Enter/Space on it presses it by design: drop the focus first
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Escape');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Space');
    await page.waitForTimeout(800);
    await expect(byId(page, 'setup-screen')).toBeVisible();
    await expect(byId(page, 'pause-overlay')).toBeHidden();
    expect((await getState(page)).timeMs).toBe(0);
    expect((await getState(page)).players.every((p) => p.phase === 'idle' && p.targetId === null)).toBe(true);
    noErrors(page);
  });

  test('desktop keyboard: the start button has the focus, Enter starts the match with the defaults (3 Normal bots)', async ({ page }) => {
    test.skip(isTouch(), 'keyboard flow is desktop-only');
    await openSetup(page);
    await expect(byId(page, 'setup-start')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(byId(page, 'setup-screen')).toBeHidden();
    const s = await getState(page);
    expect(s.players.filter((p) => p.kind === 'bot').map((p) => p.botLevel)).toEqual(['normal', 'normal', 'normal']);
  });

  test('QA-CP5a-01: desktop keyboard: Tab stays inside the setup card (focus must not escape to the race view behind it)', async ({ page }) => {
    test.skip(isTouch(), 'keyboard flow is desktop-only');
    test.fail(true, 'QA-CP5a-01: Tab walks out of the setup card to Pause, Export log and the map regions behind it (passes the day it is fixed: delete this line)');
    await openSetup(page);
    // start with 3 bots: "+" is disabled, so the card has 5 focusable controls: minus, easy, normal, hard, start
    const inside = new Set(['setup-bots-minus', 'setup-bots-plus', 'setup-level-easy', 'setup-level-normal', 'setup-level-hard', 'setup-start']);
    const seen: string[] = [];
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      seen.push((await page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? document.activeElement?.tagName ?? '')) as string);
    }
    test.info().annotations.push({ type: 'tab-order', description: seen.join(' > ') });
    expect(seen.filter((x) => !inside.has(x)), `focus left the card: ${seen.join(' > ')}`).toEqual([]);
  });

  test('QA-CP5a-01b: with the setup open, neither a map region nor Pause behind it can be activated from the keyboard', async ({ page }) => {
    test.skip(isTouch(), 'keyboard flow is desktop-only');
    test.fail(true, 'QA-CP5a-01b: same root cause as QA-CP5a-01: the Pause button behind the setup screen is reachable by Tab and opens the pause overlay on top of it (delete this line when fixed)');
    await openSetup(page);
    const region = page.getByTestId('region-padang');
    await region.focus();
    await page.keyboard.press('Enter');
    const s = await getState(page);
    expect(s.players[0]?.targetId, 'a target was picked behind the open setup screen').toBeNull();
    await page.getByTestId('btn-pause').focus();
    await page.keyboard.press('Enter');
    await expect(byId(page, 'pause-overlay'), 'the pause overlay opened on top of the setup screen').toBeHidden();
  });

  test('count and level chosen here drive the match; Pause -> Keluar reopens the screen with the last choice; a second choice starts a fresh match', async ({ page }) => {
    await openSetup(page);
    await press(byId(page, 'setup-bots-minus'));
    await press(byId(page, 'setup-bots-minus'));
    await press(byId(page, 'setup-level-hard'));
    await press(byId(page, 'setup-start'));
    await expect(byId(page, 'setup-screen')).toBeHidden();
    let s = await getState(page);
    expect(s.players.map((p) => p.id)).toEqual(['p1', 'bot1']);
    expect(s.players[1]?.botLevel).toBe('hard');
    await setTimeScale(page, 6);
    await expect.poll(async () => (await getState(page)).timeMs, { timeout: 20_000 }).toBeGreaterThan(4000);

    await press(byId(page, 'btn-pause'));
    await press(byId(page, 'btn-quit'));
    await press(byId(page, 'btn-quit-yes'));
    await expect(byId(page, 'setup-screen')).toBeVisible();
    await expect(byId(page, 'pause-overlay')).toBeHidden();
    await expect(byId(page, 'setup-bots-count')).toHaveText('1'); // last choice kept
    await expect(byId(page, 'setup-level-hard')).toHaveAttribute('aria-checked', 'true');
    const held = (await getState(page)).timeMs;
    await page.waitForTimeout(1200);
    expect((await getState(page)).timeMs, 'the old match must not run behind the open screen').toBe(held);

    await press(byId(page, 'setup-bots-plus'));
    await press(byId(page, 'setup-bots-plus'));
    await press(byId(page, 'setup-level-easy'));
    await press(byId(page, 'setup-start'));
    s = await getState(page);
    expect(s.players.map((p) => p.id)).toEqual(['p1', 'bot1', 'bot2', 'bot3']);
    expect(s.players.slice(1).map((p) => p.botLevel)).toEqual(['easy', 'easy', 'easy']);
    expect(s.timeMs).toBeLessThan(1000);
    expect(s.players.every((p) => p.remainingWins === 8)).toBe(true);
    noErrors(page);
  });

  test('double tap on Mulai Balapan (two real pointer clicks at the same spot) starts one match and leaves nothing selected behind it', async ({ page }) => {
    await openSetup(page);
    await press(byId(page, 'setup-bots-minus')); // 2 bots
    const b = await box(byId(page, 'setup-start'));
    const x = b.x + b.width / 2;
    const y = b.y + b.height / 2;
    if (isTouch()) {
      await page.touchscreen.tap(x, y);
      await page.touchscreen.tap(x, y);
    } else {
      await page.mouse.click(x, y);
      await page.mouse.click(x, y);
    }
    await expect(byId(page, 'setup-screen')).toBeHidden();
    await page.waitForTimeout(400);
    const under = await page.evaluate(([px, py]) => {
      const el = document.elementFromPoint(px as number, py as number);
      return el ? `${el.tagName}.${el.className}#${el.getAttribute('data-testid') ?? ''}` : 'none';
    }, [x, y]);
    const s = await getState(page);
    test.info().annotations.push({ type: 'under-the-start-button', description: under });
    expect(s.players).toHaveLength(3);
    expect(s.timeMs).toBeLessThan(5000);
    expect(s.players[0]?.targetId, `the second tap hit ${under}`).toBeNull();
    noErrors(page);
  });

  test('URL parameters: one of ?bots / ?botLevel skips the screen, junk is clamped (bots=9 -> 3, 0 -> 1, abc -> 3, level=insane -> normal)', async ({ page }) => {
    const cases: [string, number, string][] = [
      ['bots=2', 2, 'normal'],
      ['botLevel=hard', 3, 'hard'],
      ['bots=9&botLevel=easy', 3, 'easy'],
      ['bots=0&botLevel=hard', 1, 'hard'],
      ['bots=abc&botLevel=normal', 3, 'normal'],
      ['bots=2&botLevel=insane', 2, 'normal'],
    ];
    for (const [q, count, level] of cases) {
      await page.goto(`/?seed=42&debug=1&${q}`);
      await page.waitForFunction(() => !!(window as unknown as { __atlasTest?: unknown }).__atlasTest, null, { timeout: 30_000 });
      await expect(byId(page, 'setup-screen')).toBeHidden();
      const s = await getState(page);
      expect(s.players.filter((p) => p.kind === 'bot'), q).toHaveLength(count);
      expect(new Set(s.players.filter((p) => p.kind === 'bot').map((p) => p.botLevel)), q).toEqual(new Set([level]));
    }
  });

  test('after a finished match "Main Lagi" starts a new one with the same setup (ui-flow: "Main Lagi (Setup sama)")', async ({ page }) => {
    await openSetup(page);
    await press(byId(page, 'setup-bots-minus')); // 2 bots
    await press(byId(page, 'setup-level-easy'));
    await press(byId(page, 'setup-start'));
    // let the bots win: they play against an idle human
    await setTimeScale(page, 60);
    await expect(byId(page, 'results-screen')).toBeVisible({ timeout: 80_000 });
    await expect(byId(page, 'results-row-bot1')).toBeVisible();
    expect((await getState(page)).players).toHaveLength(3);
    await setTimeScale(page, 1);
    await press(byId(page, 'btn-play-again'));
    const s = await getState(page);
    expect(s.players.map((p) => p.id)).toEqual(['p1', 'bot1', 'bot2']);
    expect(s.players.slice(1).map((p) => p.botLevel)).toEqual(['easy', 'easy']);
    expect(s.timeMs).toBeLessThan(1000);
    expect(s.status).toBe('running');
    noErrors(page);
  });
});

test.describe('thinking indicator and pause with real bots', () => {
  test('pause freezes the whole state (bot think / brake timers included) and the indicator; resume continues', async ({ page }) => {
    await open(page, { bots: 3, botLevel: 'hard' });
    await setTimeScale(page, 4);
    await expect.poll(async () => (await Promise.all(['bot1', 'bot2', 'bot3'].map((id) => activityOf(page, id)))).includes('thinking'), { timeout: 20_000 }).toBe(true);
    await pause(page);
    await expect(byId(page, 'pause-overlay')).toBeVisible();
    const before = JSON.stringify(await getState(page));
    const acts = await Promise.all(['bot1', 'bot2', 'bot3'].map((id) => activityOf(page, id)));
    await page.waitForTimeout(2500);
    expect(JSON.stringify(await getState(page)), 'state moved during pause').toBe(before);
    expect(await Promise.all(['bot1', 'bot2', 'bot3'].map((id) => activityOf(page, id)))).toEqual(acts);
    await resume(page);
    await expect.poll(async () => (await getState(page)).timeMs, { timeout: 15_000 }).toBeGreaterThan(JSON.parse(before).timeMs + 1500);
    noErrors(page);
  });

  test('the human row never shows an activity; a bot that is playing shows none for longer than a render frame', async ({ page }) => {
    await open(page, { bots: 3, botLevel: 'normal' });
    await setTimeScale(page, 6);
    const seen = { thinking: false };
    const playingBefore = new Set<string>();
    for (let i = 0; i < 40; i++) {
      // state and DOM in one evaluate; the HUD repaints on animation frames (about 6 per second here), so a
      // mismatch only counts when the bot was already playing one sample (250 ms) earlier
      const snap = await page.evaluate(() => {
        const st = (window as unknown as { __atlasTest: { getState(): { players: { id: string; kind: string; phase: string }[] } } }).__atlasTest.getState();
        return st.players.map((p) => ({ id: p.id, kind: p.kind, phase: p.phase, activity: document.querySelector(`[data-testid="progress-row-${p.id}"]`)?.getAttribute('data-activity') ?? '' }));
      });
      for (const p of snap) {
        if (p.id === 'p1') expect(p.activity).toBe('');
        if (p.activity === 'thinking') seen.thinking = true;
        if (p.kind === 'bot' && p.phase === 'playing' && playingBefore.has(p.id)) expect(p.activity, `${p.id} is in a minigame`).toBe('');
      }
      playingBefore.clear();
      for (const p of snap) if (p.phase === 'playing') playingBefore.add(p.id);
      await page.waitForTimeout(250);
    }
    expect(seen.thinking).toBe(true);
    noErrors(page);
  });

  test('a braking leader shows the pawn bubble and the label; it goes away once the bot starts again', async ({ page }) => {
    await open(page, { bots: 1, botLevel: 'hard' });
    await setTimeScale(page, 0);
    for (const region of ['medan', 'jakarta']) {
      await dispatch(page, { type: 'selectTarget', playerId: 'bot1', targetId: region });
      for (let w = 0; w < 2; w++) {
        await dispatch(page, { type: 'startAttempt', playerId: 'bot1' });
        await dispatch(page, { type: 'minigameResult', playerId: 'bot1', passed: true });
        await dispatch(page, { type: 'autoCards', playerId: 'bot1' });
      }
    }
    await dispatch(page, { type: 'selectTarget', playerId: 'bot1', targetId: 'toraja' });
    await setTimeScale(page, 12);
    await expect.poll(() => activityOf(page, 'bot1'), { timeout: 40_000 }).toBe('braking');
    await expect(byId(page, 'status-bot1')).toHaveAttribute('title', 'menahan diri');
    const bubble = () => page.evaluate(() => (window as unknown as { atlas: { scene: { getObjectByName(n: string): { visible: boolean } | undefined } } }).atlas.scene.getObjectByName('Thinking:bot1')?.visible);
    expect(await bubble()).toBe(true);
    // the Hard pace line is 610 s for 8 wins: after 4 wins the bot may start once the clock passes ~(610*4/8 - 20) s
    await setTimeScale(page, 60);
    await expect.poll(() => activityOf(page, 'bot1'), { timeout: 60_000 }).not.toBe('braking');
    await expect.poll(bubble, { timeout: 10_000 }).toBe(false);
    noErrors(page);
  });

  test('a full match against 3 Hard bots in the real browser: no console error, no rejected action, bots only act through ordinary actions', async ({ page }) => {
    await open(page, { bots: 3, botLevel: 'hard', seed: 7 });
    await setTimeScale(page, 80);
    await expect(byId(page, 'results-screen')).toBeVisible({ timeout: 85_000 });
    const log = JSON.parse(await page.evaluate(() => (window as unknown as { __atlasTest: { exportLog(): string } }).__atlasTest.exportLog())) as { events: { event: { type: string } }[] };
    const rejected = log.events.filter((e) => e.event.type === 'actionRejected');
    expect(rejected.length, JSON.stringify(rejected.slice(0, 3))).toBe(0);
    noErrors(page);
  });
});
