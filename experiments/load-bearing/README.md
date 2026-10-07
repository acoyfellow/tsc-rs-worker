# Is the type checker load-bearing?

Could a cheaper gate do the checker's job? This experiment puts two gates in front of the same execution path and
runs the same snippets through both:

1. **tsc-rs**: the WebAssembly checker from this repo. It refuses the snippet on any diagnostic.
2. **Allowlist**: every property name the snippet uses must appear in `tools.d.ts`. The names are extracted with the
   TypeScript parser, so there is no regex guesswork. It comes in two versions:
   - **strict**: names from `tools.d.ts` only.
   - **lenient**: also allows JavaScript built-ins such as `split` and `trim`, so ordinary string code isn't refused.

The tool surface is `tools.d.ts` from the live demo, unchanged. Two failing snippets and one valid snippet are demo
presets, unchanged. The others change one thing each. When a gate lets a snippet through, it runs against a fake
`workspace` that behaves like My AX's real one:
- A non-object argument throws `Tool arguments must be a JSON object`.
- Extra arguments are ignored.
- Methods that don't exist are absent.

```
cd experiments/load-bearing && npm install && node run.mjs   # writes results.json
```

## Result

| Failing case | With no gate, the run… | tsc-rs | Allowlist, strict | Allowlist, lenient |
|---|---|---|---|---|
| Missing method (`writeFile`) | throws `writeFile is not a function` | ✅ TS2339 | ✅ | ✅ |
| Wrong argument count (`exec({…}, { cwd })`) | **returns the wrong directory, silently** | ✅ TS2554 | ❌ runs | ❌ runs |
| Wrong argument type (`exec("ls -la")`) | throws `Tool arguments must be a JSON object` | ✅ TS2345 | ❌ runs | ❌ runs |
| Generic constraint failure | throws `reading 'split'` of undefined | ✅ TS2345 | ⚠️ refuses, but flags `split` on a correct line | ❌ runs |
| Narrowed union after a condition | throws `out.trim is not a function` | ✅ TS2339 | ⚠️ refuses, but flags `trim` (any `trim` at all) | ❌ runs |

| Valid control | tsc-rs | Allowlist, strict | Allowlist, lenient |
|---|---|---|---|
| Demo preset "Valid" | ✅ runs | ✅ runs | ✅ runs |
| `r.stdout.trim().split("\n").length` | ✅ runs | ❌ refused | ✅ runs |
| A local object with its own field | ✅ runs | ❌ refused | ❌ refused |

- **tsc-rs** refused all 5 failing cases, each with exactly the expected error code, and none of the valid ones.
- **The strict allowlist** missed argument count and argument type. It "caught" the generic and narrowing cases only
  because it refuses every built-in method name, so it also refuses correct code that calls `trim` or `split`.
- **The lenient allowlist** caught only the missing method.

The allowlist does not catch the same set. Only the checker catches the generic and narrowing cases without refusing
correct code.

## What agents actually emit

A search of My AX's own conversation history (full-text index, to 2026-10-07) for the runtime errors these bugs produce:

| Failure seen at run time | Count | Class | Allowlist catches it? |
|---|---|---|---|
| `Tool arguments must be a JSON object` | 7 | wrong argument type | no |
| `machine.shell` / `machine.exec` / `machine.accessibility_query is not a function` | 4 | missing method | yes |
| `Cannot read properties of undefined (reading 'stdout' / 'trim' / 'slice' / …)` | about 8 | wrong result shape; the code isn't in the index, so unclassified | depends |
| a generic constraint or a narrowed union | **0 found** | | |

So the cases only the checker catches (generics, narrowing) were **not** found in what agents emitted. The checker's
weight comes from **argument types**: the most common failure (7). The allowlist can't see these, and My AX's runtime
catches them only during the run. At least 2 of the 7 failed after an earlier tool call in the same snippet had
already run.

Limits: one small tool surface (2 methods), 8 snippets, and an index search that returns at most 100 hits per query.
