# tsc-rs in a Cloudflare Worker

The TypeScript 7 type checker, running **inside a Cloudflare Worker**, in memory.
No container, no file system, no Node.

[tsc-rs](https://github.com/pingdotgg/ts-rust) is a Rust port of the TypeScript 7 compiler
([microsoft/typescript-go](https://github.com/microsoft/typescript-go)). It already ships a
WebAssembly build. This repo bundles that build into a Worker, puts an HTTP endpoint and a demo page
in front of it, and checks that it gives the same errors `tsc` does.

```
POST /check
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

Measured on 2026-10-07, tsc-rs commit `dfb3ca6`, fast build (release profile, no `wasm-opt`).
Raw numbers are in [`results/`](results/). GitHub Actions reruns all of this from source on every push.

| Case | Expected | Node | Local Worker (workerd) |
|---|---|---|---|
| `state.nonExistentMethod.panic()` on `Record<string, unknown>` | TS18046 | ✅ | ✅ |
| Valid plain code | no errors | ✅ | ✅ |
| Tool call with a string instead of `{ command }` | TS2345 | ✅ | ✅ |
| Made-up method `writeFile` and field `output` | TS2339 ×2 | ✅ | ✅ |
| Valid tool call | no errors | ✅ | ✅ |

| | Node 22 | Local Worker |
|---|---|---|
| Module compile | 32 ms | at deploy |
| First check | ~157 ms | ~236 ms |
| Warm check | 50–64 ms (median 55) | 69–77 ms |
| Peak memory (whole process) | 120 MB | not measured |
| Module size | 14.5 MB (4.0 MB gzip) | same |

**What isn't measured yet:** the smaller `wasm-opt` build (upstream reports 4.2 MB), and memory inside a deployed
Worker, which has a 128 MB limit. Deployed Workers only advance `performance.now()` across I/O, so on a deployed
Worker the `ms` field reads 0; time it from the client instead.

## Run it

Needs Rust (with `rustup target add wasm32-wasip1`), a C compiler, and Node 22.

```sh
npm install
scripts/build-wasm.sh          # clones tsc-rs at dfb3ca6, builds it (~3 min on 4 cores)
node test/bench.mjs            # Node: all cases, writes results/node.json
node test/worker-test.mjs      # starts wrangler dev, all cases, writes results/worker-local.json
npm run dev                    # demo page at http://localhost:8787
```

`scripts/build-wasm.sh small` builds the size-optimised module instead (fat LTO plus `wasm-opt`; slow, and needs
[binaryen](https://github.com/WebAssembly/binaryen) 132 or later).

### Deploy to your own account

```sh
npx wrangler login
npm run deploy
node test/worker-test.mjs https://<your-worker-url>   # same cases against the deployed Worker
```

Optional: `npx wrangler secret put TOKEN` makes `/check` require `Authorization: Bearer <TOKEN>`.
`wrangler.jsonc` sets a 30-checks-per-minute-per-IP rate limit; remove that block if your account has no
rate limiting.

## Files

| Path | What it is |
|---|---|
| `worker/src/index.js` | The Worker: demo page, `POST /check`, size cap, rate limit |
| `worker/src/page.html` | The demo page |
| `worker/src/core.js` | The tsc-rs JavaScript host, copied unchanged ([NOTICE](NOTICE.md)) |
| `scripts/build-wasm.sh` | Builds `worker/src/ts_rust.wasm` from tsc-rs source |
| `test/cases.mjs` | The cases and the error codes they must produce |
| `test/bench.mjs`, `test/worker-test.mjs` | Node and Worker checks |
| `ci/proof.yml` | GitHub Actions workflow: build from source, run both checks |

## Caveats

tsc-rs was released on 2026-10-07. Its README says it was written by models and that its author hasn't read the
code. Treat it as an experiment. Each check runs one at a time on a fresh WebAssembly instance.

tsc-rs is MIT licensed; see [NOTICE.md](NOTICE.md).
