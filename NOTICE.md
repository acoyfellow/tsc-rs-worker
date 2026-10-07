# Third-party code

- `worker/src/core.js` is copied unchanged from
  [pingdotgg/ts-rust](https://github.com/pingdotgg/ts-rust) `npm/wasm/core.js`, commit `dfb3ca6`.
- `worker/src/ts_rust.wasm` (not committed; built by `scripts/build-wasm.sh`) is compiled from the same repo and commit.

ts-rust is MIT licensed. It is a Rust port of
[microsoft/typescript-go](https://github.com/microsoft/typescript-go) (Apache-2.0).
See the upstream `LICENSE` and `NOTICE.md` for full terms.
