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

const SUBJECT = `import tempfile

MODE = 0


def classify(n):
    if n < 0:
        return "neg"
    return "pos"


def other():
    return 42


def never():
    return 1


def leaky():
    tempfile.mkdtemp()
    return MODE
`;

const TESTS = `import os, time


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

    def t_leaky():
        _log("t_leaky")
        r = m.leaky()
        if r == 1:
            raise RuntimeError("boom")
        if r == 2:
            open(os.environ["READY"], "w").close()
            time.sleep(60)

    return {"t_classify_neg": t_classify_neg, "t_classify_pos": t_classify_pos,
            "t_other": t_other, "t_leaky": t_leaky}
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

function run(fx: Fx, extra: string[] = []): { code: number | null; lines: string[] } {
  const r = spawnSync('python3', args(fx, extra), {
    encoding: 'utf8', env: { ...process.env, TMPDIR: fx.systmp, CALLS_LOG: fx.log, READY: fx.ready },
  });
  return { code: r.status, lines: r.stdout.trim().split('\n') };
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
});
