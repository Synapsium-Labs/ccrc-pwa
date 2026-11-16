// server/test/mutation-run-helper.test.ts
// The mutation-run helper (ccd/coordinator-skill/references/mutation-run.py) drives a
// fixture subject through a private RAM-root stand-in directory and must leave that
// root empty: a mutation round that writes a file per mutant and never removes it
// once filled a fleet volume's inodes.
import { describe, it, expect, afterEach } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);
const HELPER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../ccd/coordinator-skill/references/mutation-run.py');

const SUBJECT = `import sys
import tempfile

MODE = 0
CACHE = tempfile.mkdtemp()


def classify(n):
    if n < 0:
        return "neg"
    return "pos"


def other():
    return 42


def table():
    return {"k": 7}


def bail(n):
    if n < 0:
        sys.exit(3)
    return n


def never():
    return 1


def leaky():
    tempfile.mkdtemp()
    return MODE
`;

const TESTS = `import os, tempfile, time


def _log(name):
    p = os.environ.get("CALLS_LOG")
    if p:
        with open(p, "a") as f:
            f.write(name + "\\n")


def suite(m):
    def t_classify_neg():
        _log("t_classify_neg")
        assert m.classify(-1) == "neg"

    def t_classify_pos():
        _log("t_classify_pos")
        assert m.classify(1) == "pos"

    def t_other():
        _log("t_other")
        assert m.other() == 42

    tbl = m.table()
    tmp = tempfile.mkdtemp()

    def t_table():
        _log("t_table")
        assert tbl["k"] == 7

    def t_bail():
        _log("t_bail")
        assert m.bail(1) == 1

    def t_leaky():
        _log("t_leaky")
        r = m.leaky()
        if r == 1:
            raise RuntimeError("boom")
        if r == 2:
            open(os.environ["READY"], "w").close()
            time.sleep(60)

    return {"t_classify_neg": t_classify_neg, "t_classify_pos": t_classify_pos,
            "t_other": t_other, "t_table": t_table, "t_bail": t_bail, "t_leaky": t_leaky}
`;

interface Fx { dir: string; root: string; systmp: string; log: string; ready: string; mutations: string; out: string }

function fixture(mutations: Array<{ id: string; old: string; new: string }>): Fx {
  const dir = mkTmp('ccrc-mutrun-');
  const root = path.join(dir, 'ramroot');
  mkdirSync(root);
  const systmp = path.join(dir, 'systmp');
  mkdirSync(systmp);
  writeFileSync(path.join(dir, 'subject.py'), SUBJECT);
  writeFileSync(path.join(dir, 'tests.py'), TESTS);
  const mpath = path.join(dir, 'mut.json');
  writeFileSync(mpath, JSON.stringify(mutations));
  return { dir, root, systmp, log: path.join(dir, 'calls.log'), ready: path.join(dir, 'ready'), mutations: mpath, out: path.join(dir, 'out.json') };
}

function args(fx: Fx, extra: string[] = []): string[] {
  return [HELPER, '--module', path.join(fx.dir, 'subject.py'), '--tests', `${path.join(fx.dir, 'tests.py')}:suite`,
    '--mutations', fx.mutations, '--tmp-root', fx.root, ...extra];
}

function run(fx: Fx, extra: string[] = [], argv?: string[]): { code: number | null; lines: string[]; err: string[] } {
  const r = spawnSync('python3', argv ?? args(fx, extra), {
    encoding: 'utf8', env: { ...process.env, TMPDIR: fx.systmp, CALLS_LOG: fx.log, READY: fx.ready },
  });
  return { code: r.status, lines: r.stdout.trim().split('\n'), err: r.stderr.trim().split('\n').filter(Boolean) };
}

