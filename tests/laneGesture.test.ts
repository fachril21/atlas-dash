import { describe, expect, it } from 'vitest';
import { LaneGesture } from '../src/ui/minigames/laneGesture';

const mk = () => new LaneGesture(() => 200); // play area 400 wide, split at x = 200

describe('LaneGesture (one gesture = one move)', () => {
  it('quick tap on the left / right half', () => {
    const g = mk();
    g.down(1, 50, 300, 1000);
    expect(g.up(1, 50, 300, 1040)).toEqual({ dir: -1, t: 1040 });
    g.down(1, 350, 300, 2000);
    expect(g.up(1, 351, 300, 2050)).toEqual({ dir: 1, t: 2050 });
  });

  it('swipe decides at 24 px horizontal travel, in the swipe direction, regardless of the half', () => {
    const g = mk();
    g.down(1, 350, 300, 1000);
    expect(g.move(1, 340, 300, 1010)).toBeNull(); // 10 px
    expect(g.move(1, 326, 302, 1020)).toEqual({ dir: -1, t: 1020 }); // 24 px left, even from the right half
    expect(g.move(1, 200, 300, 1030)).toBeNull(); // no second move in the same gesture
    expect(g.up(1, 200, 300, 1040)).toBeNull();
    g.down(1, 10, 300, 2000);
    expect(g.move(1, 34, 300, 2010)).toEqual({ dir: 1, t: 2010 });
  });

  it('needs |dx| > |dy|: a vertical drag moves nothing and consumes the gesture', () => {
    const g = mk();
    g.down(1, 100, 300, 1000);
    expect(g.move(1, 130, 360, 1010)).toBeNull(); // 30 px right, 60 down
    expect(g.move(1, 200, 360, 1020)).toBeNull();
    expect(g.up(1, 200, 360, 1030)).toBeNull();
  });

  it('holding 100 ms without moving is a tap decided at press + 100 ms', () => {
    const g = mk();
    g.down(1, 120, 300, 1000);
    expect(g.tick(1099)).toBeNull();
    expect(g.tick(1100)).toEqual({ dir: -1, t: 1100 });
    expect(g.tick(1200)).toBeNull(); // decided once
    expect(g.up(1, 120, 300, 1300)).toBeNull(); // pointerup after the decision adds nothing
  });

  it('a late pointerup without tick still gives one tap at press + 100 ms', () => {
    const g = mk();
    g.down(1, 300, 300, 1000);
    expect(g.up(1, 300, 300, 1500)).toEqual({ dir: 1, t: 1100 });
  });

  it('a second finger is not a second gesture; other pointers are ignored', () => {
    const g = mk();
    g.down(1, 100, 300, 1000);
    g.down(2, 300, 300, 1010);
    expect(g.up(2, 300, 300, 1020)).toBeNull();
    expect(g.up(1, 100, 300, 1030)).toEqual({ dir: -1, t: 1030 });
  });

  it('cancel drops the gesture', () => {
    const g = mk();
    g.down(1, 100, 300, 1000);
    g.cancel();
    expect(g.up(1, 100, 300, 1020)).toBeNull();
    expect(g.tick(5000)).toBeNull();
  });
});
