// Compares the checker with a brute-force search over all orders on small random histories.
import { describe, expect, it } from "vitest";
import { check, prng, register, type Operation, type RegisterInput } from "../src/index.ts";

type Op = Operation<RegisterInput<number>, number>;

/** a must take effect before b. Mirrors the event order documented in check.ts. */
function precedes(a: Op, b: Op, strict: boolean): boolean {
  const ret = a.ret ?? Infinity;
  if (ret < b.call) return true;
  return strict && ret === b.call && a.call < ret;
}

function bruteForce(ops: Op[], strict: boolean): boolean {
  const used = new Array<boolean>(ops.length).fill(false);
  const go = (state: number, placed: number): boolean => {
    if (placed === ops.length) return true;
    for (let i = 0; i < ops.length; i++) {
      if (used[i]) continue;
      const op = ops[i] as Op;
      // every unplaced op that must come before this one blocks it
      if (ops.some((o, j) => !used[j] && j !== i && precedes(o, op, strict))) continue;
      const pending = op.ret === undefined;
      let next = state;
      if (op.input.op === "write") next = op.input.value;
      else if (!pending && op.output !== state) continue;
      used[i] = true;
      if (go(next, placed + 1)) return true;
      used[i] = false;
    }
    return false;
  };
  return go(0, 0);
}

function randomHistory(rnd: () => number): Op[] {
  const n = 1 + Math.floor(rnd() * 6);
  return Array.from({ length: n }, (): Op => {
    const call = Math.floor(rnd() * 6);
    const roll = rnd();
    const ret = roll < 0.15 ? undefined : roll < 0.3 ? call : call + Math.floor(rnd() * 4);
    const base = ret === undefined ? { call } : { call, ret };
    return rnd() < 0.5
      ? { ...base, input: { op: "write", value: 1 + Math.floor(rnd() * 3) } }
      : { ...base, input: { op: "read" }, output: Math.floor(rnd() * 4) };
  });
}

describe("differential test against brute force", () => {
  for (const strictTies of [false, true]) {
    it(`agrees on 5000 random histories (strictTies: ${strictTies})`, () => {
      const rnd = prng(strictTies ? 2 : 1);
      let illegal = 0;
      for (let k = 0; k < 5000; k++) {
        const ops = randomHistory(rnd);
        const expected = bruteForce(ops, strictTies);
        const got = check(register(0), ops, { strictTies }).result;
        if (got !== (expected ? "ok" : "illegal")) throw new Error(`mismatch on ${JSON.stringify(ops)}: got ${got}`);
        if (!expected) illegal++;
      }
      // the generator must produce both outcomes for the test to mean anything
      expect(illegal).toBeGreaterThan(500);
      expect(illegal).toBeLessThan(4500);
    });
  }
});
