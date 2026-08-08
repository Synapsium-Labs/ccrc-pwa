// The heart of Task 5: a `worker_done` claim is re-measured, never believed.
// `readBranchTip` gets its own small suite (git's own ref-resolution rules,
// narrowed to the one case a workspace branch needs); `verifyDone` gets the
// mismatch table spec:127-132 demands, plus the two cases the table can't
// carry: the D-2 correspondence check, and the "the run is not touched here"
// guarantee the docstring makes.
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { localIO } from '../src/io.js';
import { readBranchTip } from '../src/coord/gitref.js';
import { verifyDone, type DoneClaim } from '../src/coord/fingerprint.js';
import type { Runner } from '../src/exec.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const TIP = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);

const project = (loose: string | null, packed: string | null): string => {
  const root = mkTmp('ccrc-git-');
  const git = path.join(root, 'demo', '.git');
  mkdirSync(path.join(git, 'refs', 'heads', 'ws'), { recursive: true });
  if (loose !== null) writeFileSync(path.join(git, 'refs', 'heads', 'ws', 'quiet-mesa'), `${loose}\n`);
  if (packed !== null) writeFileSync(path.join(git, 'packed-refs'),
    `# pack-refs with: peeled fully-peeled sorted\n${packed} refs/heads/ws/quiet-mesa\n`);
  return root;
};

describe('readBranchTip', () => {
  it('reads a loose ref', async () => {
    expect(await readBranchTip(localIO, project(TIP, null), 'demo', 'ws/quiet-mesa')).toBe(TIP);
  });
  it('falls back to packed-refs when the loose ref is absent', async () => {
    expect(await readBranchTip(localIO, project(null, TIP), 'demo', 'ws/quiet-mesa')).toBe(TIP);
  });
  it('prefers the LOOSE ref, which is what git does', async () => {
    expect(await readBranchTip(localIO, project(TIP, OTHER), 'demo', 'ws/quiet-mesa')).toBe(TIP);
  });
  it('answers null — never a guess — when neither exists', async () => {
    expect(await readBranchTip(localIO, project(null, null), 'demo', 'ws/quiet-mesa')).toBeNull();
  });
  it('refuses a branch name that could climb out of the ref tree', async () => {
    const root = project(TIP, null);
    for (const bad of ['../../../../etc/passwd', 'ws/../../x', 'ws/ x', '-x']) {
      expect(await readBranchTip(localIO, root, 'demo', bad)).toBeNull();
    }
  });
});

// ── verifyDone ──────────────────────────────────────────────────────────────
//
// The worker's claim is held FIXED across the mismatch table below
// (branchTip=TIP, prPhase='open', prNumber=null, handoffCommit=TIP — a claim
// that agrees with itself, so the D-2 correspondence check never fires here;
// that check gets its own test). What varies per row is what the SERVER
// measures: the git ref this fixture's project actually has, and what
// `ccd pr-state` actually answers. `project` above builds the former;
// `runnerFor` below builds the latter as a stubbed `Runner`, through the same
// `testDeps` harness (`server/test/helpers.ts`) every other route/lifecycle
// test uses, so `runCcd` is wired through the real `ccdRunner` + whitelist
// guard rather than hand-rolled.
const SESSION = 'demo-quiet-mesa';
const PROJECT = 'demo';
const BRANCH = 'ws/quiet-mesa';
const BASE_SHORT = 'main';

/** One `ccd pr-state` row, bound to `BRANCH`/`BASE_SHORT` the way
 *  `boundRow`/`isMergedRow` (`server/src/prstate.ts`) require. */
const prRow = (state: 'OPEN' | 'CLOSED' | 'MERGED'): Record<string, unknown> => ({
  number: 42, state, headRefName: BRANCH, baseRefName: BASE_SHORT,
  isCrossRepository: false, ours: true, isDraft: false,
  ...(state === 'MERGED' ? { mergedAt: '2020-01-01T00:00:00Z', mergeCommit: { oid: 'f'.repeat(40) } } : {}),
});

const ccdLine = (row: Record<string, unknown>): string => JSON.stringify({
  id: SESSION, rows: [row], baseShort: BASE_SHORT, branch: BRANCH, ahead: 1, checkedAt: Date.now(),
});

type MeasuredPr = 'open' | 'closed' | 'merged' | 'unknown';

/** `'unknown'` models "pr-state could not be read" as a real exec failure —
 *  `res.ok === false` — rather than as a phase, matching the code path
 *  `verifyDone` actually takes (it never gets as far as `phaseFor`). */
