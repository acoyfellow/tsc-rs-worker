// Node: run every case through the wasm checker on the calling thread and time it.
// usage: node test/bench.mjs [path/to/ts_rust.wasm]   -> writes results/node.json, exits 1 on a wrong result
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { runTsc, memoryFileSystem } from "../worker/src/core.js";
import { TSCONFIG, TOOLS_DTS, CASES, sameCodes } from "./cases.mjs";

const wasmPath = process.argv[2] ?? new URL("../worker/src/ts_rust.wasm", import.meta.url).pathname;
const bytes = readFileSync(wasmPath);
let t = performance.now();
const module = await WebAssembly.compile(bytes);
const compileMs = performance.now() - t;

const check = (src) => {
  const fs = memoryFileSystem({ "/p/tsconfig.json": TSCONFIG, "/p/tools.d.ts": TOOLS_DTS, "/p/agent.ts": src });
  const start = performance.now();
  const out = runTsc(module, { args: ["-p", "/p"], cwd: "/p", fs, diagnosticsJson: true, env: {} });
  return { ms: performance.now() - start, out };
};

const results = [];
for (const c of CASES) {
  const { ms, out } = check(c.src);
  const codes = (out.diagnostics ?? []).map((d) => d.code);
  results.push({
    name: c.name, expect: c.expect, got: codes, pass: sameCodes(codes, c.expect), ms: Math.round(ms),
    diagnostics: (out.diagnostics ?? []).map((d) => `TS${d.code}: ${d.text}`),
  });
}
const warm = [];
for (let i = 0; i < 10; i++) warm.push(Math.round(check(CASES[4].src).ms));
warm.sort((a, b) => a - b);

const report = {
  runtime: `node ${process.version}`,
  wasmBytes: bytes.length,
  compileMs: Math.round(compileMs),
  warmCheckMs: { min: warm[0], median: warm[5], max: warm[9] },
  peakRssMB: Math.round(process.memoryUsage().rss / 1e6),
  allPass: results.every((r) => r.pass),
  results,
};
mkdirSync(new URL("../results/", import.meta.url), { recursive: true });
writeFileSync(new URL("../results/node.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
process.exit(report.allPass ? 0 : 1);
