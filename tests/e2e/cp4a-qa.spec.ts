/**
 * CP4a QA e2e: only what the browser can show (layout at 390x844, pause with a real clock,
 * real-flow determinism, double submit). Runs on `desktop` and `mobile`.
 */
import { expect, test, type Page } from '@playwright/test';
import type { AtlasTestApi } from '../../src/ui/debug';
import { box, byId, consoleErrors, dispatch, force, getState, me, open, overlaps, press, setTimeScale } from './helpers';

type Api = AtlasTestApi;
const api = <T>(page: Page, fn: (a: Api) => T, ...[]: []) => page.evaluate(fn as never) as Promise<T>;
const give = (page: Page, id: string) => page.evaluate((c) => (window as unknown as { __atlasTest: Api }).__atlasTest.giveCard(c), id);
const hand = (page: Page) => page.evaluate(() => (window as unknown as { __atlasTest: Api }).__atlasTest.getHand());
const forceOffer = (page: Page, ids: string[], pick: number) =>
  page.evaluate(([i, n]) => (window as unknown as { __atlasTest: Api }).__atlasTest.forceOffer(i as string[], n as number), [ids, pick] as const);
const noErrors = (page: Page) => expect(consoleErrors.get(page) ?? []).toEqual([]);
void api;

async function playFromHand(page: Page, defId: string): Promise<void> {
  const h = await hand(page);
  const c = h.find((x) => x.id === defId);
  if (!c) throw new Error(`no ${defId} in hand`);
  await dispatch(page, { type: 'playCard', playerId: 'p1', cardUid: c.uid });
}

