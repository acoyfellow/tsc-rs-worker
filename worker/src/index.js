// Type-check TypeScript inside a Cloudflare Worker, in memory, with tsc-rs compiled to WebAssembly.
//   GET  /       the demo page (plus its manifest, icons, link-preview image and service worker)
//   POST /check  { files: { "agent.ts": "...", "tools.d.ts"?: "..." } }
//                -> { ok, exitCode, diagnostics: [{ code, line, file, text }] }
import tsModule from "./ts_rust.wasm"; // wrangler bundles it as a compiled WebAssembly.Module
import { runTsc, memoryFileSystem } from "./core.js"; // from ts-rust npm/wasm (MIT), see NOTICE.md
import page from "./page.html";
import manifest from "./manifest.webmanifest";
import serviceWorker from "./sw.js.txt";
import ogImage from "./og.png"; // link-preview image for X, Slack and others
import icon192 from "./icon-192.png";
import icon512 from "./icon-512.png";
import appleTouchIcon from "./apple-touch-icon.png";

const DAY = "public, max-age=86400";
const STATIC = {
  "/": [page, "text/html; charset=utf-8", "public, max-age=300"],
  "/manifest.webmanifest": [manifest, "application/manifest+json", DAY],
  "/sw.js": [serviceWorker, "text/javascript; charset=utf-8", "no-cache"],
  "/og.png": [ogImage, "image/png", DAY],
  "/icon-192.png": [icon192, "image/png", DAY],
  "/icon-512.png": [icon512, "image/png", DAY],
  "/apple-touch-icon.png": [appleTouchIcon, "image/png", DAY],
  "/robots.txt": ["User-agent: *\nAllow: /\nSitemap: https://tsc-rs.coey.dev/sitemap.xml\n", "text/plain", DAY],
  "/sitemap.xml": [
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://tsc-rs.coey.dev/</loc></url></urlset>\n',
    "application/xml", DAY,
  ],
};

const MAX_BYTES = 64 * 1024;
const TSCONFIG = JSON.stringify({
  compilerOptions: {
    strict: true, noEmit: true, target: "es2022", lib: ["es2022"], types: [],
    skipLibCheck: true, module: "esnext", moduleResolution: "bundler",
  },
  include: ["*.ts"],
});

const json = (body, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

export function check(files) {
  const fsFiles = { "/p/tsconfig.json": TSCONFIG };
  for (const [name, src] of Object.entries(files ?? {})) {
    if (typeof src !== "string") continue;
    const safe = name.replace(/[^\w.-]/g, "_");
    if (safe.endsWith(".ts")) fsFiles[`/p/${safe}`] = src;
  }
  // One checker: the Worker is single-threaded anyway, and it keeps memory down.
  const out = runTsc(tsModule, { args: ["-p", "/p", "--checkers", "1"], cwd: "/p", fs: memoryFileSystem(fsFiles), diagnosticsJson: true, env: {} });
  const diagnostics = (out.diagnostics ?? []).map((d) => ({
    code: d.code, line: (d.startPosition?.line ?? -1) + 1, file: d.fileName, text: d.text,
  }));
  return { ok: diagnostics.length === 0, exitCode: out.exitCode, diagnostics };
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "GET" && STATIC[url.pathname]) {
      const [body, type, cache] = STATIC[url.pathname];
      return new Response(body, { headers: { "content-type": type, "cache-control": cache } });
    }
    if (req.method !== "POST" || (url.pathname !== "/check" && url.pathname !== "/")) {
      return new Response("not found\n", { status: 404 });
    }
    // Optional shared secret (npx wrangler secret put TOKEN, then send Authorization: Bearer <TOKEN>).
    if (env.TOKEN && req.headers.get("authorization") !== `Bearer ${env.TOKEN}`) {
      return new Response("unauthorized\n", { status: 401 });
    }
    // Optional per-IP rate limit (the LIMITER binding in wrangler.jsonc).
    if (env.LIMITER) {
      const { success } = await env.LIMITER.limit({ key: req.headers.get("cf-connecting-ip") ?? "anon" });
      if (!success) return json({ ok: false, error: "rate limited, try again in a minute" }, 429);
    }
    const text = await req.text();
    if (text.length > MAX_BYTES) return json({ ok: false, error: "too large (64 KB max)" }, 413);
    let files;
    try { ({ files } = JSON.parse(text)); } catch { return json({ ok: false, error: "bad json" }, 400); }
    // Note: deployed Workers only advance performance.now() across I/O, so `ms` reads 0 there.
    const t = performance.now();
    try {
      return json({ ...check(files), ms: Math.round(performance.now() - t) });
    } catch (e) {
      return json({ ok: false, crash: String(e) }, 500);
    }
  },
};
