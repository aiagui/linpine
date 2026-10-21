/** One operation in a recorded history. Times can be any monotonic unit. */
export interface Operation<I = unknown, O = unknown> {
  /** Any unique value. Defaults to the index in the history. */
  id?: unknown;
  /** When the call was invoked. Must be a finite number. */
  call: number;
  /** When the call returned. Omit (or pass Infinity) for an operation that never returned. */
  ret?: number;
  input: I;
  /** Ignored for pending operations. */
  output?: O;
}

export interface Model<S, I = unknown, O = unknown> {
  init: S;
  /** Returns whether `output` is legal for `input` in `state`, and the next state. */
  step(state: S, input: I, output: O | undefined): readonly [boolean, S];
  /** A string that identifies a state, used for memoisation. */
  key(state: S): string;
  /** Optional split into independent sub-histories (e.g. one per key). */
  partition?(history: readonly Operation<I, O>[]): Operation<I, O>[][];
}

export interface CheckOptions {
  /** Give up after this many search steps and return "unknown". */
  maxSteps?: number;
  /** Give up after this many milliseconds and return "unknown". */
  timeoutMs?: number;
  /**
   * When a return and a call share a timestamp, treat them as not overlapping.
   * Default false: they overlap, which matches Porcupine.
   */
  strictTies?: boolean;
}

export type CheckResult =
  | { result: "ok"; steps: number }
  | { result: "unknown"; steps: number }
  | { result: "illegal"; steps: number; partition: number; longest: unknown[] };
