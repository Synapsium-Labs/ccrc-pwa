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
/** One full `pr-state --session` line — `run-routes.test.ts`'s `ccdLine` shape. */
const fullLine = (rows: unknown[], ahead: number | null = 1, id = ID): string =>
  JSON.stringify({ id, rows, baseShort: 'main', branch: BRANCH, ahead, checkedAt: 1 });

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
