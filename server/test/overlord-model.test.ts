// The Overlord's first model (docs/superpowers/specs/2026-11-09-overlord-design.md §11.7), W0's explicit-state
// Python model brought under test/model/overlord/ and run from here. Python's standard library only, `python3 -I -B`.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pythonOrSkip } from './ccgptHarness.js';

// The scenarios W0's final matrix (matrix.out) measures at 1.1 s or less at the defaults, the plan's rule;
// `nohold` measured 1.2 s there, so it runs only under CCRC_MODEL=full. `genback` (plan review 1902, F3) measured
// 0.06 s; `genmachine` and `renewal`, which also exercise a failed renewal's return, take 15 s and more.
const FAST = ['push', 'pause', 'race', 'asks', 'value', 'lineage', 'deadpush', 'restore', 'rebind', 'genback'];

const PY = pythonOrSkip();
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'model/overlord');
const CHECK = path.join(DIR, 'check.py');
const py = (args: string[], timeout = 60_000) =>
  execFileSync(PY!, ['-I', '-B', CHECK, ...args], { encoding: 'utf8', timeout });
const check = (...args: string[]) => JSON.parse(py(['--json', ...args]));

// The first name of every `import a` and `from a import` line.
function importsOf(file: string): string[] {
  const out: string[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*(?:import|from)\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(line);
    if (m) out.push(m[1]!);
  }
  return out;
}

describe.skipIf(PY === null)('the Overlord model (§11.7, the first model)', () => {
  // First in the file: a later run may have made __pycache__ already, which would hide a missing -B.
  it('a run writes no bytecode beside the model', () => {
    const pyc = path.join(DIR, '__pycache__');
    const before = existsSync(pyc);
    check('lineage');
    if (!before) expect(existsSync(pyc)).toBe(false);
  }, 60_000);
  it.each(FAST)('%s holds every invariant at the defaults', (sc) => {
    expect(check(sc)).toMatchObject({ scenario: sc, violated: [] });
  }, 60_000);
  // Since a degraded generation is never proven (review 1912, F5), 'previous' and 'proven' give the same state graph,
  // so no run tells them apart: the default reading is pinned in the text (F13), and the runs pin the rest.
  it('A2: the model reads a failed renewal as active only if proven, at its default and its SAFE baseline; the bare "active" reading is caught by X4', () => {
    expect(readFileSync(path.join(DIR, 'model.py'), 'utf8')).toMatch(/^\s*FAILED_RENEWAL_RETURNS='proven',/m);
    expect(readFileSync(CHECK, 'utf8')).toMatch(/^\s*FAILED_RENEWAL_RETURNS='proven'\)/m);
    expect(check('genback').violated).toEqual([]);
    expect(check('genback', 'FAILED_RENEWAL_RETURNS=active').violated).toContain('X4');
  }, 60_000);
  it('no_fence on rebind is caught by I5', () => {
    expect(check('rebind', 'MUTATION=no_fence').violated).toContain('I5');
  }, 60_000);
  it('the model imports only the standard library', () => {
    const allowed = new Set(['array', 'collections', 'json', 'os', 'sys', 'time', 'model']);
    for (const f of ['model.py', 'check.py'])
      for (const m of importsOf(path.join(DIR, f))) expect(allowed.has(m), `${f} imports ${m}`).toBe(true);
  });
  describe.runIf(process.env['CCRC_MODEL'] === 'full')('the whole matrix (by hand: CCRC_MODEL=full)', () => {
    it('every scenario holds every invariant at the defaults and ends under the bound', () => {
      const names = py(['--list']).split('\n')[0]!.replace(/^scenarios: /, '').split(', ');
      for (const sc of names) expect(check(sc), sc).toMatchObject({ scenario: sc, violated: [] });
    }, 600_000);
    it('every planted mutation that names an invariant is caught by it', () => {
      for (const r of JSON.parse(py(['--json', '--mutations'], 600_000)) as { mutation: string; expected: string; caught: string[] }[])
        if (/^[IXD]\d/.test(r.expected)) expect(r.caught, r.mutation).toContain(r.expected);
    }, 600_000);
  });
});
