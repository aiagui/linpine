import type { Model, Operation } from "./types.ts";

export type RegisterInput<V> = { op: "write"; value: V } | { op: "read" };

/** A single read/write register. A pending read accepts any value. */
export function register<V>(init: V): Model<V, RegisterInput<V>, V> {
  return {
    init,
    key: (s) => JSON.stringify(s),
    step: (s, input, output) =>
      input.op === "write" ? [true, input.value] : [output === undefined || Object.is(output, s), s],
  };
}

export type KvInput<V> = { op: "write"; key: string; value: V } | { op: "read"; key: string };

/** A key-value store where each key is an independent register, checked separately. */
export function kv<V>(init: V): Model<V, KvInput<V>, V> {
  const reg = register(init);
  return {
    init,
    key: reg.key,
    step: (s, input, output) =>
      reg.step(s, input.op === "write" ? { op: "write", value: input.value } : { op: "read" }, output),
    partition: (history) => {
      const byKey = new Map<string, Operation<KvInput<V>, V>[]>();
      for (const op of history) {
        const list = byKey.get(op.input.key) ?? [];
        list.push(op);
        byKey.set(op.input.key, list);
      }
      return [...byKey.values()];
    },
  };
}
