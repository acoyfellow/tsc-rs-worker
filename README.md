# tsc-rs in a Cloudflare Worker

The TypeScript 7 type checker, running **inside a Cloudflare Worker**, in memory.
No container, no file system, no Node.

**Try it: https://tsc-rs.coey.dev**

[tsc-rs](https://github.com/pingdotgg/ts-rust) is a Rust port of the TypeScript 7 compiler
([microsoft/typescript-go](https://github.com/microsoft/typescript-go)). It already ships a
WebAssembly build. This repo bundles that build into a Worker, puts an HTTP endpoint and a demo page
in front of it, and checks that it gives the same errors `tsc` does: in Node, in a local Worker, and
against the deployed site.

```
POST https://tsc-rs.coey.dev/check
{ "files": { "agent.ts": "...", "tools.d.ts": "..." } }

→ { "ok": false, "exitCode": 2, "diagnostics": [
    { "code": 2339, "line": 2, "file": "/p/agent.ts",
      "text": "Property 'writeFile' does not exist on type '{ exec(...); readFile(...); }'." } ] }
```

## Why

Agents write code against tool APIs. If an agent calls a method that doesn't exist, or passes a string
where an object belongs, that should be caught **in milliseconds, before the code runs**. Give the checker
a `tools.d.ts` generated from your tool schemas, plus the agent's code, and it returns real `tsc` errors.

## Results

Measured on 2026-10-07 with tsc-rs commit `dfb3ca6`. Raw numbers are in [`results/`](results/).

| Case | Expected | Node | Local Worker | Deployed Worker |
|---|---|---|---|---|
| `state.nonExistentMethod.panic()` on `Record<string, unknown>` | TS18046 | ✅ | ✅ | ✅ |
| Valid plain code | no errors | ✅ | ✅ | ✅ |
| Tool call with a string instead of `{ command }` | TS2345 | ✅ | ✅ | ✅ |
| Made-up method `writeFile` and field `output` | TS2339 ×2 | ✅ | ✅ | ✅ |
| Valid tool call | no errors | ✅ | ✅ | ✅ |

There are two builds of the module. The deployed site uses the small one.

| | Small build (deployed) | Fast build |
|---|---|---|
| How | `wasm` profile: size-optimised, fat LTO, then `wasm-opt` | `release` profile, no `wasm-opt` |
| Module size | **4.7 MB (2.0 MB gzip)** | 14.5 MB (4.0 MB gzip) |
| Build time (4 cores, warm cargo cache) | about 5 min | about 3 min |
| Warm check, Node 22 (median) | 74 ms | 55 ms |
| Warm check, local Worker | 48–67 ms | 69–77 ms |
| First check, Node 22 | 190 ms | about 157 ms |
| Peak memory, whole Node process | 98 MB | 120 MB |

On the deployed Worker, a check takes **70–150 ms round trip** from a client in a cloud sandbox, including the
network. All 10 requests in the deployed test succeeded inside the Workers 128 MB memory limit.

Deployed Workers only advance `performance.now()` across I/O, so on a deployed Worker the `ms` field in a response
reads 0; time requests from the client instead.

## Run it

Needs Rust (with `rustup target add wasm32-wasip1`), a C compiler, and Node 22.

```sh
npm install
scripts/build-wasm.sh          # clones tsc-rs at dfb3ca6 and builds the fast module
scripts/build-wasm.sh small    # or the small one (slow; needs binaryen 132 or later for wasm-opt)
node test/bench.mjs            # Node: all cases, writes results/node.json
node test/worker-test.mjs      # starts wrangler dev, all cases, writes results/worker-local.json
npm run dev                    # demo page at http://localhost:8787
```

### Deploy to your own account

```sh
npx wrangler login
npm run deploy
node test/worker-test.mjs https://<your-worker-url>   # same cases against your deployed Worker
```

To serve it on your own domain, add a `routes` entry to `worker/wrangler.jsonc` (there's a commented example), or
run `npx wrangler deploy --domain tsc-rs.example.com` from `worker/`.

Optional: `npx wrangler secret put TOKEN` makes `/check` require `Authorization: Bearer <TOKEN>`.
`wrangler.jsonc` sets a 30-checks-per-minute-per-IP rate limit; remove that block if your account has no
rate limiting.

### Continuous checks

[`ci/proof.yml`](ci/proof.yml) is a GitHub Actions workflow that builds the module from source and runs the Node and
local Worker checks. Copy it to `.github/workflows/` to turn it on.

## Files

| Path | What it is |
|---|---|
| `worker/src/index.js` | The Worker: demo page, `POST /check`, size cap, rate limit, optional token |
| `worker/src/page.html` | The demo page |
| `worker/src/core.js` | The tsc-rs JavaScript host, copied unchanged ([NOTICE](NOTICE.md)) |
| `scripts/build-wasm.sh` | Builds `worker/src/ts_rust.wasm` from tsc-rs source |
| `test/cases.mjs` | The cases and the error codes they must produce |
| `test/bench.mjs`, `test/worker-test.mjs` | Node and Worker checks |
| `results/` | The measured runs: `node.json`, `worker-local.json`, `worker-deployed.json` |
| `ci/proof.yml` | GitHub Actions workflow: build from source, run both checks |

## Caveats

tsc-rs was released on 2026-10-07. Its README says it was written by models and that its author hasn't read the
code. Treat this as an experiment. Each check runs one at a time on a fresh WebAssembly instance.

tsc-rs is MIT licensed; see [NOTICE.md](NOTICE.md).
