/**
 * CP3a smoke tests (docs/qa/test-plan.md, CP3). Run on the `desktop` and `mobile` projects.
 * Game rules are covered by Vitest; these check the real page: DOM, input, layout, flow.
 */
import { expect, test } from '@playwright/test';
import {
  box, byId, conquer, consoleErrors, dispatch, exportLog, force, forceWin, getState, isTouch, me, open, overlaps, press, setTimeScale, waitIdle,
} from './helpers';

test.describe('boot', () => {
  test('smoke_boot: no console errors, canvas + 10 region labels, no horizontal scroll', async ({ page }) => {
    await open(page);
    await expect(page.locator('canvas').first()).toBeVisible();
    await expect(page.locator('[data-testid^="region-"]')).toHaveCount(10);
    const dims = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    expect(dims.sw).toBeLessThanOrEqual(dims.iw);
    expect(consoleErrors.get(page)).toEqual([]);
    const s = await getState(page);
    expect(s.mapId).toBe('indonesia');
    expect(s.players).toHaveLength(2);
    expect(s.players[0]).toMatchObject({ nodeId: 'sabang', targetId: null, phase: 'idle' });
    await expect(byId(page, 'btn-start')).toHaveCount(0); // no target yet: no minigame offered at the start
  });
});

test.describe('loop', () => {
  test('smoke_loop: pick neighbour -> start -> intro -> fail -> cooldown -> 2 wins -> pawn moves', async ({ page }) => {
    await open(page);
    await setTimeScale(page, 1);
    // non-neighbour is not selectable through the UI
    const mb = await box(byId(page, 'region-merauke'));
    if (isTouch()) await page.touchscreen.tap(mb.x + mb.width / 2, mb.y + mb.height / 2);
    else await page.mouse.click(mb.x + mb.width / 2, mb.y + mb.height / 2);
    await page.waitForTimeout(500);
    expect((await me(page)).targetId).toBeNull();
    // neighbour: real click/tap on the label
    await press(byId(page, 'region-medan'));
    await expect.poll(async () => (await me(page)).targetId).toBe('medan');
    await expect(byId(page, 'target-panel')).toBeVisible();
    await expect(byId(page, 'target-wins')).toHaveText('0/2');
    await press(byId(page, 'btn-start'));
    await expect(byId(page, 'mg-overlay')).toBeVisible();
    await expect(byId(page, 'mg-intro')).toBeVisible();
    expect((await me(page)).phase).toBe('playing');
    // forced failure: banner says fail, cooldown appears, Start disabled
    await expect.poll(() => force(page, false)).toBe(true);
    await expect(byId(page, 'mg-banner')).toHaveAttribute('data-result', 'fail');
    await waitIdle(page);
    // toBeVisible() is unreliable here: with no fonts the text span has zero width
    await expect(byId(page, 'cooldown-timer')).toHaveText(/\d/);
    await expect(byId(page, 'btn-start')).toBeDisabled();
    const p = await me(page);
    expect(p.cooldownUntilMs).toBeGreaterThan((await getState(page)).timeMs);
    // cooldown ends (time scale up), Start enabled again
    await setTimeScale(page, 10);
    await expect(byId(page, 'btn-start')).toBeEnabled({ timeout: 30_000 });
    await expect(byId(page, 'cooldown-timer')).toHaveCount(0);
    // 2 wins: first keeps the pawn, second moves it
    await press(byId(page, 'btn-start'));
    await forceWin(page);
    expect(await me(page)).toMatchObject({ nodeId: 'sabang', winsAtTarget: 1 });
    await expect(byId(page, 'target-wins')).toHaveText('1/2');
    await forceWin(page);
    expect(await me(page)).toMatchObject({ nodeId: 'medan', winsAtTarget: 0, targetId: null });
    expect(consoleErrors.get(page)).toEqual([]);
  });

  test('switch target with partial wins asks for confirmation (race_switch_target_rules)', async ({ page }) => {
    await open(page);
    await setTimeScale(page, 10);
    await dispatch(page, { type: 'selectTarget', playerId: 'p1', targetId: 'medan' });
    await forceWin(page);
    expect((await me(page)).winsAtTarget).toBe(1);
    // "No" keeps target and win
    await press(byId(page, 'region-padang'));
    await expect(byId(page, 'confirm-switch')).toBeVisible();
    await press(byId(page, 'btn-switch-no'));
    await expect(byId(page, 'confirm-switch')).toBeHidden();
    expect(await me(page)).toMatchObject({ targetId: 'medan', winsAtTarget: 1 });
    // "Yes" switches and loses the partial win
    await press(byId(page, 'region-padang'));
    await press(byId(page, 'btn-switch-yes'));
    await expect.poll(async () => (await me(page)).targetId).toBe('padang');
    expect((await me(page)).winsAtTarget).toBe(0);
  });

  test('smoke_full_race: forced wins reach Merauke and the results screen; play again resets', async ({ page }) => {
    await open(page, { bots: 1 });
    await setTimeScale(page, 10);
    await dispatch(page, { type: 'selectTarget', playerId: 'p1', targetId: 'padang' });
    await conquer(page, ['padang', 'jakarta', 'toraja', 'raja_ampat']);
    await expect(byId(page, 'results-screen')).toBeVisible({ timeout: 30_000 });
    const s = await getState(page);
    expect(s.status).toBe('finished');
    await expect(byId(page, 'results-screen').locator('[data-testid^="results-row-"]')).toHaveCount(2);
    await press(byId(page, 'btn-play-again'));
    await expect(byId(page, 'results-screen')).toBeHidden();
    const s2 = await getState(page);
    expect(s2.status).toBe('running');
    expect(s2.players[0]).toMatchObject({ nodeId: 'sabang', targetId: null });
  });
});

