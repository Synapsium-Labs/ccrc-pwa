// The heart of Task 5: a `worker_done` claim is re-measured, never believed.
// `readBranchTip` gets its own small suite (git's own ref-resolution rules,
// narrowed to the one case a workspace branch needs); `verifyDone` gets the
// mismatch table spec:127-132 demands, plus the two cases the table can't
// carry: the D-2 correspondence check, and the "the run is not touched here"
// guarantee the docstring makes.
import { describe, it, expect } from 'vitest';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { localIO, type FleetIO } from '../src/io.js';
import { readBranchTip } from '../src/coord/gitref.js';
import { verifyDone, type DoneClaim } from '../src/coord/fingerprint.js';
import type { Runner } from '../src/exec.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const TIP = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);

const SESSION = 'demo-quiet-mesa';
const PROJECT = 'demo';
const BRANCH = 'ws/quiet-mesa';
const BASE_SHORT = 'main';

/** Builds `<root>/demo/.git` with a loose and/or packed ref for `branch`
 *  (default `BRANCH`). Passing a different `branch` is how the registry-vs-
 *  frozen-column tests below put the git fixture at the RENAMED name while
 *  `RUN.branch` keeps the born one. */
const project = (loose: string | null, packed: string | null, branch: string = BRANCH): string => {
  const root = mkTmp('ccrc-git-');
  const git = path.join(root, 'demo', '.git');
  const segs = branch.split('/');
  const file = segs.pop()!;
  mkdirSync(path.join(git, 'refs', 'heads', ...segs), { recursive: true });
  if (loose !== null) writeFileSync(path.join(git, 'refs', 'heads', ...segs, file), `${loose}\n`);
  if (packed !== null) writeFileSync(path.join(git, 'packed-refs'),
    `# pack-refs with: peeled fully-peeled sorted\n${packed} refs/heads/${branch}\n`);
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
  it('refuses a packed-refs line whose sha/ref-name column is off by one (finding 3, survived mutant 11)', async () => {
    // A 41-hex sha — one character too many — shifts the space/ref-name
    // column by one place: `.trim()` on `line.slice(41)` eats the single
    // leading space and still lands on the exact target ref name, while
    // `line.slice(0, 40)` still yields 40 valid-looking hex characters — a
    // WRONG sha, missing its true last character. Only the column check
    // (`line.length < 42 || line[40] !== ' '`) tells this apart from a
    // genuine entry; without it this resolves to a real-looking but WRONG
    // tip instead of null. Proven against the shipped body with that guard
    // deleted: it returns the 41-'c' line's first 40 characters instead of
    // null (scratchpad/columnprobe.mjs).
    const root = mkTmp('ccrc-git-');
    mkdirSync(path.join(root, 'demo', '.git'), { recursive: true });
    const shiftedSha = 'c'.repeat(41);
    writeFileSync(path.join(root, 'demo', '.git', 'packed-refs'),
      `# pack-refs with: peeled fully-peeled sorted\n${shiftedSha} refs/heads/ws/quiet-mesa\n`);
    expect(await readBranchTip(localIO, root, 'demo', 'ws/quiet-mesa')).toBeNull();
  });
  it('never falls through a PRESENT loose ref to a stale packed-refs entry (finding 5)', async () => {
    // A loose ref that IS readable but does not parse as a SHA — the shape a
    // symref (`ref: refs/heads/main`) has — must answer null, not whatever
    // packed-refs says about the same name: git resolution SHADOWS packed
    // with loose, it does not fall back through it. This fixture is exactly
    // the "prefers the loose ref" one above with the loose content swapped
    // for a symref string, which is the shape the old fall-through bug
    // could not tell from "absent".
    const root = mkTmp('ccrc-git-');
    const git = path.join(root, 'demo', '.git');
    mkdirSync(path.join(git, 'refs', 'heads', 'ws'), { recursive: true });
    writeFileSync(path.join(git, 'refs', 'heads', 'ws', 'quiet-mesa'), 'ref: refs/heads/main\n');
    writeFileSync(path.join(git, 'packed-refs'),
      `# pack-refs with: peeled fully-peeled sorted\n${OTHER} refs/heads/ws/quiet-mesa\n`);
    expect(await readBranchTip(localIO, root, 'demo', 'ws/quiet-mesa')).toBeNull();
  });
  it('refuses a PRESENT loose ref this process cannot READ, rather than fall through to a stale packed-refs entry (findings 1 & 2)', async () => {
    // The loose ref IS the true, current tip (TIP); packed-refs holds a STALE
    // one (OTHER) — exactly the shape left behind by `git pack-refs` followed
    // by a real commit. `chmod 000` makes the file's BYTES unreadable
    // (`readFile` -> EACCES -> null) without making the ref absent: `stat`
    // needs only search permission on the parent directory chain, not read
    // permission on the leaf, so it still proves this path exists. Before the
    // fix, `readFile === null` fell straight through to packed-refs and this
    // returned OTHER — the stale tip — instead of refusing.
    const root = project(TIP, OTHER);
    const loosePath = path.join(root, 'demo', '.git', 'refs', 'heads', 'ws', 'quiet-mesa');
    chmodSync(loosePath, 0o000);
    try {
      expect(await readBranchTip(localIO, root, 'demo', 'ws/quiet-mesa')).toBeNull();
    } finally {
      chmodSync(loosePath, 0o644); // fixture cleanup doesn't need to fight the perms
    }
  });
  it('refuses when the loose ref path is a DIRECTORY (EISDIR), rather than fall through to a stale packed-refs entry (findings 1 & 2)', async () => {
    // One of the three triggers D-19's own problem statement named
    // ("a torn write, an EISDIR, or a git symbolic-ref") and the one D-19's
    // adaptation left unclosed: `readFile` on a directory throws EISDIR (->
    // null), but `stat` on that same path succeeds (it IS something), so this
    // must refuse rather than answer packed-refs' stale OTHER.
    const root = mkTmp('ccrc-git-');
    const git = path.join(root, 'demo', '.git');
    mkdirSync(path.join(git, 'refs', 'heads', 'ws', 'quiet-mesa'), { recursive: true });
    writeFileSync(path.join(git, 'packed-refs'),
      `# pack-refs with: peeled fully-peeled sorted\n${OTHER} refs/heads/ws/quiet-mesa\n`);
    expect(await readBranchTip(localIO, root, 'demo', 'ws/quiet-mesa')).toBeNull();
  });
  it('refuses a branch name that could climb out of the ref tree', async () => {
    const root = project(TIP, null);
    for (const bad of ['../../../../etc/passwd', 'ws/../../x', 'ws/ x', '-x']) {
      expect(await readBranchTip(localIO, root, 'demo', bad)).toBeNull();
    }
  });
  it('discriminates dropping the ".." guard alone — an escape, not just an absent file (finding 4)', async () => {
    const root = project(TIP, null);
    // Unguarded (or with only the `..` check removed, `BRANCH_OK` left
    // intact), `ws/../../x` resolves to `<root>/demo/.git/refs/x` — inside
    // this project's OWN `.git` but outside `refs/heads`. `BRANCH_OK` alone
    // does NOT reject this string (every character is in its class and the
    // first is alnum), so a decoy here is what actually distinguishes the
    // guard working from the escape target simply not existing — which is
    // all the four strings above prove, per the plan's own literal
    // `readBranchTip: drop the ".." guard` mutant (plan:3056).
    writeFileSync(path.join(root, 'demo', '.git', 'refs', 'x'), `${OTHER}\n`);
    expect(await readBranchTip(localIO, root, 'demo', 'ws/../../x')).toBeNull();
  });
  it('discriminates dropping BOTH path guards — a real escape outside the project (finding 4)', async () => {
    const root = project(TIP, null);
    // Unguarded, `../../../../loot` resolves to `<root>/loot` — outside the
    // project directory entirely, proving the WHOLE guard clause and not
    // merely one half of it (`BRANCH_OK`'s leading-character rule alone
    // already refuses this particular string, so this is the case that
    // needs BOTH guards gone at once to reach the decoy).
    writeFileSync(path.join(root, 'loot'), `${OTHER}\n`);
    expect(await readBranchTip(localIO, root, 'demo', '../../../../loot')).toBeNull();
  });
  it('refuses a project name that could climb out of the projects root (finding 7)', async () => {
    const root = mkTmp('ccrc-git-');
    const projectsRoot = path.join(root, 'projects');
    mkdirSync(projectsRoot, { recursive: true });
    // Decoys at BOTH resolution targets: `..` from `projectsRoot` lands one
    // level up, at `root`; `.` resolves to `projectsRoot` itself. Neither
    // decoy is a real project, so a guard-less implementation returns a real
    // (wrong) tip instead of null.
    for (const dir of [root, projectsRoot]) {
      mkdirSync(path.join(dir, '.git', 'refs', 'heads', 'ws'), { recursive: true });
      writeFileSync(path.join(dir, '.git', 'refs', 'heads', 'ws', 'quiet-mesa'), `${OTHER}\n`);
    }
    for (const bad of ['..', '.']) {
      expect(await readBranchTip(localIO, projectsRoot, bad, 'ws/quiet-mesa')).toBeNull();
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

/** One `ccd pr-state` row, bound to `BRANCH`/`BASE_SHORT` the way
 *  `boundRow`/`isMergedRow` (`server/src/prstate.ts`) require. `proveMerge`
 *  omits `mergedAt`/`mergeCommit` — the shape `isMergedRow` needs — which is
 *  exactly the row gh reports MERGED without proving: `merge-unproven`. */
const prRow = (state: 'OPEN' | 'CLOSED' | 'MERGED', proveMerge = true): Record<string, unknown> => ({
  number: 42, state, headRefName: BRANCH, baseRefName: BASE_SHORT,
  isCrossRepository: false, ours: true, isDraft: false,
  ...(state === 'MERGED' && proveMerge ? { mergedAt: '2020-01-01T00:00:00Z', mergeCommit: { oid: 'f'.repeat(40) } } : {}),
});

const ccdLine = (rows: Record<string, unknown>[]): string => JSON.stringify({
  id: SESSION, rows, baseShort: BASE_SHORT, branch: BRANCH, ahead: 1, checkedAt: Date.now(),
});

type MeasuredPr = 'open' | 'closed' | 'merged' | 'merge-unproven' | 'none' | 'unknown';

/** `'unknown'` models "pr-state could not be read" as a real exec failure —
 *  `res.ok === false` — rather than as a phase, matching the code path
 *  `verifyDone` actually takes (it never gets as far as `phaseFor`).
 *  `'merge-unproven'` and `'none'` DO reach `phaseFor`: the first is a MERGED
 *  row whose merge predicate has a failed conjunct (`isMergedRow`,
 *  `prstate.ts:186-188`) — the case `prVerdict`'s `measured === 'unknown'`
 *  arm exists for and the suite never reached before (finding 6); the second
 *  is no bound row at all (`rows: []`), used by the untrusted-claim-field
 *  tests below. */
const runnerFor = (pr: MeasuredPr): Runner => async () => {
  if (pr === 'unknown') return { code: 1, stdout: '', stderr: 'boom: pr-state unreachable' };
  const rows: Record<string, unknown>[] = pr === 'none' ? [] :
    [prRow(pr === 'open' ? 'OPEN' : pr === 'closed' ? 'CLOSED' : 'MERGED', pr !== 'merge-unproven')];
  return { code: 0, stdout: `${ccdLine(rows)}\n`, stderr: '' };
};

/** `testDeps` (the house harness) builds a full `Deps`, wired through the real
 *  whitelist guard; only `cfg.projectsRoot` needs overriding to point at this
 *  test's fixture git tree. `home` defaults to a fresh fixture with an EMPTY,
 *  but LISTABLE, `.cc-sessions` — no registry row for `SESSION` — so
 *  `verifyDone` falls back to `RUN.branch` unless a test seeds one itself
 *  (the registry-resolution tests below). The directory is created here
 *  (registry ladder, architecture doc increment 1's second half) rather than
 *  left absent: `io.readdir` cannot distinguish "this directory was never
 *  created" from "this directory could not be listed" (`io.ts`'s `readdir`
 *  maps every `fs` error, ENOENT included, to `null`) — and on a REAL fleet
 *  host a `.cc-sessions` directory always exists once ccd has ever run
 *  (`run-routes.test.ts`'s `openApp` makes the identical baseline explicit
 *  for the same reason). Leaving it absent by default would have every
 *  "no row for this session" fixture in this file accidentally exercise the
 *  NEW `!registryRead.listed` refusal instead of the empty-registry fallback
 *  it means to test; the "findings 3" describe block below is what
 *  deliberately exercises the genuinely-unlistable case, via `chmodSync`.
 *  `verbs`, when passed, becomes `fleetState.ccdVerbs`; `undefined` (the
 *  default) leaves `fleetState` unset, which `verbSupported` treats as
 *  "permit everything" (`ccdargv.ts:97`). */
const fingerprintDeps = (
  run: Runner, projectsRoot: string, home: string = mkTmp('ccrc-fp-'), verbs?: string[],
) => {
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const base = testDeps(home, run);
  return {
    ...base, cfg: { ...base.cfg, projectsRoot },
    ...(verbs !== undefined ? { fleetState: { connected: true, downSince: null, ccdVerbs: verbs } } : {}),
  };
};

const FIXED_CLAIM: DoneClaim = { branchTip: TIP, prNumber: null, prPhase: 'open', handoffCommit: TIP };
const RUN = { sessionId: SESSION, project: PROJECT, branch: BRANCH };

describe('verifyDone — the mismatch table', () => {
  // Each row: what the server measures (the git ref it actually has, and what
  // pr-state actually answers), against the fixed claim above. A row missing
  // from here is a fact nobody re-measures, which is the whole failure mode
  // this exists to prevent. `ok` rows also pin the exact `measured` payload —
  // not just `ok: true` — because "settled, on whatever facts" is not the
  // guarantee; "settled, on THESE re-measured facts" is (finding 3).
  it.each([
    ['tip matches, pr matches, handoff = tip',      { tip: TIP,   pr: 'open' as const },
      { ok: true, measured: { branchTip: TIP, prNumber: 42, prPhase: 'open' } }],
    ['tip has moved under the claim',               { tip: OTHER, pr: 'open' as const },    { code: 'stale-tip' }],
    ['the branch ref cannot be read at all',        { tip: null,  pr: 'open' as const },    { code: 'tip-unmeasurable' }],
    ['the PR closed after the worker looked',       { tip: TIP,   pr: 'closed' as const },  { code: 'pr-regressed' }],
    ['pr-state could not be read',                  { tip: TIP,   pr: 'unknown' as const }, { code: 'pr-unmeasurable' }],
    ['the PR merged after the worker looked',       { tip: TIP,   pr: 'merged' as const },
      { ok: true, measured: { branchTip: TIP, prNumber: 42, prPhase: 'merged' } }],
    // gh answered fine and said MERGED, but a conjunct of the merge predicate
    // failed — `unknown`/`merge-unproven`, never `ok` and never `pr-regressed`
    // (finding 6: this is the row that actually drives `prVerdict`'s
    // `measured === 'unknown'` arm through `phaseFor`, not through the
    // exec-failure branch the old `'pr-state could not be read'` row hits).
    ['gh says MERGED but a merge-predicate conjunct failed (merge-unproven)',
      { tip: TIP, pr: 'merge-unproven' as const }, { code: 'pr-unmeasurable' }],
  ])('%s', async (_name, measured, verdict) => {
    const root = project(measured.tip, null);
    const deps = fingerprintDeps(runnerFor(measured.pr), root);
    const res = await verifyDone(deps, RUN, FIXED_CLAIM);
    if ('ok' in verdict) {
      expect(res).toMatchObject(verdict);
    } else {
      expect(res.ok).toBe(false);
      expect((res as { code: string }).code).toBe(verdict.code);
    }
  });

  it('rejects a claim naming the wrong PR number for a really-bound PR (finding 3)', async () => {
    // `FIXED_CLAIM.prNumber` is `null` in every row of the table above — this
    // re-measured fact has no row of its own there. `cmd_pr_state`'s own
    // comment (`ccd/ccd:2389`) describes exactly this event: a worker whose
    // claim still names an earlier PR number after the branch has rebound.
    const root = project(TIP, null);
    const deps = fingerprintDeps(runnerFor('open'), root); // the real, bound PR is #42
    const claim: DoneClaim = { ...FIXED_CLAIM, prNumber: 41 };
    const res = await verifyDone(deps, RUN, claim);
    expect(res.ok).toBe(false);
    expect((res as { code: string; detail: string }).code).toBe('pr-regressed');
    expect((res as { code: string; detail: string }).detail)
      .toBe('the claim names PR #41, the branch is bound to #42');
  });

  it('rejects a claim that says merged against a branch the server measures as still open (finding 3, survived mutant 7)', async () => {
    // `FIXED_CLAIM.prPhase` is `'open'` in every row of the table above, so
    // `prVerdict`'s `claimed === 'merged' && measured !== 'merged'` arm never
    // executes there — that table only ever drives the open/draft-vs-none
    // arm and the unmeasurable arm. A worker that reported merged (a stale
    // read, or a race with an in-flight `pr-state` refresh) against a branch
    // the server re-measures as still open is exactly the regression this
    // arm exists to catch, and must be refused rather than read as forward
    // motion (`prVerdict`'s own docstring: "forward motion is not a
    // mismatch" — but backward from a false "merged" is).
    const root = project(TIP, null);
    const deps = fingerprintDeps(runnerFor('open'), root);
    const claim: DoneClaim = { ...FIXED_CLAIM, prPhase: 'merged' };
    const res = await verifyDone(deps, RUN, claim);
    expect(res.ok).toBe(false);
    expect((res as { code: string }).code).toBe('pr-regressed');
  });

  it('refuses pr-unmeasurable when pr-state exits 0 but names no full line for this session (finding 3, survived mutant 9)', async () => {
    // `ccd pr-state --session <id>` can exit zero while the one line naming
    // THIS session is a session-failure shape (`{id, phase:'unknown',
    // reason}`, no `rows` array at all) rather than a full `CcdPrLine` — the
    // shape `_pr_state_one` writes when the registry entry for this session
    // has no bound branch (`prstate.ts`'s own `isFullLine` docstring: "the
    // discriminator is `rows`, NOT `id`"). `runnerFor` above never produces
    // this shape — every one of its rows carries `rows: []` or a bound row,
    // which IS a full line — so this is the one case the mismatch table
    // cannot carry: not "pr-state failed" (that is `res.ok === false`,
    // pinned by the `pr: 'unknown'` row already) but "pr-state succeeded and
    // said nothing usable about this session".
    const root = project(TIP, null);
    const noLineRunner: Runner = async () => ({
      code: 0,
      stdout: `${JSON.stringify({ id: SESSION, phase: 'unknown', reason: 'error' })}\n`,
      stderr: '',
    });
    const deps = fingerprintDeps(noLineRunner, root);
    const res = await verifyDone(deps, RUN, FIXED_CLAIM);
    expect(res.ok).toBe(false);
    expect((res as { code: string; detail: string }).code).toBe('pr-unmeasurable');
    expect((res as { code: string; detail: string }).detail).toBe('pr-state answered no full line');
  });

  it('refuses pr-unmeasurable when the fleet host cannot answer pr-state at all (finding 3)', async () => {
    const root = project(TIP, null);
    const deps = fingerprintDeps(runnerFor('open'), root, mkTmp('ccrc-fp-'), []); // ccdVerbs: [] — no 'pr-state'
    const res = await verifyDone(deps, RUN, FIXED_CLAIM);
    expect(res.ok).toBe(false);
    expect((res as { code: string; detail: string }).code).toBe('pr-unmeasurable');
    expect((res as { code: string; detail: string }).detail).toBe('the fleet host cannot answer pr-state');
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

describe('verifyDone — prPhase/prNumber are validated, not merely typed (finding 2)', () => {
  // `DoneClaim`'s own docstring: every field is UNTRUSTED input off an HTTP
  // body. `branchTip`/`handoffCommit` are validated by the `SHA` regex above;
  // these two were not, before this fix — a claim that OMITTED `prPhase`, or
  // spelled it in the wrong case/vocabulary, fell through every arm of
  // `prVerdict` unmatched and read as agreement (`ok: true`) on a branch with
  // no PR at all, where the well-formed, honest claim is correctly refused.
  // `pr: 'none'` (no bound row) is the fixture that makes that failure mode
  // concrete: a well-formed `prPhase: 'open'` claim against it is a real
  // `pr-regressed` (claimed open, measured none) — proof these claims are
  // refused for being malformed, not coincidentally refused for some other
  // reason the fixture would refuse anyway.
  it('the well-formed baseline actually refuses, so the next two are not a coincidence', async () => {
    const root = project(TIP, null);
    const deps = fingerprintDeps(runnerFor('none'), root);
    const res = await verifyDone(deps, RUN, FIXED_CLAIM);
    expect(res.ok).toBe(false);
    expect((res as { code: string }).code).toBe('pr-regressed');
  });

  it('refuses rather than passes an omitted prPhase', async () => {
    const root = project(TIP, null);
    const deps = fingerprintDeps(runnerFor('none'), root);
    const claim = { branchTip: TIP, handoffCommit: TIP, prNumber: null } as unknown as DoneClaim;
    const res = await verifyDone(deps, RUN, claim);
    expect(res.ok).toBe(false);
    expect((res as { code: string }).code).toBe('pr-unmeasurable');
  });

  it('refuses a prPhase outside the PrPhase vocabulary (a worker on a different build)', async () => {
    const root = project(TIP, null);
    const deps = fingerprintDeps(runnerFor('none'), root);
    const claim = { ...FIXED_CLAIM, prPhase: 'OPEN' } as unknown as DoneClaim;
    const res = await verifyDone(deps, RUN, claim);
    expect(res.ok).toBe(false);
    expect((res as { code: string }).code).toBe('pr-unmeasurable');
  });

  it('refuses a non-number, non-null prNumber', async () => {
    const root = project(TIP, null);
    const deps = fingerprintDeps(runnerFor('open'), root);
    const claim = { ...FIXED_CLAIM, prNumber: 'forty-two' } as unknown as DoneClaim;
    const res = await verifyDone(deps, RUN, claim);
    expect(res.ok).toBe(false);
    expect((res as { code: string }).code).toBe('pr-unmeasurable');
  });
});

describe('verifyDone — the branch to re-measure comes from the live registry (finding 1)', () => {
  /** Registry row for `SESSION`, the same field shape `name-sweep.test.ts`'s
   *  own `seed()` writes — `readRegistry` needs wrapper+workdir+uuid or it
   *  skips the row entirely (`registry.ts:122`). `branch: null` (the default)
   *  seeds no row at all, so `readRegistry` never lists this id. */
  const seedRegistry = (home: string, branch: string | null): void => {
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    const fields: Record<string, string | null> = {
      wrapper: 'claude', project: PROJECT, workdir: '/w/demo/quiet-mesa', uuid: 'a'.repeat(36),
      started: '1', workspace: 'quiet-mesa', branch,
    };
    for (const [k, v] of Object.entries(fields)) {
      if (v !== null) writeFileSync(path.join(reg, `${SESSION}.${k}`), v);
    }
  };

  it('measures the RENAMED branch the registry names, not the born branch frozen on the run row', async () => {
    // The ordinary wave-1 path (finding 1): `RUN.branch` is `ws/quiet-mesa`,
    // the name `markDispatched` froze at dispatch time — but `sweepNames` has
    // since renamed the workspace, and the fixture's only git ref lives at
    // the RENAMED name. Without this fix, `readBranchTip` would be asked
    // about `ws/quiet-mesa`, find nothing, and answer `tip-unmeasurable`
    // forever — there is no repair route for `runs.branch` in this PR.
    const RENAMED = 'ws/fix-the-parser';
    const home = mkTmp('ccrc-fp-');
    seedRegistry(home, RENAMED);
    const root = project(TIP, null, RENAMED);
    const deps = fingerprintDeps(runnerFor('open'), root, home);
    const res = await verifyDone(deps, RUN, FIXED_CLAIM); // RUN.branch is still the BORN name
    expect(res).toMatchObject({ ok: true });
  });

  it('falls back to the run row only when the registry has no row for this session at all', async () => {
    const home = mkTmp('ccrc-fp-'); // no registry row seeded for SESSION
    const root = project(TIP, null); // fixture's ref is at RUN.branch — the fallback value
    const deps = fingerprintDeps(runnerFor('open'), root, home);
    const res = await verifyDone(deps, RUN, FIXED_CLAIM);
    expect(res).toMatchObject({ ok: true });
  });
});

describe('verifyDone — a present-but-unreadable loose ref never settles a stale claim (findings 1 & 2)', () => {
  // The exact failure scenario the findings measured end to end: the
  // workspace branch was packed by an auto `git gc`, then advanced by a real
  // commit (loose = NEW, packed-refs still = OLD). A `worker_done` naming OLD
  // is stale and must be refused — but only IF the server can actually tell
  // the loose ref apart from absent. On the sweep where the loose read
  // hiccups (chmod 000 here; an EACCES/EISDIR/remote-mode round-trip failure
  // in production), the pre-fix code fell through to packed-refs and settled
  // the stale claim `ok: true`, with `measured.branchTip` naming OLD as if it
  // had been re-measured — the exact inversion of "a stale worker_done can
  // never settle a task" (spec:127-132).
  const NEW_TIP = 'c'.repeat(40);
  const OLD_TIP = 'd'.repeat(40);

  it('refuses the STALE claim (tip-unmeasurable), never settles it ok:true, once the loose ref is unreadable', async () => {
    const root = project(NEW_TIP, OLD_TIP);
    const loosePath = path.join(root, 'demo', '.git', 'refs', 'heads', 'ws', 'quiet-mesa');
    chmodSync(loosePath, 0o000);
    try {
      const deps = fingerprintDeps(runnerFor('open'), root);
      const staleClaim: DoneClaim = { branchTip: OLD_TIP, prNumber: null, prPhase: 'open', handoffCommit: OLD_TIP };
      const res = await verifyDone(deps, RUN, staleClaim);
      expect(res.ok).toBe(false);
      expect((res as { code: string }).code).toBe('tip-unmeasurable');
    } finally {
      chmodSync(loosePath, 0o644);
    }
  });

  it('the HONEST claim (naming the true current tip) is refused too — unreadable means unmeasurable, not "trust the claim"', async () => {
    // Read alone cannot confirm the honest claim either — that is exactly why
    // this is UNMEASURABLE and not a pass. Pinned so a future "just believe
    // the claim when the ref can't be read" shortcut fails this case.
    const root = project(NEW_TIP, OLD_TIP);
    const loosePath = path.join(root, 'demo', '.git', 'refs', 'heads', 'ws', 'quiet-mesa');
    chmodSync(loosePath, 0o000);
    try {
      const deps = fingerprintDeps(runnerFor('open'), root);
      const honestClaim: DoneClaim = { branchTip: NEW_TIP, prNumber: null, prPhase: 'open', handoffCommit: NEW_TIP };
      const res = await verifyDone(deps, RUN, honestClaim);
      expect(res.ok).toBe(false);
      expect((res as { code: string }).code).toBe('tip-unmeasurable');
    } finally {
      chmodSync(loosePath, 0o644);
    }
  });

  it('once the loose ref is readable again, the same OLD claim IS correctly refused as stale — the fixture is not confused with a real gap', async () => {
    const root = project(NEW_TIP, OLD_TIP); // no chmod — loose ref reads clean
    const deps = fingerprintDeps(runnerFor('open'), root);
    const staleClaim: DoneClaim = { branchTip: OLD_TIP, prNumber: null, prPhase: 'open', handoffCommit: OLD_TIP };
    const res = await verifyDone(deps, RUN, staleClaim);
    expect(res.ok).toBe(false);
    expect((res as { code: string }).code).toBe('stale-tip');
  });
});

describe('verifyDone — the run.branch fallback is reached by more than "session retired" (finding 3)', () => {
  // `record?.branch ?? run.branch`'s own comment used to name exactly ONE
  // trigger ("the registry no longer carries this session at all") as the
  // only way to reach the `run.branch` fallback. These pin the OTHER
  // reachable triggers, each landing on the identical fallback for an
  // unrelated — and often transient — reason. This is a documentation fix,
  // not a behavioural one for the cases that still reach the fallback at
  // all: the fallback already degrades safely (a stale `run.branch` earns a
  // typed refusal, never a false accept, once it no longer names a real ref
  // — see the "findings 1 & 2" block above), so those cases assert the SAME
  // `ok: true` a healthy fallback already produces, proving the trigger is
  // reached, not that behaviour changed. The registry ladder (architecture
  // doc, increment 1's second half) CLOSES the other two triggers this
  // block used to name and tolerate — the whole-listing collapse and a
  // listed-but-unmeasured identity — turning them into an EARLY, typed
  // `tip-unmeasurable` refusal that never reaches this fallback at all; see
  // `verifyDone`'s own docstring for why that gap is now closed rather than
  // merely documented.
  const seedField = (home: string, id: string, name: string, value: string): void => {
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    writeFileSync(path.join(reg, `${id}.${name}`), value);
  };

  it('a registry directory that cannot be LISTED at all (io.readdir -> null) now REFUSES tip-unmeasurable ' +
     'directly — the ladder closes this trigger rather than letting it reach the run.branch fallback', async () => {
    const home = mkTmp('ccrc-fp-');
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    chmodSync(reg, 0o000);
    try {
      const root = project(TIP, null); // ref lives at RUN.branch — never reached
      const deps = fingerprintDeps(runnerFor('open'), root, home);
      const res = await verifyDone(deps, RUN, FIXED_CLAIM);
      expect(res.ok).toBe(false);
      expect((res as { code: string }).code).toBe('tip-unmeasurable');
    } finally {
      chmodSync(reg, 0o755); // let afterAll's rmSync clean up without fighting perms
    }
  });

  it('a row LISTED but with an unmeasured identity field also REFUSES tip-unmeasurable directly, never the ' +
     'run.branch fallback (the gap this docstring used to confess to, closed)', async () => {
    // Deliberately NO `.branch` file on the registry row: `record.branch`
    // reads null, so `record?.branch ?? run.branch` would fall back to
    // `RUN.branch` — which THIS fixture's git tree genuinely has a ref for
    // (`project(TIP, null)` puts it at RUN.branch), so a gate-less run would
    // settle `ok: true` on that fallback. Isolates the identity gate from
    // the branch-mismatch path the FIRST draft of this test accidentally
    // routed through instead (a seeded `.branch` naming a branch the git
    // fixture has no ref for reaches `tip-unmeasurable` on ITS OWN, via
    // `readBranchTip` returning null, whether or not the identity gate
    // exists at all — measured: deleting the gate left that version green).
    const home = mkTmp('ccrc-fp-');
    seedField(home, SESSION, 'wrapper', 'claude');
    seedField(home, SESSION, 'workdir', '/w/demo/quiet-mesa');
    seedField(home, SESSION, 'uuid', 'a'.repeat(36));
    const root = project(TIP, null); // ref lives at RUN.branch — the fallback a gate-less run would settle on
    const unreadableWrapper: FleetIO = {
      ...localIO, readFile: async (p) => (p.endsWith(`${SESSION}.wrapper`) ? null : localIO.readFile(p)),
    };
    const deps = { ...fingerprintDeps(runnerFor('open'), root, home), io: unreadableWrapper };
    const res = await verifyDone(deps, RUN, FIXED_CLAIM);
    expect(res.ok).toBe(false);
    expect((res as { code: string }).code).toBe('tip-unmeasurable');
  });

  it('a row present but with an INCOMPLETE identity (uuid file never written, not just unreadable) is ' +
     'DROPPED by readRegistry entirely, and still reaches the fallback — a proven-absent row, not an ' +
     'unmeasured one', async () => {
    const home = mkTmp('ccrc-fp-');
    seedField(home, SESSION, 'wrapper', 'claude');
    seedField(home, SESSION, 'workdir', '/w/demo/quiet-mesa');
    // no `.uuid` file — registry.ts's `if (!wrapper || !workdir || !uuid) continue`
    // drops the whole row, `record` is undefined the same as a retired session.
    seedField(home, SESSION, 'branch', 'ws/some-other-branch'); // present, but never reached
    const root = project(TIP, null); // ref lives at RUN.branch, the fallback value
    const deps = fingerprintDeps(runnerFor('open'), root, home);
    const res = await verifyDone(deps, RUN, FIXED_CLAIM);
    expect(res).toMatchObject({ ok: true });
  });

  it('a row that IS found, but whose OWN .branch field is absent, reaches the fallback WITHOUT `record` ever being undefined', async () => {
    const home = mkTmp('ccrc-fp-');
    seedField(home, SESSION, 'wrapper', 'claude');
    seedField(home, SESSION, 'workdir', '/w/demo/quiet-mesa');
    seedField(home, SESSION, 'uuid', 'a'.repeat(36));
    // no `.branch` file: readRegistry returns this row (wrapper/workdir/uuid
    // all present) with `branch: null` — `record` is DEFINED; it is
    // `record.branch` that is null, and the `??` falls back on that.
    const root = project(TIP, null); // ref lives at RUN.branch, the fallback value
    const deps = fingerprintDeps(runnerFor('open'), root, home);
    const res = await verifyDone(deps, RUN, FIXED_CLAIM);
    expect(res).toMatchObject({ ok: true });
  });
});
