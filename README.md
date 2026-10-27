<p align="center">
  <img src="https://raw.githubusercontent.com/aiagui/linpine/main/docs/logo.svg" alt="linpine" width="520">
</p>

<p align="center">
  <a href="https://github.com/aiagui/linpine/actions/workflows/ci.yml"><img src="https://github.com/aiagui/linpine/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-2f9e6e" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D22.13-2f9e6e" alt="Node >= 22.13">
</p>

linpine tells you whether a history of concurrent operations could have happened on a
correct, sequential version of your system. You record what each client called, when it
started and when it got an answer; linpine searches for an order that explains every result.
If none exists, it says so and shows how far it got.

It is a small TypeScript library with no runtime dependencies, meant for tests of caches,
locks, queues and clients of distributed stores.

## Usage

```ts
import { check, register } from "linpine";

const history = [
  { call: 0, ret: 2, input: { op: "write", value: 1 } },
  { call: 3, ret: 4, input: { op: "read" }, output: 0 }, // stale
] as const;

const r = check(register(0), history, { timeoutMs: 1000 });
// { result: "illegal", partition: 0, longest: [0], steps: 4 }
```

`result` is `"ok"`, `"illegal"` or `"unknown"` (the step or time budget ran out).
An operation without `ret` is treated as still pending. `kv()` checks each key on its own.

Requires Node.js >=22.13. The package is ESM and includes TypeScript declarations;
it has no runtime dependencies. Install it from GitHub (this builds with the package's
development dependencies):

```sh
npm install github:aiagui/linpine
```

### Try the distribution locally

This checkout prepares version 0.1.0 as the first distribution candidate.
`private: true` deliberately blocks publication while it is being validated;
the commands below only create and install local tarballs.

From a checkout:

```sh
npm ci
npm run test:package
npm pack
```

`test:package` builds and packs the library, installs the tarball offline in a temporary
project outside the checkout, compiles a strict TypeScript consumer, and runs the compiled
JavaScript and the integration example. It removes the temporary project afterwards.
Pass an output directory (`npm run test:package -- /tmp/linpine-dist`) to keep the exact
tarball that passed these checks. CI runs this check on Node 22 and 24.
The tarball contains `dist/`, the integration example,
this README, the license and package metadata; installing it does not require TypeScript.

To try the resulting tarball in your own ESM project:

```sh
npm install /absolute/path/to/linpine/linpine-0.1.0.tgz
```

### Integrate an asynchronous store

The executable example in `examples/async-store.mjs` records invocation and response times
around asynchronous calls using a single monotonic clock. It runs concurrent readers and
writers, then checks a read made after the write has returned. The tests accept a correct
store and demonstrate detection of a stale cache:

```sh
# In this checkout, after npm ci:
node --test examples/async-store.mjs

# In a project that installed the tarball:
node --test node_modules/linpine/examples/async-store.mjs
```

Copy the recording helper and the first test into your suite and replace its
`createStore()` call with your client, starting with a fresh store whose value is 0.
The second test is a deliberately broken fixture that demonstrates detection.
Keep the assertion that the result is `"ok"` for your correctness test:
`"unknown"` means the budget ran out, not that the store passed.
Rejected calls fail the example rather than being recorded as successful writes;
model error responses explicitly if your workload needs them. Use the `kv` model for
independent keys; cross-key operations need a custom model.

## Demo

A store with a read cache that is refreshed just after the write is acknowledged. Three
clients run five operations each on a seeded virtual clock, so every seed replays the same
history. In about 8% of seeds a client reads a value that was already overwritten.

<p align="center">
  <img src="https://raw.githubusercontent.com/aiagui/linpine/main/docs/demo.gif" alt="Terminal: seed 1 is not linearizable; client C reads 944 after write(104) finished" width="720">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/aiagui/linpine/main/docs/history.svg" alt="Timeline of seed 1 with the stale read highlighted" width="820">
</p>

```sh
npm run demo            # buggy cache, 1000 seeds
npm run demo -- --fixed # same seeds, no violations
```

Set `NO_COLOR=1` for plain output. The timeline is drawn from the real seed-1 history with `npm run docs:history`.

## How it works

linpine uses the search from Wing and Gong with the memoisation described by Gavin Lowe,
the same approach as [Porcupine](https://github.com/anishathalye/porcupine) (Go) and
[Knossos](https://github.com/jepsen-io/knossos) (Clojure). Calls and returns go into one
ordered list. The checker repeatedly picks an operation that could take effect now, applies
it to your model and moves on, backtracking when a result can't be explained. Visited
(set of operations, model state) pairs are cached, so the same dead end is never explored twice.

A model is three functions:

```ts
interface Model<S, I, O> {
  init: S;
  step(state: S, input: I, output: O | undefined): readonly [ok: boolean, next: S];
  key(state: S): string;                 // identifies a state for the cache
  partition?(history): Operation[][];    // optional: split into independent parts
}
```

When a return and a call share a timestamp they are treated as overlapping, as in Porcupine.
Pass `strictTies: true` to treat them as ordered.

## Limits

- Checking linearizability is NP-complete. Many concurrent writes of the same key blow up:
  18 overlapping writes followed by an impossible read take around 16 s without a budget.
  Always set `timeoutMs` or `maxSteps` in tests.
- The check runs synchronously and blocks the event loop until it finishes or hits its budget.
- Timestamps must come from one clock. For several processes, use a shared or virtual clock,
  or widen the intervals.
- `longest` lists the operations that fit in a valid order before the search got stuck. It can
  be empty, for example when the very first operation already returns an impossible value.
- linpine checks a history you give it. It does not generate workloads or inject faults.

## License

[MIT](LICENSE) © Aitor Aguilar
