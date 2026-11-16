/**
 * Seeded pseudo-random number generator (sfc32), pure TypeScript.
 *
 * All game randomness (minigame parameters, card offers, bot choices) must come from an
 * Rng instance so a run can be reproduced from its seed in tests and, later, on a server.
 * The state is four 32-bit integers and can be saved/restored with getState/setState.
 */

export type RngState = readonly [number, number, number, number];

/** Hash an arbitrary string (e.g. a room code) into a 32-bit seed (FNV-1a). */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** splitmix32: expands one 32-bit seed into well-mixed state words. */
function splitmix32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
}

export class Rng {
  private a = 0;
  private b = 0;
  private c = 0;
  private d = 0;

  constructor(seed: number | string) {
    const n = typeof seed === 'string' ? hashSeed(seed) : seed;
    const mix = splitmix32(n);
    this.a = mix();
    this.b = mix();
    this.c = mix();
    this.d = mix();
    // Discard a few outputs so similar seeds diverge quickly.
    for (let i = 0; i < 12; i++) this.nextUint32();
  }

  /** Next unsigned 32-bit integer. */
  nextUint32(): number {
    const t = (((this.a + this.b) >>> 0) + this.d) >>> 0;
    this.d = (this.d + 1) >>> 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) >>> 0;
    this.c = ((this.c << 21) | (this.c >>> 11)) >>> 0;
    this.c = (this.c + t) >>> 0;
    return t;
  }

  /** Float in [0, 1). */
  next(): number {
    return this.nextUint32() / 4294967296;
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
      throw new RangeError(`Rng.int: invalid range [${min}, ${max}]`);
    }
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Uniformly pick one element. Throws on an empty array. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('Rng.pick: empty array');
    return items[this.int(0, items.length - 1)] as T;
  }

  /** Fisher-Yates shuffle into a new array (input untouched). */
  shuffle<T>(items: readonly T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      const tmp = out[i] as T;
      out[i] = out[j] as T;
      out[j] = tmp;
    }
    return out;
  }

  /** Derive an independent child stream (e.g. one per player or per minigame). */
  fork(label: string): Rng {
    return new Rng((this.nextUint32() ^ hashSeed(label)) >>> 0);
  }

  getState(): RngState {
    return [this.a, this.b, this.c, this.d];
  }

  setState(state: RngState): void {
    [this.a, this.b, this.c, this.d] = state;
  }

  static fromState(state: RngState): Rng {
    const r = new Rng(0);
    r.setState(state);
    return r;
  }
}

/**
 * Named RNG streams (DR-04, minigames.md §1.2.1): every stream is seeded with
 * hash(matchSeed, playerId, label), so one player's actions never shift another player's
 * results. Labels: "minigamePick", "minigameParams:<targetId>:<attemptIndex>", "cards",
 * "bot", "copet".
 */
export function streamSeed(matchSeed: number, playerId: string, label: string): number {
  // FNV-1a over a canonical string, then one splitmix round for avalanche.
  const h = hashSeed(`${matchSeed >>> 0}|${playerId}|${label}`);
  return splitmix32(h)();
}

export function createStream(matchSeed: number, playerId: string, label: string): Rng {
  return new Rng(streamSeed(matchSeed, playerId, label));
}
