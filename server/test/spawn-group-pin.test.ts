// A timed spawn of a shell, or of a script that forks, goes through `spawnSyncGroup` (#896; `spawnGroup.ts`, #172).
// `spawnSync(…, { timeout })` signals only its direct child: a `bash -c` that times out while waiting on a `sleep`,
// a `flock` or a `git` it started dies, and the grandchild runs on in the suite's process group. `spawnSyncGroup`
// runs the child in a group of its own and kills the whole group on a timeout.
//
// The census is `spawnGroupScan.ts`, which reads sources only through `scan/parse.ts`. Every timed
// `spawnSync`/`execFileSync` under server/test whose command is a shell, a wrapper or a script path must be a row of
// `SPAWN_GROUP_ALLOWLIST`, by file and command, with its exact count. A new site is red here until it uses
// `spawnSyncGroup`, and a converted site is red until its row is lowered. The list may only shrink, and
// `SPAWN_GROUP_CEILING` is what holds that: comparing the tree with the list passes a change that edits both.
import { describe, it, expect } from 'vitest';
import { REPO_ROOT } from './scan/symbols.js';
import { timedSpawnCensus, timedSpawnsInSource, type TimedSpawn } from './spawnGroupScan.js';
import { SPAWN_GROUP_ALLOWLIST } from './spawnGroupAllowlist.js';

// The sum of the allowlist's counts. It is held exactly, so a conversion lowers it by the same number in the same
// commit and leaves no slack for a new row to use. NEVER RAISE IT: a new timed spawn uses `spawnSyncGroup` instead.
// Measured: 150 once the census read renamed imports, conditional spreads and assignments, and part 1 of #896 had
// moved 28 sites.
const SPAWN_GROUP_CEILING = 150;

const kinds = (src: string): string[] => timedSpawnsInSource(src).map((s) => `${s.name} ${s.command} ${s.kind}`);

