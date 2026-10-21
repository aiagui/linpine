import { describe, expect, it } from "vitest";
import { check, register } from "../src/index.ts";
import { firstUnplaced, history } from "../examples/cache-demo.ts";

describe("cache demo", () => {
  it("is reproducible for a given seed", async () => {
    expect(JSON.stringify(await history(42, true))).toBe(JSON.stringify(await history(42, true)));
  });
  it("finds violations only in the buggy version", async () => {
    let buggy = 0, fixed = 0;
    for (let s = 1; s <= 200; s++) {
      if (check(register(0), await history(s, true)).result !== "ok") buggy++;
      if (check(register(0), await history(s, false)).result !== "ok") fixed++;
    }
    expect(buggy).toBeGreaterThan(0);
    expect(fixed).toBe(0);
  });
});

describe("cache demo, seed 1", () => {
  it("only reads values that were written (or the initial 0)", async () => {
    const ops = await history(1, true);
    const written = new Set<number>([0]);
    for (const o of ops) if (o.input.op === "write") written.add(o.input.value);
    for (const o of ops) if (o.input.op === "read") expect(written.has(o.output as number)).toBe(true);
  });
  it("is caught at C's stale read of 944, which starts after write(104) returned", async () => {
    const ops = await history(1, true);
    const r = check(register(0), ops);
    expect(r.result).toBe("illegal");
    if (r.result !== "illegal") return;
    const stuck = firstUnplaced(ops, r.longest);
    expect(stuck).toMatchObject({ client: "C", call: 7, ret: 8, output: 944 });
    const w104 = ops.find((o) => o.input.op === "write" && o.input.value === 104);
    expect(w104?.ret).toBeLessThan(stuck.call);
  });
});
