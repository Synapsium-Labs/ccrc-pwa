// `ccd ws-shed-deps` (D-7278) earns a runner row of its own: without one it inherits the flat 90 s, and a kill
// mid-removal leaves no `.depsshed` stamp and no lifecycle row, which the arm reads as `unreadable` and holds off for.
// The verb's bounded calls do not grow with its candidates (one index read, one repository walk, one `du`, one `rm`
// over all of them), so their sum is fixed: six tree walks at WS_SHED_SCAN_S_DEFAULT (the ignored listing, the
// repository walk, the size, two `git status` reads, the removal), two quick reads at WS_SHED_QUICK_S (the toplevel,
// the index), and the process walk at WS_PATH_USERS_SCAN_S. A bound reached ends the verb except the size's, so at most
// TWO TERM-to-KILL graces are paid. CCD_DEPS_SHED_SCAN_S is lower-only, so the default is the bound. Each half is read
// from source as TEXT and each read asserts it matched exactly once (`collect-audit-budget.test.ts`'s method). Stated
// residual: the registry rungs (file reads, the pane probe, the unit read, the journal) carry no bound in the sum.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ccdSource } from './ccdWsHelpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const readRel = (r: string): string => readFileSync(path.join(ROOT, r), 'utf8');

function exactlyOne(text: string, re: RegExp, what: string): RegExpMatchArray {
  const hits = [...text.matchAll(re)];
  if (hits.length !== 1) throw new Error(`${what}: ${hits.length} matches; exactly one is expected`);
  return hits[0]!;
}
const count = (text: string, needle: string): number => text.split(needle).length - 1;

function region(ccd: string): string {
  const a = ccd.indexOf('DEPSSHED-BEGIN');
  const b = ccd.indexOf('DEPSSHED-END');
  if (a < 0 || b < a) throw new Error('the DEPSSHED region was not found');
  return ccd.slice(a, b);
}

function budget(): { scanS: number; quickS: number; usersS: number; graceMaxS: number; rowS: number; r: string } {
  const ccd = ccdSource();
  const int = (re: RegExp, what: string): number => Number(exactlyOne(ccd, re, what)[1]!);
  const row = exactlyOne(readRel('server/src/remote/runner.ts'), /^[ \t]*'ws-shed-deps':[ \t]*([\d_]+),/gm,
    "CCD_VERB_TIMEOUT_MS['ws-shed-deps']");
  return {
    scanS: int(/^WS_SHED_SCAN_S_DEFAULT=(\d+)\b/gm, 'WS_SHED_SCAN_S_DEFAULT'),
    quickS: int(/^WS_SHED_QUICK_S=(\d+)\b/gm, 'WS_SHED_QUICK_S'),
    usersS: int(/^WS_PATH_USERS_SCAN_S=(\d+)\b/gm, 'WS_PATH_USERS_SCAN_S'),
    graceMaxS: int(/\[ "\$grace" -gt (\d+) \] && grace=\1\b/g, "_plat_timeout's grace ceiling"),
    rowS: Number(row[1]!.replace(/_/g, '')) / 1000,
    r: region(ccd),
  };
}

describe('ws-shed-deps fits its runner row (D-7278)', () => {
  it('the row exists and reads 30 s walks, 10 s quick reads and a 10 s process walk against 240 s', () => {
    const b = budget();
    expect({ scanS: b.scanS, quickS: b.quickS, usersS: b.usersS, graceMaxS: b.graceMaxS, rowS: b.rowS })
      .toEqual({ scanS: 30, quickS: 10, usersS: 10, graceMaxS: 8, rowS: 240 });
  });

  it('every bound in the verb is one the sum counts, and the count does not grow with the candidates', () => {
    const { r } = budget();
    // Six sites at the walk bound: status, listing, repositories, size and the removal's two platform arms (one runs).
    expect(count(r, '_plat_timeout "$scan"')).toBe(6);
    expect(count(r, '_plat_timeout "$WS_SHED_QUICK_S"')).toBe(2);
    expect(count(r, '_plat_timeout ')).toBe(8);
    expect(count(r, '_ws_shed_git_state "$wdp"')).toBe(2);
    expect(count(r, '_ws_path_users_many "')).toBe(1);
    // The walks run once each, never inside a per-candidate loop: their callers name every candidate at once.
    for (const call of ['_ws_shed_tracked "$wdp" "${pre[@]}"', '_ws_shed_repos "${physs[@]}"', '_ws_shed_size "${physs[@]}"',
      'rm -rfx -- "${physs[@]}"', 'rm -rf --one-file-system -- "${physs[@]}"']) {
      expect(count(r, call), call).toBe(1);
    }
    // Lower-only: a value above the default reads as the default, so the default is the bound.
    expect(r).toContain('(( v <= WS_SHED_SCAN_S_DEFAULT )) || v=$WS_SHED_SCAN_S_DEFAULT');
  });

  it('six walks, two quick reads, the process walk and two graces sum under the row: 226 s against 240 s', () => {
    const b = budget();
    const worst = 6 * b.scanS + 2 * b.quickS + b.usersS + 2 * b.graceMaxS;
    expect(worst).toBe(226);
    expect(worst).toBeLessThan(b.rowS);
  });
});