// Start the helper on a run whose last mutant hangs in t_leaky, wait for the hang, send `sig`.
async function interrupt(fx: Fx, sig: NodeJS.Signals): Promise<{ code: number | null; stdout: string }> {
  const child = spawn('python3', args(fx, ['--out', fx.out]), { env: { ...process.env, TMPDIR: fx.systmp, CALLS_LOG: fx.log, READY: fx.ready } });
  let stdout = '';
  child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
  const exited = new Promise<number | null>((res) => child.on('exit', (c) => res(c)));
  const deadline = Date.now() + 20_000;
  while (!existsSync(fx.ready) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  expect(existsSync(fx.ready)).toBe(true);
  child.kill(sig);
  const code = await exited;
  return { code, stdout };
}

const calls = (fx: Fx, name: string): number =>
  (existsSync(fx.log) ? readFileSync(fx.log, 'utf8').split('\n') : []).filter((l) => l === name).length;

describe('mutation-run helper', () => {
  it('kills a mutated module-level constant with coverage on', () => {
    const fx = fixture([{ id: 'const', old: 'MODE = 0', new: 'MODE = 1' }]);
    const r = run(fx);
    expect(r.lines[0]).toBe('const\tkilled\tt_leaky');
    expect(readdirSync(fx.systmp)).toEqual([]);
  });

  it('keeps a survivor through three carry rounds and exits 1 each time', () => {
    const fx = fixture([
      { id: 'S', old: 'return 1\n', new: 'return 2\n' },
      { id: 'K', old: 'return 42', new: 'return 43' },
    ]);
    const diff = path.join(fx.dir, 'c.diff');
    const out2 = path.join(fx.dir, 'out2.json');
    writeFileSync(diff, '--- a/subject.py\n+++ b/subject.py\n@@ -1,1 +1,1 @@\n-import os\n+import tempfile\n');
    const r1 = run(fx, ['--no-coverage', '--out', fx.out]);
    expect(r1.code).toBe(1);
    expect(r1.lines[0]).toMatch(/^S\tsurvived/);
    const r2 = run(fx, ['--no-coverage', '--previous', fx.out, '--diff', diff, '--out', out2]);
    expect(r2.lines[1]).toBe('K\tcarried\tkilled');
    expect(r2.code).toBe(1);
    const r3 = run(fx, ['--no-coverage', '--previous', out2, '--diff', diff]);
    expect(r3.lines[0]).toMatch(/^S\tsurvived/);
    expect(r3.lines[1]).toBe('K\tcarried\tkilled');
    expect(r3.code).toBe(1);
  });

  it('re-runs everything when the diff touches the tests file', () => {
    const fx = fixture([{ id: 'K', old: 'return 42', new: 'return 43' }]);
    run(fx, ['--out', fx.out]);
    const diff = path.join(fx.dir, 'c.diff');
    writeFileSync(diff, '--- a/tests.py\n+++ b/tests.py\n@@ -1,1 +1,1 @@\n-x\n+import os, time\n');
    expect(run(fx, ['--previous', fx.out, '--diff', diff]).lines[0]).toMatch(/^K\tkilled/);
  });

  it('leaves no temp tree behind, even though the tests themselves call mkdtemp', () => {
    const fx = fixture([
      { id: 'a', old: 'return "neg"', new: 'return "pos"' },
      { id: 'b', old: 'return MODE', new: 'return MODE + 1' },
    ]);
    const r = run(fx);
    expect(r.lines[0]).toMatch(/^a\tkilled/);
    expect(r.lines[1]).toMatch(/^b\tkilled/);
    expect(readdirSync(fx.root)).toEqual([]);
    expect(readdirSync(fx.systmp)).toEqual([]);
  });

  it('cleans up when a mutant makes a test raise', () => {
    const fx = fixture([{ id: 'boom', old: 'return MODE', new: 'return 1' }]);
    const r = run(fx);
    expect(r.lines[0]).toBe('boom\tkilled\tt_leaky');
    expect(readdirSync(fx.root)).toEqual([]);
    expect(readdirSync(fx.systmp)).toEqual([]);
  });

  it('cleans up when the run is terminated mid-mutant', async () => {
    const fx = fixture([{ id: 'hang', old: 'return MODE', new: 'return 2' }]);
    const child = spawn('python3', args(fx), { env: { ...process.env, TMPDIR: fx.systmp, CALLS_LOG: fx.log, READY: fx.ready } });
    const deadline = Date.now() + 20_000;
    while (!existsSync(fx.ready) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    expect(existsSync(fx.ready)).toBe(true);
    const exited = new Promise<number | null>((res) => child.on('exit', (c) => res(c)));
    child.kill('SIGTERM');
    expect(await exited).toBe(143);
    expect(readdirSync(fx.root)).toEqual([]);
    expect(readdirSync(fx.systmp)).toEqual([]);
  });

  it('runs only the tests that execute the mutated lines', () => {
    const fx = fixture([{ id: 'o', old: 'return 42', new: 'return 43' }]);
    const r = run(fx);
    expect(r.lines[0]).toBe('o\tkilled\tt_other');
    // baseline + traced baseline + (mutant: only the covering test)
    expect(calls(fx, 't_other')).toBe(3);
    expect(calls(fx, 't_classify_neg')).toBe(2);
  });

  it('reports a mutant no test executes as uncovered, and survived without coverage mapping', () => {
    const fx = fixture([{ id: 'n', old: 'return 1\n', new: 'return 2\n' }]);
    expect(run(fx).lines[0]).toMatch(/^n\tuncovered/);
    const r = run(fx, ['--no-coverage']);
    expect(r.lines[0]).toMatch(/^n\tsurvived/);
    expect(r.code).toBe(1);
  });

  it('marks a mutation whose old text is not unique as invalid', () => {
    const fx = fixture([{ id: 'dup', old: 'return', new: 'pass' }]);
    expect(run(fx).lines[0]).toMatch(/^dup\tinvalid/);
  });

  it('exits 2 when any mutation is invalid, even beside a killed one', () => {
    const fx = fixture([
      { id: 'dup', old: 'return', new: 'pass' },
      { id: 'K', old: 'return 42', new: 'return 43' },
    ]);
    const r = run(fx);
    expect(r.lines[0]).toMatch(/^dup\tinvalid/);
    expect(r.lines[1]).toBe('K\tkilled\tt_other');
    expect(r.code).toBe(2);
  });

  it('re-runs only mutants on lines a diff changed, carrying the rest', () => {
    const fx = fixture([
      { id: 'A', old: 'return "neg"', new: 'return "pos"' },
      { id: 'B', old: 'return 42', new: 'return 43' },
    ]);
    expect(run(fx, ['--out', fx.out]).lines[0]).toMatch(/^A\tkilled/);
    const otherLine = SUBJECT.split('\n').findIndex((l) => l.includes('return 42')) + 1;
    const diff = path.join(fx.dir, 'c.diff');
    writeFileSync(diff, `--- a/subject.py\n+++ b/subject.py\n@@ -${otherLine},1 +${otherLine},1 @@\n-    return 41\n+    return 42\n`);
    writeFileSync(fx.log, '');
    const r = run(fx, ['--previous', fx.out, '--diff', diff]);
    expect(r.lines[0]).toBe('A\tcarried\tkilled');
    expect(r.lines[1]).toBe('B\tkilled\tt_other');
    // A's tests ran only in the two baselines, never for the carried mutant
    expect(calls(fx, 't_classify_neg')).toBe(2);
  });

  it('refuses to run mutants when the unmutated baseline fails', () => {
    const fx = fixture([{ id: 'a', old: 'return "neg"', new: 'return "pos"' }]);
    writeFileSync(path.join(fx.dir, 'subject.py'), SUBJECT.replace('return "pos"', 'return "broken"'));
    const r = run(fx);
    expect(r.code).toBe(2);
    expect(r.lines.join('')).not.toMatch(/killed|survived/);
    expect(readdirSync(fx.root)).toEqual([]);
    expect(readdirSync(fx.systmp)).toEqual([]);
  });

  it('reports a mutant that calls sys.exit as killed and still runs the later mutants', () => {
    const fx = fixture([
      { id: 'ex', old: 'if n < 0:\n        sys.exit(3)', new: 'if n > 0:\n        sys.exit(3)' },
      { id: 'o', old: 'return 42', new: 'return 43' },
    ]);
    const r = run(fx);
    expect(r.lines[0]).toMatch(/^ex\tkilled/);
    expect(r.lines[1]).toBe('o\tkilled\tt_other');
    expect(r.lines[2]).toMatch(/^summary:/);
    expect(readdirSync(fx.systmp)).toEqual([]);
  });

  it('kills a mutant on a line only the suite setup runs, with coverage on', () => {
    const fx = fixture([{ id: 'tbl', old: 'return {"k": 7}', new: 'return {"k": 8}' }]);
    const r = run(fx);
    expect(r.lines[0]).toBe('tbl\tkilled\tt_table');
    expect(r.code).toBe(0);
  });

  it('leaves the session temp dir empty when the suite setup and the module import call mkdtemp', () => {
    const fx = fixture([
      { id: 'a', old: 'return 42', new: 'return 43' },
      { id: 'b', old: 'return "neg"', new: 'return "pos"' },
    ]);
    run(fx);
    expect(readdirSync(fx.systmp)).toEqual([]);
    expect(readdirSync(fx.root)).toEqual([]);
    run(fx, ['--no-coverage']);
    expect(readdirSync(fx.systmp)).toEqual([]);
    expect(readdirSync(fx.root)).toEqual([]);
  });
});

describe('mutation-run helper: interrupts, unusable input and diff parsing', () => {
  it('does not count SIGINT as a kill: exits 130 with no killed line, no --out, nothing left behind', async () => {
    const fx = fixture([{ id: 'hang', old: 'return MODE', new: 'return 2' }]);
    const r = await interrupt(fx, 'SIGINT');
    expect(r.code).toBe(130);
    expect(r.stdout).not.toMatch(/\tkilled/);
    expect(existsSync(fx.out)).toBe(false);
    expect(readdirSync(fx.root)).toEqual([]);
    expect(readdirSync(fx.systmp)).toEqual([]);
  });

  it('prints each result as produced and writes the results so far, marked partial, on SIGTERM', async () => {
    const fx = fixture([
      { id: 'K', old: 'return 42', new: 'return 43' },
      { id: 'hang', old: 'return MODE', new: 'return 2' },
    ]);
    const r = await interrupt(fx, 'SIGTERM');
    expect(r.code).toBe(143);
    expect(r.stdout.split('\n')[0]).toBe('K\tkilled\tt_other');
    const out = JSON.parse(readFileSync(fx.out, 'utf8')) as { partial: boolean; results: Array<{ id: string; status: string }> };
    expect(out.partial).toBe(true);
    expect(out.results.map((x) => [x.id, x.status])).toEqual([['K', 'killed']]);
    expect(readdirSync(fx.root)).toEqual([]);
    expect(readdirSync(fx.systmp)).toEqual([]);
  });

  it('prints one line and exits 2 on unusable input', () => {
    const fx = fixture([{ id: 'K', old: 'return 42', new: 'return 43' }]);
    const cases: Array<string | null> = ['{not json', JSON.stringify([{ id: 'x', old: 'return 42' }]),
      JSON.stringify([{ old: 'a', new: 'b' }]), JSON.stringify([{ id: 'x', old: 7, new: 'b' }]), JSON.stringify({ id: 'x' })];
    for (const body of cases) {
      writeFileSync(fx.mutations, body as string);
      const r = run(fx);
      expect(r.code, body as string).toBe(2);
      expect(r.err, body as string).toHaveLength(1);
      expect(r.lines.join(''), body as string).not.toMatch(/killed|survived|summary/);
    }
    writeFileSync(fx.mutations, JSON.stringify([{ id: 'K', old: 'return 42', new: 'return 43' }]));
    const full = args(fx);
    const without = (flag: string): string[] => { const i = full.indexOf(flag); return [...full.slice(0, i), ...full.slice(i + 2)]; };
    for (const flag of ['--module', '--tests']) {
      const r = run(fx, [], without(flag));
      expect(r.code, flag).toBe(2);
      expect(r.err, flag).toHaveLength(1);
    }
  });

  it('reads an empty line inside a hunk as context, and header-like lines inside a hunk as content', () => {
    const fx = fixture([{ id: 'B', old: 'return 42', new: 'return 43' }]);
    expect(run(fx, ['--out', fx.out]).lines[0]).toBe('B\tkilled\tt_other');
    const L = SUBJECT.split('\n').findIndex((l) => l.includes('return 42')) + 1;
    const diff = path.join(fx.dir, 'c.diff');
    // the blank line before `def other():` arrives as an empty line (trailing whitespace stripped)
    writeFileSync(diff, `--- a/subject.py\n+++ b/subject.py\n@@ -${L - 2},3 +${L - 2},3 @@\n\n def other():\n-    return 41\n+    return 42\n`);
    expect(run(fx, ['--previous', fx.out, '--diff', diff]).lines[0]).toBe('B\tkilled\tt_other');
    // a deleted line whose text starts `-- ` reads `--- ...` inside the hunk; it still touches line L
    writeFileSync(diff, `--- a/subject.py\n+++ b/subject.py\n@@ -${L},2 +${L},1 @@\n--- old note\n     return 42\n`);
    expect(run(fx, ['--previous', fx.out, '--diff', diff]).lines[0]).toBe('B\tkilled\tt_other');
    // an added line reading `+++ b/tests.py` inside a module hunk is content, not a tests-file header
    writeFileSync(diff, `--- a/subject.py\n+++ b/subject.py\n@@ -1,1 +1,2 @@\n+++ b/tests.py\n import sys\n`);
    expect(run(fx, ['--previous', fx.out, '--diff', diff]).lines[0]).toBe('B\tcarried\tkilled');
  });
});
