// Shared test cases: the same inputs go to Node (bench.mjs) and the Worker (worker-test.mjs).
// Each case lists the TypeScript error codes it must produce. [] means "must be clean".

export const TSCONFIG = JSON.stringify({
  compilerOptions: {
    strict: true, noEmit: true, target: "es2022", lib: ["es2022"], types: [],
    skipLibCheck: true, module: "esnext", moduleResolution: "bundler",
  },
  include: ["*.ts"],
});

// A tool surface an agent writes code against, as it could be generated from tool schemas.
export const TOOLS_DTS = `
declare const workspace: {
  exec(input: { command: string; cwd?: string }): Promise<{ stdout: string; stderr: string; exitCode: number }>;
  readFile(input: { path: string }): Promise<string>;
};
`;

export const CASES = [
  {
    name: "unknown misuse",
    expect: [18046],
    src: `export const process = (state: Record<string, unknown>) => {
  state.data = "corrupted";
  return state.nonExistentMethod.panic();
};`,
  },
  {
    name: "valid plain code",
    expect: [],
    src: `export const add = (a: number, b: number): number => a + b;
export const xs = [1, 2, 3].map((x) => add(x, 1));`,
  },
  {
    name: "tool call: wrong argument shape",
    expect: [2345],
    src: `export default async () => { const r = await workspace.exec("ls -la"); return r.stdout; };`,
  },
  {
    name: "tool call: made-up method and field",
    expect: [2339, 2339],
    src: `export default async () => {
  await workspace.writeFile({ path: "/a", text: "x" });
  const r = await workspace.exec({ command: "ls" });
  return r.output;
};`,
  },
  {
    name: "tool call: valid",
    expect: [],
    src: `export default async () => {
  const r = await workspace.exec({ command: "ls", cwd: "/tmp" });
  return r.exitCode === 0 ? r.stdout : r.stderr;
};`,
  },
];

export const sameCodes = (got, want) =>
  JSON.stringify([...got].sort()) === JSON.stringify([...want].sort());
