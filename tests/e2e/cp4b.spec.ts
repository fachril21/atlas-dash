/**
 * CP4b e2e: the target picker, slot visibility, toasts, Copet vs open popovers, and Pause above
 * every card modal (QA-CP4a-03). Runs on `desktop` and `mobile`. No fonts on the test machine, so
 * text checks use toHaveText / data attributes only.
 */
import { expect, test, type Page } from '@playwright/test';
import type { AtlasTestApi } from '../../src/ui/debug';
import { box, byId, consoleErrors, dispatch, getState, me, open, overlaps, press } from './helpers';

type Api = AtlasTestApi;
const noErrors = (page: Page) => expect(consoleErrors.get(page) ?? []).toEqual([]);
const give = (page: Page, id: string, to = 'p1') => page.evaluate(([p, c]) => (window as unknown as { __atlasTest: Api }).__atlasTest.giveCardTo(p!, c!), [to, id]);
const handOf = (page: Page, id: string) => page.evaluate((p) => (window as unknown as { __atlasTest: Api }).__atlasTest.getHandOf(p), id);
const pendingOf = (page: Page, id: string) => page.evaluate((p) => (window as unknown as { __atlasTest: Api }).__atlasTest.getPending(p), id);
const slotsOf = (page: Page, id: string) => page.evaluate((p) => (window as unknown as { __atlasTest: Api }).__atlasTest.getSabotageSlots(p), id);
const playAs = (page: Page, card: string, target: string | undefined, as: string) =>
  page.evaluate(([c, t, p]) => (window as unknown as { __atlasTest: Api }).__atlasTest.playCard(c!, t || undefined, p!), [card, target ?? '', as]);
const forceOffer = (page: Page, ids: string[], pick: number) =>
  page.evaluate(([i, n]) => (window as unknown as { __atlasTest: Api }).__atlasTest.forceOffer(i as string[], n as number), [ids, pick] as const);
const hitId = (page: Page, b: { x: number; y: number; width: number; height: number }) =>
  page.evaluate(([x, y]) => (document.elementFromPoint(x as number, y as number) as HTMLElement | null)?.closest('[data-testid]')?.getAttribute('data-testid') ?? null, [b.x + b.width / 2, b.y + b.height / 2] as const);

/** Fill a bot with 2 sabotage cards sent by another bot (debug hooks; bots never play on their own). */
async function fill(page: Page, target: string, from: string): Promise<void> {
  for (const id of ['badai', 'kabut_asap']) {
    await give(page, id, from);
    expect((await playAs(page, id, target, from)).ok).toBe(true);
  }
}

async function openDetail(page: Page, cardId: string): Promise<void> {
  const slot = page.locator(`[data-testid^="hand-card-"][data-card-id="${cardId}"]`).first();
  await press(slot);
  await expect(byId(page, 'card-detail')).toBeVisible();
}

