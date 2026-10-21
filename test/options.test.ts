import { describe, expect, it } from "vitest";
import { check, kv, register, stateKey, type Operation, type RegisterInput } from "../src/index.ts";

type Op = Operation<RegisterInput<number>, number>;
const reg = register(0);
const w = (call: number, ret: number, value: number): Op => ({ call, ret, input: { op: "write", value } });
const r = (call: number, ret: number, output: number): Op => ({ call, ret, input: { op: "read" }, output });

describe("zero-duration operations", () => {
  it("work in both modes", () => {
    for (const strictTies of [false, true]) {
      expect(check(reg, [w(1, 1, 1)], { strictTies }).result).toBe("ok");
      expect(check(reg, [w(1, 1, 1), r(2, 3, 1)], { strictTies }).result).toBe("ok");
      expect(check(reg, [w(1, 1, 1), r(2, 3, 0)], { strictTies }).result).toBe("illegal");
      // two zero-duration ops at the same instant overlap each other
      expect(check(reg, [w(1, 1, 1), r(1, 1, 0)], { strictTies }).result).toBe("ok");
    }
  });
  it("strict mode orders a write that ends at t before a read that starts at t", () => {
    expect(check(reg, [w(0, 1, 1), r(1, 1, 0)]).result).toBe("ok");
    expect(check(reg, [w(0, 1, 1), r(1, 1, 0)], { strictTies: true }).result).toBe("illegal");
  });
});

describe("options", () => {
  it("rejects invalid budgets", () => {
    for (const bad of [NaN, -1, -Infinity]) {
      expect(() => check(reg, [], { maxSteps: bad })).toThrow(TypeError);
      expect(() => check(reg, [], { timeoutMs: bad })).toThrow(TypeError);
    }
    expect(() => check(reg, [], { maxSteps: "5" as unknown as number })).toThrow(TypeError);
    expect(check(reg, [], { maxSteps: 0, timeoutMs: Infinity }).result).toBe("ok");
  });
});

describe("models", () => {
  it("keeps NaN, null, undefined and Infinity apart in the memo key", () => {
    const keys = [NaN, null, undefined, Infinity, -Infinity, 0, -0, "0", "null"].map(stateKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("kv rejects an operation without a key", () => {
    expect(() =>
      check(kv(0), [{ call: 0, ret: 1, input: { op: "write", value: 1 } as never }]),
    ).toThrow(/string key/);
  });
  it("reports an illegal partition after one that ran out of budget", () => {
    const hard = Array.from({ length: 12 }, (_, i) => ({ call: 0, ret: 10, input: { op: "write" as const, key: "a", value: i + 1 } }));
    const h = [
      ...hard,
      { call: 20, ret: 21, input: { op: "read" as const, key: "a" }, output: 999 },
      { call: 0, ret: 1, input: { op: "write" as const, key: "b", value: 1 } },
      { call: 2, ret: 3, input: { op: "read" as const, key: "b" }, output: 0 },
    ];
    expect(check(kv(0), h.slice(0, 13), { maxSteps: 50 }).result).toBe("unknown");
    expect(check(kv(0), h, { maxSteps: 50 })).toMatchObject({ result: "illegal", partition: 1 });
  });
  it("reports a longest prefix with several operations", () => {
    const res = check(reg, [w(0, 1, 1), r(2, 3, 1), w(4, 5, 2), r(6, 7, 1)]);
    expect(res).toMatchObject({ result: "illegal", longest: [0, 1, 2] });
  });
});

describe("stateKey inside objects", () => {
  it("handles bigints and keeps NaN, Infinity and null apart", () => {
    expect(() => stateKey({ n: 1n, list: [2n] })).not.toThrow();
    const keys = [{ v: NaN }, { v: null }, { v: Infinity }, { v: -Infinity }, { v: undefined }, { v: "x" }, [NaN], [null], { v: 1n }, { v: 1 }].map(stateKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("is stable for equal values and distinguishes strings that look alike", () => {
    expect(stateKey({ a: [1, { b: 2n }] })).toBe(stateKey({ a: [1, { b: 2n }] }));
    expect(stateKey(["a,b"])).not.toBe(stateKey(["a", "b"]));
  });
});
