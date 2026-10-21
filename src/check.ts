import type { CheckOptions, CheckResult, Model, Operation } from "./types.ts";

interface Node {
  t: number;
  kind: 0 | 1; // 0 = call, 1 = return
  i: number;
  prev: Node | Head;
  next: Node | null;
  match: Node | null;
}
interface Head {
  next: Node | null;
}
interface Budget {
  steps: number;
  max: number;
  deadline: number;
}

/** Throws a TypeError if the history cannot be checked. */
export function validate(history: readonly Operation[]): void {
  if (!Array.isArray(history)) throw new TypeError("history must be an array");
  const seen = new Set<unknown>();
  history.forEach((op, i) => {
    if (op === null || typeof op !== "object") throw new TypeError(`operation ${i}: not an object`);
    if (!Number.isFinite(op.call)) throw new TypeError(`operation ${i}: invalid call time (${String(op.call)})`);
    if (op.ret !== undefined && op.ret !== Infinity && !Number.isFinite(op.ret))
      throw new TypeError(`operation ${i}: invalid return time (${String(op.ret)})`);
    if (op.ret !== undefined && op.ret < op.call) throw new TypeError(`operation ${i}: returns before it is called`);
    const id = op.id ?? i;
    if (seen.has(id)) throw new TypeError(`operation ${i}: duplicate id (${String(id)})`);
    seen.add(id);
  });
}

function checkPartition<S, I, O>(
  model: Model<S, I, O>,
  ops: readonly (Operation<I, O> & { id: unknown })[],
  strictTies: boolean,
  budget: Budget,
): { result: "ok" | "illegal" | "unknown"; steps: number; longest: unknown[] } {
  const n = ops.length;
  const words = (n + 31) >>> 5;
  const head: Head = { next: null };
  const nodes: Node[] = [];
  ops.forEach((op, i) => {
    nodes.push({ t: op.call, kind: 0, i, prev: head, next: null, match: null });
    nodes.push({ t: op.ret ?? Infinity, kind: 1, i, prev: head, next: null, match: null });
  });
  // Order within one instant t.
  // Default (closed intervals, like Porcupine): calls, then returns, so everything at t overlaps.
  // strictTies: returns of operations called before t, then calls, then returns of operations
  // called at t. A zero-duration operation still has its call before its return.
  const rank = (x: Node): number => {
    if (x.kind === 0) return strictTies ? 1 : 0;
    if (!strictTies) return 1;
    return (ops[x.i] as Operation).call < x.t ? 0 : 2;
  };
  nodes.sort((a, b) => a.t - b.t || rank(a) - rank(b));
  let prev: Node | Head = head;
  const calls: Node[] = new Array<Node>(n);
  for (const node of nodes) {
    prev.next = node;
    node.prev = prev;
    prev = node;
    if (node.kind === 0) calls[node.i] = node;
    else (calls[node.i] as Node).match = node;
  }

  const lift = (c: Node): void => {
    c.prev.next = c.next;
    if (c.next) c.next.prev = c.prev;
    const r = c.match as Node;
    r.prev.next = r.next;
    if (r.next) r.next.prev = r.prev;
  };
  const unlift = (c: Node): void => {
    const r = c.match as Node;
    r.prev.next = r;
    if (r.next) r.next.prev = r;
    c.prev.next = c;
    if (c.next) c.next.prev = c;
  };

  // Linearized set as a bitset, with an incremental XOR hash so the cache key is O(1) to update.
  const bits = new Uint32Array(words);
  const zobrist = new Uint32Array(n);
  let z = 0x9e3779b9;
  for (let i = 0; i < n; i++) {
    z ^= z << 13;
    z ^= z >>> 17;
    z ^= z << 5;
    zobrist[i] = z >>> 0;
  }
  let hash = 0;
  const flip = (i: number): void => {
    bits[i >>> 5] = (bits[i >>> 5] as number) ^ (1 << (i & 31));
    hash ^= zobrist[i] as number;
  };
  const cache = new Map<string, Uint32Array[]>();
  const seenBefore = (stateKey: string): boolean => {
    const k = `${hash}|${stateKey}`;
    let list = cache.get(k);
    if (list) {
      for (const b of list) {
        let equal = true;
        for (let w = 0; w < words; w++)
          if (b[w] !== bits[w]) {
            equal = false;
            break;
          }
        if (equal) return true;
      }
    } else {
      list = [];
      cache.set(k, list);
    }
    list.push(bits.slice());
    return false;
  };

  const stack: [Node, S][] = [];
  let state = model.init;
  let steps = 0;
  let longest: unknown[] = [];
  let e: Node | null = head.next;
  while (head.next) {
    steps++;
    if (++budget.steps > budget.max || ((steps & 1023) === 0 && performance.now() > budget.deadline))
      return { result: "unknown", steps, longest };
    if (!e) throw new Error("internal: ran past the end of the history");
    if (e.kind === 0) {
      const op = ops[e.i] as Operation<I, O>;
      const pending = op.ret === undefined || op.ret === Infinity;
      const [ok, next] = model.step(state, op.input, pending ? undefined : op.output);
      if (ok) {
        const before = state;
        state = next;
        flip(e.i);
        if (!seenBefore(model.key(state))) {
          stack.push([e, before]);
          if (stack.length > longest.length) longest = stack.map(([c]) => (ops[c.i] as { id: unknown }).id);
          lift(e);
          e = head.next;
          continue;
        }
        flip(e.i);
        state = before;
      }
      e = e.next;
    } else {
      const top = stack.pop();
      if (!top) return { result: "illegal", steps, longest };
      const [c, before] = top;
      state = before;
      flip(c.i);
      unlift(c);
      e = c.next;
    }
  }
  return { result: "ok", steps, longest };
}

/**
 * Checks whether a concurrent history is linearizable with respect to a sequential model.
 * Uses the Wing–Gong search with Lowe's memoisation, as in Porcupine.
 */
function validateOptions(options: CheckOptions): void {
  for (const name of ["maxSteps", "timeoutMs"] as const) {
    const v = options[name];
    if (v === undefined) continue;
    if (typeof v !== "number" || Number.isNaN(v) || v < 0)
      throw new TypeError(`${name} must be a number >= 0 (got ${String(v)})`);
  }
}

export function check<S, I, O>(
  model: Model<S, I, O>,
  history: readonly Operation<I, O>[],
  options: CheckOptions = {},
): CheckResult {
  validateOptions(options);
  validate(history);
  const ops = history.map((op, i) => ({ ...op, id: op.id ?? i }));
  const parts = model.partition ? model.partition(ops) : [ops];
  const budget: Budget = {
    steps: 0,
    max: options.maxSteps ?? Infinity,
    deadline: performance.now() + (options.timeoutMs ?? Infinity),
  };
  // Every partition is checked, so an "illegal" one is reported even if an earlier one ran out
  // of budget. maxSteps applies to each partition; timeoutMs is one deadline for the whole call.
  let steps = 0;
  let unknown = false;
  for (let p = 0; p < parts.length; p++) {
    const part = (parts[p] ?? []) as (Operation<I, O> & { id: unknown })[];
    budget.steps = 0;
    const r = checkPartition(model, part, options.strictTies ?? false, budget);
    steps += r.steps;
    if (r.result === "illegal") return { result: "illegal", steps, partition: p, longest: r.longest };
    if (r.result === "unknown") unknown = true;
  }
  if (unknown) return { result: "unknown", steps };
  return { result: "ok", steps };
}