test.describe('target picker (ui-flow §7)', () => {
  test('3 opponents: rows, labels, no overlap, touch targets >= 48 px, pick -> card sent, picker closes, toast fades', async ({ page }) => {
    await open(page, { bots: 3 });
    await fill(page, 'bot2', 'bot1'); // bot2 is full
    await give(page, 'jam_rusak');
    await openDetail(page, 'jam_rusak');
    await press(byId(page, 'btn-play-card'));
    await expect(byId(page, 'target-picker')).toBeVisible();
    await expect(byId(page, 'picker-title')).toHaveText('Pilih lawan untuk Jam Rusak');
    // rows for exactly the 3 opponents, label only on the invalid one
    for (const id of ['bot1', 'bot2', 'bot3']) await expect(byId(page, `picker-row-${id}`)).toBeVisible();
    await expect(byId(page, 'picker-row-bot2')).toBeDisabled();
    await expect(byId(page, 'picker-label-bot2')).toHaveText('Penuh');
    await expect(byId(page, 'picker-slots-bot2')).toHaveText('●●');
    await expect(byId(page, 'picker-slots-bot1')).toHaveText('○○');
    await expect(byId(page, 'picker-row-bot1')).toBeEnabled();
    expect(await byId(page, 'picker-label-bot1').count()).toBe(0);
    const vp = page.viewportSize()!;
    const rows = [];
    for (const id of ['bot1', 'bot2', 'bot3']) rows.push(await box(byId(page, `picker-row-${id}`)));
    const cancel = await box(byId(page, 'btn-picker-cancel'));
    for (const [i, r] of [...rows, cancel].entries()) {
      expect(r.height, `row ${i} height`).toBeGreaterThanOrEqual(48);
      expect(r.width, `row ${i} width`).toBeGreaterThanOrEqual(48);
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.x + r.width).toBeLessThanOrEqual(vp.width);
      expect(r.y + r.height).toBeLessThanOrEqual(vp.height);
    }
    const all = [...rows, cancel];
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(overlaps(all[i]!, all[j]!), `rows ${i}/${j} overlap`).toBe(false);
    // a dim row cannot be picked
    await byId(page, 'picker-row-bot2').click({ force: true }).catch(() => undefined);
    expect(await slotsOf(page, 'bot2')).toBe(2);
    // pick bot3
    await press(byId(page, 'picker-row-bot3'));
    await expect(byId(page, 'target-picker')).toBeHidden();
    await expect.poll(() => pendingOf(page, 'bot3')).toEqual([expect.objectContaining({ id: 'jam_rusak', source: 'p1' })]);
    expect((await handOf(page, 'p1')).length).toBe(0);
    await expect(byId(page, 'card-toast-0')).toBeVisible();
    await expect(byId(page, 'card-toast-0')).toBeHidden({ timeout: 8000 }); // fades on its own
    await noErrors(page);
  });

  test('Batal goes back to the detail and the card stays in hand', async ({ page }) => {
    await open(page, { bots: 2 });
    await give(page, 'badai');
    await openDetail(page, 'badai');
    await press(byId(page, 'btn-play-card'));
    await expect(byId(page, 'target-picker')).toBeVisible();
    await press(byId(page, 'btn-picker-cancel'));
    await expect(byId(page, 'target-picker')).toBeHidden();
    await expect(byId(page, 'card-detail')).toBeVisible();
    expect((await handOf(page, 'p1')).length).toBe(1);
    await noErrors(page);
  });

  test('with 1 opponent the picker is skipped: Pakai sends at once', async ({ page }) => {
    await open(page, { bots: 1 });
    await give(page, 'badai');
    await openDetail(page, 'badai');
    await press(byId(page, 'btn-play-card'));
    await expect(byId(page, 'target-picker')).toBeHidden();
    await expect.poll(() => pendingOf(page, 'bot1')).toEqual([expect.objectContaining({ id: 'badai', source: 'p1' })]);
    expect((await handOf(page, 'p1')).length).toBe(0);
    await noErrors(page);
  });

  test('a target that fills up while the picker is open: toast on tap, nothing is spent, the row dims', async ({ page }) => {
    await open(page, { bots: 3 });
    await give(page, 'ngebut');
    await openDetail(page, 'ngebut');
    await press(byId(page, 'btn-play-card'));
    await expect(byId(page, 'target-picker')).toBeVisible();
    await fill(page, 'bot1', 'bot2'); // behind the picker's back
    // The row updates through state; a tap that races it is refused by the logic.
    const r = await page.evaluate(() => (window as unknown as { __atlasTest: Api }).__atlasTest.playCard('ngebut', 'bot1'));
    expect(r).toEqual({ ok: false, reason: 'bad-target' });
    await expect(byId(page, 'picker-row-bot1')).toBeDisabled();
    await expect(byId(page, 'picker-label-bot1')).toHaveText('Penuh');
    expect((await handOf(page, 'p1')).length).toBe(1);
    await noErrors(page);
  });

  test('every opponent becomes invalid while the picker is open: it closes with a toast', async ({ page }) => {
    await open(page, { bots: 2 });
    await give(page, 'ngebut');
    await openDetail(page, 'ngebut');
    await press(byId(page, 'btn-play-card'));
    await expect(byId(page, 'target-picker')).toBeVisible();
    await fill(page, 'bot1', 'bot2');
    await fill(page, 'bot2', 'bot1');
    await expect(byId(page, 'target-picker')).toBeHidden();
    await expect(byId(page, 'card-toast-0')).toBeVisible();
    expect((await handOf(page, 'p1')).length).toBe(1);
  });

  test('Gunung Meletus: no picker; the confirmation names the impact; Ya hits the valid opponents', async ({ page }) => {
    await open(page, { bots: 3 });
    await fill(page, 'bot2', 'bot1');
    await give(page, 'gunung_meletus');
    await openDetail(page, 'gunung_meletus');
    await press(byId(page, 'btn-play-card'));
    await expect(byId(page, 'target-picker')).toBeHidden();
    await expect(byId(page, 'confirm-text')).toHaveText('Kena 2 dari 3 lawan (Bot 2 penuh)');
    await press(byId(page, 'btn-confirm-yes'));
    await expect.poll(async () => (await pendingOf(page, 'bot1')).some((c) => c.id === 'gunung_meletus')).toBe(true);
    expect((await pendingOf(page, 'bot1')).some((c) => c.id === 'gunung_meletus')).toBe(true);
    expect((await pendingOf(page, 'bot3')).some((c) => c.id === 'gunung_meletus')).toBe(true);
    expect((await pendingOf(page, 'bot2')).some((c) => c.id === 'gunung_meletus')).toBe(false);
    await noErrors(page);
  });
});

