// codex-bridge-absorb.test.ts — `ccd/codexbridge/absorb.py`, the pure decision of what the bridge tries again and when
// (D-9078, plan 2026-11-25). The acting half is in codex-bridge-server.test.ts.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { pythonOrSkip } from './ccgptHarness.js';
import { CCD_DIR } from './codexBridgeFixture.js';

const PY = pythonOrSkip();

/** Each expression over the module `absorb`, evaluated in one `python3 -I` with no environment of this process. */
function evaluate(exprs: string[]): unknown[] {
  const prog = 'import json, sys\nsys.dont_write_bytecode = True\nsys.path.insert(0, sys.argv[1])\n'
    + 'from codexbridge import absorb\nprint(json.dumps([eval(e, {"absorb": absorb}) for e in json.loads(sys.argv[2])]))\n';
  const r = spawnSync(PY!, ['-I', '-c', prog, CCD_DIR, JSON.stringify(exprs)], { encoding: 'utf8', timeout: 30_000, env: { PATH: process.env.PATH ?? '' } });
  expect(r.status, r.stderr).toBe(0);
  return JSON.parse(r.stdout) as unknown[];
}
const delay = (retries: number, o: { took?: number; spent?: number; after?: number | null; rand?: number } = {}): string =>
  `absorb.delay(${retries}, took_s=${o.took ?? 0.2}, spent_s=${o.spent ?? 0}, retry_after_s=${o.after ?? 'None'}, rand=lambda: ${o.rand ?? 0.5})`;

describe.skipIf(!PY)('absorb.py: which failure, and when', () => {
  it('its bounds are the plan\'s', () => {
    expect(evaluate(['absorb.BUDGET_S', 'absorb.FIRST_S', 'absorb.CAP_S', 'absorb.JITTER', 'absorb.FAST_S', 'list(absorb.WORDS)']))
      .toEqual([120, 1, 20, 0.25, 30, ['overloaded', 'unavailable', 'transport']]);
  });

  it('a word only for the two rows, transport with no answer, none once a response ended', () => {
    const rows = ['overflow', 'billing', 'rate', 'ineligible', 'policy', 'refused', 'auth', 'capability'];
    expect(evaluate(rows.flatMap((k) => [`absorb.word("${k}", 503, False)`, `absorb.word("${k}", None, False)`])))
      .toEqual(rows.flatMap(() => [null, null]));
    expect(evaluate(['absorb.word("overloaded", 503, False)', 'absorb.word("overloaded", 200, False)', 'absorb.word("unavailable", 502, False)',
      'absorb.word("unavailable", None, False)', 'absorb.word("unavailable", 200, True)', 'absorb.word("overloaded", 200, True)']))
      .toEqual(['overloaded', 'overloaded', 'unavailable', 'transport', null, null]);
  });

  it('the waits double from FIRST_S to CAP_S, spread by JITTER and never past CAP_S', () => {
    expect(evaluate([0, 1, 2, 3, 4, 5, 9, 400].map((n) => delay(n)))).toEqual([1, 2, 4, 8, 16, 20, 20, 20]);
    expect(evaluate([delay(0, { rand: 0 }), delay(0, { rand: 1 }), delay(5, { rand: 0 }), delay(5, { rand: 1 })])).toEqual([0.75, 1.25, 15, 20]);
  });

  it('an attempt of FAST_S or longer is answered', () => {
    expect(evaluate([delay(0, { took: 29.9 }), delay(0, { took: 30 }), delay(0, { took: 870 })])).toEqual([1, null, null]);
  });

  it('a wait that ends past BUDGET_S is not started', () => {
    expect(evaluate([delay(5, { spent: 100 }), delay(5, { spent: 100.1 }), delay(0, { spent: 119 }), delay(0, { spent: 119.5 })])).toEqual([20, null, 1, null]);
  });

  it('a longer retry-after replaces the wait, a shorter one does not, and one that does not fit is answered', () => {
    expect(evaluate([delay(0, { after: 45 }), delay(3, { after: 2 }), delay(0, { after: 120 }), delay(0, { after: 121 }), delay(0, { after: 45, spent: 80 })]))
      .toEqual([45, 8, 120, null, null]);
  });
});
