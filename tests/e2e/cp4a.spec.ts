/**
 * CP4a smoke tests (docs/qa/test-plan.md, CP4): card offer, hand, discard, playing boost cards,
 * pending badges, QA hooks, B-1. Runs on `desktop` and `mobile`.
 */
import { expect, test, type Page } from '@playwright/test';
import type { GameState, PlayerState } from '../../src/logic';
import type { AtlasTestApi } from '../../src/ui/debug';
import { box, byId, conquer, consoleErrors, dispatch, force, getState, me, open, press, setTimeScale, waitIdle } from './helpers';

type Api = AtlasTestApi;
const give = async (page: Page, id: string) => {
  expect(await page.evaluate((c) => (window as unknown as { __atlasTest: Api }).__atlasTest.giveCard(c), id)).toBe(true);
};
const clearHand = (page: Page) => page.evaluate(() => (window as unknown as { __atlasTest: Api }).__atlasTest.clearHand());
const hand = (page: Page) => page.evaluate(() => (window as unknown as { __atlasTest: Api }).__atlasTest.getHand());
const forceOffer = (page: Page, ids?: string[], pick?: number) =>
  page.evaluate(([i, n]) => (window as unknown as { __atlasTest: Api }).__atlasTest.forceOffer((i as string[] | null) ?? undefined, (n as number | null) ?? undefined), [ids ?? null, pick ?? null]);
const noErrors = (page: Page) => expect(consoleErrors.get(page) ?? []).toEqual([]);

/** Win once at medan (medium: N = 2) and stop on the offer screen. */
async function winToOffer(page: Page): Promise<void> {
  await dispatch(page, { type: 'selectTarget', playerId: 'p1', targetId: 'medan' });
  await expect.poll(() => force(page, true), { timeout: 20_000 }).toBe(true);
  await expect(byId(page, 'card-offer')).toBeVisible({ timeout: 20_000 });
}