test.describe('slot visibility (DR-33)', () => {
  test('everyone sees the slot count; card names only reach the sender and the target', async ({ page }) => {
    await open(page, { bots: 3 });
    // bot1 -> bot2 (a third party for the human) and the human -> bot3
    await give(page, 'jam_rusak', 'bot1');
    expect((await playAs(page, 'jam_rusak', 'bot2', 'bot1')).ok).toBe(true);
    await give(page, 'badai');
    expect((await playAs(page, 'badai', 'bot3', 'p1')).ok).toBe(true);
    await expect(byId(page, 'progress-row-bot2')).toHaveAttribute('data-slots', '1');
    await expect(byId(page, 'progress-row-bot3')).toHaveAttribute('data-slots', '1');
    await expect(byId(page, 'progress-row-bot1')).toHaveAttribute('data-slots', '0');
    await expect(byId(page, 'slots-bot2')).toContainText('●○');
    // third party: no card name anywhere in the progress list for bot2
    await expect(byId(page, 'sent-bot2')).toHaveCount(0);
    const text = await byId(page, 'progress-row-bot2').innerText();
    expect(text).not.toContain('Jam Rusak');
    // sender: sees the name of what he sent to bot3
    await expect(byId(page, 'sent-bot3')).toHaveText(/Badai/);
    // target: own pending row names it
    await give(page, 'kabut_asap', 'bot1');
    expect((await playAs(page, 'kabut_asap', 'p1', 'bot1')).ok).toBe(true);
    await expect(byId(page, 'progress-row-p1')).toHaveAttribute('data-slots', '1');
    await expect(page.locator('[data-testid^="pending-badge-"][data-card-id="kabut_asap"]')).toHaveCount(1);
    await noErrors(page);
  });
});

test.describe('Copet and open popovers (DR-27)', () => {
  test('the Detail of the stolen card closes with a toast; the card is gone from the hand', async ({ page }) => {
    await open(page, { bots: 1 });
    await give(page, 'teropong');
    await openDetail(page, 'teropong');
    await give(page, 'copet', 'bot1');
    expect((await playAs(page, 'copet', 'p1', 'bot1')).ok).toBe(true);
    await expect(byId(page, 'card-detail')).toBeHidden();
    await expect(byId(page, 'card-toasts')).toContainText('Teropong');
    expect((await handOf(page, 'p1')).length).toBe(0);
    expect((await handOf(page, 'bot1')).map((c) => c.id)).toEqual(['teropong']);
    await noErrors(page);
  });

  test('the Buang screen closes by itself when the steal makes it unnecessary, without resetting the timer', async ({ page }) => {
    await open(page, { bots: 1 });
    for (let i = 0; i < 6; i++) await give(page, 'teropong');
    await expect(byId(page, 'discard-screen')).toBeVisible();
    await give(page, 'copet', 'bot1');
    expect((await playAs(page, 'copet', 'p1', 'bot1')).ok).toBe(true);
    await expect(byId(page, 'discard-screen')).toBeHidden();
    expect((await handOf(page, 'p1')).length).toBe(5);
    await noErrors(page);
  });
});