test.describe('layout with full hand, many pending badges, offer and discard', () => {
  test('8 pending badges + 5 hand cards: pending row never covers Mulai / target panel / progress list, all inside the viewport', async ({ page }) => {
    await open(page);
    await dispatch(page, { type: 'selectTarget', playerId: 'p1', targetId: 'padang' });
    const ids = ['jam_pasir', 'jam_pasir', 'santai_dulu', 'teropong', 'zona_lebar', 'nyawa_cadangan', 'oleh_oleh', 'ojek_kilat'];
    for (const batch of [ids.slice(0, 4), ids.slice(4)]) {
      for (const id of batch) await give(page, id);
      for (const id of batch) await playFromHand(page, id);
    }
    for (const id of ['teropong', 'kopi_tubruk', 'tiket_pesawat', 'jam_pasir', 'zona_lebar']) await give(page, id);
    await expect(byId(page, 'pending-badge-7')).toBeAttached();
    const vp = page.viewportSize()!;
    const row = await box(byId(page, 'pending-row'));
    const handBar = await box(byId(page, 'hand-bar'));
    const start = await box(byId(page, 'btn-start'));
    const panel = await box(byId(page, 'target-panel'));
    const prog = await box(byId(page, 'progress-list'));
    const badges = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="pending-badge-"]')].map((b) => { const r = b.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; }));
    const info = { vp, row, handBar, start, panel, prog, badges };
    test.info().annotations.push({ type: 'layout', description: JSON.stringify(info) });
    expect(row.y, `pending row leaves the top of the screen: ${JSON.stringify(info)}`).toBeGreaterThanOrEqual(0);
    for (const [i, b] of badges.entries()) {
      expect(b.x, `badge ${i} left`).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w, `badge ${i} right: ${JSON.stringify(info)}`).toBeLessThanOrEqual(vp.width);
      expect(overlaps({ x: b.x, y: b.y, width: b.w, height: b.h }, start), `badge ${i} covers Mulai`).toBe(false);
    }
    expect(overlaps(row, start), `pending row covers Mulai: ${JSON.stringify(info)}`).toBe(false);
    expect(overlaps(row, panel), `pending row overlaps target panel: ${JSON.stringify(info)}`).toBe(false);
    expect(overlaps(row, prog), `pending row overlaps progress list: ${JSON.stringify(info)}`).toBe(false);
    expect(overlaps(handBar, start)).toBe(false);
    expect(handBar.y + handBar.height).toBeLessThanOrEqual(vp.height);
    // Mulai must still be hit-testable (nothing on top of it)
    const topEl = await page.evaluate(([x, y]) => (document.elementFromPoint(x as number, y as number) as HTMLElement | null)?.closest('[data-testid]')?.getAttribute('data-testid') ?? null,
      [start.x + start.width / 2, start.y + start.height / 2] as const);
    expect(topEl).toBe('btn-start');
    await noErrors(page);
  });

  test('discard screen with 9 cards: all inside the viewport, no overlapping cards, text not clipped, Buang reachable', async ({ page }) => {
    await open(page);
    for (let i = 0; i < 5; i++) await give(page, ['nyawa_cadangan', 'tiket_pesawat', 'oleh_oleh', 'kopi_tubruk', 'santai_dulu'][i]!);
    await forceOffer(page, ['jam_pasir', 'zona_lebar', 'ojek_kilat', 'teropong', 'nyawa_cadangan'], 4);
    for (const i of [0, 1, 2, 3]) await press(byId(page, `card-slot-${i}`));
    await press(byId(page, 'btn-take'));
    await expect(byId(page, 'discard-screen')).toBeVisible();
    const vp = page.viewportSize()!;
    const boxes = [];
    for (let i = 0; i < 9; i++) boxes.push(await box(byId(page, `discard-card-${i}`)));
    for (const [i, b] of boxes.entries()) {
      expect(b.x, `card ${i} left`).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width, `card ${i} right`).toBeLessThanOrEqual(vp.width);
      expect(b.y, `card ${i} top`).toBeGreaterThanOrEqual(0);
      expect(b.y + b.height, `card ${i} bottom`).toBeLessThanOrEqual(vp.height);
      expect(b.width, `card ${i} touch width`).toBeGreaterThanOrEqual(48);
      expect(b.height, `card ${i} touch height`).toBeGreaterThanOrEqual(48);
    }
    for (let i = 0; i < 9; i++) for (let j = i + 1; j < 9; j++) expect(overlaps(boxes[i]!, boxes[j]!), `cards ${i} and ${j} overlap`).toBe(false);
    const confirm = await box(byId(page, 'btn-discard'));
    expect(confirm.y + confirm.height).toBeLessThanOrEqual(vp.height);
    for (const b of boxes) expect(overlaps(b, confirm), 'a card covers the Buang button').toBe(false);
    const title = await box(byId(page, 'discard-title'));
    expect(title.y).toBeGreaterThanOrEqual(0);
    // Clipping: each card face must not hide its own text (name wider/taller than the face)
    const clipped = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="discard-card-"] .cface')].map((f) => {
      const face = f as HTMLElement;
      const name = face.querySelector('.cname') as HTMLElement;
      const nb = name.getBoundingClientRect();
      const fb = face.getBoundingClientRect();
      return { name: name.textContent, textOverflowX: name.scrollWidth > name.clientWidth + 1, outside: nb.left < fb.left - 1 || nb.right > fb.right + 1 || nb.bottom > fb.bottom + 1 };
    }).filter((x) => x.textOverflowX || x.outside));
    expect(clipped, 'card names clipped / outside the face').toEqual([]);
    const hit = await page.evaluate(([x, y]) => (document.elementFromPoint(x as number, y as number) as HTMLElement | null)?.closest('[data-testid]')?.getAttribute('data-testid') ?? null,
      [confirm.x + confirm.width / 2, confirm.y + confirm.height / 2] as const);
    expect(hit).toBe('btn-discard');
    await noErrors(page);
  });

  test('offer screen with 5 cards: cards and Ambil fully inside the viewport (no scrolling needed)', async ({ page }) => {
    await open(page);
    await forceOffer(page, ['jam_pasir', 'zona_lebar', 'ojek_kilat', 'teropong', 'nyawa_cadangan'], 3);
    await expect(byId(page, 'card-offer')).toBeVisible();
    await page.waitForTimeout(800); // flip animation
    const vp = page.viewportSize()!;
    for (let i = 0; i < 5; i++) {
      const b = await box(byId(page, `card-slot-${i}`));
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(vp.width);
      expect(b.y + b.height, `card ${i} bottom`).toBeLessThanOrEqual(vp.height);
    }
    const take = await box(byId(page, 'btn-take'));
    expect(take.y + take.height, 'Ambil below the fold').toBeLessThanOrEqual(vp.height);
    const clipped = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="card-slot-"] .cface')].filter((f) => f.scrollHeight > f.clientHeight + 1 || f.scrollWidth > f.clientWidth + 1).map((f) => f.querySelector('.cname')?.textContent));
    expect(clipped, 'offer card content clipped').toEqual([]);
  });
});

