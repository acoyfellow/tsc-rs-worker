#!/usr/bin/env bash
# Build tsc-rs (pingdotgg/ts-rust) as WebAssembly and copy it, with its JS host, into worker/src.
#
# usage: scripts/build-wasm.sh [fast|small]
#   fast   release profile, no wasm-opt   (~3 min on 4 cores, ~14.5 MB)
#   small  upstream default: opt-level z, fat LTO, wasm-opt  (slow, ~4.2 MB per upstream)
# needs: rustup with target wasm32-wasip1, a C compiler, node; wasm-opt (binaryen >= 132) for "small"
set -euo pipefail
here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
mode="${1:-fast}"
TS_RUST_REF="${TS_RUST_REF:-dfb3ca6}"   # the commit these results were measured on
src="${TS_RUST_DIR:-$here/.ts-rust}"

if [[ ! -d "$src/.git" ]]; then
  git clone https://github.com/pingdotgg/ts-rust "$src"
fi
git -C "$src" fetch --quiet origin
git -C "$src" checkout --quiet "$TS_RUST_REF"
echo "ts-rust at $(git -C "$src" rev-parse --short HEAD)"

out="$here/worker/src/ts_rust.wasm"
if [[ "$mode" == fast ]]; then
  WASM_PROFILE=release WASM_OPT=none "$src/scripts/wasm/build.sh" "$out"
else
  "$src/scripts/wasm/build.sh" "$out"
fi
cp "$src/npm/wasm/core.js" "$here/worker/src/core.js"
# The same files, served to the page for the "Your browser" mode.
mkdir -p "$here/worker/public"
cp "$out" "$here/worker/public/ts_rust.wasm"
cp "$src/npm/wasm/core.js" "$src/npm/wasm/browser.js" "$here/worker/public/"
ls -l "$out" "$here/worker/src/core.js" "$here/worker/public/"
