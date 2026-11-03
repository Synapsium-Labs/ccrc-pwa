// A timed spawn of a shell, or of a script that forks, goes through `spawnSyncGroup` (#896; `spawnGroup.ts`, #172).
// `spawnSync(…, { timeout })` signals only its direct child: a `bash -c` that times out while waiting on a `sleep`,
// a `flock` or a `git` it started dies, and the grandchild runs on in the suite's process group. `spawnSyncGroup`
// runs the child in a group of its own and kills the whole group on a timeout.
//
// The census is `spawnGroupScan.ts`, which reads sources only through `scan/parse.ts`. Every timed
// `spawnSync`/`execFileSync` under server/test whose command is a shell, a wrapper or a script path must be a row of
// `SPAWN_GROUP_ALLOWLIST`, by file and command, with its exact count. The list may only shrink: a new site is red
// here until it uses `spawnSyncGroup`, and a converted site is red until its row is lowered.
import { describe, it, expect } from 'vitest';
import { REPO_ROOT } from './scan/symbols.js';
import { timedSpawnCensus, timedSpawnsInSource, type TimedSpawn } from './spawnGroupScan.js';
import { SPAWN_GROUP_ALLOWLIST } from './spawnGroupAllowlist.js';

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

  it('the allowlist has one row per file and command, each with a positive count', () => {
    const keys = SPAWN_GROUP_ALLOWLIST.map((r) => key(r.file, r.command));
    expect(keys.length - new Set(keys).size, 'a duplicated row').toBe(0);
    expect(SPAWN_GROUP_ALLOWLIST.filter((r) => !(Number.isInteger(r.count) && r.count > 0))).toEqual([]);
  });
});