describe('the timed-spawn census (fixtures)', () => {
  it('CONTROL: a timed shell spawn is counted; an untimed one, and one through spawnSyncGroup, are not', () => {
    expect(kinds("spawnSync('bash', ['-c', 'sleep 1'], { encoding: 'utf8', timeout: 5_000 });"))
      .toEqual(["spawnSync 'bash' shell"]);
    expect(kinds("spawnSync('bash', ['-c', 'sleep 1'], { encoding: 'utf8' });")).toEqual([]);
    expect(kinds("spawnSyncGroup('bash', ['-c', 'sleep 1'], { encoding: 'utf8', timeout: 5_000 });")).toEqual([]);
    expect(kinds("execFileSync('/bin/sh', ['-c', 'x'], { timeout: 1 });")).toEqual(["execFileSync '/bin/sh' shell"]);
    expect(kinds("cp.spawnSync('sh', [], { timeout: 1 }); x.spawnSyncLater('sh', [], { timeout: 1 });"))
      .toEqual(["spawnSync 'sh' shell"]);
  });

  it('CONTROL: options passed by name, by spread or through a cast are followed to their timeout', () => {
    expect(kinds("const opts = { encoding: 'utf8' as const, timeout: 9 };\nspawnSync('bash', ['-c', 'x'], opts);"))
      .toEqual(["spawnSync 'bash' shell"]);
    expect(kinds("const base = { timeout: 9 };\nconst opts = { ...base };\nspawnSync('bash', [], { ...opts, stdio: 'pipe' });"))
      .toEqual(["spawnSync 'bash' shell"]);
    expect(kinds("const opts = { timeout: 9 };\nspawnSync('bash', [], opts as never);")).toEqual(["spawnSync 'bash' shell"]);
    expect(kinds("const opts = { encoding: 'utf8' };\nspawnSync('bash', [], opts);")).toEqual([]);
    // The innermost binding wins: the outer `opts` has a timeout, the one in scope at the call does not.
    expect(kinds("const opts = { timeout: 9 };\nfunction f() { const opts = { cwd: '/' }; spawnSync('bash', [], opts); }"))
      .toEqual([]);
  });

  it('CONTROL: a command is classed by what it runs, through its binding', () => {
    expect(kinds("const BASH = spawnSync('sh', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();\n"
      + "spawnSync(BASH, ['-c', 'x'], { timeout: 1 });")).toEqual(['spawnSync BASH shell']);
    expect(kinds("spawnSync(real('bash'), [], { timeout: 1 }); spawnSync(path.join(bin, 'bash'), [], { timeout: 1 });"))
      .toEqual(["spawnSync real('bash') shell", "spawnSync path.join(bin, 'bash') shell"]);
    expect(kinds("const S = path.join(dir, 'run.sh');\nspawnSync(S, [], { timeout: 1 }); spawnSync(file, [], { timeout: 1 });"))
      .toEqual(['spawnSync S script', 'spawnSync file script']);
    expect(kinds("spawnSync('/usr/bin/prlimit', ['--fsize=0', 'x'], { timeout: 1 });"))
      .toEqual(["spawnSync '/usr/bin/prlimit' wrapper"]);
    expect(kinds("spawnSync('git', ['status'], { timeout: 1 }); spawnSync(process.execPath, ['-e', '1'], { timeout: 1 });"
      + "\nconst PY = pythonOrSkip();\nspawnSync(PY!, ['-c', '1'], { timeout: 1 });"
      + "\nconst node = [process.execPath, '-e', '1'];\nspawnSync(node[0]!, node.slice(1), { timeout: 1 });"))
      .toEqual(["spawnSync 'git' plain", 'spawnSync process.execPath plain', 'spawnSync PY! plain',
        'spawnSync node[0]! plain']);
  });

  it('a renamed import, a name bound to a spawn and a cast callee are the spawn they name', () => {
    expect(kinds("import { spawnSync as run } from 'node:child_process';\nrun('bash', ['-c', 'x'], { timeout: 1 });"))
      .toEqual(["spawnSync 'bash' shell"]);
    expect(kinds("import { execFileSync as ef } from 'node:child_process';\nef(SRC, [], { timeout: 1 });"))
      .toEqual(['execFileSync SRC script']);
    expect(kinds("const run = spawnSync;\nrun('bash', [], { timeout: 1 });")).toEqual(["spawnSync 'bash' shell"]);
    expect(kinds("const run = cp.spawnSync;\nrun('bash', [], { timeout: 1 });")).toEqual(["spawnSync 'bash' shell"]);
    expect(kinds("(spawnSync as unknown as Spawn)('bash', [], { timeout: 1 });")).toEqual(["spawnSync 'bash' shell"]);
    // CONTROL: a member that shares the alias's name is not it, and neither is the group helper under any name.
    expect(kinds("import { spawnSync as run } from 'node:child_process';\nobj.run('bash', [], { timeout: 1 });")).toEqual([]);
    expect(kinds("import { spawnSyncGroup as run } from './spawnGroup.js';\nrun('bash', [], { timeout: 1 });")).toEqual([]);
  });

  it('a `timeout` is read from the parsed object, so no spelling or comment hides it', () => {
    const shell = ["spawnSync 'bash' shell"];
    expect(kinds("spawnSync('bash', [], {\n  encoding: 'utf8', // why\n  timeout: 5,\n});")).toEqual(shell);
    expect(kinds("spawnSync('bash', [], {\n  // why\n  timeout: 5,\n});")).toEqual(shell);
    expect(kinds("spawnSync('bash', [], { /* why */ timeout: 5 });")).toEqual(shell);
    expect(kinds("spawnSync('bash', [], { 'timeout': 5 });")).toEqual(shell);
    expect(kinds("spawnSync('bash', [], { ['timeout']: 5 });")).toEqual(shell);
    expect(kinds("const opts = {\n  cwd: '/', // why\n  timeout: 5,\n};\nspawnSync('bash', [], opts);")).toEqual(shell);
    // CONTROL: `timeout` in a nested object, a value or a comment is not the option.
    expect(kinds("spawnSync('bash', [], { env: { timeout: '1' }, input: 'timeout: 1' /* timeout: 1 */ });")).toEqual([]);
  });

  it('a `timeout` in any arm of a conditional or a logical expression counts', () => {
    const shell = ["spawnSync 'bash' shell"];
    expect(kinds("spawnSync('bash', [], { encoding: 'utf8', ...(t === undefined ? {} : { timeout: t }) });")).toEqual(shell);
    expect(kinds("spawnSync('bash', [], { ...(o.t === undefined ? {} : { timeout: o.t }) });")).toEqual(shell);
    expect(kinds("spawnSync('bash', [], { ...(t !== undefined && { timeout: t }) });")).toEqual(shell);
    expect(kinds("spawnSync('bash', [], c ? { timeout: 1 } : {});")).toEqual(shell);
    expect(kinds("spawnSync('bash', [], (c ? {} : { timeout: 1 }) as never);")).toEqual(shell);
    expect(kinds("const o = c ? { timeout: 1 } : { cwd: '/' };\nspawnSync('bash', [], o);")).toEqual(shell);
    // CONTROL: an arm with no timeout is not one, and the guard of an `&&` adds nothing.
    expect(kinds("spawnSync('bash', [], { ...(cwd === undefined ? {} : { cwd }) });")).toEqual([]);
    expect(kinds("spawnSync('bash', [], { ...(cwd !== undefined && { cwd }) });")).toEqual([]);
  });

  it('an assignment in scope gives a bound options object its timeout', () => {
    const shell = ["spawnSync 'bash' shell"];
    expect(kinds("const opts: O = { encoding: 'utf8' };\nif (ms) { opts.timeout = ms; }\nspawnSync('bash', [], opts);"))
      .toEqual(shell);
    expect(kinds("const opts: O = {};\nopts['timeout'] = ms;\nspawnSync('bash', [], opts);")).toEqual(shell);
    expect(kinds("let opts: O = {};\nopts = { timeout: 1 };\nspawnSync('bash', [], opts);")).toEqual(shell);
    expect(kinds("let opts: O = {};\nopts = mkOpts();\nspawnSync('bash', [], opts);")).toEqual(shell);
    expect(kinds("const opts: O = {};\nObject.assign(opts, { timeout: 1 });\nspawnSync('bash', [], opts);")).toEqual(shell);
    // CONTROL: another member, another object, or the same name in another scope gives it none.
    expect(kinds("const opts: O = {};\nopts.cwd = '/';\nspawnSync('bash', [], opts);")).toEqual([]);
    expect(kinds("const opts: O = {};\nconst other: O = {};\nother.timeout = 1;\nspawnSync('bash', [], opts);")).toEqual([]);
    expect(kinds("function a() { const opts: O = {}; opts.timeout = 1; }\n"
      + "function b() { const opts: O = {}; spawnSync('bash', [], opts); }")).toEqual([]);
  });

  it('options the scan cannot read count as timed, except in the argument straight after the command', () => {
    const shell = ["spawnSync 'bash' shell"];
    expect(kinds("function f(opts: O) { spawnSync('bash', [], opts); }")).toEqual(shell);
    expect(kinds("spawnSync('bash', [], mkOpts());")).toEqual(shell);
    expect(kinds("spawnSync('bash', [], h.opts);")).toEqual(shell);
    expect(kinds("spawnSync('bash', [], { ...h.opts, encoding: 'utf8' });")).toEqual(shell);
    expect(kinds("function f(extra: O) { spawnSync('bash', [], { ...extra, encoding: 'utf8' }); }")).toEqual(shell);
    expect(kinds("spawnSync('bash', [], { [k]: 1 });")).toEqual(shell);
    expect(kinds("spawnSync(...args);")).toEqual(['spawnSync ...args script']);
    // CONTROL: an argv in that slot is not options, and `undefined` is no options at all.
    expect(kinds("spawnSync('bash', ['-c', 'x']);")).toEqual([]);
    expect(kinds("function f(argv: string[]) { spawnSync('bash', argv); spawnSync('sh', argv.slice(1)); }")).toEqual([]);
    expect(kinds("spawnSync('bash', [], undefined);")).toEqual([]);
    expect(kinds("spawnSync('bash', { timeout: 1 });")).toEqual(shell);
  });
});

