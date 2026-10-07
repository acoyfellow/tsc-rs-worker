# Third-party code

- `worker/src/core.js` is copied unchanged from
  [pingdotgg/ts-rust](https://github.com/pingdotgg/ts-rust) `npm/wasm/core.js`, commit `dfb3ca6`.
- `worker/src/ts_rust.wasm` (not committed; built by `scripts/build-wasm.sh`) is compiled from the same repo and commit.

ts-rust is MIT licensed. It is a Rust port of
[microsoft/typescript-go](https://github.com/microsoft/typescript-go) (Apache-2.0).
See the upstream `LICENSE` and `NOTICE.md` for full terms.

## ts-rust license

```
MIT License

Copyright (c) 2026 T3 Tools Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
