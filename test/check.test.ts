import { describe, expect, it } from "vitest";
import { check, kv, register, type Operation, type RegisterInput } from "../src/index.ts";

type Op = Operation<RegisterInput<number>, number>;
const W = (call: number, ret: number | undefined, value: number, id?: unknown): Op =>
  ret === undefined ? { id, call, input: { op: "write", value } } : { id, call, ret, input: { op: "write", value } };
const R = (call: number, ret: number, output: number, id?: unknown): Op => ({ id, call, ret, input: { op: "read" }, output });
const reg = register(0);

describe("check", () => {
  it("rejects a stale read after an acknowledged write", () => {
    expect(check(reg, [W(0, 1, 1), R(2, 3, 0)]).result).toBe("illegal");
  });
  it("accepts a read that overlaps the write", () => {
    expect(check(reg, [W(0, 3, 1), R(1, 2, 0)]).result).toBe("ok");
  });
  it("treats a missing return as pending (+Infinity)", () => {
    // Before validation, ret: undefined sorted as NaN and this illegal history passed.
    expect(check(reg, [W(0, 1, 1), R(2, 3, 0), W(4, undefined, 5)]).result).toBe("illegal");
    expect(check(reg, [W(0, undefined, 1), R(2, 3, 1)]).result).toBe("ok");
    expect(check(reg, [W(0, Infinity, 1), R(2, 3, 1)]).result).toBe("ok");
  });
  it("rejects invalid input", () => {
    expect(() => check(reg, [{ call: NaN, ret: 1, input: { op: "read" }, output: 0 }])).toThrow(TypeError);
    expect(() => check(reg, [{ call: 0, ret: NaN, input: { op: "read" }, output: 0 }])).toThrow(TypeError);
    expect(() => check(reg, [W(5, 1, 1)])).toThrow(TypeError);
    expect(() => check(reg, [W(0, 1, 1, "a"), W(2, 3, 2, "a")])).toThrow(TypeError);
  });
  it("accepts arbitrary ids and reports the longest prefix", () => {
    const r = check(reg, [W(0, 1, 1, "x9"), R(2, 3, 0, { n: 5 })]);
    expect(r).toMatchObject({ result: "illegal", longest: ["x9"] });
  });
  it("treats equal timestamps as overlapping by default, like Porcupine", () => {
    const h = [W(0, 1, 1), R(1, 2, 0)];
    expect(check(reg, h).result).toBe("ok");
    expect(check(reg, h, { strictTies: true }).result).toBe("illegal");
  });
  it("returns unknown when the budget runs out", () => {
    const h: Op[] = Array.from({ length: 16 }, (_, i) => W(0, 10, i + 1));
    h.push(R(20, 21, 999));
    expect(check(reg, h, { maxSteps: 1000 }).result).toBe("unknown");
    expect(check(reg, h, { timeoutMs: 0 }).result).toBe("unknown");
  });
  it("checks each key of a kv history independently", () => {
    const m = kv(0);
    const r = check(m, [
      { call: 0, ret: 1, input: { op: "write", key: "a", value: 1 } },
      { call: 2, ret: 3, input: { op: "read", key: "b" }, output: 0 },
      { call: 4, ret: 5, input: { op: "read", key: "a" }, output: 0 },
    ]);
    expect(r).toMatchObject({ result: "illegal", partition: 0 });
    expect(check(m, [
      { call: 0, ret: 1, input: { op: "write", key: "a", value: 1 } },
      { call: 2, ret: 3, input: { op: "read", key: "b" }, output: 0 },
    ]).result).toBe("ok");
  });
});
