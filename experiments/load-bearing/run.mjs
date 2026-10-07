// Is the type checker load-bearing, or would a property-name allowlist do the same job?
//
// Two gates sit in front of the same execution path:
//   (1) tsc-rs: the WebAssembly checker; refuse on any diagnostic.
//   (2) allowlist: every property name the snippet uses must appear in tools.d.ts.
//       Two versions: "strict" (names from tools.d.ts only, as specified) and "lenient" (plus the names of
//       JavaScript built-ins such as split and trim, so ordinary string and array code is not refused).
// Every case is run through every gate. If a gate lets a snippet through, the snippet runs against a fake
// `workspace` that behaves like My AX's real one, and the outcome is recorded.
//
// usage: node run.mjs   -> writes results.json; prints a table
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import ts from "typescript";
import { runTsc, memoryFileSystem } from "../../worker/src/core.js";
import { TSCONFIG } from "../../test/cases.mjs";

// --- The tool surface and agent snippets, copied from the live demo (worker/src/page.html) -------------------------
const TOOLS = `declare const workspace: {
  exec(input: { command: string; cwd?: string }): Promise<{ stdout: string; stderr: string; exitCode: number }>;
  readFile(input: { path: string }): Promise<string>;
};`;

// fails: what is wrong; expect: the TypeScript error codes the bug should produce; args: what the caller passes.
const CASES = [
  {
    kind: "missing method", from: "demo preset 'Made-up method', verbatim", expect: [2339, 2339],
    src: `export default async () => {
  await workspace.writeFile({ path: "/a", text: "x" });
  const r = await workspace.exec({ command: "ls" });
  return r.output;
};`,
  },
  {
    kind: "wrong argument count", from: "demo preset 'Valid', with options passed as a second argument", expect: [2554],
    src: `export default async () => {
  const r = await workspace.exec({ command: "pwd" }, { cwd: "/tmp" });
  return r.stdout;
};`,
  },
  {
    kind: "wrong argument type", from: "demo preset 'Wrong argument', verbatim", expect: [2345],
    src: `export default async () => {
  const r = await workspace.exec("ls -la");
  return r.stdout;
};`,
  },
  {
    kind: "generic constraint failure", from: "a helper constrained to exec's result, given readFile's string", expect: [2345],
    src: `const firstLine = <T extends { stdout: string }>(r: T) => r.stdout.split("\\n")[0];

export default async () => {
  const hosts = await workspace.readFile({ path: "/etc/hosts" });
  return firstLine(hosts);
};`,
  },
  {
    kind: "narrowed union after a condition", from: "readFile or exec; after the string check, out is exec's result", expect: [2339],
    args: [false],
    src: `export default async (fromFile: boolean) => {
  const out = fromFile
    ? await workspace.readFile({ path: "/tmp/out.txt" })
    : await workspace.exec({ command: "cat /tmp/out.txt" });
  if (typeof out === "string") return out;
  return out.trim();
};`,
  },
  // Controls: correct code. A gate that refuses these is refusing work, not bugs.
  {
    kind: "valid (control)", from: "demo preset 'Valid', verbatim", expect: [],
    src: `export default async () => {
  const r = await workspace.exec({ command: "ls", cwd: "/tmp" });
  return r.exitCode === 0 ? r.stdout : r.stderr;
};`,
  },
  {
    kind: "valid (control)", from: "string and array methods on a tool result", expect: [],
    src: `export default async () => {
  const r = await workspace.exec({ command: "ls" });
  return r.stdout.trim().split("\\n").length;
};`,
  },
  {
    kind: "valid (control)", from: "a local object with its own fields", expect: [],
    src: `export default async () => {
  const seen = { files: 0 };
  const r = await workspace.exec({ command: "ls" });
  for (const line of r.stdout.split("\\n")) if (line) seen.files++;
  return seen.files;
};`,
  },
];

