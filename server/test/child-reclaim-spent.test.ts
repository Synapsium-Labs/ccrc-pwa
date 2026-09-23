// child-reclamation wave 2, Task 4 — `childSpent` (spec §5.3). Three values,
// never a boolean: `spent` refuses a bind, `unspent` permits one, and
// `unmeasured` refuses too — an unreadable ledger or a lookup that did not
// answer is not evidence that no PR exists.
//
// Order, exactly: the registry's PR number (a present one is evidence; a null
// is evidence of NOTHING, because `field()` folds unreadable into absent),
// then `.prhistory` through its measured reader, then a LIVE
// `ccd pr-state --session` — the one path that can see a PR opened seconds
// ago, which is the hand-over rule 3 exists to stop.
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Runner } from '../src/exec.js';
import { readSessionRecord, type SessionRecord } from '../src/registry.js';
import { childSpent, type ChildSpentDeps } from '../src/coord/childSpent.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { unreadableField } from './ioDoubles.js';

const ID = 'demo-child';
const BRANCH = `ws/${ID}`;
let home: string;
let reg: string;

beforeEach(() => {
  home = mkTmp('ccrc-child-spent-');
  reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  for (const [k, v] of Object.entries({
    wrapper: 'claude', project: 'demo', workdir: `/w/${ID}`, uuid: `u-${ID}`, started: '1',
    workspace: ID, branch: BRANCH, base: 'origin/main', child: '5',
  })) writeFileSync(path.join(reg, `${ID}.${k}`), v);
});
const put = (field: string, content: string): void => writeFileSync(path.join(reg, `${ID}.${field}`), content);

/** A `gh pr list` row as `ccd pr-state` re-emits it, bound to this branch —
 *  `run-routes.test.ts`'s `prRow` shape. */
const prRow = (state: 'OPEN' | 'CLOSED' | 'MERGED', extra: Record<string, unknown> = {}) => ({
  number: 7, state, headRefName: BRANCH, baseRefName: 'main', isCrossRepository: false, ours: true, isDraft: false,
  ...(state === 'MERGED' ? { mergedAt: '2020-01-01T00:00:00Z', mergeCommit: { oid: 'f'.repeat(40) } } : {}),
  ...extra,
});
/** One full `pr-state --session` line — `run-routes.test.ts`'s `ccdLine` shape.
 *  `tip` defaults to a real-looking sha: a null/absent `tip` is ccd's own
 *  "I did not measure that" (D-3351) and answers `unmeasured` before
 *  `phaseFor` is ever reached, so every case here that expects `phaseFor` to
 *  decide needs a MEASURED tip — the rename shape below overrides it to
 *  `null` deliberately. */
const fullLine = (rows: unknown[], ahead: number | null = 1, id = ID, tip: string | null = 'f'.repeat(40)): string =>
  JSON.stringify({ id, rows, baseShort: 'main', branch: BRANCH, ahead, tip, checkedAt: 1 });

/** Real `testDeps` wiring over a recording runner that answers `pr-state`
 *  with `answer` — no real ccd, no real gh. */
const harness = (
  answer: { code: number; stdout: string; stderr: string } = { code: 0, stdout: '', stderr: '' },
  over: Partial<ChildSpentDeps> = {},
) => {
  const verbs: string[] = [];
  const run: Runner = async (_cmd, args) => {
    verbs.push(args[0] ?? '');
    return args[0] === 'pr-state' ? answer : { code: 0, stdout: '', stderr: '' };
  };
  const base = testDeps(home, run);
  const deps: ChildSpentDeps = { io: base.io, cfg: base.cfg, runCcd: base.runCcd, ...over };
  return { deps, verbs };
};
const recordOf = async (deps: ChildSpentDeps): Promise<SessionRecord> => {
  const r = await readSessionRecord(deps.io, deps.cfg, ID);
  if (!r.found) throw new Error(`fixture row not found: ${r.reason}`);
  return r.record;
};
const verdict = async (h: ReturnType<typeof harness>) => childSpent(h.deps, await recordOf(h.deps));

