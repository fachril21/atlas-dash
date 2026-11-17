/**
 * CP4b QA e2e (on top of tests/e2e/cp4b.spec.ts): the Buang grid with 6-10 cards at 390x844, the
 * deferred Buang after a minigame (reflected Copet), Pause freezing the picker / bots / cooldown,
 * toasts for blocked / reflected / Copet, DR-33 information leaks, DR-27 on Picker and Buang, and Esc.
 * Runs on `desktop` and `mobile`. The machine has no fonts: text checks use toHaveText / data attributes.
 */
import { expect, test, type Page } from '@playwright/test';
import type { AtlasTestApi } from '../../src/ui/debug';
import { box, byId, consoleErrors, dispatch, force, getState, me, open, overlaps, press, setTimeScale, waitIdle } from './helpers';

type Api = AtlasTestApi;
type Box = { x: number; y: number; width: number; height: number };
const A = (page: Page) => page;
void A;
const noErrors = (page: Page) => expect(consoleErrors.get(page) ?? []).toEqual([]);
const give = (page: Page, id: string, to = 'p1') => page.evaluate(([p, c]) => (window as unknown as { __atlasTest: Api }).__atlasTest.giveCardTo(p!, c!), [to, id]);
const handOf = (page: Page, id: string) => page.evaluate((p) => (window as unknown as { __atlasTest: Api }).__atlasTest.getHandOf(p), id);
const pendingOf = (page: Page, id: string) => page.evaluate((p) => (window as unknown as { __atlasTest: Api }).__atlasTest.getPending(p), id);
const playAs = (page: Page, card: string, target: string | undefined, as: string) =>
  page.evaluate(([c, t, p]) => (window as unknown as { __atlasTest: Api }).__atlasTest.playCard(c!, t || undefined, p!), [card, target ?? '', as]);
const clearHand = (page: Page) => page.evaluate(() => (window as unknown as { __atlasTest: Api }).__atlasTest.clearHand());
const hitId = (page: Page, b: Box) =>
  page.evaluate(([x, y]) => (document.elementFromPoint(x as number, y as number) as HTMLElement | null)?.closest('[data-testid]')?.getAttribute('data-testid') ?? null, [b.x + b.width / 2, b.y + b.height / 2] as const);
const inside = (b: Box, vp: { width: number; height: number }) => b.x >= 0 && b.y >= 0 && b.x + b.width <= vp.width + 0.5 && b.y + b.height <= vp.height + 0.5;

async function openDetail(page: Page, cardId: string): Promise<void> {
  await press(page.locator(`[data-testid^="hand-card-"][data-card-id="${cardId}"]`).first());
  await expect(byId(page, 'card-detail')).toBeVisible();
}

