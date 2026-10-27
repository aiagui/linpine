// Run with: node --test examples/async-store.mjs
// Adapt capture() and the first test to your asynchronous store client. All clients
// must use the same clock, and the store must start at the model's initial value (0).
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { test } from "node:test";
import { check, register } from "linpine";

function createStore(staleCache = false) {
  let value = 0;
  let cached = 0;
  return {
    async write(next) {
      value = next;
      if (!staleCache) cached = value;
    },
    async read() {
      return cached;
    },
  };
}

async function capture(store) {
  const history = [];
  async function record(id, input, invoke) {
    const call = performance.now();
    // A rejected operation propagates to the test: it is not silently recorded as
    // a successful response. Define error semantics in a custom model if needed.
    const output = await invoke();
    history.push({ id, call, ret: performance.now(), input, output });
  }

  await Promise.all([
    record("writer", { op: "write", value: 42 }, () => store.write(42)),
    record("concurrent-reader", { op: "read" }, () => store.read()),
  ]);
  await record("read-after-write", { op: "read" }, () => store.read());
  return history;
}

test("an asynchronous store explains every observed result", async () => {
  const history = await capture(createStore());
  const result = check(register(0), history, { timeoutMs: 1000, maxSteps: 100_000 });
  // An exhausted budget (unknown) must also fail a correctness test.
  assert.equal(result.result, "ok", JSON.stringify({ result, history }));
});

test("a stale read after an acknowledged write is detected", async () => {
  const history = await capture(createStore(true));
  const result = check(register(0), history, { timeoutMs: 1000, maxSteps: 100_000 });
  assert.equal(result.result, "illegal", JSON.stringify({ result, history }));
});