// --- Gate 1: tsc-rs ---------------------------------------------------------------------------------------------
const wasm = await WebAssembly.compile(readFileSync(new URL("../../worker/src/ts_rust.wasm", import.meta.url)));
function tscGate(src) {
  const fs = memoryFileSystem({ "/p/tsconfig.json": TSCONFIG, "/p/tools.d.ts": TOOLS, "/p/agent.ts": src });
  const t = performance.now();
  const out = runTsc(wasm, { args: ["-p", "/p", "--checkers", "1"], cwd: "/p", fs, diagnosticsJson: true, env: {} });
  const ms = Math.round(performance.now() - t);
  const diagnostics = (out.diagnostics ?? []).map((d) => ({ code: d.code, line: (d.startPosition?.line ?? 0) + 1, text: d.text }));
  return { refuse: diagnostics.length > 0, codes: diagnostics.map((d) => d.code), reasons: diagnostics.map((d) => `agent.ts:${d.line} TS${d.code}: ${d.text}`), ms };
}

// --- Gate 2: property-name allowlist, extracted from tools.d.ts ------------------------------------------------
function walk(node, visit) { visit(node); ts.forEachChild(node, (n) => walk(n, visit)); }
const parse = (name, text) => ts.createSourceFile(name, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);

function namesFromDts(dts) {
  const names = new Set();
  walk(parse("tools.d.ts", dts), (n) => {
    if ((ts.isPropertySignature(n) || ts.isMethodSignature(n) || ts.isVariableDeclaration(n)) && ts.isIdentifier(n.name)) names.add(n.name.text);
  });
  return names;
}
const DTS_NAMES = namesFromDts(TOOLS);
const ROOTS = new Set(["workspace"]); // the declared tool objects
const BUILTIN_NAMES = new Set(
  [String.prototype, Array.prototype, Object.prototype, Number.prototype, Boolean.prototype, Promise.prototype,
   Function.prototype, RegExp.prototype, Map.prototype, Set.prototype, Date.prototype, Error.prototype,
   JSON, Math, Object, Array, Promise, Number, String, console]
    .flatMap((o) => Object.getOwnPropertyNames(o)).filter((k) => typeof k === "string"),
);

// The property names a snippet uses: member access (a.b, a["b"]), destructuring ({ b } = a), and the keys of
// object literals passed straight to a tool call (workspace.exec({ b: 1 })). Type annotations are ignored.
function usedNames(src) {
  const used = [];
  const add = (node, name) => used.push({ name, line: node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1 });
  walk(parse("agent.ts", src), (n) => {
    if (ts.isPropertyAccessExpression(n)) add(n.name, n.name.text);
    else if (ts.isElementAccessExpression(n) && ts.isStringLiteral(n.argumentExpression)) add(n.argumentExpression, n.argumentExpression.text);
    else if (ts.isObjectBindingPattern(n)) for (const el of n.elements) { const k = el.propertyName ?? el.name; if (ts.isIdentifier(k)) add(k, k.text); }
    else if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ts.isIdentifier(n.expression.expression) && ROOTS.has(n.expression.expression.text)) {
      for (const arg of n.arguments) if (ts.isObjectLiteralExpression(arg)) for (const p of arg.properties) {
        if ((ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && ts.isIdentifier(p.name)) add(p.name, p.name.text);
      }
    }
  });
  return used;
}
function allowlistGate(allowed) {
  return (src) => {
    const t = performance.now();
    const bad = usedNames(src).filter((u) => !allowed.has(u.name));
    return { refuse: bad.length > 0, reasons: bad.map((u) => `agent.ts:${u.line} '${u.name}' is not in tools.d.ts`), ms: Math.round(performance.now() - t) };
  };
}
const strictGate = allowlistGate(DTS_NAMES);
const lenientGate = allowlistGate(new Set([...DTS_NAMES, ...BUILTIN_NAMES]));

