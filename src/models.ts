import type { Model, Operation } from "./types.ts";

/**
 * A memo key that keeps NaN, null, undefined, Infinity, -0, bigints and strings apart.
 * It recurses into arrays and plain objects (keys in insertion order) and keys a Date by its
 * time. Anything else (Map, Set, class instances, functions, symbols, symbol-keyed properties,
 * cycles) throws a TypeError: give such models their own `key`.
 */
export function stateKey(v: unknown): string {
  return encode(v, new WeakSet<object>());
}

const unsupported = (what: string): TypeError =>
  new TypeError(`stateKey: cannot key ${what}; give the model its own key(state)`);

function encode(v: unknown, path: WeakSet<object>): string {
  switch (typeof v) {
    case "number":
      return Object.is(v, -0) ? "n:-0" : `n:${String(v)}`;
    case "string":
      return `s:${JSON.stringify(v)}`;
    case "bigint":
      return `b:${String(v)}`;
    case "boolean":
      return `t:${String(v)}`;
    case "undefined":
      return "u";
    case "object": {
      if (v === null) return "null";
      if (v instanceof Date) return Number.isNaN(v.getTime()) ? "d:invalid" : `d:${v.getTime()}`;
      const proto: unknown = Object.getPrototypeOf(v);
      const isArray = Array.isArray(v);
      if (!isArray && proto !== Object.prototype && proto !== null)
        throw unsupported(`a ${(v as { constructor?: { name?: string } }).constructor?.name ?? "non-plain object"}`);
      if (Object.getOwnPropertySymbols(v).length > 0) throw unsupported("an object with symbol keys");
      if (path.has(v)) throw unsupported("a cyclic value");
      path.add(v);
      try {
        if (isArray) {
          const items: string[] = [];
          for (let i = 0; i < v.length; i++) items.push(i in v ? encode(v[i], path) : "hole");
          return `[${items.join(",")}]`;
        }
        return `{${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}:${encode(x, path)}`).join(",")}}`;
      } finally {
        path.delete(v);
      }
    }
    default:
      throw unsupported(`a ${typeof v}`);
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
