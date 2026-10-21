import type { Model, Operation } from "./types.ts";

/**
 * A memo key that keeps NaN, null, undefined, Infinity, -0 and strings apart.
 * Values inside objects and arrays go through JSON.stringify, where NaN and Infinity become null:
 * give such models their own `key`.
 */
export function stateKey(v: unknown): string {
  switch (typeof v) {
    case "number":
      return Object.is(v, -0) ? "n:-0" : `n:${String(v)}`;
    case "string":
      return `s:${v}`;
    case "bigint":
      return `b:${String(v)}`;
    case "boolean":
      return `t:${String(v)}`;
    case "undefined":
      return "u";
    default:
      return v === null ? "null" : `j:${JSON.stringify(v)}`;
  }
}

export type RegisterInput<V> = { op: "write"; value: V } | { op: "read" };

/** A single read/write register. A pending read accepts any value. */
export function register<V>(init: V): Model<V, RegisterInput<V>, V> {
  return {
    init,
    key: stateKey,
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
      history.forEach((op, i) => {
        const key: unknown = (op.input as { key?: unknown } | undefined)?.key;
        if (typeof key !== "string") throw new TypeError(`operation ${i}: kv input needs a string key (got ${String(key)})`);
        const list = byKey.get(key) ?? [];
        list.push(op);
        byKey.set(key, list);
      });
      return [...byKey.values()];
    },
  };
}
