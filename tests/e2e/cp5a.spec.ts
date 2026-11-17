/**
 * CP5a smoke tests: the Setup Bot screen (B1/B3) and the "thinking" indicator for waiting bots.
 * The machine has no fonts, so text is checked with toHaveText / data attributes only.
 */
import { expect, test, type Page } from '@playwright/test';
import { byId, dispatch, getState, open, press, setTimeScale } from './helpers';

const activityOf = (page: Page, id: string) => byId(page, `progress-row-${id}`).getAttribute('data-activity');

test.describe('setup bot screen', () => {
  test('a URL without ?bots / ?botLevel opens the setup first; count and level chosen there drive the match; the clock waits', async ({ page }) => {
    await page.goto('/?seed=42&debug=1');
    await expect(byId(page, 'setup-screen')).toBeVisible({ timeout: 30_000 });
    await expect(byId(page, 'setup-bots-count')).toHaveText('3');
    await expect(byId(page, 'setup-level-normal')).toHaveAttribute('aria-checked', 'true');
    await page.waitForTimeout(1500);
    expect((await getState(page)).timeMs).toBe(0); // held while the setup is open
    await press(byId(page, 'setup-bots-minus'));
    await expect(byId(page, 'setup-bots-count')).toHaveText('2');
    await press(byId(page, 'setup-level-hard'));
    await expect(byId(page, 'setup-level-hard')).toHaveAttribute('aria-checked', 'true');
    await expect(byId(page, 'setup-level-normal')).toHaveAttribute('aria-checked', 'false');
    await press(byId(page, 'setup-start'));
    await expect(byId(page, 'setup-screen')).toBeHidden();
    const s = await getState(page);
    expect(s.players).toHaveLength(3);
    expect(s.players.filter((p) => p.kind === 'bot').map((p) => p.botLevel)).toEqual(['hard', 'hard']);
    await expect.poll(async () => (await getState(page)).timeMs, { timeout: 15_000 }).toBeGreaterThan(0);
  });

  test('the count stays within 1-3 and the screen offers Easy / Normal / Hard', async ({ page }) => {
    await page.goto('/?seed=42&debug=1');
    await expect(byId(page, 'setup-screen')).toBeVisible({ timeout: 30_000 });
    await expect(byId(page, 'setup-bots-plus')).toBeDisabled(); // already 3
    await press(byId(page, 'setup-bots-minus'));
    await press(byId(page, 'setup-bots-minus'));
    await expect(byId(page, 'setup-bots-count')).toHaveText('1');
    await expect(byId(page, 'setup-bots-minus')).toBeDisabled();
    for (const l of ['easy', 'normal', 'hard']) await expect(byId(page, `setup-level-${l}`)).toBeVisible();
  });

  test('?bots and ?botLevel in the URL skip the screen', async ({ page }) => {
    await open(page, { bots: 2, botLevel: 'hard' });
    await expect(byId(page, 'setup-screen')).toBeHidden();
    expect((await getState(page)).players.filter((p) => p.kind === 'bot').map((p) => p.botLevel)).toEqual(['hard', 'hard']);
  });
});

test.describe('bots that wait are "thinking", not frozen', () => {
  test('at the start a bot thinks: its row says so and a bubble shows over its pawn', async ({ page }) => {
    await open(page, { bots: 1, botLevel: 'normal' });
    await expect.poll(() => activityOf(page, 'bot1'), { timeout: 15_000 }).toBe('thinking');
    await expect(byId(page, 'status-bot1')).toHaveAttribute('title', 'berpikir');
    const bubble = await page.evaluate(() => (window as unknown as { atlas: { scene: { getObjectByName(n: string): { visible: boolean } | undefined } } }).atlas.scene.getObjectByName('Thinking:bot1')?.visible);
    expect(bubble).toBe(true);
    // it does not stay in that state: the thinking ends with an action
    await setTimeScale(page, 5);
    await expect.poll(async () => (await getState(page)).players.find((p) => p.id === 'bot1')?.targetId, { timeout: 30_000 }).not.toBeNull();
  });

  test('a leading bot that is ahead of schedule is shown as braking ("menahan diri"), and the clock keeps running', async ({ page }) => {
    await open(page, { bots: 1, botLevel: 'normal' });
    await setTimeScale(page, 0);
    // bot1 wins two regions in the first seconds: leading and far ahead of the pace line
    for (const region of ['medan', 'jakarta']) {
      await dispatch(page, { type: 'selectTarget', playerId: 'bot1', targetId: region });
      for (let w = 0; w < 2; w++) {
        await dispatch(page, { type: 'startAttempt', playerId: 'bot1' });
        await dispatch(page, { type: 'minigameResult', playerId: 'bot1', passed: true });
        await dispatch(page, { type: 'autoCards', playerId: 'bot1' });
      }
    }
    await dispatch(page, { type: 'selectTarget', playerId: 'bot1', targetId: 'toraja' });
    await setTimeScale(page, 10);
    await expect.poll(() => activityOf(page, 'bot1'), { timeout: 40_000 }).toBe('braking');
    await expect(byId(page, 'status-bot1')).toHaveAttribute('title', 'menahan diri');
    const t0 = (await getState(page)).timeMs;
    await expect.poll(async () => (await getState(page)).timeMs, { timeout: 20_000 }).toBeGreaterThan(t0 + 5000);
  });
});
