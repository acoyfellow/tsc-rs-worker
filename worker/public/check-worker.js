// Runs the type checker in your browser, off the page's main thread.
// Same WebAssembly module and the same settings as the Worker's POST /check.
import { loadModule, tsc } from "/browser.js"; // from ts-rust npm/wasm (MIT), see NOTICE.md

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    strict: true, noEmit: true, target: "es2022", lib: ["es2022"], types: [],
    skipLibCheck: true, module: "esnext", moduleResolution: "bundler",
  },
  include: ["*.ts"],
});

// Start the download and compile straight away, so the first check waits less.
const ready = loadModule("/ts_rust.wasm").catch((e) => e);

onmessage = async ({ data: { id, files } }) => {
  let t = performance.now();
  try {
    const loaded = await ready;
    if (loaded instanceof Error) throw loaded;
    const loadMs = performance.now() - t;
    t = performance.now();
    const fsFiles = { "/p/tsconfig.json": TSCONFIG };
    for (const [name, src] of Object.entries(files ?? {})) {
      const safe = name.replace(/[^\w.-]/g, "_");
      if (typeof src === "string" && safe.endsWith(".ts")) fsFiles[`/p/${safe}`] = src;
    }
    const out = await tsc(["-p", "/p", "--checkers", "1"], { files: fsFiles, cwd: "/p", diagnostics: "json" });
    const diagnostics = (out.diagnostics ?? []).map((d) => ({
      code: d.code, line: (d.startPosition?.line ?? -1) + 1, file: d.fileName, text: d.text,
    }));
    postMessage({ id, ok: diagnostics.length === 0, diagnostics, loadMs, ms: performance.now() - t });
  } catch (e) {
    postMessage({ id, error: String(e?.message ?? e), ms: performance.now() - t });
  }
};