test.describe('pause', () => {
  test('pause freezes game time, resume continues, quit restarts', async ({ page }) => {
    await open(page);
    await setTimeScale(page, 10);
    await press(byId(page, 'btn-pause'));
    await expect(byId(page, 'pause-overlay')).toBeVisible();
    const t0 = (await getState(page)).timeMs;
    await page.waitForTimeout(1500);
    expect((await getState(page)).timeMs).toBe(t0);
    await press(byId(page, 'btn-resume'));
    await expect(byId(page, 'pause-overlay')).toBeHidden();
    await expect.poll(async () => (await getState(page)).timeMs).toBeGreaterThan(t0);
    await press(byId(page, 'btn-pause'));
    await press(byId(page, 'btn-quit'));
    await press(byId(page, 'btn-quit-yes'));
    await expect(byId(page, 'pause-overlay')).toBeHidden();
    expect((await getState(page)).status).toBe('running');
  });

  test('pause during a minigame does not advance the attempt', async ({ page }) => {
    await open(page);
    await dispatch(page, { type: 'selectTarget', playerId: 'p1', targetId: 'medan' });
    await dispatch(page, { type: 'startAttempt', playerId: 'p1' });
    await expect(byId(page, 'mg-overlay')).toBeVisible();
    await page.evaluate(() => window.__atlasTest?.pause());
    const t0 = (await getState(page)).timeMs;
    await page.waitForTimeout(1500);
    expect((await getState(page)).timeMs).toBe(t0);
    await page.evaluate(() => window.__atlasTest?.resume());
  });
});

test.describe('input', () => {
  test('smoke_input: real tap/click on the play area counts exactly one action', async ({ page }) => {
    await open(page);
    await dispatch(page, { type: 'selectTarget', playerId: 'p1', targetId: 'medan' });
    await dispatch(page, { type: 'startAttempt', playerId: 'p1' });
    await expect(byId(page, 'mg-play-area')).toBeVisible();
    await expect(byId(page, 'mg-intro')).toBeHidden({ timeout: 20_000 }); // intro is over -> play
    const read = async () => {
      const prog = (await byId(page, 'mg-progress').textContent()) ?? '0/0';
      const hearts = (await byId(page, 'mg-misses').textContent()) ?? '';
      return { hits: Number(prog.split('/')[0]), lost: (hearts.match(/♡/g) ?? []).length };
    };
    const before = await read();
    await press(byId(page, 'mg-play-area'));
    await expect.poll(async () => { const a = await read(); return a.hits + a.lost - (before.hits + before.lost); }, { timeout: 10_000 }).toBe(1);
    await page.waitForTimeout(1500); // a double event would show up now
    const after = await read();
    expect(after.hits + after.lost - (before.hits + before.lost)).toBeLessThanOrEqual(1);
  });

  test('desktop: Space works as tap, digit keys choose a target', async ({ page }) => {
    test.skip(isTouch(), 'keyboard is a desktop path');
    await open(page);
    await page.keyboard.press('Digit1');
    await expect.poll(async () => (await me(page)).targetId).not.toBeNull();
    await page.keyboard.press('Enter');
    await expect(byId(page, 'mg-intro')).toBeVisible();
    await expect(byId(page, 'mg-intro')).toBeHidden({ timeout: 20_000 });
    const before = await byId(page, 'mg-misses').textContent();
    const prog = await byId(page, 'mg-progress').textContent();
    await page.keyboard.press('Space');
    await expect.poll(async () => `${await byId(page, 'mg-misses').textContent()}|${await byId(page, 'mg-progress').textContent()}`, { timeout: 10_000 }).not.toBe(`${before}|${prog}`);
  });
});