const runnerFor = (pr: MeasuredPr): Runner => async () => {
  if (pr === 'unknown') return { code: 1, stdout: '', stderr: 'boom: pr-state unreachable' };
  const row = pr === 'open' ? prRow('OPEN') : pr === 'closed' ? prRow('CLOSED') : prRow('MERGED');
  return { code: 0, stdout: `${ccdLine(row)}\n`, stderr: '' };
};

/** `testDeps` (the house harness) builds a full `Deps`, wired through the real
 *  whitelist guard; only `cfg.projectsRoot` needs overriding to point at this
 *  test's fixture git tree. */
const fingerprintDeps = (run: Runner, projectsRoot: string) => {
  const base = testDeps(mkTmp('ccrc-fp-'), run);
  return { ...base, cfg: { ...base.cfg, projectsRoot } };
};

const FIXED_CLAIM: DoneClaim = { branchTip: TIP, prNumber: null, prPhase: 'open', handoffCommit: TIP };
const RUN = { sessionId: SESSION, project: PROJECT, branch: BRANCH };

describe('verifyDone — the mismatch table', () => {
  // Each row: what the server measures (the git ref it actually has, and what
  // pr-state actually answers), against the fixed claim above. A row missing
  // from here is a fact nobody re-measures, which is the whole failure mode
  // this exists to prevent.
  it.each([
    ['tip matches, pr matches, handoff = tip',      { tip: TIP,   pr: 'open' as const },    { ok: true }],
    ['tip has moved under the claim',               { tip: OTHER, pr: 'open' as const },    { code: 'stale-tip' }],
    ['the branch ref cannot be read at all',        { tip: null,  pr: 'open' as const },    { code: 'tip-unmeasurable' }],
    ['the PR closed after the worker looked',       { tip: TIP,   pr: 'closed' as const },  { code: 'pr-regressed' }],
    ['pr-state could not be read',                  { tip: TIP,   pr: 'unknown' as const }, { code: 'pr-unmeasurable' }],
    ['the PR merged after the worker looked',       { tip: TIP,   pr: 'merged' as const },  { ok: true }],
  ])('%s', async (_name, measured, verdict) => {
    const root = project(measured.tip, null);
    const deps = fingerprintDeps(runnerFor(measured.pr), root);
    const res = await verifyDone(deps, RUN, FIXED_CLAIM);
    if ('ok' in verdict) {
      expect(res).toMatchObject({ ok: true });
    } else {
      expect(res.ok).toBe(false);
      expect((res as { code: string }).code).toBe(verdict.code);
    }
  });

  it('rejects a handoff commit that is not the tip the same claim names', async () => {
    // Deviation D-2: this is a CORRESPONDENCE check. The server cannot read a
    // commit object, so it cannot tell whether the commit edits the ledger —
    // only that the worker's own two facts agree and that the tip is real.
    // The content gate stays the coordinator's ordinary review (spec:246-252).
    const root = project(TIP, null);
    const deps = fingerprintDeps(runnerFor('open'), root);
    const cases: (string | undefined)[] = [
      undefined,                 // absent
      'not-forty-hex-chars',     // not 40 hex
      OTHER,                     // a real 40-hex sha, but not THIS claim's branchTip
    ];
    for (const handoffCommit of cases) {
      const claim = { ...FIXED_CLAIM, handoffCommit } as unknown as DoneClaim;
      const res = await verifyDone(deps, RUN, claim);
      expect(res.ok).toBe(false);
      expect((res as { code: string }).code).toBe('no-handoff-commit');
    }
    // Never confused with a git-side mismatch: the git ref is never even read.
  });

  it('leaves the run state untouched on every rejection', async () => {
    // `verifyDone` takes no store and no writable handle on the run at all —
    // ANSWERS, never advances (its own docstring: "THE RUN IS NOT TOUCHED
    // HERE"). Freezing the inputs is the closest observable proxy this task's
    // own scope affords: any attempt inside `verifyDone` to write back onto
    // the run or the claim it was given would throw in strict mode rather than
    // silently mutate. The store-backed version of this guarantee — a real
    // `runs` row whose `state` column is unchanged after a rejected claim —
    // is Task 9's, once the route exists to call both `verifyDone` and
    // `CoordStore` in the same request.
    const root = project(OTHER, null); // measured tip != claimed tip -> a real rejection
    const deps = fingerprintDeps(runnerFor('open'), root);
    const run = Object.freeze({ ...RUN });
    const claim = Object.freeze({ ...FIXED_CLAIM });
    const res = await verifyDone(deps, run, claim);
    expect(res.ok).toBe(false);
    expect((res as { code: string }).code).toBe('stale-tip');
    expect(run).toEqual(RUN);
    expect(claim).toEqual(FIXED_CLAIM);
  });
});