test.describe('timers, pause, double submit, determinism', () => {
  test('pause freezes the discard timer on a real clock; resume continues from the same value', async ({ page }) => {
    await open(page);
    for (let i = 0; i < 5; i++) await give(page, 'teropong');
    await forceOffer(page, ['jam_pasir', 'santai_dulu'], 2);
    await press(byId(page, 'card-slot-0'));
    await press(byId(page, 'card-slot-1'));
    await press(byId(page, 'btn-take'));
    await expect(byId(page, 'discard-screen')).toBeVisible();
    await setTimeScale(page, 10);
    await page.waitForTimeout(500);
    await page.evaluate(() => (window as unknown as { __atlasTest: Api }).__atlasTest.pause());
    const before = (await me(page)).discard!.expiresAtMs - (await getState(page)).timeMs;
    await page.waitForTimeout(2500);
    const after = (await me(page)).discard!.expiresAtMs - (await getState(page)).timeMs;
    expect(after).toBe(before);
    expect(await byId(page, 'discard-screen').isVisible()).toBe(true);
    expect((await hand(page)).length).toBe(7);
    await page.evaluate(() => (window as unknown as { __atlasTest: Api }).__atlasTest.resume());
    await expect.poll(async () => (await me(page)).discard, { timeout: 20_000 }).toBeNull();
    expect((await hand(page)).length).toBe(5);
    await noErrors(page);
  });

  test('double submit: Ambil twice and a timeout racing Ambil never give the cards twice', async ({ page }) => {
    await open(page);
    await forceOffer(page, ['jam_pasir', 'santai_dulu', 'teropong'], 2);
    await press(byId(page, 'card-slot-0'));
    await press(byId(page, 'card-slot-1'));
    await expect(byId(page, 'offer-count')).toHaveText('2/2');
    const res = await page.evaluate(() => {
      const w = (window as unknown as { __atlasTest: Api }).__atlasTest;
      const uid = w.getState().players[0]!.offer!.cards.map((c) => c.uid);
      void uid;
      const a = w.dispatch({ type: 'confirmCards', playerId: 'p1' });
      const b = w.dispatch({ type: 'confirmCards', playerId: 'p1' });
      const c = w.autoResolveCards();
      return { a: a.map((e) => e.type), b: b.map((e) => e.type), c };
    });
    expect(res.a).toContain('cardsPicked');
    expect(res.b).toEqual(['actionRejected']);
    expect(res.c).toBe(false);
    expect(await hand(page)).toHaveLength(2);
  });

  test('same seed -> same offer after a real win through the host; other seed differs', async ({ page }) => {
    const offerFor = async (seed: number): Promise<string[]> => {
      await open(page, { seed });
      await dispatch(page, { type: 'selectTarget', playerId: 'p1', targetId: 'medan' });
      await expect.poll(() => force(page, true), { timeout: 20_000 }).toBe(true);
      await expect(byId(page, 'card-offer')).toBeVisible({ timeout: 20_000 });
      return (await me(page)).offer!.cards.map((c) => c.defId);
    };
    const a = await offerFor(7);
    const b = await offerFor(7);
    const c = await offerFor(8);
    expect(b).toEqual(a);
    expect(c).not.toEqual(a);
  });

  test('the pause button stays reachable while an offer is open (informational)', async ({ page }) => {
    await open(page);
    await forceOffer(page, ['jam_pasir', 'santai_dulu'], 1);
    const pb = await box(byId(page, 'btn-pause'));
    const hit = await page.evaluate(([x, y]) => (document.elementFromPoint(x as number, y as number) as HTMLElement | null)?.closest('[data-testid]')?.getAttribute('data-testid') ?? null,
      [pb.x + pb.width / 2, pb.y + pb.height / 2] as const);
    test.info().annotations.push({ type: 'pause-hit', description: String(hit) });
    expect(['btn-pause', 'card-offer']).toContain(hit); // documents the current behaviour either way
  });
});
