// Keeps the README honest: every ```ts block that imports "linpine" must typecheck under
// --strict and, when it ends a statement with `// { ... }`, print exactly that value.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readme = readFileSync(join(root, "README.md"), "utf8");
const blocks = [...readme.matchAll(/```ts\n([\s\S]*?)```/g)]
  .map((m) => m[1] as string)
  .filter((code) => /from "linpine"/.test(code));

// The temp dir lives inside the repo so tsc finds @types/node and src/.
const dir = mkdtempSync(join(root, "test", ".readme-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const tsc = join(root, "node_modules", "typescript", "bin", "tsc");

/** Rewrites the import and appends a print of each variable followed by an expected-value comment. */
function prepare(code: string): { source: string; expected: unknown[] } {
  const lines = code.replace(/from "linpine"/g, 'from "../../src/index.ts"').split("\n");
  const expected: unknown[] = [];
  const prints: string[] = [];
  lines.forEach((line, i) => {
    const decl = /^const (\w+) =/.exec(line);
    const next = lines[i + 1]?.trim() ?? "";
    if (decl && next.startsWith("// {")) {
      expected.push(new Function(`return (${next.slice(2)})`)());
      prints.push(`console.log(JSON.stringify(${decl[1] as string}));`);
    }
  });
  return { source: [...lines, ...prints].join("\n"), expected };
}

describe("README usage examples", () => {
  it("has at least one example", () => expect(blocks.length).toBeGreaterThan(0));

  blocks.forEach((code, n) => {
    it(`example ${n + 1} typechecks under --strict and prints what it claims`, () => {
      const { source, expected } = prepare(code);
      const file = join(dir, `example-${n + 1}.ts`);
      writeFileSync(file, source);

      const types = spawnSync(process.execPath, [
        tsc, "--ignoreConfig", "--noEmit", "--strict", "--exactOptionalPropertyTypes", "--noUncheckedIndexedAccess",
        "--module", "nodenext", "--moduleResolution", "nodenext", "--target", "es2023",
        "--allowImportingTsExtensions", "--types", "node", "--skipLibCheck", file,
      ], { encoding: "utf8" });
      expect(types.stdout + types.stderr, "tsc --strict on the README example").toBe("");
      expect(types.status).toBe(0);

      const run = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", file], { encoding: "utf8" });
      expect(run.stderr).toBe("");
      expect(run.status).toBe(0);
      const printed = run.stdout.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as unknown);
      expect(printed).toEqual(expected);
    });
  });
});