describe('childSpent — the fast path', () => {
  it('a registry PR number present → spent/registry, and no live call is made', async () => {
    put('prnumber', '42');
    const h = harness();
    expect(await verdict(h)).toEqual({ kind: 'spent', pr: 42, source: 'registry' });
    expect(h.verbs).not.toContain('pr-state');
  });

  it('.prhistory naming PRs → spent/prhistory naming the NEWEST by recordedAt, and no live call', async () => {
    // Newest in the MIDDLE, so neither "the first line" nor "the last line"
    // is the right answer by accident.
    put('prhistory', [
      JSON.stringify({ pr: 7, branch: BRANCH, phase: 'merged', recordedAt: 100 }),
      JSON.stringify({ pr: 9, branch: BRANCH, phase: 'closed', recordedAt: 300 }),
      JSON.stringify({ pr: 8, branch: BRANCH, phase: 'closed', recordedAt: 200 }),
    ].join('\n') + '\n');
    const h = harness();
    expect(await verdict(h)).toEqual({ kind: 'spent', pr: 9, source: 'prhistory' });
    expect(h.verbs).not.toContain('pr-state');
  });

  it('an UNREADABLE .prhistory → unmeasured, never unspent, and no live call', async () => {
    put('prhistory', '');   // LISTED — `readPrHistory` refuses only a file it can see
    const h = harness(undefined, { io: unreadableField(ID, 'prhistory') });
    expect(await verdict(h)).toEqual({ kind: 'unmeasured', detail: 'the PR ledger (.prhistory) could not be read' });
    expect(h.verbs).not.toContain('pr-state');
  });

  it('an unreadable .prnumber is evidence of NOTHING — it falls through to the live lookup', async () => {
    put('prnumber', '42');
    const h = harness({ code: 0, stdout: `${fullLine([prRow('OPEN')])}\n`, stderr: '' },
      { io: unreadableField(ID, 'prnumber') });
    expect(await verdict(h)).toEqual({ kind: 'spent', pr: 7, source: 'live' });
    expect(h.verbs).toContain('pr-state');
  });
});

