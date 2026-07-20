// Deterministic seeded PRNG (mulberry32).
// Every composition is fully defined by (seed, macros) — the same pair always
// produces the identical score, which is what lets the offline export renderer
// reproduce exactly what the user heard live.

export class RNG {
  constructor(seed) {
    this.s = seed >>> 0;
  }

  /** float in [0, 1) */
  next() {
    this.s = (this.s + 0x6D2B79F5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** float in [a, b) */
  range(a, b) { return a + this.next() * (b - a); }

  /** integer in [a, b] inclusive */
  int(a, b) { return a + Math.floor(this.next() * (b - a + 1)); }

  /** true with probability p */
  chance(p) { return this.next() < p; }

  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }

  /** pick from [value, weight] pairs */
  weighted(pairs) {
    let total = 0;
    for (const [, w] of pairs) total += w;
    let r = this.next() * total;
    for (const [v, w] of pairs) {
      r -= w;
      if (r <= 0) return v;
    }
    return pairs[pairs.length - 1][0];
  }

  shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /** spawn an independent stream (e.g. one per track role) */
  fork() { return new RNG(Math.floor(this.next() * 0xFFFFFFFF)); }
}

export function randomSeed() {
  return Math.floor(Math.random() * 0xFFFFFFFF) >>> 0;
}
