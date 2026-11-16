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
// W1's four (plan w1-authority-journal, Task 1) measured 3 s, 6 s, 1 s and 0.5 s: `restore-w1`, `witness`,
// `writer-failure` and `malformed`. `confirm` (475,000 states, 12 s) runs only under CCRC_MODEL=full.
const FAST = ['push', 'pause', 'race', 'asks', 'value', 'lineage', 'deadpush', 'restore', 'rebind', 'genback',
  'restore-w1', 'witness', 'writer-failure', 'malformed'];

// W1's planted mutations. The first group runs in the default suite; the second needs the `confirm` scenario (a restore,
// Confirm, a second restore and a second Confirm: up to a million states), so it runs under CCRC_MODEL=full.
const W1_MUTATIONS_FAST = ['same_host_agent_counts', 'heads_not_checked', 'trailing_widening_applied',
  'append_over_incoherent', 'narrowing_refused_while_incoherent', 'narrowing_refused_on_append_failure',
  'writer_failure_unfenced', 'no_confirm_over_malformed', 'confirm_ignores_told', 'this_boot_witness_counts'];
const W1_MUTATIONS_FULL = ['epoch_in_db', 'confirm_no_epoch_raise', 'restore_generation_in_db',
  'generation_ignores_witnesses'];
type MutationRow = { mutation: string; expected: string; caught: string[] };
// A row's expected string names the invariants that must catch it ("WH, I7w"), or starts "none expected".
function expectMutations(names: string[], timeout: number): void {
  const rows = JSON.parse(py(['--json', '--mutations', ...names], timeout)) as MutationRow[];
  expect(rows.map((r) => r.mutation)).toEqual(names);
  for (const r of rows) {
    if (r.expected.startsWith('none expected')) expect(r.caught, r.mutation).toEqual([]);
    else
      for (const inv of r.expected.split(/,\s*/)) expect(r.caught, `${r.mutation} by ${inv}`).toContain(inv);
  }
}

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
  // 'previous' and 'proven' reach the same states (each lands where the other also can), so no state count tells them
  // apart (review 1920, R3). What pins the behaviour: the text pins the default's name; X6, an edge check, holds that a
  // renewal begun in degraded never returns to active (F5's proof ends with the conversation), and goes red when the
  // model keeps the proof; the fact that a failed renewal returns to active with a hold-off pins the other direction,
  // and goes unreachable when back() always degrades; X4 catches the bare 'active' reading.
  it('A2: the model reads a failed renewal as active only if proven, and the proof ends with the conversation (F5)', () => {
    expect(readFileSync(path.join(DIR, 'model.py'), 'utf8')).toMatch(/^\s*FAILED_RENEWAL_RETURNS='proven',/m);
    expect(readFileSync(CHECK, 'utf8')).toMatch(/^\s*FAILED_RENEWAL_RETURNS='proven'\)/m);
    const atDefault = check('genback');
    expect(atDefault.violated).toEqual([]);
    expect(atDefault.reachable).toContain('a failed renewal returns to active with a hold-off');
    expect(check('genback', 'FAILED_RENEWAL_RETURNS=active').violated).toContain('X4');
    expect(check('genback', 'MUTATION=proof_outlives_conversation').violated).toContain('X6');
    expect(check('genback', 'MUTATION=back_always_degraded').reachable).not.toContain('a failed renewal returns to active with a hold-off');
  }, 60_000);
  it('no_fence on rebind is caught by I5', () => {
    expect(check('rebind', 'MUTATION=no_fence').violated).toContain('I5');
  }, 60_000);
  it('the W1 mutations are each caught by the invariant they name, and the weakened mitigation is not caught', () => {
    expectMutations(W1_MUTATIONS_FAST, 120_000);
  }, 120_000);
  it('the W1 switch off leaves the W0 restore scenario as it was (AUTH_W1=False is the default)', () => {
    expect(readFileSync(path.join(DIR, 'model.py'), 'utf8')).toMatch(/^\s*AUTH_W1=False,/m);
    expect(check('restore')).toMatchObject({ states: 4563, transitions: 13002, violated: [] });
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
    it('the W1 mutations that need the confirm scenario are each caught by the invariant they name', () => {
      expectMutations(W1_MUTATIONS_FULL, 600_000);
    }, 600_000);
    it('every planted mutation that names an invariant is caught by it', () => {
      for (const r of JSON.parse(py(['--json', '--mutations'], 600_000)) as { mutation: string; expected: string; caught: string[] }[])
        if (/^[IXD]\d/.test(r.expected)) expect(r.caught, r.mutation).toContain(r.expected);
    }, 600_000);
  });
});
