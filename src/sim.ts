/** A small seeded virtual clock, enough to drive reproducible async tests. */

export type Random = () => number;

/** sfc32 PRNG seeded from a single integer. */
export function prng(seed: number): Random {
  let a = 0x9e3779b9, b = 0x243f6a88, c = 0xb7e15162, d = seed >>> 0;
  const next = (): number => {
    a |= 0; b |= 0; c |= 0; d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 15; i++) next();
  return next;
}

interface Timer {
  t: number;
  seq: number;
  resolve: () => void;
}

export interface Clock {
  readonly random: Random;
  now(): number;
  sleep(ms: number): Promise<void>;
  /** Runs `main` to completion, advancing virtual time whenever the microtask queue is empty. */
  run<T>(main: () => Promise<T>): Promise<T>;
}

export function virtualClock(seed: number): Clock {
  const random = prng(seed);
  const heap: Timer[] = [];
  let now = 0;
  let seq = 0;
  const less = (x: Timer, y: Timer): boolean => x.t < y.t || (x.t === y.t && x.seq < y.seq);
  const push = (x: Timer): void => {
    heap.push(x);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      const parent = heap[p] as Timer;
      if (less(parent, x)) break;
      heap[i] = parent;
      i = p;
    }
    heap[i] = x;
  };
  const pop = (): Timer => {
    const top = heap[0] as Timer;
    const last = heap.pop() as Timer;
    if (heap.length > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= heap.length) break;
        if (c + 1 < heap.length && less(heap[c + 1] as Timer, heap[c] as Timer)) c++;
        if (less(last, heap[c] as Timer)) break;
        heap[i] = heap[c] as Timer;
        i = c;
      }
      heap[i] = last;
    }
    return top;
  };
  return {
    random,
    now: () => now,
    sleep: (ms) => new Promise<void>((resolve) => push({ t: now + ms, seq: seq++, resolve })),
    async run(main) {
      let done = false;
      let value: unknown;
      let error: unknown;
      let failed = false;
      main().then(
        (v) => { done = true; value = v; },
        (e: unknown) => { done = true; failed = true; error = e; },
      );
      for (;;) {
        await new Promise<void>((r) => setImmediate(r));
        if (done) break;
        if (heap.length === 0) throw new Error("deadlock: nothing scheduled and main has not finished");
        const timer = pop();
        now = timer.t;
        timer.resolve();
      }
      if (failed) throw error;
      return value as Awaited<ReturnType<typeof main>>;
    },
  };
}