// --- The one execution path every gate sits in front of ----------------------------------------------------------
// A fake workspace with My AX's behaviour: arguments must be an object (the real error text), extra arguments are
// ignored, methods that don't exist are simply absent.
const calls = [];
globalThis.workspace = {
  async exec(input) {
    calls.push(["exec", ...arguments]);
    if (typeof input !== "object" || input === null) throw new Error("Tool arguments must be a JSON object");
    return { stdout: input.command === "pwd" ? `${input.cwd ?? "/home/user"}\n` : "a.txt\nb.txt\n", stderr: "", exitCode: 0 };
  },
  async readFile(input) {
    calls.push(["readFile", ...arguments]);
    if (typeof input !== "object" || input === null) throw new Error("Tool arguments must be a JSON object");
    return "127.0.0.1 localhost\n";
  },
};
mkdirSync("/tmp/load-bearing", { recursive: true });
let n = 0;
async function run(src, args = []) {
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const file = `/tmp/load-bearing/snippet-${++n}.mjs`;
  writeFileSync(file, js);
  calls.length = 0;
  try {
    const value = await (await import(file)).default(...args);
    return { threw: false, value, toolCalls: calls.map((c) => JSON.stringify(c)) };
  } catch (e) {
    return { threw: true, error: `${e.constructor.name}: ${e.message}`, toolCalls: calls.map((c) => JSON.stringify(c)) };
  }
}
async function execute(gate, c) {
  const verdict = gate(c.src);
  if (verdict.refuse) return { ...verdict, ran: null };
  return { ...verdict, ran: await run(c.src, c.args) };
}

// --- Run ----------------------------------------------------------------------------------------------------------
const GATES = { tsc: tscGate, allowlistStrict: strictGate, allowlistLenient: lenientGate };
const results = [];
for (const c of CASES) {
  const ungated = await run(c.src, c.args); // what happens with no gate at all
  const row = { kind: c.kind, from: c.from, expect: c.expect, src: c.src, ungated, gates: {} };
  for (const [name, gate] of Object.entries(GATES)) row.gates[name] = await execute(gate, c);
  // Gate 1 must refuse for the right reason: exactly the expected error codes.
  row.tscRightReason = JSON.stringify([...row.gates.tsc.codes ?? []].sort()) === JSON.stringify([...c.expect].sort());
  results.push(row);
}

const failing = results.filter((r) => r.expect.length);
const valid = results.filter((r) => !r.expect.length);
const caught = (g) => failing.filter((r) => r.gates[g].refuse).map((r) => r.kind);
const falseRefusals = (g) => valid.filter((r) => r.gates[g].refuse).map((r) => r.from);
const summary = Object.fromEntries(Object.keys(GATES).map((g) => [g, { caught: caught(g), missed: failing.filter((r) => !r.gates[g].refuse).map((r) => r.kind), refusedValid: falseRefusals(g) }]));
const sameSet = (a, b) => JSON.stringify(caught(a)) === JSON.stringify(caught(b));
const report = {
  question: "Does a property-name allowlist from tools.d.ts catch the same failing cases as the tsc-rs checker?",
  answer: {
    strictAllowlistCatchesSameSetAsTsc: sameSet("allowlistStrict", "tsc"),
    lenientAllowlistCatchesSameSetAsTsc: sameSet("allowlistLenient", "tsc"),
    tscRefusedEveryFailingCaseForTheRightReason: failing.every((r) => r.tscRightReason),
    tscRefusedNoValidControl: valid.every((r) => !r.gates.tsc.refuse),
  },
  summary,
  allowlist: { fromDts: [...DTS_NAMES], builtinNames: BUILTIN_NAMES.size },
  runtime: `node ${process.version}, typescript ${ts.version} (parser and type stripping only)`,
  results,
};
writeFileSync(new URL("./results.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");

const cell = (r, g) => { const x = r.gates[g]; if (x.refuse) return "REFUSED"; return x.ran.threw ? "ran: threw" : `ran: returned ${JSON.stringify(x.ran.value)}`; };
for (const r of results) {
  console.log(`\n## ${r.kind} — ${r.from}`);
  console.log(`   no gate:   ${r.ungated.threw ? r.ungated.error : `returned ${JSON.stringify(r.ungated.value)}`}`);
  for (const g of Object.keys(GATES)) console.log(`   ${g.padEnd(17)} ${cell(r, g).padEnd(30)} ${(r.gates[g].reasons ?? []).join(" | ").slice(0, 160)}`);
}
console.log("\n" + JSON.stringify({ answer: report.answer, summary }, null, 2));
