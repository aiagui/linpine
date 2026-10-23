import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const npm = process.env.npm_execpath;
if (!npm) throw new Error("Run this check with npm run test:package");
const [destination, ...extraArgs] = process.argv.slice(2);
assert.equal(extraArgs.length, 0, "Usage: npm run test:package -- [output-directory]");
const temporary = mkdtempSync(join(tmpdir(), "linpine-package-"));

function run(args: string[], cwd: string): string {
  const result = spawnSync(process.execPath, args, {
    cwd, encoding: "utf8", timeout: 120_000,
    env: { ...process.env, npm_config_cache: join(temporary, "npm-cache") },
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

try {
  // npm pack runs prepare, so this also verifies that the tarball builds from source.
  const packed = JSON.parse(run([npm, "pack", "--json", "--pack-destination", temporary], root)) as {
    filename: string; files: { path: string }[];
  }[];
  assert.equal(packed.length, 1);
  const archive = packed[0];
  assert(archive);
  const paths = archive.files.map((file) => file.path);
  const extra = ["package.json", "README.md", "LICENSE", "examples/async-store.mjs"];
  for (const path of [...extra, "dist/index.js", "dist/index.d.ts"]) assert(paths.includes(path), `missing ${path}`);
  for (const path of paths) assert(path.startsWith("dist/") || extra.includes(path), `unexpected file: ${path}`);

  const consumer = join(temporary, "consumer");
  mkdirSync(consumer);
  writeFileSync(join(consumer, "package.json"), JSON.stringify({ name: "linpine-consumer", private: true, type: "module" }));
  // Normal lifecycle scripts remain enabled: installing a release must not need tsc.
  run([npm, "install", "--offline", "--omit=dev", "--no-audit", "--no-fund", join(temporary, archive.filename)], consumer);
  const installed = join(consumer, "node_modules", "linpine");
  const manifest = JSON.parse(readFileSync(join(installed, "package.json"), "utf8")) as { dependencies?: object };
  assert.equal(Object.keys(manifest.dependencies ?? {}).length, 0, "the library must have no runtime dependencies");
  copyFileSync(join(root, "scripts", "fixtures", "package-consumer.mts"), join(consumer, "consumer.mts"));
  writeFileSync(join(consumer, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      target: "ES2023", lib: ["ES2023"], module: "NodeNext", moduleResolution: "NodeNext",
      strict: true, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true,
      verbatimModuleSyntax: true, types: [], skipLibCheck: false,
    },
    include: ["consumer.mts"],
  }));
  run([join(root, "node_modules", "typescript", "bin", "tsc"), "-p", join(consumer, "tsconfig.json")], consumer);
  run(["consumer.mjs"], consumer);
  copyFileSync(join(installed, "examples", "async-store.mjs"), join(consumer, "async-store.mjs"));
  const example = run(["--test", "async-store.mjs"], consumer);
  console.log(example.trim());
  console.log(`Verified ${archive.filename}: offline install, strict TypeScript, ESM exports and async-store integration.`);
  if (destination) {
    const output = resolve(destination);
    mkdirSync(output, { recursive: true });
    copyFileSync(join(temporary, archive.filename), join(output, archive.filename));
    console.log(`Saved verified package to ${join(output, archive.filename)}`);
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