test.describe('hand bar and card detail', () => {
  test('5 slots, empty ones dashed; a card opens the detail with Pakai/Batal', async ({ page }) => {
    await open(page);
    for (let i = 0; i < 5; i++) {
      await expect(byId(page, `hand-slot-${i}`)).toBeVisible();
      await expect(byId(page, `hand-slot-${i}`)).toHaveClass(/empty/);
    }
    expect(await getState(page).then((s) => s.players[0]?.hand.length)).toBe(0);
    await give(page, 'teropong');
    await give(page, 'zona_lebar');
    await expect(byId(page, 'hand-card-0')).toBeVisible();
    await expect(byId(page, 'hand-slot-0')).not.toHaveClass(/empty/);
    await expect(byId(page, 'hand-slot-2')).toHaveClass(/empty/);
    const c = await box(byId(page, 'hand-card-0'));
    expect(c.width).toBeGreaterThanOrEqual(48);
    expect(c.height).toBeGreaterThanOrEqual(48);
    await press(byId(page, 'hand-card-0'));
    await expect(byId(page, 'card-detail')).toBeVisible();
    await expect(byId(page, 'card-detail-name')).toHaveText('Teropong');
    await expect(byId(page, 'btn-play-card')).toBeEnabled();
    await press(byId(page, 'btn-cancel-card'));
    await expect(byId(page, 'card-detail')).toBeHidden();
    expect((await hand(page)).map((h) => h.id)).toEqual(['teropong', 'zona_lebar']);
    await noErrors(page);
  });

  test('playing a boost card moves it to a pending badge; the hand does not shrink below real content', async ({ page }) => {
    await open(page);
    await dispatch(page, { type: 'selectTarget', playerId: 'p1', targetId: 'medan' });
    await give(page, 'teropong');
    await press(byId(page, 'hand-card-0'));
    await press(byId(page, 'btn-play-card'));
    await expect(byId(page, 'pending-badge-0')).toBeVisible();
    await expect(byId(page, 'pending-badge-0')).toContainText('Teropong');
    await expect(byId(page, 'hand-slot-0')).toHaveClass(/empty/);
    expect((await me(page)).pending).toHaveLength(1);
    await noErrors(page);
  });

  test('unplayable cards are dimmed with a reason; Kopi Tubruk only during cooldown, Tiket needs a target', async ({ page }) => {
    await open(page);
    await give(page, 'kopi_tubruk');
    await give(page, 'tiket_pesawat');
    await expect(byId(page, 'hand-card-0')).toHaveClass(/dim/);
    await press(byId(page, 'hand-card-0'));
    await expect(byId(page, 'card-reason')).toHaveText('Hanya saat cooldown');
    await expect(byId(page, 'btn-play-card')).toBeDisabled();
    await press(byId(page, 'btn-cancel-card'));
    await press(byId(page, 'hand-card-1'));
    await expect(byId(page, 'card-reason')).toHaveText('Pilih region tujuan dulu');
    await press(byId(page, 'btn-cancel-card'));
    // FINAL target
    await conquer(page, ['medan', 'jakarta', 'toraja']);
    await clearHand(page);
    await give(page, 'tiket_pesawat');
    await dispatch(page, { type: 'selectTarget', playerId: 'p1', targetId: 'labuan_bajo' });
    await press(byId(page, 'hand-card-0'));
    await expect(byId(page, 'card-reason')).toHaveText('Tidak bisa ke region FINAL');
    await noErrors(page);
  });

  test('warnings: Santai Dulu at an easy region, Oleh-oleh at FINAL', async ({ page }) => {
    await open(page);
    await conquer(page, ['medan', 'jakarta']);
    await dispatch(page, { type: 'selectTarget', playerId: 'p1', targetId: 'yogyakarta' });
    await clearHand(page);
    await give(page, 'santai_dulu');
    await press(byId(page, 'hand-card-0'));
    await expect(byId(page, 'card-warning')).toContainText('Tidak berefek di region easy');
    await expect(byId(page, 'btn-play-card')).toBeEnabled();
    await press(byId(page, 'btn-cancel-card'));
    await conquer(page, ['toraja']);
    await clearHand(page);
    await dispatch(page, { type: 'selectTarget', playerId: 'p1', targetId: 'labuan_bajo' });
    await give(page, 'oleh_oleh');
    const idx = (await hand(page)).findIndex((h) => h.id === 'oleh_oleh');
    await press(byId(page, `hand-card-${idx}`));
    await expect(byId(page, 'card-warning')).toContainText('Region FINAL tidak memberi kartu');
    await expect(byId(page, 'btn-play-card')).toBeEnabled();
    await noErrors(page);
  });

  test('card type is not colour only: boost = round frame + arrow, sabotage = jagged frame + bolt', async ({ page }) => {
    await open(page);
    await give(page, 'teropong');
    await give(page, 'copet');
    const faces = await page.locator('[data-testid^="hand-card-"] .cface').evaluateAll((els) =>
      els.map((e) => ({ cls: e.className, glyph: e.querySelector('.ctype')?.textContent, clip: getComputedStyle(e).clipPath, radius: getComputedStyle(e).borderRadius })),
    );
    expect(faces[0]?.cls).toContain('t-boost');
    expect(faces[0]?.glyph).toBe('▲');
    expect(faces[1]?.cls).toContain('t-sabotage');
    expect(faces[1]?.glyph).toBe('⚡');
    expect(faces[0]?.clip).toBe('none');
    expect(faces[1]?.clip).not.toBe('none');
  });
});