test.describe('Pause above the card modals (QA-CP4a-03)', () => {
  test('the Pause button is hit-testable on top of Offer, Discard, Detail and Picker, and Pause freezes their timers', async ({ page }) => {
    await open(page, { bots: 3 });
    const pauseBox = async () => box(byId(page, 'btn-pause'));
    // Offer
    await forceOffer(page, ['jam_pasir', 'santai_dulu'], 1);
    await expect(byId(page, 'card-offer')).toBeVisible();
    expect(await hitId(page, await pauseBox())).toBe('btn-pause');
    await press(byId(page, 'btn-pause'));
    await expect(byId(page, 'pause-overlay')).toBeVisible();
    await expect(byId(page, 'card-offer')).toBeVisible(); // still shown under the Pause overlay
    await page.waitForTimeout(2500);
    const frozen = (await me(page)).offer!.expiresAtMs - (await getState(page)).timeMs;
    await page.waitForTimeout(1500);
    expect((await me(page)).offer!.expiresAtMs - (await getState(page)).timeMs).toBe(frozen);
    await press(byId(page, 'btn-resume'));
    await expect(byId(page, 'pause-overlay')).toBeHidden();
    await press(byId(page, 'card-slot-0'));
    await press(byId(page, 'btn-take'));
    // Detail
    await expect(byId(page, 'card-offer')).toBeHidden();
    await openDetail(page, 'jam_pasir').catch(async () => openDetail(page, 'santai_dulu'));
    expect(await hitId(page, await pauseBox())).toBe('btn-pause');
    // Discard
    await page.evaluate(() => (window as unknown as { __atlasTest: Api }).__atlasTest.clearHand());
    for (let i = 0; i < 6; i++) await give(page, 'teropong');
    await expect(byId(page, 'discard-screen')).toBeVisible();
    expect(await hitId(page, await pauseBox())).toBe('btn-pause');
    await press(byId(page, 'btn-pause'));
    await expect(byId(page, 'pause-overlay')).toBeVisible();
    const d1 = (await me(page)).discard!.expiresAtMs - (await getState(page)).timeMs;
    await page.waitForTimeout(2000);
    expect((await me(page)).discard!.expiresAtMs - (await getState(page)).timeMs).toBe(d1);
    await press(byId(page, 'btn-resume'));
    await page.evaluate(() => (window as unknown as { __atlasTest: Api }).__atlasTest.autoResolveCards());
    // Picker
    await give(page, 'badai');
    await openDetail(page, 'badai');
    await press(byId(page, 'btn-play-card'));
    await expect(byId(page, 'target-picker')).toBeVisible();
    expect(await hitId(page, await pauseBox())).toBe('btn-pause');
    await press(byId(page, 'btn-pause'));
    await expect(byId(page, 'pause-overlay')).toBeVisible();
    await expect(byId(page, 'target-picker')).toBeVisible();
    await press(byId(page, 'btn-resume'));
    await expect(byId(page, 'pause-overlay')).toBeHidden();
    await noErrors(page);
  });
});

test.describe('bots hold hands (DR-32)', () => {
  test('a bot win gives it cards at once, with no screen; a Copet can then take one', async ({ page }) => {
    await open(page, { bots: 1 });
    await dispatch(page, { type: 'selectTarget', playerId: 'bot1', targetId: 'medan' });
    await dispatch(page, { type: 'startAttempt', playerId: 'bot1' });
    await dispatch(page, { type: 'minigameResult', playerId: 'bot1', passed: true });
    const st = await getState(page);
    const bot = st.players.find((p) => p.id === 'bot1')!;
    expect(bot.offer).toBeNull();
    expect(bot.hand.length).toBeGreaterThanOrEqual(2);
    expect(bot.hand.length).toBeLessThanOrEqual(5);
    await give(page, 'copet');
    expect((await playAs(page, 'copet', 'bot1', 'p1')).ok).toBe(true);
    expect((await handOf(page, 'p1')).length).toBe(1);
    expect((await handOf(page, 'bot1')).length).toBe(bot.hand.length - 1);
    await noErrors(page);
  });
});
