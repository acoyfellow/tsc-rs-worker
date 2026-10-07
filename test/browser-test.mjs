// Opens the demo page in Chromium and checks every preset twice: on the Worker, and in the browser.
// Then it goes offline, reloads, and checks again in the browser from the service worker cache.
//   npx playwright install chromium
//   npm run dev                                         # in one terminal (http://localhost:8787)
//   node test/browser-test.mjs [url]                    # writes results/browser-<local|deployed>.json
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const BASE = (process.argv[2] ?? "http://localhost:8787").replace(/\/$/, "");
const OUT = new URL(`../results/browser-${/localhost|127\.0\.0\.1/.test(BASE) ? "local" : "deployed"}.json`, import.meta.url);
const EXPECT = { "Made-up method": ["2339", "2339"], "Wrong argument": ["2345"], "Unknown misuse": ["18046"], "Valid": [] };

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
const pageErrors = [];
const offlineRequestsFailed = []; // expected offline: requests to other sites (web fonts) that nothing caches
let offline = false;
page.on("pageerror", (e) => pageErrors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error" && !(offline && m.text().includes("ERR_INTERNET_DISCONNECTED"))) pageErrors.push(m.text()); });
page.on("requestfailed", (r) => { if (offline) offlineRequestsFailed.push(r.url()); });
let wasmContentType = null;
page.on("response", (r) => { if (r.url().endsWith("/ts_rust.wasm")) wasmContentType = r.headers()["content-type"]; });

const stat = () => page.evaluate(() => document.getElementById("stat").textContent);
const waitFor = (text) => page.waitForFunction(
  (t) => { const s = document.getElementById("stat").textContent; return s.includes(t) || s.includes("failed"); }, text, { timeout: 90000 });
const ms = (s) => Number(s.match(/(\d+) ms/)?.[1]);

async function runPreset(name, mode) {
  await page.evaluate(() => { document.getElementById("stat").textContent = ""; });
  await page.click(`#presets button:text-is("${name}")`);
  await waitFor(mode === "worker" ? "ms round trip to the Worker" : "ms in your browser");
  const codes = await page.evaluate(() => [...document.querySelectorAll("#out li .where")].map((w) => w.textContent.match(/TS(\d+)/)[1]));
  const s = await stat();
  return { expected: EXPECT[name], got: codes, ms: ms(s), pass: JSON.stringify(codes) === JSON.stringify(EXPECT[name]) };
}

await page.goto(BASE + "/", { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "networkidle" });

const results = { worker: {}, browser: {}, offline: {} };
for (const name of Object.keys(EXPECT)) results.worker[name] = await runPreset(name, "worker");

await page.evaluate(() => { document.getElementById("stat").textContent = ""; });
await page.click("#on-browser");
await waitFor("ms in your browser");
const firstBrowserCheck = { stat: await stat(), loadMs: ms(await page.evaluate(() => document.getElementById("bl").textContent)) };
for (const name of Object.keys(EXPECT)) results.browser[name] = await runPreset(name, "browser");

await page.waitForTimeout(1500); // let the service worker finish caching
await ctx.setOffline(true);
offline = true;
await page.reload({ waitUntil: "domcontentloaded" });
const servedByServiceWorker = await page.evaluate(() => !!navigator.serviceWorker.controller);
await waitFor("ms in your browser");
for (const name of ["Wrong argument", "Valid"]) results.offline[name] = await runPreset(name, "browser");
await ctx.setOffline(false);
offline = false;
// Offline, only requests to other sites (web fonts) and Cloudflare's own analytics beacon (/cdn-cgi/rum, added by
// the edge, not the app) may fail. Every file of the app itself must come from the service worker cache.
const sameSiteFailedOffline = offlineRequestsFailed.filter((u) => u.startsWith(BASE) && !u.startsWith(`${BASE}/cdn-cgi/`));
const version = browser.version();
await browser.close();

const allPass = pageErrors.length === 0 && sameSiteFailedOffline.length === 0 && servedByServiceWorker && wasmContentType === "application/wasm"
  && Object.values(results).every((m) => Object.values(m).every((r) => r.pass));
const report = { base: BASE, date: new Date().toISOString(), browser: `Chromium ${version}`,
  allPass, wasmContentType, servedByServiceWorker, firstBrowserCheck, results, pageErrors, offlineRequestsFailed };
writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n");
for (const [mode, m] of Object.entries(results)) for (const [name, r] of Object.entries(m))
  console.log(`${r.pass ? "ok  " : "FAIL"} ${mode.padEnd(8)} ${name.padEnd(15)} ${(r.got.join("+") || "no errors").padEnd(12)} ${r.ms} ms`);
console.log(allPass ? "all pass" : "FAILED", "->", OUT.pathname);
process.exit(allPass ? 0 : 1);