describe('timed shell and script spawns in server/test go through spawnSyncGroup (#896)', () => {
  const census: TimedSpawn[] = timedSpawnCensus(REPO_ROOT);
  const key = (file: string, command: string): string => `${file}  ${command}`;

  it('the census sees the tree: it reads at least one timed spawn the allowlist names', () => {
    expect(census.length, 'the census found no timed spawn at all: the scan is broken, not the tree clean')
      .toBeGreaterThan(0);
  });

  it('every timed shell, wrapper or script spawn is a row of the allowlist, with its exact count (may only shrink)', () => {
    const seen = new Map<string, number>();
    for (const s of census) {
      const k = key(s.file.replace(/^server\/test\//, ''), s.command);
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    const allowed = new Map(SPAWN_GROUP_ALLOWLIST.map((r) => [key(r.file, r.command), r.count]));
    const over = [...seen].filter(([k, n]) => n > (allowed.get(k) ?? 0))
      .map(([k, n]) => `${k}: ${n} in the tree, ${allowed.get(k) ?? 0} allowed — use spawnSyncGroup (spawnGroup.ts)`);
    const under = [...allowed].filter(([k, n]) => (seen.get(k) ?? 0) < n)
      .map(([k, n]) => `${k}: ${seen.get(k) ?? 0} in the tree, ${n} allowed — lower the row in spawnGroupAllowlist.ts`);
    const lines = census.map((s) => `  ${s.file}:${s.line}  ${s.name}(${s.command})  ${s.kind}`);
    console.log(`timed spawns outside spawnSyncGroup: ${census.length}\n${lines.join('\n')}`);
    expect(over, 'new timed shell or script spawns').toEqual([]);
    expect(under, 'allowlist rows above the tree').toEqual([]);
  });

  it('the allowlist may only shrink: its counts sum to the ceiling, which may only be lowered', () => {
    const sum = SPAWN_GROUP_ALLOWLIST.reduce((n, r) => n + r.count, 0);
    expect(sum, 'a row was added or raised (use spawnSyncGroup), or a conversion left SPAWN_GROUP_CEILING behind (lower it)')
      .toBe(SPAWN_GROUP_CEILING);
  });

  it('the allowlist has one row per file and command, each with a positive count', () => {
    const keys = SPAWN_GROUP_ALLOWLIST.map((r) => key(r.file, r.command));
    expect(keys.length - new Set(keys).size, 'a duplicated row').toBe(0);
    expect(SPAWN_GROUP_ALLOWLIST.filter((r) => !(Number.isInteger(r.count) && r.count > 0))).toEqual([]);
  });
});