test.describe('Buang grid with 6-10 cards (verdict 2: the hand can reach 10)', () => {
  test('6, 7, 8, 9 and 10 cards: every card, the title, the timer, Buang and Pause are inside the viewport, >= 48 px, not overlapping', async ({ page }) => {
    await open(page, { bots: 3 });
    await setTimeScale(page, 0); // game clock frozen: the bots stay idle, the 15 s timer does not run
    const vp = page.viewportSize()!;
    const kinds = ['teropong', 'jam_pasir', 'badai', 'copet', 'cermin_balik', 'ngebut', 'kopi_tubruk', 'gunung_meletus', 'tambah_beban', 'oleh_oleh'];
    const report: string[] = [];
    for (const count of [6, 7, 8, 9, 10]) {
      await clearHand(page);
      for (let i = 0; i < count; i++) await give(page, kinds[i]!);
      await expect(byId(page, 'discard-screen')).toBeVisible();
      await expect(byId(page, 'discard-title')).toHaveText(`Hand penuh! Buang ${count - 5} kartu`);
      await expect(byId(page, 'discard-count')).toHaveText(`0/${count - 5}`);
      const cards: Box[] = [];
      for (let i = 0; i < count; i++) cards.push(await box(byId(page, `discard-card-${i}`)));
      const timer = await box(byId(page, 'discard-timer'));
      const ok = await box(byId(page, 'btn-discard'));
      const pause = await box(byId(page, 'btn-pause'));
      report.push(`${count}: card ${Math.round(cards[0]!.width)}x${Math.round(cards[0]!.height)}, grid bottom ${Math.round(Math.max(...cards.map((c) => c.y + c.height)))}, Buang y ${Math.round(ok.y)}-${Math.round(ok.y + ok.height)} of ${vp.height}`);
      for (const [i, c] of cards.entries()) {
        expect(inside(c, vp), `${count} cards: card ${i} outside the viewport ${JSON.stringify(c)}`).toBe(true);
        expect(c.width, `${count}: card ${i} width`).toBeGreaterThanOrEqual(48);
        expect(c.height, `${count}: card ${i} height`).toBeGreaterThanOrEqual(48);
      }
      for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) expect(overlaps(cards[i]!, cards[j]!), `${count}: cards ${i}/${j} overlap`).toBe(false);
      for (const [name, b] of [['timer', timer], ['Buang', ok]] as const) expect(inside(b, vp), `${count}: ${name} outside ${JSON.stringify(b)}`).toBe(true);
      for (const c of cards) expect(overlaps(c, ok), `${count}: a card overlaps Buang`).toBe(false);
      expect(ok.height, 'Buang height').toBeGreaterThanOrEqual(48);
      expect(await hitId(page, ok), `${count}: Buang is covered`).toBe('btn-discard');
      expect(await hitId(page, pause), `${count}: Pause is covered`).toBe('btn-pause');
      // the last card is hit-testable (nothing on top of it)
      const last = cards[count - 1]!;
      expect(await hitId(page, last), `${count}: last card is covered`).toBe(`discard-card-${count - 1}`);
    }
    test.info().annotations.push({ type: 'layout', description: report.join(' | ') });
    // use the 10-card screen for real: mark 5 by pointer, Buang. A frozen clock applies no UI action
    // (human actions are polled once per logic step), so run slowly instead: 15 s of game = 50 s of real time.
    await setTimeScale(page, 0.3);
    await clearHand(page);
    for (let i = 0; i < 10; i++) await give(page, kinds[i]!);
    for (let i = 0; i < 5; i++) await press(byId(page, `discard-card-${i}`));
    await expect(byId(page, 'discard-count')).toHaveText('5/5');
    await expect(byId(page, 'btn-discard')).toBeEnabled();
    await press(byId(page, 'btn-discard'));
    await expect(byId(page, 'discard-screen')).toBeHidden();
    expect((await handOf(page, 'p1')).map((c) => c.id)).toEqual(kinds.slice(5));
    await noErrors(page);
  });

  test('real flow: Cermin pending, hand 5, a bot\'s Copet is reflected during the minigame (hand 6, no screen), then a win with Oleh-oleh on a hard region -> Buang with 10 cards, 4 BARU', async ({ page }) => {
    await open(page, { bots: 1 });
    await setTimeScale(page, 0); // freeze the bot while the hand is prepared
    await dispatch(page, { type: 'selectTarget', playerId: 'p1', targetId: 'padang' }); // hard: N = 3, +1 Oleh-oleh
    for (const c of ['cermin_balik', 'oleh_oleh']) {
      await give(page, c);
      expect((await playAs(page, c, undefined, 'p1')).ok).toBe(true);
    }
    for (let i = 0; i < 5; i++) await give(page, 'teropong');
    await give(page, 'copet', 'bot1');
    await give(page, 'jam_pasir', 'bot1');
    await setTimeScale(page, 1);
    await press(byId(page, 'btn-start'));
    await expect(byId(page, 'mg-overlay')).toBeVisible();
    await setTimeScale(page, 0); // the bot must still be idle for its Copet to be playable
    const r = await playAs(page, 'copet', 'p1', 'bot1');
    expect(r.ok).toBe(true);
    expect((await handOf(page, 'p1')).length).toBe(6);
    expect((await handOf(page, 'bot1')).length).toBe(0);
    expect((await pendingOf(page, 'p1')).map((c) => c.id)).toEqual(['oleh_oleh']);
    await expect(byId(page, 'discard-screen')).toBeHidden(); // deferred: nothing opens over the minigame
    await setTimeScale(page, 1);
    await expect.poll(() => force(page, true), { timeout: 20_000 }).toBe(true);
    await expect(byId(page, 'card-offer')).toBeVisible({ timeout: 20_000 });
    await expect(byId(page, 'offer-title')).toHaveText('Pilih 4 kartu');
    for (let i = 0; i < 4; i++) await press(byId(page, `card-slot-${i}`));
    await press(byId(page, 'btn-take'));
    await expect(byId(page, 'discard-screen')).toBeVisible();
    await expect(byId(page, 'discard-count')).toHaveText('0/5');
    expect((await handOf(page, 'p1')).length).toBe(10);
    await expect(byId(page, 'discard-new')).toHaveCount(4);
    const vp = page.viewportSize()!;
    for (let i = 0; i < 10; i++) expect(inside(await box(byId(page, `discard-card-${i}`)), vp), `card ${i}`).toBe(true);
    expect(inside(await box(byId(page, 'btn-discard')), vp)).toBe(true);
    const st = (await me(page)).discard!;
    expect(st.expiresAtMs - (await getState(page)).timeMs).toBeGreaterThan(13_000); // a fresh 15 s, opened after the offer
    await dispatch(page, { type: 'autoCards', playerId: 'p1' });
    expect((await handOf(page, 'p1')).length).toBe(5);
    await noErrors(page);
  });
});

