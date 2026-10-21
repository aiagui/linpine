// A key-value store with a primary and a read cache. The buggy version refreshes the cache
// after acknowledging the write, so a later read can still see the old value.
//
//   node --experimental-strip-types examples/cache-demo.ts [seeds] [--fixed]

import { check, register, virtualClock, type Operation, type RegisterInput } from "../src/index.ts";

type Op = Operation<RegisterInput<number>, number> & { client: string; ret: number };

export async function history(seed: number, buggy: boolean): Promise<Op[]> {
  const clock = virtualClock(seed);
  const delay = (): Promise<void> => clock.sleep(Math.floor(clock.random() * 4));
  let cache = 0;
  const ops: Op[] = [];

  async function write(value: number): Promise<void> {
    await delay();
    if (buggy) void delay().then(() => { cache = value; });
    else cache = value;
    await delay();
  }
  async function read(): Promise<number> {
    await delay();
    const value = cache;
    await delay();
    return value;
  }
  async function client(name: string): Promise<void> {
    for (let i = 0; i < 5; i++) {
      const isWrite = clock.random() < 0.4;
      const value = 1 + Math.floor(clock.random() * 1000);
      const call = clock.now();
      if (isWrite) {
        await write(value);
        ops.push({ id: ops.length, client: name, call, ret: clock.now(), input: { op: "write", value } });
      } else {
        const output = await read();
        ops.push({ id: ops.length, client: name, call, ret: clock.now(), input: { op: "read" }, output });
      }
    }
  }
  await clock.run(() => Promise.all([client("A"), client("B"), client("C")]));
  return ops;
}

const color = !process.env.NO_COLOR && process.stdout.isTTY !== false;
const paint = (code: string) => (s: string): string => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const red = paint("1;31"), green = paint("1;32"), dim = paint("2"), bold = paint("1"), yellow = paint("33");

const describe = (op: Op): string =>
  `${op.client}  [${String(op.call).padStart(3)} → ${String(op.ret).padStart(3)}]  ` +
  (op.input.op === "write" ? `write(${op.input.value})` : `read() = ${String(op.output)}`);

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const seeds = Number(args.find((a) => /^\d+$/.test(a)) ?? 1000);
  const buggy = !args.includes("--fixed");
  const model = register(0);
  let failures = 0;
  let shown = false;
  for (let seed = 1; seed <= seeds; seed++) {
    const ops = await history(seed, buggy);
    const r = check(model, ops, { timeoutMs: 1000 });
    if (r.result === "ok") continue;
    failures++;
    if (shown || r.result !== "illegal") continue;
    shown = true;
    const placed = new Set(r.longest);
    const stuck = ops.filter((o) => !placed.has(o.id)).sort((a, b) => a.ret - b.ret)[0] as Op;
    console.log(`${bold(`seed ${seed}`)}  ${red("NOT LINEARIZABLE")}`);
    console.log(dim(`  longest linearizable prefix: ${r.longest.length} of ${ops.length} operations`));
    console.log(dim("  operations around the first one that cannot be placed:"));
    for (const op of ops.filter((o) => o.ret >= stuck.call - 3 && o.call <= stuck.ret).sort((a, b) => a.call - b.call)) {
      console.log(op === stuck ? red(`  ✗ ${describe(op)}   ← cannot be linearized`) : `    ${describe(op)}`);
    }
    console.log();
  }
  const pct = ((100 * failures) / seeds).toFixed(1);
  const verdict = failures ? red(`${failures}/${seeds} seeds not linearizable (${pct}%)`) : green(`0/${seeds} seeds not linearizable`);
  console.log(`${yellow(buggy ? "buggy cache" : "fixed cache")}  ${verdict}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