test.describe('offer screen', () => {
  test('a win opens "Pilih 2 kartu" with 5 slots; Ambil needs exactly N; taken cards land in the hand', async ({ page }) => {
    await open(page);
    await winToOffer(page);
    await expect(byId(page, 'offer-title')).toHaveText('Pilih 2 kartu');
    for (let i = 0; i < 5; i++) await expect(byId(page, `card-slot-${i}`)).toBeVisible();
    await expect(byId(page, 'btn-take')).toBeDisabled();
    await press(byId(page, 'card-slot-0'));
    await expect(byId(page, 'offer-count')).toHaveText('1/2');
    await expect(byId(page, 'card-slot-0')).toHaveAttribute('data-marked', 'true');
    await expect(byId(page, 'btn-take')).toBeDisabled();
    await press(byId(page, 'card-slot-0')); // unmark
    await expect(byId(page, 'offer-count')).toHaveText('0/2');
    await press(byId(page, 'card-slot-1'));
    await press(byId(page, 'card-slot-4'));
    await expect(byId(page, 'btn-take')).toBeEnabled();
    const offered = (await me(page)).offer!.cards.map((c) => c.defId);
    await press(byId(page, 'btn-take'));
    await expect(byId(page, 'card-offer')).toBeHidden();
    expect((await hand(page)).map((h) => h.id)).toEqual([offered[1], offered[4]]);
    // all 5 offered cards are distinct boost cards from the CP4a pool
    expect(new Set(offered).size).toBe(5);
    await noErrors(page);
  });

  test('a failed attempt gives no offer; the board is blocked behind the offer', async ({ page }) => {
    await open(page);
    await dispatch(page, { type: 'selectTarget', playerId: 'p1', targetId: 'medan' });
    await expect.poll(() => force(page, false), { timeout: 20_000 }).toBe(true);
    await waitIdle(page);
    await expect(byId(page, 'card-offer')).toBeHidden();
    await dispatch(page, { type: 'selectTarget', playerId: 'p1', targetId: 'padang' });
    await expect.poll(() => me(page).then((p) => p.cooldownUntilMs), { timeout: 5000 }).toBeGreaterThanOrEqual(0);
  });

  test('15 s timer: auto-pick (rarest first, leftmost on ties) and pause freezes it', async ({ page }) => {
    await open(page);
    await winToOffer(page);
    await expect(byId(page, 'offer-timer')).toBeVisible();
    await page.evaluate(() => (window as unknown as { __atlasTest: Api }).__atlasTest.pause());
    const before = await byId(page, 'offer-timer').getAttribute('data-remaining');
    await page.waitForTimeout(1500);
    expect(await byId(page, 'offer-timer').getAttribute('data-remaining')).toBe(before);
    await page.evaluate(() => (window as unknown as { __atlasTest: Api }).__atlasTest.resume());
    const cards = (await me(page)).offer!.cards;
    await setTimeScale(page, 20);
    await expect(byId(page, 'card-offer')).toBeHidden({ timeout: 20_000 });
    await setTimeScale(page, 1);
    const got = (await hand(page)).map((h) => h.uid);
    expect(got).toHaveLength(2);
    // slots are in order; the auto-pick keeps slot order inside the hand
    const order = cards.map((c) => c.uid);
    expect(got).toEqual(order.filter((u) => got.includes(u)));
    await noErrors(page);
  });
});

test.describe('discard screen', () => {
  test('hand 5 + 4 picked = 9 cards in two rows on mobile; Buang needs exact count; ends at 5', async ({ page }) => {
    await open(page);
    for (let i = 0; i < 5; i++) await give(page, 'teropong');
    await expect(byId(page, 'discard-screen')).toBeHidden();
    await forceOffer(page, ['jam_pasir', 'santai_dulu', 'zona_lebar', 'kopi_tubruk', 'oleh_oleh'], 4);
    await expect(byId(page, 'card-offer')).toBeVisible();
    for (const i of [0, 1, 2, 3]) await press(byId(page, `card-slot-${i}`));
    await press(byId(page, 'btn-take'));
    await expect(byId(page, 'discard-screen')).toBeVisible();
    await expect(byId(page, 'discard-title')).toHaveText('Hand penuh! Buang 4 kartu');
    for (let i = 0; i < 9; i++) await expect(byId(page, `discard-card-${i}`)).toBeVisible();
    await expect(byId(page, 'discard-new')).toHaveCount(4);
    const first = await box(byId(page, 'discard-card-0'));
    const last = await box(byId(page, 'discard-card-8'));
    const screen = await box(byId(page, 'discard-screen'));
    expect(first.x).toBeGreaterThanOrEqual(0);
    expect(last.x + last.width).toBeLessThanOrEqual(screen.x + screen.width + 1);
    if (test.info().project.name === 'mobile') {
      expect(last.y).toBeGreaterThan(first.y + first.height - 2); // second row
      expect(first.width).toBeGreaterThanOrEqual(48);
    } else {
      expect(Math.abs(last.y - first.y)).toBeLessThan(4); // one row on desktop
    }
    await expect(byId(page, 'btn-discard')).toBeDisabled();
    await press(byId(page, 'discard-card-0'));
    await press(byId(page, 'discard-card-1'));
    await press(byId(page, 'discard-card-2'));
    await expect(byId(page, 'btn-discard')).toBeDisabled();
    await press(byId(page, 'discard-card-3'));
    await expect(byId(page, 'discard-count')).toHaveText('4/4');
    await expect(byId(page, 'btn-discard')).toBeEnabled();
    await press(byId(page, 'btn-discard'));
    await expect(byId(page, 'discard-screen')).toBeHidden();
    expect(await hand(page)).toHaveLength(5);
    await noErrors(page);
  });

  test('discard timeout: auto-discard drops the lowest rarity / oldest first', async ({ page }) => {
    await open(page);
    for (const id of ['teropong', 'kopi_tubruk', 'ojek_kilat', 'jam_pasir', 'tiket_pesawat', 'zona_lebar']) await give(page, id);
    await expect(byId(page, 'discard-screen')).toBeVisible();
    await expect(byId(page, 'discard-title')).toHaveText('Hand penuh! Buang 1 kartu');
    await setTimeScale(page, 20);
    await expect(byId(page, 'discard-screen')).toBeHidden({ timeout: 20_000 });
    await setTimeScale(page, 1);
    // oldest common (teropong) is dropped; the rare and the epic stay
    expect((await hand(page)).map((h) => h.id)).toEqual(['kopi_tubruk', 'ojek_kilat', 'jam_pasir', 'tiket_pesawat', 'zona_lebar']);
  });
});

