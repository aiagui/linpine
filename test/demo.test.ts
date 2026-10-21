import { describe, expect, it } from "vitest";
import { check, register } from "../src/index.ts";
import { history } from "../examples/cache-demo.ts";

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