test.describe('layout and touch', () => {
  async function interactive(page: import('@playwright/test').Page) {
    return page.evaluate(() => {
      const out: { id: string; w: number; h: number }[] = [];
      document.querySelectorAll<HTMLElement>('button, [role=button], a[href]').forEach((el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || cs.pointerEvents === 'none' || el.closest('[hidden]') || el.closest('.debug-panel')) return;
        if (el.closest('.region-label') || el.classList.contains('region-label')) {
          if (r.right < 0 || r.left > innerWidth || r.bottom < 0 || r.top > innerHeight) return;
        }
        out.push({ id: el.dataset.testid ?? el.className, w: Math.round(r.width), h: Math.round(r.height) });
      });
      return out;
    });
  }

  test('smoke_touch_targets: interactive elements >= 48x48, Start >= 56 high', async ({ page }) => {
    await open(page);
    await dispatch(page, { type: 'selectTarget', playerId: 'p1', targetId: 'medan' });
    await expect(byId(page, 'btn-start')).toBeVisible();
    const small = (await interactive(page)).filter((e) => e.w < 48 || e.h < 48);
    expect(small, `elements under 48px (${page.viewportSize()?.width}px wide)`).toEqual([]);
    const b = await box(byId(page, 'btn-start'));
    if (isTouch()) expect(b.height).toBeGreaterThanOrEqual(56);
  });

  test('smoke_layout_safe: HUD, target panel, Start inside the viewport and not overlapping', async ({ page }) => {
    await open(page);
    await dispatch(page, { type: 'selectTarget', playerId: 'p1', targetId: 'medan' });
    await expect(byId(page, 'btn-start')).toBeVisible();
    const sizes = isTouch() ? [{ width: 390, height: 844 }, { width: 844, height: 390 }] : [{ width: 1280, height: 720 }];
    for (const vp of sizes) {
      await page.setViewportSize(vp);
      await page.waitForTimeout(500);
      const boxes = {
        progress: await box(byId(page, 'progress-list')),
        panel: await box(byId(page, 'target-panel')),
        start: await box(byId(page, 'btn-start')),
        pause: await box(byId(page, 'btn-pause')),
      };
      for (const [name, b] of Object.entries(boxes)) {
        expect(b.x, `${name} @${vp.width}x${vp.height}`).toBeGreaterThanOrEqual(-0.5);
        expect(b.y, `${name} @${vp.width}x${vp.height}`).toBeGreaterThanOrEqual(-0.5);
        expect(b.x + b.width, `${name} right @${vp.width}x${vp.height}`).toBeLessThanOrEqual(vp.width + 0.5);
        expect(b.y + b.height, `${name} bottom @${vp.width}x${vp.height}`).toBeLessThanOrEqual(vp.height + 0.5);
      }
      expect(overlaps(boxes.progress, boxes.panel), `progress/panel overlap @${vp.width}x${vp.height}`).toBe(false);
      expect(overlaps(boxes.progress, boxes.pause), `progress/pause overlap @${vp.width}x${vp.height}`).toBe(false);
      expect(overlaps(boxes.panel, boxes.pause), `panel/pause overlap @${vp.width}x${vp.height}`).toBe(false);
      const sw = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
      expect(sw, `horizontal scroll @${vp.width}x${vp.height}`).toBe(true);
    }
  });

  test('smoke_no_page_gestures: play area + canvas touch-action none; swipe does not scroll', async ({ page }) => {
    await open(page);
    const ta = await page.evaluate(() => getComputedStyle(document.querySelector('canvas') as HTMLElement).touchAction);
    expect(ta).toBe('none');
    await dispatch(page, { type: 'selectTarget', playerId: 'p1', targetId: 'medan' });
    await dispatch(page, { type: 'startAttempt', playerId: 'p1' });
    await expect(byId(page, 'mg-play-area')).toBeVisible();
    const pa = await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="mg-overlay"]') as HTMLElement).touchAction);
    expect(pa).toBe('none');
    const vp = page.viewportSize() as { width: number; height: number };
    await page.mouse.move(vp.width / 2, vp.height * 0.8);
    await page.mouse.down();
    await page.mouse.move(vp.width / 2, vp.height * 0.2, { steps: 8 });
    await page.mouse.up();
    expect(await page.evaluate(() => scrollY)).toBe(0);
  });
});

test.describe('debug log', () => {
  test('export log contains actions and events of the match', async ({ page }) => {
    await open(page, { seed: '0xDEADBEEF' });
    await dispatch(page, { type: 'selectTarget', playerId: 'p1', targetId: 'medan' });
    const log = JSON.parse(await exportLog(page));
    expect(log.format).toBe('atlas-dash-match-log@1');
    expect(log.matchSeed).toBe(0xdeadbeef);
    expect(log.mapId).toBe('indonesia');
    expect(log.events.some((e: { event: { type: string } }) => e.event.type === 'targetSelected')).toBe(true);
    await expect(byId(page, 'btn-export-log')).toBeVisible();
  });
});