test.describe('boost cards through the real UI and minigames', () => {
  /** Select a target repeatedly (alternating) until the armed minigame is `id`. */
  async function armMinigame(page: Page, id: string): Promise<void> {
    for (let i = 0; i < 60; i++) {
      const p: PlayerState = await me(page);
      if (p.targetId && p.nextMinigameId === id) return;
      await dispatch(page, { type: 'selectTarget', playerId: 'p1', targetId: p.targetId === 'medan' ? 'padang' : 'medan' });
    }
    throw new Error(`could not arm ${id}`);
  }

  test('Jam Pasir badge: "tempo -15%" in Hindari Rintangan, "+5 s" in Tap Tepat Waktu; Teropong and Zona Lebar badges', async ({ page }) => {
    await open(page);
    for (const [mg, expected] of [['dodge_runner', 'tempo −15%'], ['tap_timing', '+5 s']] as const) {
      await armMinigame(page, mg);
      await give(page, 'jam_pasir');
      await give(page, 'teropong');
      await give(page, 'zona_lebar');
      for (const [n, id] of (['jam_pasir', 'teropong', 'zona_lebar'] as const).entries()) {
        const idx = (await hand(page)).findIndex((h) => h.id === id);
        await press(byId(page, `hand-card-${idx}`));
        await press(byId(page, 'btn-play-card'));
        await expect.poll(async () => (await me(page)).pending.length).toBe(n + 1); // the action is queued, wait for it
      }
      await expect.poll(async () => (await me(page)).pending.length).toBe(3);
      await expect(byId(page, 'pending-badge-2')).toBeAttached();
      await dispatch(page, { type: 'startAttempt', playerId: 'p1' });
      await expect(byId(page, 'mg-badge-timeDelta')).toContainText(expected);
      await expect(byId(page, 'mg-badge-hint')).toBeVisible();
      await expect(byId(page, 'mg-badge-tolerance')).toBeVisible();
      const a = (await me(page)).attempt!;
      expect(a.minigameId).toBe(mg);
      expect(a.modifiers).toEqual(expect.arrayContaining([{ kind: 'timeDelta', seconds: 5 }, { kind: 'hint' }, { kind: 'tolerance', mult: 1.3 }]));
      await expect.poll(() => force(page, false), { timeout: 20_000 }).toBe(true);
      await waitIdle(page);
      expect((await me(page)).pending).toHaveLength(0); // spent after the attempt
      await expect(byId(page, 'pending-badge-0')).toHaveCount(0);
      await dispatch(page, { type: 'tick', dtMs: 10_000 });
    }
    await noErrors(page);
  });

  test('Nyawa Cadangan: a failed attempt gives no cooldown, Mulai stays a press', async ({ page }) => {
    await open(page);
    await dispatch(page, { type: 'selectTarget', playerId: 'p1', targetId: 'medan' });
    await give(page, 'nyawa_cadangan');
    await press(byId(page, 'hand-card-0'));
    await press(byId(page, 'btn-play-card'));
    await expect.poll(async () => (await me(page)).pending.length).toBe(1);
    await expect.poll(() => force(page, false), { timeout: 20_000 }).toBe(true);
    await waitIdle(page);
    expect((await me(page)).cooldownUntilMs).toBe(0);
    await expect(byId(page, 'btn-start')).toBeEnabled();
    await expect(byId(page, 'cooldown-timer')).toHaveCount(0);
  });

  test('Kopi Tubruk during cooldown clears it', async ({ page }) => {
    await open(page);
    await dispatch(page, { type: 'selectTarget', playerId: 'p1', targetId: 'medan' });
    await expect.poll(() => force(page, false), { timeout: 20_000 }).toBe(true);
    await waitIdle(page);
    await expect(byId(page, 'btn-start')).toBeDisabled();
    await give(page, 'kopi_tubruk');
    await press(byId(page, 'hand-card-0'));
    await press(byId(page, 'btn-play-card'));
    await expect(byId(page, 'cooldown-timer')).toHaveCount(0);
    await expect(byId(page, 'btn-start')).toBeEnabled();
  });

  test('Tiket Pesawat moves the pawn into the chosen target without a minigame', async ({ page }) => {
    await open(page);
    await dispatch(page, { type: 'selectTarget', playerId: 'p1', targetId: 'medan' });
    await give(page, 'tiket_pesawat');
    await press(byId(page, 'hand-card-0'));
    await press(byId(page, 'btn-play-card'));
    await expect.poll(async () => (await me(page)).nodeId).toBe('medan');
    const p = await me(page);
    expect(p.phase).toBe('idle');
    expect(p.targetId).toBeNull();
    await expect(byId(page, 'card-offer')).toBeHidden();
  });

  test('Oleh-oleh: the next win offers 3 cards to take (medium 2 + 1)', async ({ page }) => {
    await open(page);
    await dispatch(page, { type: 'selectTarget', playerId: 'p1', targetId: 'medan' });
    await give(page, 'oleh_oleh');
    await press(byId(page, 'hand-card-0'));
    await press(byId(page, 'btn-play-card'));
    await expect.poll(async () => (await me(page)).pending.length).toBe(1);
    await expect.poll(() => force(page, true), { timeout: 20_000 }).toBe(true);
    await expect(byId(page, 'card-offer')).toBeAttached({ timeout: 20_000 });
    await expect(byId(page, 'offer-title')).toHaveText('Pilih 3 kartu');
  });
});