test.describe('Pause (criterion 18)', () => {
  test('picker open, Pause pressed: bots, clock and picker are frozen for 3 s of real time at x10; Resume continues and the picker still works', async ({ page }) => {
    await open(page, { bots: 2 });
    await give(page, 'jam_rusak');
    await openDetail(page, 'jam_rusak');
    await press(byId(page, 'btn-play-card'));
    await expect(byId(page, 'target-picker')).toBeVisible();
    await setTimeScale(page, 10);
    await expect.poll(async () => (await getState(page)).players.some((p) => p.id !== 'p1' && p.targetId !== null), { timeout: 20_000 }).toBe(true); // bots are moving
    await press(byId(page, 'btn-pause'));
    await expect(byId(page, 'pause-overlay')).toBeVisible();
    await expect(byId(page, 'target-picker')).toBeVisible();
    const t0 = (await getState(page)).timeMs;
    const snap = JSON.stringify((await getState(page)).players);
    await page.waitForTimeout(3000); // 30 s of game time if it were running
    const s1 = await getState(page);
    expect(s1.timeMs).toBe(t0);
    expect(JSON.stringify(s1.players)).toBe(snap);
    await press(byId(page, 'btn-resume'));
    await expect(byId(page, 'pause-overlay')).toBeHidden();
    await expect(byId(page, 'target-picker')).toBeVisible();
    await expect.poll(async () => (await getState(page)).timeMs, { timeout: 10_000 }).toBeGreaterThan(t0);
    await setTimeScale(page, 1);
    await press(byId(page, 'picker-row-bot2'));
    await expect.poll(async () => (await pendingOf(page, 'bot2')).map((c) => c.id)).toEqual(['jam_rusak']);
    await noErrors(page);
  });

  test('Pause freezes a running cooldown while the Detail is open; the remaining time is identical after the pause', async ({ page }) => {
    await open(page, { bots: 1 });
    await dispatch(page, { type: 'selectTarget', playerId: 'p1', targetId: 'medan' });
    await expect.poll(() => force(page, false), { timeout: 20_000 }).toBe(true);
    await waitIdle(page);
    const cd = async () => { const s = await getState(page); return s.players.find((p) => p.id === 'p1')!.cooldownUntilMs - s.timeMs; };
    expect(await cd()).toBeGreaterThan(0);
    await give(page, 'teropong');
    await openDetail(page, 'teropong');
    await press(byId(page, 'btn-pause'));
    const before = await cd();
    await page.waitForTimeout(3000);
    expect(await cd()).toBe(before);
    await press(byId(page, 'btn-resume'));
    await expect.poll(cd, { timeout: 10_000 }).toBeLessThan(before);
    await noErrors(page);
  });

  test('Esc: the first press closes the picker (no pause); with no popover left, the next Esc pauses and the one after resumes (desktop only)', async ({ page }) => {
    test.skip(test.info().project.name === 'mobile', 'keyboard');
    await open(page, { bots: 2 });
    await give(page, 'badai');
    await openDetail(page, 'badai');
    await press(byId(page, 'btn-play-card'));
    await expect(byId(page, 'target-picker')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(byId(page, 'target-picker')).toBeHidden();
    await expect(byId(page, 'pause-overlay')).toBeHidden();
    expect((await handOf(page, 'p1')).length).toBe(1);
    // (QA-CP4b-02: the Detail is closed too; if it were still open, one more Esc would close it first)
    if (await byId(page, 'card-detail').isVisible()) await page.keyboard.press('Escape');
    await expect(byId(page, 'card-detail')).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(byId(page, 'pause-overlay')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(byId(page, 'pause-overlay')).toBeHidden();
    await noErrors(page);
  });
});

test.describe('toasts (criterion 21)', () => {
  test('blocked by Payung, reflected by Cermin, Copet seen from the outside: each toast shows, names the right thing and goes away; toasts never take taps', async ({ page }) => {
    await open(page, { bots: 3 });
    await setTimeScale(page, 0); // bots stay idle
    await give(page, 'payung_tameng', 'bot1');
    expect((await playAs(page, 'payung_tameng', undefined, 'bot1')).ok).toBe(true);
    await give(page, 'badai');
    expect((await playAs(page, 'badai', 'bot1', 'p1')).ok).toBe(true);
    await expect(byId(page, 'card-toast-0')).toContainText('Payung Tameng');
    // a toast must not swallow a tap: its centre hits whatever is below
    const tb = await box(byId(page, 'card-toast-0'));
    expect(await hitId(page, tb)).not.toBe('card-toast-0');
    const prog = await box(byId(page, 'progress-list'));
    test.info().annotations.push({ type: 'toast-over-progress', description: String(overlaps(tb, prog)) });
    await expect(byId(page, 'card-toast-0')).toBeHidden({ timeout: 8000 });
    expect((await pendingOf(page, 'bot1')).length).toBe(0);
    expect((await handOf(page, 'p1')).length).toBe(0);

    await give(page, 'cermin_balik', 'bot2');
    expect((await playAs(page, 'cermin_balik', undefined, 'bot2')).ok).toBe(true);
    await give(page, 'kabut_asap');
    expect((await playAs(page, 'kabut_asap', 'bot2', 'p1')).ok).toBe(true);
    await expect(byId(page, 'card-toast-0')).toHaveText('Dipantulkan ke kamu!');
    await expect(page.locator('[data-testid^="pending-badge-"][data-card-id="kabut_asap"]')).toHaveCount(1);
    await expect(byId(page, 'progress-row-p1')).toHaveAttribute('data-slots', '1');
    await expect(byId(page, 'card-toast-0')).toBeHidden({ timeout: 8000 });

    // third party Copet: bot3 steals from bot2 (human sees names of players, not of the card)
    await give(page, 'teropong', 'bot2');
    await give(page, 'copet', 'bot3');
    expect((await playAs(page, 'copet', 'bot2', 'bot3')).ok).toBe(true);
    await expect(byId(page, 'card-toast-0')).toContainText('Bot 3');
    await expect(byId(page, 'card-toasts')).not.toContainText('Teropong');
    await expect(byId(page, 'card-toast-0')).toBeHidden({ timeout: 8000 });
    await noErrors(page);
  });
});

test.describe('DR-33: hidden information', () => {
  test('a third party\'s card names and a bot\'s Payung / Cermin never appear anywhere in the DOM', async ({ page }) => {
    await open(page, { bots: 3 });
    await setTimeScale(page, 0); // bots stay idle
    await give(page, 'payung_tameng', 'bot2');
    expect((await playAs(page, 'payung_tameng', undefined, 'bot2')).ok).toBe(true);
    await give(page, 'jam_rusak', 'bot1');
    expect((await playAs(page, 'jam_rusak', 'bot3', 'bot1')).ok).toBe(true);
    await give(page, 'gunung_meletus', 'bot3');
    expect((await playAs(page, 'gunung_meletus', undefined, 'bot3')).ok).toBe(true); // blocked by bot2, lands on p1 and bot1
    await expect(byId(page, 'progress-row-bot3')).toHaveAttribute('data-slots', '1');
    await expect(byId(page, 'progress-row-bot2')).toHaveAttribute('data-slots', '0'); // a defence card holds no slot and is not shown
    const html = await page.evaluate(() => document.documentElement.outerHTML);
    for (const hidden of ['payung_tameng', 'Payung Tameng', 'Payung', 'jam_rusak', 'Jam Rusak']) expect(html, `leak: ${hidden}`).not.toContain(hidden);
    // the target does see what hit him: own pending row names Gunung Meletus
    await expect(page.locator('[data-testid^="pending-badge-"][data-card-id="gunung_meletus"]')).toHaveCount(1);
    await noErrors(page);
  });
});

test.describe('picker, worst case layout and DR-27', () => {
  test('verdict 5: with every opponent invalid the card is dim and the detail says why (Penuh / hand kosong); Pakai is disabled and nothing opens', async ({ page }) => {
    await open(page, { bots: 3 });
    await setTimeScale(page, 0); // bots stay idle
    // a ring of sabotage so that all three bots are full: bot1 -> bot2, bot2 -> bot3, bot3 -> bot1 (2 cards each)
    const ring: [string, string][] = [['bot1', 'bot2'], ['bot2', 'bot3'], ['bot3', 'bot1']];
    for (const [from, to] of ring) {
      for (const c of ['badai', 'kabut_asap']) { await give(page, c, from); expect((await playAs(page, c, to, from)).ok).toBe(true); }
    }
    await give(page, 'jam_rusak');
    await give(page, 'copet');
    await openDetail(page, 'jam_rusak');
    await expect(byId(page, 'card-reason')).toHaveText('Semua lawan penuh');
    await expect(byId(page, 'btn-play-card')).toBeDisabled();
    await expect(page.locator('[data-testid^="hand-card-"][data-card-id="jam_rusak"]')).toHaveAttribute('data-playable', 'false');
    await press(byId(page, 'btn-cancel-card'));
    // Copet ignores the slots, but every bot hand is empty
    await openDetail(page, 'copet');
    await expect(byId(page, 'card-reason')).toHaveText('Semua lawan hand kosong');
    await expect(byId(page, 'btn-play-card')).toBeDisabled();
    await expect(byId(page, 'target-picker')).toBeHidden();
    // give one bot a card: Copet becomes playable and the picker shows the other two as "Hand kosong"
    await give(page, 'teropong', 'bot2');
    await expect(byId(page, 'btn-play-card')).toBeEnabled();
    await press(byId(page, 'btn-play-card'));
    await expect(byId(page, 'target-picker')).toBeVisible();
    await expect(byId(page, 'picker-label-bot1')).toHaveText('Hand kosong');
    await expect(byId(page, 'picker-label-bot3')).toHaveText('Hand kosong');
    await expect(byId(page, 'picker-row-bot2')).toBeEnabled(); // bot2 is "Penuh" but Copet ignores slots
    expect(await page.locator('[data-testid="picker-label-bot2"]').count()).toBe(0);
    await noErrors(page);
  });

  test('picker worst case: labels on invalid rows, a "sent" chip on both kinds of row; no clipping, no overlap, everything inside the viewport', async ({ page }) => {
    await open(page, { bots: 3 });
    await setTimeScale(page, 0); // bots stay idle
    for (const c of ['kabut_asap', 'jam_rusak']) { await give(page, c, 'bot3'); expect((await playAs(page, c, 'bot1', 'bot3')).ok).toBe(true); } // bot1 full
    await give(page, 'badai');
    expect((await playAs(page, 'badai', 'bot2', 'p1')).ok).toBe(true); // bot2 now has my Badai (stacked for another Badai)
    await give(page, 'jam_rusak');
    expect((await playAs(page, 'jam_rusak', 'bot3', 'p1')).ok).toBe(true); // bot3 has my Jam Rusak and stays valid
    await give(page, 'badai');
    await openDetail(page, 'badai');
    await press(byId(page, 'btn-play-card'));
    await expect(byId(page, 'target-picker')).toBeVisible();
    await expect(byId(page, 'picker-label-bot1')).toHaveText('Penuh');
    await expect(byId(page, 'picker-label-bot2')).toHaveText('Sudah kena kartu ini');
    expect(await page.locator('[data-testid="picker-label-bot3"]').count()).toBe(0);
    await expect(byId(page, 'picker-row-bot3')).toBeEnabled();
    await expect(byId(page, 'picker-row-bot2')).toContainText('Badai'); // my own card is named on the row, not the others'
    await expect(byId(page, 'picker-row-bot1')).not.toContainText('Kabut');
    const vp = page.viewportSize()!;
    const rows: Box[] = [];
    for (const id of ['bot1', 'bot2', 'bot3']) rows.push(await box(byId(page, `picker-row-${id}`)));
    const cancel = await box(byId(page, 'btn-picker-cancel'));
    const all = [...rows, cancel];
    for (const [i, b] of all.entries()) expect(inside(b, vp), `row ${i} ${JSON.stringify(b)} vs ${JSON.stringify(vp)}`).toBe(true);
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(overlaps(all[i]!, all[j]!)).toBe(false);
    const clipped = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.picker-row')].map((r) => r.scrollHeight - r.clientHeight));
    expect(clipped.every((d) => d <= 1), `clipped rows ${clipped}`).toBe(true);
    expect(await hitId(page, cancel)).toBe('btn-picker-cancel');
    for (const r of rows) expect(r.height).toBeGreaterThanOrEqual(48);
    await noErrors(page);
  });

  test('DR-27: Copet takes the card whose Picker is open -> picker closes with the toast; a Copet that takes another card leaves it open', async ({ page }) => {
    await open(page, { bots: 2 });
    await setTimeScale(page, 0); // bots stay idle
    await give(page, 'jam_rusak');
    await openDetail(page, 'jam_rusak');
    await press(byId(page, 'btn-play-card'));
    await expect(byId(page, 'target-picker')).toBeVisible();
    await give(page, 'copet', 'bot1');
    expect((await playAs(page, 'copet', 'p1', 'bot1')).ok).toBe(true);
    await expect(byId(page, 'target-picker')).toBeHidden();
    await expect(byId(page, 'card-detail')).toBeHidden();
    await expect(byId(page, 'card-toasts')).toContainText('Jam Rusak');
    expect((await handOf(page, 'p1')).length).toBe(0);
    await expect(byId(page, 'card-toast-0')).toBeHidden({ timeout: 8000 });

    // two cards: whichever the (seeded) steal takes, the UI must agree with the state
    await give(page, 'jam_rusak');
    await give(page, 'teropong');
    await openDetail(page, 'jam_rusak');
    await press(byId(page, 'btn-play-card'));
    await expect(byId(page, 'target-picker')).toBeVisible();
    await give(page, 'copet', 'bot2');
    expect((await playAs(page, 'copet', 'p1', 'bot2')).ok).toBe(true);
    const left = (await handOf(page, 'p1')).map((c) => c.id);
    expect(left).toHaveLength(1);
    if (left[0] === 'jam_rusak') {
      await expect(byId(page, 'target-picker')).toBeVisible(); // another card was stolen: the picker stays
      await press(byId(page, 'picker-row-bot1'));
      await expect.poll(async () => (await pendingOf(page, 'bot1')).map((c) => c.id)).toEqual(['jam_rusak']);
    } else {
      await expect(byId(page, 'target-picker')).toBeHidden();
    }
    await noErrors(page);
  });

  test('DR-27 on the Buang screen with marks: a steal re-bases the counter, drops a mark on a stolen card, keeps the timer', async ({ page }) => {
    await open(page, { bots: 1 });
    await setTimeScale(page, 0.3); // UI actions need logic steps; slow enough that the bot stays idle and the 15 s timer is safe
    for (const c of ['teropong', 'jam_pasir', 'zona_lebar', 'kopi_tubruk', 'oleh_oleh', 'ojek_kilat', 'santai_dulu']) await give(page, c);
    await expect(byId(page, 'discard-screen')).toBeVisible();
    await expect(byId(page, 'discard-count')).toHaveText('0/2');
    await press(byId(page, 'discard-card-0'));
    await press(byId(page, 'discard-card-1'));
    await expect(byId(page, 'discard-count')).toHaveText('2/2');
    const expiry = (await me(page)).discard!.expiresAtMs;
    await setTimeScale(page, 0); // the hook below goes straight to the reducer; keep the bot idle for its Copet
    await give(page, 'copet', 'bot1');
    expect((await playAs(page, 'copet', 'p1', 'bot1')).ok).toBe(true);
    const d = (await me(page)).discard!;
    expect(d.expiresAtMs).toBe(expiry);
    const hand = (await me(page)).hand;
    expect(hand).toHaveLength(6);
    await expect(byId(page, 'discard-count')).toHaveText(`${d.marked.length}/1`);
    expect(d.marked.length).toBeLessThanOrEqual(1);
    for (const u of d.marked) expect(hand.some((c) => c.uid === u)).toBe(true);
    // finish it through the UI
    await setTimeScale(page, 0.3);
    if (d.marked.length === 0) await press(byId(page, 'discard-card-0'));
    await expect(byId(page, 'btn-discard')).toBeEnabled();
    await press(byId(page, 'btn-discard'));
    await expect(byId(page, 'discard-screen')).toBeHidden();
    expect((await handOf(page, 'p1')).length).toBe(5);
    await noErrors(page);
  });
});


test.describe('picker, spec deviations (documented bugs: each test passes while the bug exists, and starts failing once it is fixed)', () => {
  const openPicker = async (page: Page, bots = 2): Promise<void> => {
    await open(page, { bots });
    await setTimeScale(page, 0);
    await give(page, 'badai');
    await openDetail(page, 'badai');
    await press(byId(page, 'btn-play-card'));
    await expect(byId(page, 'target-picker')).toBeVisible();
  };

  test('QA-CP4b-01: ui-flow section 7 point 3: tapping outside the picker goes back to the Detail (card stays in hand)', async ({ page }) => {
    test.fail(true, 'QA-CP4b-01: a tap on the backdrop does nothing');
    await openPicker(page);
    const vp = page.viewportSize()!;
    await page.mouse.click(vp.width / 2, 8); // the top strip is outside the picker card
    await expect(byId(page, 'target-picker')).toBeHidden({ timeout: 3000 });
    await expect(byId(page, 'card-detail')).toBeVisible();
  });

  test('QA-CP4b-02: ui-flow section 7 point 4: Esc in the picker goes back to the Detail, not to nothing (desktop)', async ({ page }) => {
    test.skip(test.info().project.name === 'mobile', 'keyboard');
    test.fail(true, 'QA-CP4b-02: Esc closes the picker and the Detail together');
    await openPicker(page);
    await page.keyboard.press('Escape');
    await expect(byId(page, 'target-picker')).toBeHidden();
    await expect(byId(page, 'card-detail')).toBeVisible({ timeout: 3000 });
  });

  test('QA-CP4b-04: a picker row keeps the same DOM node while bots change state (a touch that straddles a re-render would be dropped)', async ({ page }) => {
    await open(page, { bots: 3 });
    await give(page, 'badai');
    await openDetail(page, 'badai');
    await press(byId(page, 'btn-play-card'));
    await expect(byId(page, 'target-picker')).toBeVisible();
    await page.evaluate(() => { (document.querySelector('[data-testid="picker-row-bot1"]') as unknown as { __mark?: number }).__mark = 1; });
    await setTimeScale(page, 10);
    await expect.poll(async () => (await getState(page)).players.filter((p) => p.id !== 'p1' && p.phase === 'playing').length, { timeout: 30_000 }).toBeGreaterThan(0); // a bot changed state
    const kept = await page.evaluate(() => (document.querySelector('[data-testid="picker-row-bot1"]') as unknown as { __mark?: number } | null)?.__mark === 1);
    expect(kept).toBe(true);
  });

  test('QA-CP4b-03: ui-flow section 7 point 2: the first valid opponent has focus when the picker opens (keyboard / gamepad users)', async ({ page }) => {
    test.skip(test.info().project.name === 'mobile', 'keyboard');
    test.fail(true, 'QA-CP4b-03: nothing is focused when the picker opens');
    await openPicker(page);
    const focused = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute('data-testid') ?? null);
    expect(focused).toBe('picker-row-bot1');
  });
});

test.describe('picker: ranking and match end', () => {
  test('rows follow the race ranking: the leader is #1 with the "Terdepan" badge and the picker shows its position', async ({ page }) => {
    await open(page, { bots: 3 });
    await setTimeScale(page, 0);
    // bot2 conquers one region: it leads
    for (const a of [{ type: 'selectTarget', targetId: 'medan' }, { type: 'startAttempt' }, { type: 'minigameResult', passed: true }, { type: 'startAttempt' }, { type: 'minigameResult', passed: true }] as const) {
      await dispatch(page, { ...a, playerId: 'bot2' } as never);
    }
    await give(page, 'badai');
    await openDetail(page, 'badai');
    await press(byId(page, 'btn-play-card'));
    await expect(byId(page, 'picker-rank-bot2')).toHaveText('#1');
    const ranks = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="picker-rank-"]')].map((e) => e.textContent));
    expect(ranks[0]).toBe('#1'); // the leader is listed first
    await expect(byId(page, 'picker-row-bot2')).toContainText('Terdepan');
    expect(await byId(page, 'picker-row-bot1').innerText()).not.toContain('Terdepan');
    await noErrors(page);
  });

  test('a bot reaches Merauke while the picker is open (2 opponents): the picker goes away, the hand keeps the card, the logic refuses the play', async ({ page }) => {
    await open(page, { bots: 2 });
    await setTimeScale(page, 0);
    await give(page, 'ngebut');
    await openDetail(page, 'ngebut');
    await press(byId(page, 'btn-play-card'));
    await expect(byId(page, 'target-picker')).toBeVisible();
    for (const region of ['medan', 'jakarta', 'toraja', 'labuan_bajo']) {
      await dispatch(page, { type: 'selectTarget', playerId: 'bot1', targetId: region });
      for (let w = 0; w < 2; w++) {
        await dispatch(page, { type: 'startAttempt', playerId: 'bot1' });
        await dispatch(page, { type: 'minigameResult', playerId: 'bot1', passed: true });
        await dispatch(page, { type: 'autoCards', playerId: 'bot1' }); // the offer, then an overflow Discard it may open
        await dispatch(page, { type: 'autoCards', playerId: 'bot1' });
      }
    }
    expect((await getState(page)).status).toBe('finished');
    await expect(byId(page, 'target-picker')).toBeHidden();
    expect((await handOf(page, 'p1')).map((c) => c.id)).toEqual(['ngebut']);
    const r = await playAs(page, 'ngebut', 'bot2', 'p1');
    expect(r.ok).toBe(false); // the logic refuses too
    await noErrors(page);
  });
});
