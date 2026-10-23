// Compiled and executed outside the checkout, with only the packed library installed.
import {
  check, validate, register, kv, stateKey, virtualClock, prng,
  type CheckOptions, type CheckResult, type Clock, type Random,
  type Model, type Operation, type RegisterInput, type KvInput,
} from "linpine";

function expectResult(actual: CheckResult, expected: CheckResult["result"]): void {
  if (actual.result !== expected) throw new Error(`expected ${expected}, got ${actual.result}`);
}

const model: Model<number, RegisterInput<number>, number> = register(0);
const write: Operation<RegisterInput<number>, number> = { call: 0, ret: 1, input: { op: "write", value: 1 } };
const history: Operation<RegisterInput<number>, number>[] = [
  write,
  { call: 2, ret: 3, input: { op: "read" }, output: 0 },
];
const options: CheckOptions = { timeoutMs: 1000, maxSteps: 100_000 };
validate(history);
const illegal = check(model, history, options);
expectResult(illegal, "illegal");
if (illegal.result === "illegal" && (illegal.partition !== 0 || illegal.longest[0] !== 0)) {
  throw new Error("missing illegal-result diagnostics");
}
expectResult(check(model, [write], options), "ok");
expectResult(check(model, history, { maxSteps: 0 }), "unknown");
const keyed: Operation<KvInput<number>, number>[] = [
  { call: 0, ret: 1, input: { op: "write", key: "a", value: 1 } },
  { call: 2, ret: 3, input: { op: "read", key: "b" }, output: 0 },
];
expectResult(check(kv(0), keyed, options), "ok");
if (stateKey(undefined) === stateKey(null)) throw new Error("state keys collided");
const random: Random = prng(42);
const value = random();
if (value < 0 || value >= 1) throw new Error("invalid random output");
const clock: Clock = virtualClock(42);
await clock.run(() => clock.sleep(5));
if (clock.now() !== 5) throw new Error("virtual clock did not advance");