describe('childSpent — the live lookup', () => {
  it.each([
    ['open', prRow('OPEN')],
    ['draft', prRow('OPEN', { isDraft: true })],
    ['merged', prRow('MERGED')],
    ['closed', prRow('CLOSED')],
  ] as const)('a bound %s PR → spent/live, naming it', async (_phase, row) => {
    const h = harness({ code: 0, stdout: `${fullLine([row])}\n`, stderr: '' });
    expect(await verdict(h)).toEqual({ kind: 'spent', pr: 7, source: 'live' });
  });

  // D-3347 (review run 144, F1): the operator ruled "a PR OPENED from its
  // branch spends a child", and binding is not part of that — childSpent's
  // live rung now reads every SAME-REPOSITORY row of `line.rows` whose head
  // names the branch, in ANY state, whatever its base, bound or not. Step 1's
  // measurement (real `ccd pr-state --session` through a fixture HOME with a
  // stubbed `gh`, fed through the server's own `parsePrLines`) confirmed the
  // row reaches `rows` for all three shapes below — ccd's `--head` filter
  // narrows only by branch NAME, never by base or `ours`, and `rows` is the
  // full annotated list, not the one `pick()`/`boundRow()` binds.
  it('(i) a same-branch OPEN row with a different base → spent/live, naming it', async () => {
    // Measured shape (Step 1, case i), fields unchanged but for this file's
    // own branch/number: {"number":42,"state":"OPEN","headRefName":
    // "ws/quiet-basin","headRefOid":"<tip>","baseRefName":"release/9",
    // "isCrossRepository":false,"mergedAt":null,"mergeCommit":null,"url":…,
    // "title":"the work","isDraft":false,"statusCheckRollup":null,"ours":true}
    const row = prRow('OPEN', { number: 42, baseRefName: 'release/9' });
    const h = harness({ code: 0, stdout: `${fullLine([row])}\n`, stderr: '' });
    expect(await verdict(h)).toEqual({ kind: 'spent', pr: 42, source: 'live' });
  });

  it('(ii) a same-branch row with ours:false → spent/live, naming it', async () => {
    // Measured shape (Step 1, case ii): {"number":42,"state":"OPEN",
    // "headRefName":"ws/quiet-basin","headRefOid":"00…0","baseRefName":"main",
    // "isCrossRepository":false,"mergedAt":null,"mergeCommit":null,"url":…,
    // "title":"the work","isDraft":false,"statusCheckRollup":null,
    // "ours":false} — ccd itself computed `ours:false` (the head commit is not
    // reachable from our tip) and STILL printed the row.
    const row = prRow('OPEN', { number: 42, ours: false });
    const h = harness({ code: 0, stdout: `${fullLine([row])}\n`, stderr: '' });
    expect(await verdict(h)).toEqual({ kind: 'spent', pr: 42, source: 'live' });
  });

  it('(iii) a CROSS-repository row naming the same head, alone → unspent — it does not count', async () => {
    // Measured shape (Step 1, case iii): `isCrossRepository:true` — a
    // stranger's fork reusing this exact branch name. `gh pr list --head`
    // matches `headRefName` across fork owners, so this row reaches `rows`
    // too, and it must NOT spend a child whose branch it merely shares a name
    // with.
    const row = prRow('OPEN', { number: 42, isCrossRepository: true });
    const h = harness({ code: 0, stdout: `${fullLine([row])}\n`, stderr: '' });
    expect(await verdict(h)).toEqual({ kind: 'unspent' });
  });

  it('(iv) a same-branch row with no number cannot be named as spent → unmeasured', async () => {
    const row = prRow('OPEN', { number: undefined });
    const h = harness({ code: 0, stdout: `${fullLine([row])}\n`, stderr: '' });
    const v = await verdict(h);
    expect(v.kind).toBe('unmeasured');
    expect(v.kind === 'unmeasured' ? v.detail : '').toContain('no number');
  });

  // Fix round 1, IMPORTANT #1: the `unestablished` arm had no test. A
  // same-branch row whose `isCrossRepository` cannot be read as a boolean —
  // absent, or a stringly-typed `"false"` gh/ccd never actually sends but the
  // reader must not misclassify — must not be guessed into `spent` (it is not
  // a same-repo row) or into `unspent` (falling through to `phaseFor` would
  // answer `none`, since `boundRow` also requires the same boolean and would
  // reject it too). It must answer `unmeasured`.
  it.each([
    ['isCrossRepository REMOVED entirely', (() => {
      const row = prRow('OPEN', { number: 42 }) as Record<string, unknown>;
      delete row.isCrossRepository;
      return row;
    })()],
    ['isCrossRepository a non-boolean string "false"', prRow('OPEN', { number: 42, isCrossRepository: 'false' })],
  ] as const)('(v) a same-branch row whose repository cannot be established — %s → unmeasured', async (_what, row) => {
    const h = harness({ code: 0, stdout: `${fullLine([row])}\n`, stderr: '' });
    const v = await verdict(h);
    expect(v.kind).toBe('unmeasured');
    expect(v.kind === 'unmeasured' ? v.detail : '').toContain('could not be established');
  });

  // Review 145 F1 (D-3351): a line's `branch` was assumed to be a string —
  // reachable only through a cast, never validated — so a malformed line
  // fell straight through the (empty) same-branch filters to `phaseFor`.
  it('(vii) a line with no branch key at all → unmeasured', async () => {
    const stdout = JSON.stringify(
      { id: ID, rows: [], baseShort: 'main', ahead: 1, tip: 'f'.repeat(40), checkedAt: 1 });
    const h = harness({ code: 0, stdout: `${stdout}\n`, stderr: '' });
    const v = await verdict(h);
    expect(v.kind).toBe('unmeasured');
    expect(v.kind === 'unmeasured' ? v.detail : '').toContain('no branch');
  });

  // Review 145 F7 (D-3351): the same-branch comparison (`r.headRefName ===
  // line.branch`) answers `false` for a row whose `headRefName` cannot even
  // be compared, so it never reaches `sameBranch`/`unestablished` though it is
  // exactly as unplaced as they are. Widened alongside the `unestablished`
  // rung, checked after `sameRepo` so a genuine same-repo row still wins.
  it.each([
    ['isCrossRepository:false, headRefName DELETED', (() => {
      const row = prRow('OPEN', { number: 42 }) as Record<string, unknown>;
      delete row.headRefName;
      return row;
    })()],
    ['isCrossRepository:false, headRefName:null', prRow('OPEN', { number: 42, headRefName: null })],
  ] as const)('(viii) a non-fork row whose head branch cannot be read — %s → unmeasured', async (_what, row) => {
    const h = harness({ code: 0, stdout: `${fullLine([row])}\n`, stderr: '' });
    const v = await verdict(h);
    expect(v.kind).toBe('unmeasured');
    expect(v.kind === 'unmeasured' ? v.detail : '').toContain('head branch could not be read');
  });

  it('(ix) a FORK row with an unreadable head, alone → unspent — forks never count', async () => {
    const row = prRow('OPEN', { number: 42, isCrossRepository: true, headRefName: null });
    const h = harness({ code: 0, stdout: `${fullLine([row])}\n`, stderr: '' });
    expect(await verdict(h)).toEqual({ kind: 'unspent' });
  });

  // Review 145 F1 (D-3351): the rename shape. The registry's `.branch` is
  // `ws/a`; inside the worktree the branch was renamed, so ccd's `--head ws/a`
  // finds no PR and `rev-parse refs/heads/ws/a` fails — `tip:null`. Both sides
  // already call a null tip "not measured" (`ccd/ccd:10450-10452`,
  // `CcdPrLine`'s docstring); falling through to `phaseFor` here would read
  // "I did not look" as "there is nothing to find" and permit a spent bind.
  it("(x) a line whose branch tip never resolved (a hand rename) → unmeasured, never unspent", async () => {
    const stdout = JSON.stringify(
      { id: ID, rows: [], baseShort: 'main', branch: 'ws/a', ahead: null, tip: null, checkedAt: 1 });
    const h = harness({ code: 0, stdout: `${stdout}\n`, stderr: '' });
    const v = await verdict(h);
    expect(v.kind).toBe('unmeasured');
    expect(v.kind === 'unmeasured' ? v.detail : '').toContain('tip');
  });

  it('(xi) tip unresolved BUT a same-repo same-branch row exists → spent, naming it — positive evidence still wins', async () => {
    const row = prRow('OPEN', { number: 5, headRefName: 'ws/a' });
    const stdout = JSON.stringify(
      { id: ID, rows: [row], baseShort: 'main', branch: 'ws/a', ahead: null, tip: null, checkedAt: 1 });
    const h = harness({ code: 0, stdout: `${stdout}\n`, stderr: '' });
    expect(await verdict(h)).toEqual({ kind: 'spent', pr: 5, source: 'live' });
  });

  // Review fr2-review 145 (fix round 1), M3: a `tip` KEY ABSENT (not merely
  // `null`) must ALSO answer unmeasured — the check is `typeof line.tip !==
  // 'string'`, not `line.tip === null`, and a mutant narrowing to the latter
  // stayed green because every other case in this file sends `tip:null`
  // explicitly.
  it('(xii) a line whose tip KEY IS ABSENT (never sent, not merely null) → unmeasured', async () => {
    const stdout = JSON.stringify({ id: ID, rows: [], baseShort: 'main', branch: BRANCH, ahead: 1, checkedAt: 1 });
    const h = harness({ code: 0, stdout: `${stdout}\n`, stderr: '' });
    const v = await verdict(h);
    expect(v.kind).toBe('unmeasured');
    expect(v.kind === 'unmeasured' ? v.detail : '').toContain('tip');
  });

  // M3: `branch: null` (an explicit non-string, not merely an absent key) must
  // ALSO answer unmeasured — the check is `typeof line.branch !== 'string'`,
  // not `line.branch === undefined`; test (vii) above only deletes the key.
  it('(xiii) a line whose branch is explicitly null (not merely an absent key) → unmeasured', async () => {
    const stdout = JSON.stringify(
      { id: ID, rows: [], baseShort: 'main', branch: null, ahead: 1, tip: 'f'.repeat(40), checkedAt: 1 });
    const h = harness({ code: 0, stdout: `${stdout}\n`, stderr: '' });
    const v = await verdict(h);
    expect(v.kind).toBe('unmeasured');
    expect(v.kind === 'unmeasured' ? v.detail : '').toContain('no branch');
  });

  // M3: pins the order the comment above (viii) claims — `unplaceable` is
  // checked AFTER `sameRepo`, so a genuine same-repo same-branch row still
  // wins even when an unplaceable non-fork row is ALSO present. A mutant that
  // moved the `unplaceable` check above `sameRepo` would answer `unmeasured`
  // here instead of `spent`.
  it('(xiv) a genuine same-repo same-branch row PLUS an unplaceable non-fork row → spent — sameRepo wins, checked first', async () => {
    const good = prRow('OPEN', { number: 42 });
    const bad = prRow('OPEN', { number: 99 }) as Record<string, unknown>;
    delete bad.headRefName;
    const h = harness({ code: 0, stdout: `${fullLine([good, bad])}\n`, stderr: '' });
    expect(await verdict(h)).toEqual({ kind: 'spent', pr: 42, source: 'live' });
  });

  it('(vi) three same-repo same-branch rows → spent/live names the HIGHEST number, not the first or the last', async () => {
    // Neither the first row (7) nor the last row (8) is the highest (9) — a
    // mutant that picked `rows[0]` OR `rows[rows.length - 1]` instead of the
    // true highest would both answer wrong (F5, review 145).
    const rows = [prRow('OPEN', { number: 7 }), prRow('CLOSED', { number: 9 }), prRow('CLOSED', { number: 8 })];
    const h = harness({ code: 0, stdout: `${fullLine(rows)}\n`, stderr: '' });
    expect(await verdict(h)).toEqual({ kind: 'spent', pr: 9, source: 'live' });
  });

  // Departure from the plan text's "keep every existing case green": the
  // pre-existing 'a merge ccd could not prove' case below asserted
  // `unmeasured` under the OLD rule, because that row was BOUND (matched
  // `boundRow`'s base/ours/name conjuncts) yet `isMergedRow`'s merge-proof
  // conjunct failed. Under D-3347's rule — ANY same-repo same-branch numbered
  // row spends the child, IN ANY STATE — that row (isCrossRepository:false,
  // headRefName the branch, number 7) now spends it before the merge-proof
  // question is ever asked; whether gh's MERGED claim is provable decides
  // which PR a workspace's PR CONTROL renders, not whether the branch has been
  // spent. Moved out of the `unmeasured` table below into its own assertion.
  it('a same-branch PR gh reports MERGED but cannot prove → still spends the child (D-3347)', async () => {
    const h = harness({ code: 0, stdout: `${fullLine([prRow('MERGED', { mergeCommit: null })])}\n`, stderr: '' });
    expect(await verdict(h)).toEqual({ kind: 'spent', pr: 7, source: 'live' });
  });

  it('no PR bound to the branch → unspent (a research child still hands over)', async () => {
    const h = harness({ code: 0, stdout: `${fullLine([])}\n`, stderr: '' });
    expect(await verdict(h)).toEqual({ kind: 'unspent' });
  });

  it('a branch level with its base → unspent', async () => {
    const h = harness({ code: 0, stdout: `${fullLine([], 0)}\n`, stderr: '' });
    expect(await verdict(h)).toEqual({ kind: 'unspent' });
  });

  it.each([
    ['branch-drift — the lookup provably did not look for this PR',
      JSON.stringify({ id: ID, phase: 'unknown', reason: 'branch-drift' }), 'branch-drift'],
    ['a whole-repo failure, which --session CAN emit (no remote)',
      JSON.stringify({ phase: 'unknown', reason: 'no-remote' }), 'no-remote'],
    // NOTE: 'a merge ccd could not prove' moved out of this table — see the
    // dedicated 'still spends the child (D-3347)' test above for why.
    ['a full line about ANOTHER session', fullLine([prRow('OPEN')], 1, 'demo-other'), 'no line for this session'],
    ['nothing parseable', 'not json', 'no line for this session'],
  ])('%s → unmeasured, never unspent', async (_what, stdout, why) => {
    const h = harness({ code: 0, stdout: `${stdout}\n`, stderr: '' });
    const v = await verdict(h);
    expect(v.kind).toBe('unmeasured');
    expect(v.kind === 'unmeasured' ? v.detail : '').toContain(why);
  });

  it('a failed ccd call → unmeasured, quoting ccd', async () => {
    const h = harness({ code: 1, stdout: '', stderr: 'gh: timeout' });
    expect(await verdict(h)).toEqual({ kind: 'unmeasured', detail: 'pr-state failed: gh: timeout' });
  });

  it('a box whose ccd does not advertise pr-state → unmeasured, and nothing is sent', async () => {
    const h = harness(undefined, {
      fleetState: { connected: true, downSince: null, ccdVerbs: ['ensure'], rosterFp: null, build: null },
    });
    expect(await verdict(h)).toEqual({ kind: 'unmeasured', detail: 'the fleet host cannot answer pr-state' });
    expect(h.verbs).not.toContain('pr-state');
  });
});
