// Worker: send every case to the Worker over HTTP and check the answers.
// usage: node test/worker-test.mjs [baseUrl]
//   no baseUrl: starts `wrangler dev` (local workerd) and stops it afterwards.
//   baseUrl:    tests an already-running or deployed Worker.
// writes results/worker-<local|deployed>.json, exits 1 on a wrong result
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { TOOLS_DTS, CASES, sameCodes } from "./cases.mjs";

const given = process.argv[2];
const base = given ?? "http://127.0.0.1:8799";
let dev;
if (!given) {
  dev = spawn("npx", ["wrangler", "dev", "--port", "8799", "--ip", "127.0.0.1"], {
    cwd: new URL("../worker/", import.meta.url).pathname, stdio: ["ignore", "inherit", "inherit"], detached: true,
  });
  for (let i = 0; i < 90; i++) {
    try { if ((await fetch(base)).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
}

const post = async (src) => {
  const t = performance.now();
  const res = await fetch(`${base}/check`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(process.env.TOKEN ? { authorization: `Bearer ${process.env.TOKEN}` } : {}) },
    body: JSON.stringify({ files: { "tools.d.ts": TOOLS_DTS, "agent.ts": src } }),
  });
  return { http: res.status, roundTripMs: Math.round(performance.now() - t), body: await res.json() };
};

const results = [];
try {
  for (const c of CASES) {
    const r = await post(c.src);
    const codes = (r.body.diagnostics ?? []).map((d) => d.code);
    results.push({ name: c.name, expect: c.expect, got: codes, pass: r.http === 200 && sameCodes(codes, c.expect), http: r.http, workerMs: r.body.ms, roundTripMs: r.roundTripMs, crash: r.body.crash });
  }
  for (let i = 0; i < 5; i++) {
    const r = await post(CASES[4].src);
    results.push({ name: `repeat valid ${i + 1}`, expect: [], got: (r.body.diagnostics ?? []).map((d) => d.code), pass: r.http === 200 && r.body.ok === true, http: r.http, workerMs: r.body.ms, roundTripMs: r.roundTripMs });
  }
} finally {
  if (dev) { try { process.kill(-dev.pid); } catch {} }
}

const report = { target: given ? "deployed" : "local wrangler dev (workerd)", base: given ? "(deployed url)" : base, allPass: results.every((r) => r.pass), results };
mkdirSync(new URL("../results/", import.meta.url), { recursive: true });
writeFileSync(new URL(`../results/worker-${given ? "deployed" : "local"}.json`, import.meta.url), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
process.exit(report.allPass ? 0 : 1);