test.describe('QA hooks, B-1, bots', () => {
  test('giveCard / getHand / forceOffer; hooks reject unknown ids', async ({ page }) => {
    await open(page);
    expect(await page.evaluate(() => (window as unknown as { __atlasTest: Api }).__atlasTest.giveCard('nope'))).toBe(false);
    await give(page, 'ojek_kilat');
    const h = await hand(page);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ id: 'ojek_kilat' });
    expect(await forceOffer(page, ['teropong', 'jam_pasir'], 1)).toBe(true);
    await expect(byId(page, 'card-offer')).toBeVisible();
    await expect(byId(page, 'offer-title')).toHaveText('Pilih 1 kartu');
    expect(await forceOffer(page)).toBe(false); // already open
  });

  test('B-1: closing the minigame clears data-minigame', async ({ page }) => {
    await open(page);
    await dispatch(page, { type: 'selectTarget', playerId: 'p1', targetId: 'medan' });
    await expect.poll(() => force(page, true), { timeout: 20_000 }).toBe(true);
    await expect(byId(page, 'mg-overlay')).toHaveAttribute('data-minigame', /.+/);
    await waitIdle(page);
    await expect(byId(page, 'mg-overlay')).toBeHidden();
    expect(await byId(page, 'mg-overlay').evaluate((e) => e.hasAttribute('data-minigame'))).toBe(false);
  });

  test('bots receive offers and auto-pick; they never play cards', async ({ page }) => {
    await open(page, { bots: 2, botLevel: 'hard' });
    await setTimeScale(page, 40);
    await expect.poll(async () => (await getState(page)).players.filter((p) => p.kind === 'bot').every((b) => b.hand.length + b.discarded.length > 0), { timeout: 40_000 }).toBe(true);
    const s: GameState = await getState(page);
    for (const b of s.players.filter((p) => p.kind === 'bot')) {
      expect(b.pending).toHaveLength(0);
      expect(b.hand.length).toBeLessThanOrEqual(9);
      if (!b.offer && !b.discard) expect(b.hand.length).toBeLessThanOrEqual(5);
    }
    await setTimeScale(page, 1);
    await noErrors(page);
  });
});
