// Child reclamation wave 9 (spec 2026-09-22 §5.10, "The idle floor"): `ws-audit --collect` keeps `ws-audit`'s runner
// row. Its bounded probes run in sequence (the idle walk, the in-use probe, the checkout scan and, since path-identity
// W3, the registry row pass's one identity walk), and a probe that reaches its bound ends the audit, so ONE
// TERM-to-KILL grace is paid. That sum must stay under the row, at the default grace and at the widest. The halves
// live in two languages and neither can import the other's number, so each is read from source as TEXT, and each
// read asserts it matched exactly once (`docs-budget.test.ts`'s method). Stated residual: the row pass's git reads of
// a gone row's repository carry no bound of their own and are not in the sum (`rows-rung-git-reads-unbounded`). A
// runner kill there answers no document, which the lane reads as `no-document` and paces as a failure, so it fails
// closed.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ccdSource } from './ccdWsHelpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const readRel = (r: string): string => readFileSync(path.join(ROOT, r), 'utf8');

/** The one match of `re` (a `g` regex) in `text`; throws on zero or on more than one. */
function exactlyOne(text: string, re: RegExp, what: string): RegExpMatchArray {
  const hits = [...text.matchAll(re)];
  if (hits.length !== 1) throw new Error(`${what}: ${hits.length} matches; exactly one is expected`);
  return hits[0]!;
}

interface CollectAuditBudget {
  readonly idleS: number; readonly usersS: number; readonly scanS: number; readonly walkS: number;
  readonly graceS: number; readonly graceMaxS: number; readonly rowS: number;
}

function collectAuditBudgetIn(ccd: string, runner: string): CollectAuditBudget {
  const int = (re: RegExp, what: string): number => Number(exactlyOne(ccd, re, what)[1]!);
  const row = exactlyOne(runner, /^[ \t]*'ws-audit':[ \t]*([\d_]+),/gm, "CCD_VERB_TIMEOUT_MS['ws-audit']");
  return {
    idleS: int(/^WS_COLLECT_IDLE_SCAN_S=(\d+)\b/gm, 'WS_COLLECT_IDLE_SCAN_S'),
    usersS: int(/^WS_PATH_USERS_SCAN_S=(\d+)\b/gm, 'WS_PATH_USERS_SCAN_S'),
    scanS: int(/^REAP_SCAN_SECONDS=(\d+)\b/gm, 'REAP_SCAN_SECONDS'),
    walkS: int(/^WS_RECLAIM_WALK_S=(\d+)\b/gm, 'WS_RECLAIM_WALK_S'),
    graceS: int(/grace="\$\{CCD_TIMEOUT_KILL_AFTER:-(\d+)\}"/g, "_plat_timeout's default grace"),
    graceMaxS: int(/\[ "\$grace" -gt (\d+) \] && grace=\1\b/g, "_plat_timeout's grace ceiling"),
    rowS: Number(row[1]!.replace(/_/g, '')) / 1000,
  };
}

const ccdSrc = (): string => ccdSource();
const runnerSrc = (): string => readRel('server/src/remote/runner.ts');
const probesS = (b: CollectAuditBudget): number => b.idleS + b.usersS + b.scanS + b.walkS;

describe('the collect audit fits ws-audit’s runner row (spec §5.10)', () => {
  it('reads 30 + 10 + 30 + 5 s of probes and a 3 s grace capped at 8, against a 90 s row', () => {
    expect(collectAuditBudgetIn(ccdSrc(), runnerSrc()))
      .toEqual({ idleS: 30, usersS: 10, scanS: 30, walkS: 5, graceS: 3, graceMaxS: 8, rowS: 90 });
  });

  it('the probes and ONE grace sum under the row: 78 s at the default grace, 83 s at the widest', () => {
    const b = collectAuditBudgetIn(ccdSrc(), runnerSrc());
    expect(probesS(b) + b.graceS).toBeLessThan(b.rowS);
    expect(probesS(b) + b.graceMaxS).toBeLessThan(b.rowS);
  });
});

describe('CONTROL: the reads refuse zero and two, and a longer probe breaks the sum', () => {
  it('a renamed or doubled binding throws', () => {
    const ccd = ccdSrc(); const runner = runnerSrc();
    expect(() => collectAuditBudgetIn(ccd.replace(/^WS_COLLECT_IDLE_SCAN_S=/m, 'WS_COLLECT_IDLE_S='), runner)).toThrow(/WS_COLLECT_IDLE_SCAN_S: 0 matches/);
    expect(() => collectAuditBudgetIn(`${ccd}\nREAP_SCAN_SECONDS=30\n`, runner)).toThrow(/REAP_SCAN_SECONDS: 2 matches/);
    expect(() => collectAuditBudgetIn(`${ccd}\nWS_RECLAIM_WALK_S=5\n`, runner)).toThrow(/WS_RECLAIM_WALK_S: 2 matches/);
    expect(() => collectAuditBudgetIn(ccd, runner.replace("'ws-audit': 90_000,", '// gone'))).toThrow(/ws-audit'\]: 0 matches/);
  });

  it('a 50 s idle walk would not fit', () => {
    const b = collectAuditBudgetIn(ccdSrc().replace(/^WS_COLLECT_IDLE_SCAN_S=30\b/m, 'WS_COLLECT_IDLE_SCAN_S=50'), runnerSrc());
    expect(probesS(b) + b.graceS).toBeGreaterThanOrEqual(b.rowS);
  });

  it('a 13 s walk would not fit at the widest grace', () => {
    const b = collectAuditBudgetIn(ccdSrc().replace(/^WS_RECLAIM_WALK_S=5\b/m, 'WS_RECLAIM_WALK_S=13'), runnerSrc());
    expect(b.walkS, 'the CONTROL: the 13 s walk was read').toBe(13);
    expect(probesS(b) + b.graceS, 'it still fits at the default grace').toBeLessThan(b.rowS);
    expect(probesS(b) + b.graceMaxS).toBeGreaterThanOrEqual(b.rowS);
  });
});
