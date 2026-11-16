import { describe, expect, it } from 'vitest';
import { Rng, hashSeed } from '../src/logic/rng';

const draw = (r: Rng, n: number): number[] => Array.from({ length: n }, () => r.nextUint32());

describe('Rng', () => {
  it('same seed gives the same sequence', () => {
    expect(draw(new Rng(42), 1000)).toEqual(draw(new Rng(42), 1000));
  });

  it('string seeds are deterministic and equal to their hash', () => {
    expect(draw(new Rng('ROOM-ABCD'), 50)).toEqual(draw(new Rng(hashSeed('ROOM-ABCD')), 50));
  });

  it('different seeds diverge', () => {
    expect(draw(new Rng(1), 20)).not.toEqual(draw(new Rng(2), 20));
  });

  it('getState/setState reproduces the remaining sequence', () => {
    const a = new Rng(7);
    draw(a, 123);
    const saved = a.getState();
    const expected = draw(a, 100);
    expect(draw(Rng.fromState(saved), 100)).toEqual(expected);
  });

  it('next() stays in [0,1) and int() in its inclusive range, covering every value', () => {
    const r = new Rng(99);
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) {
      const f = r.next();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      const n = r.int(-2, 3);
      expect(n).toBeGreaterThanOrEqual(-2);
      expect(n).toBeLessThanOrEqual(3);
      seen.add(n);
    }
    expect([...seen].sort((x, y) => x - y)).toEqual([-2, -1, 0, 1, 2, 3]);
  });

  it('int() is roughly uniform', () => {
    const r = new Rng(2024);
    const counts = [0, 0, 0, 0];
    const n = 40_000;
    for (let i = 0; i < n; i++) counts[r.int(0, 3)]!++;
    for (const c of counts) expect(Math.abs(c / n - 0.25)).toBeLessThan(0.02);
  });

  it('shuffle is a deterministic permutation and leaves the input untouched', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const a = new Rng(5).shuffle(input);
    expect(a).toEqual(new Rng(5).shuffle(input));
    expect([...a].sort((x, y) => x - y)).toEqual(input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('fork() is deterministic and label-dependent', () => {
    expect(draw(new Rng(3).fork('bot:1'), 10)).toEqual(draw(new Rng(3).fork('bot:1'), 10));
    expect(draw(new Rng(3).fork('bot:1'), 10)).not.toEqual(draw(new Rng(3).fork('bot:2'), 10));
  });

  it('rejects invalid ranges and empty picks', () => {
    const r = new Rng(1);
    expect(() => r.int(5, 1)).toThrow(RangeError);
    expect(() => r.pick([])).toThrow(RangeError);
  });
});
