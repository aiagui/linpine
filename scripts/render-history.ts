// Renders docs/history.svg from the real seed-1 history of the cache demo.
//   node --experimental-strip-types scripts/render-history.ts [seed]
import { writeFileSync } from "node:fs";
import { check, register } from "../src/index.ts";
import { firstUnplaced, history } from "../examples/cache-demo.ts";

const seed = Number(process.argv[2] ?? 1);
const ops = await history(seed, true);
const r = check(register(0), ops);
if (r.result !== "illegal") throw new Error(`seed ${seed} is ${r.result}, pick a failing seed`);
const stuck = firstUnplaced(ops, r.longest);

const clients = [...new Set(ops.map((o) => o.client))].sort();
const end = Math.max(...ops.map((o) => o.ret));
const X0 = 110, S = 46, H = 24, GAP = 8;
const x = (t: number): number => X0 + t * S;

// Stack overlapping operations of one client (zero-length ops count as touching their neighbours).
const rows = new Map<number, number>();
const laneTop = new Map<string, number>();
let y = 36;
for (const c of clients) {
  const ends: number[] = [];
  for (const op of ops.filter((o) => o.client === c).sort((a, b) => a.call - b.call || a.ret - b.ret)) {
    let row = ends.findIndex((e) => e < op.call || (e === op.call && op.call !== op.ret));
    if (row === -1) row = ends.length;
    ends[row] = op.ret;
    rows.set(op.id as number, row);
  }
  laneTop.set(c, y);
  y += ends.length * (H + GAP) + 16;
}
const axisY = y;
const W = x(end) + 40;
const Ht = axisY + 92;

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const label = (o: (typeof ops)[number]): string =>
  o.input.op === "write" ? `w ${o.input.value}` : `r ${String(o.output)}`;

const out: string[] = [
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${Ht}" viewBox="0 0 ${W} ${Ht}" role="img" aria-label="Cache demo, seed ${seed}: every operation on a virtual timeline">`,
  `<style>text{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}.lane{fill:#5f6f67;font-size:15px;font-weight:600}.lbl{fill:#fff;font-size:12px;font-weight:600}.ax,.note{fill:#5f6f67;font-size:13px}.g{stroke:#8a9a91;stroke-opacity:.3}.w{fill:#1f7a55}.r{fill:#3fb68a}.x{fill:#e0574f}.ptl{fill:#1f7a55;font-size:12px;font-weight:600}@media (prefers-color-scheme:dark){.lane,.ax,.note{fill:#9fb0a7}.ptl{fill:#3fb68a}}</style>`,
];
for (let t = 0; t <= end; t++)
  out.push(`<line class="g" x1="${x(t)}" y1="24" x2="${x(t)}" y2="${axisY - 6}"/><text class="ax" x="${x(t)}" y="${axisY + 12}" text-anchor="middle">${t}</text>`);
for (const c of clients) out.push(`<text class="lane" x="16" y="${(laneTop.get(c) as number) + 17}">client ${c}</text>`);
for (const o of ops) {
  const top = (laneTop.get(o.client) as number) + (rows.get(o.id as number) as number) * (H + GAP);
  const cls = o === stuck ? "x" : o.input.op === "write" ? "w" : "r";
  if (o.call === o.ret) {
    out.push(`<rect class="${cls}" x="${x(o.call) - 4}" y="${top - 4}" width="8" height="${H + 8}" rx="4"/><text class="ptl" x="${x(o.call) + 8}" y="${top + 16}">${esc(label(o))}</text>`);
  } else {
    const w = (o.ret - o.call) * S;
    out.push(`<rect class="${cls}" x="${x(o.call) + 2}" y="${top}" width="${w - 4}" height="${H}" rx="6"/><text class="lbl" x="${x(o.call) + w / 2}" y="${top + 16}" text-anchor="middle">${esc(label(o))}</text>`);
  }
}
const lastWriteBefore = ops
  .filter((o) => o.input.op === "write" && o.ret < stuck.call)
  .sort((a, b) => b.ret - a.ret || b.call - a.call)[0];
const w = lastWriteBefore?.input.op === "write" ? lastWriteBefore : undefined;
const lines = [
  `Seed ${seed}, all ${ops.length} operations (w = write, r = read). Red: the read the checker cannot place.`,
  ...(w
    ? [
        `It starts at ${stuck.call}, after w ${w.input.op === "write" ? w.input.value : ""} returned at ${w.ret}, yet returns ${String(stuck.output)}.`,
        `Reads that start exactly at ${w.ret} overlap that write (equal timestamps overlap), so they may go first.`,
      ]
    : []),
];
lines.forEach((l, i) => out.push(`<text class="note" x="16" y="${axisY + 40 + i * 18}">${esc(l)}</text>`));
out.push("</svg>");
writeFileSync(new URL("../docs/history.svg", import.meta.url), out.join("\n") + "\n");
console.log(`docs/history.svg: seed ${seed}, ${ops.length} ops, highlighted id ${String(stuck.id)}`);
