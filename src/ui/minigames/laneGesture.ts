/**
 * Gesture recogniser for Hindari Rintangan (minigames.md §4 input). Pure (no DOM), so it is
 * unit-tested. One gesture = exactly one decision, taken at whichever comes first:
 *   - horizontal travel >= SWIPE_MIN_PX with |dx| > |dy|  -> swipe, that direction
 *   - pointerup                                          -> tap, left/right half
 *   - TAP_HOLD_MS held without a swipe                   -> tap, left/right half
 * Vertical drags decide "nothing" (and still consume the gesture). The decision time is the
 * timestamp of the deciding event (for the hold case: press time + TAP_HOLD_MS).
 */
import { SWIPE_MIN_PX, TAP_HOLD_MS } from '../../logic';

export interface LaneDecision {
  dir: -1 | 1;
  /** Event-clock time (ms) of the decision. */
  t: number;
}

interface Press {
  id: number;
  x0: number;
  y0: number;
  t0: number;
  /** Decision already taken (or discarded): ignore the rest of this gesture. */
  done: boolean;
}

export class LaneGesture {
  private press: Press | null = null;

  /** `width` = play area width in px; `halfX` = the x of the left/right split. */
  constructor(private readonly halfX: () => number) {}

  down(id: number, x: number, y: number, t: number): void {
    if (this.press && !this.press.done) return; // a second finger is not a second gesture
    this.press = { id, x0: x, y0: y, t0: t, done: false };
  }

  move(id: number, x: number, y: number, t: number): LaneDecision | null {
    const p = this.press;
    if (!p || p.id !== id || p.done) return null;
    const hold = this.tick(t);
    if (hold) return hold;
    const dx = x - p.x0;
    const dy = y - p.y0;
    if (Math.abs(dx) >= SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy)) {
      p.done = true;
      return { dir: dx > 0 ? 1 : -1, t };
    }
    if (Math.hypot(dx, dy) >= SWIPE_MIN_PX) p.done = true; // vertical drag: no move
    return null;
  }

  up(id: number, x: number, _y: number, t: number): LaneDecision | null {
    const p = this.press;
    if (!p || p.id !== id) return null;
    this.press = null;
    if (p.done) return null;
    const hold = t - p.t0 >= TAP_HOLD_MS;
    return { dir: x < this.halfX() ? -1 : 1, t: hold ? p.t0 + TAP_HOLD_MS : t };
  }

  cancel(): void {
    this.press = null;
  }

  /** Call every frame with the current event-clock time: decides the 100 ms hold tap. */
  tick(now: number): LaneDecision | null {
    const p = this.press;
    if (!p || p.done || now - p.t0 < TAP_HOLD_MS) return null;
    p.done = true;
    return { dir: p.x0 < this.halfX() ? -1 : 1, t: p.t0 + TAP_HOLD_MS };
  }
}
