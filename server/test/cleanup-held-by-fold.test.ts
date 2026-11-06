// Cleanup un-wedge R2 (spec 2026-11-04 §4.3): what the held-by carriage changed, and the fold.
//
// R2 makes ccd's three audit documents carry `heldBy` / `heldByOwn`; the server reads them with `heldByOf` and each
// lane keeps the LATEST read per subject. `withCleanupHeldBy` composes `CoordStatus.cleanupHeldBy` and folds, from the
// STATUS's copies only, the items the row's line replaces. That the fold sits at composition, and not in the lanes, is
// a departure from the plan's "fold in the lanes", accepted on the condition that every other reader of the lanes'
// attention sees exactly what it saw before: cases 1 and 2 are characterization rows (green on the unchanged
// derivations), and case 7 pins that the fold copies and never touches the lanes' own lists.
import { describe, expect, it } from 'vitest';
import type { ChildReclaimAttention, CoordStatus, ExpiryAttention } from '../../shared/api.js';
import {
  CHILD_RECLAIM_DEFER_CEILING_MS, childReclaimAttention, childReclaimFirstSighting, childReclaimNextEntry,
} from '../src/childReclaimSweep.js';
import type { ChildReclaimAsk, ChildReclaimSweepEntry } from '../src/childReclaimSweep.js';
import { CHILD_RECLAIM_PROBE_UNMEASURED, childReclaimSweepOutcomeOf, parseChildReclaimAuditFailed } from '../src/coord/childReclaim.js';
import type { ChildReclaimOutcome } from '../src/coord/childReclaim.js';
import {
  archivedExpiryEntry, archivedExpiryLearned, archivedExpiryNextEntry, expiryAttention, parseExpireAudit,
} from '../src/archivedExpiry.js';
import type { ArchivedExpiryEntry, ExpireAuditRead } from '../src/archivedExpiry.js';
import { collectAfterAudit, collectFirstSighting, parseCollectAudit } from '../src/collectLane.js';
import {
  cleanupHeldBy, cleanupHeldByAct, heldByOf, withCleanupHeldBy,
} from '../src/cleanupHeldBy.js';
import type { HeldByRead, HeldByRow } from '../src/cleanupHeldBy.js';
import { step, verdict } from './collectAnswers.js';

const NOW = 1_790_000_000_000;
const PASS = 60_000;
const C = CHILD_RECLAIM_DEFER_CEILING_MS;
const ROW_A = { id: 'row-a', word: 'gone-unrecorded', workspace: 'absent' };
const ROW_B = { id: 'row-b', word: 'not-plain', workspace: 'present' };
const heldDoc = (extra: Record<string, unknown> = {}): Record<string, unknown> =>
  ({ heldBy: [ROW_A, ROW_B], heldByOwn: false, ...extra });
const HELD: HeldByRead = {
  kind: 'rows', own: false,
  rows: [{ id: 'row-a', word: 'gone-unrecorded', workspace: 'absent' }, { id: 'row-b', word: 'not-plain', workspace: 'present' }],
};
const listed: HeldByRead = { kind: 'rows', own: false, rows: [{ id: 'row-a', word: 'gone-unrecorded', workspace: 'absent' }] };
const lane = (m: Record<string, HeldByRead | undefined>): ReadonlyMap<string, { heldBy?: HeldByRead }> =>
  new Map(Object.entries(m).map(([k, v]) => [k, v === undefined ? {} : { heldBy: v }]));
const none = lane({});

// ── the reclaim lane's inputs ────────────────────────────────────────────────
const kindOf = (t: string): 'terminal' | null => (t === 'branch-elsewhere' ? 'terminal' : null);
const jrow = (sessionId: string, over: Record<string, unknown> = {}) => ({
  sessionId, outcome: 'failed', refusal: CHILD_RECLAIM_PROBE_UNMEASURED, at: NOW, failingSince: NOW - C - 1, detail: null, ...over,
}) as never;
const CHILDREN = ['project-a-child-1', 'project-a-child-2', 'project-a-child-3'];
const reclaimInput = () => ({
  latest: [
    ...CHILDREN.map((id) => jrow(id)),
    jrow('project-a-child-4', { outcome: 'refused', refusal: 'branch-elsewhere', failingSince: null }),
  ],
  live: new Map<string, number | null>([...CHILDREN, 'project-a-child-4'].map((id, i) => [id, 10 + i])),
  kindOf,
  stuckOf: () => false,
  sentenceFor: (t: string): string => `sentence for ${t}`,
  nowMs: NOW,
});

const ask = (mono: number): ChildReclaimAsk => ({ at: { monoMs: mono, wallMs: mono }, licensed: false, asHolder: false });
const reclaimEntry = (): ChildReclaimSweepEntry => childReclaimFirstSighting(NOW - 60_000, NOW - 3_600_000, 7, { kind: 'absent' });
const failedOutcome = (heldBy?: HeldByRead): ChildReclaimOutcome => ({
  kind: 'failed', sessionId: 'project-a-child-1', runId: 7, resume: 'not-resumable', detail: 'd',
  token: CHILD_RECLAIM_PROBE_UNMEASURED, ...(heldBy === undefined ? {} : { heldBy }),
});

const ids = (a: ChildReclaimAttention): string | null => ('sessionId' in a ? a.sessionId : null);
const status = (r: ChildReclaimAttention[], e?: ExpiryAttention[]): CoordStatus =>
  ({ childReclaimAttention: r, ...(e ? { expiryAttention: e } : {}) }) as unknown as CoordStatus;

describe('R2 characterization: the lanes\' own attention lists are not changed', () => {
  it('childReclaimAttention is unchanged by heldBy: three children held by a gone row and one refused branch-elsewhere list four items', () => {
    const items = childReclaimAttention(reclaimInput());
    expect(items).toHaveLength(4);
    expect(items.filter((a) => a.kind === 'failing').map((a) => a.sessionId)).toEqual(CHILDREN);
    expect(items.filter((a) => a.kind === 'terminal').map((a) => a.sessionId)).toEqual(['project-a-child-4']);
  });

  it('expiryAttention is unchanged by heldBy', () => {
    const failing = (id: string, heldBy: HeldByRead): [string, ArchivedExpiryEntry] => [id, {
      ...archivedExpiryEntry(1_789_000_000), heldBy,
      report: { kind: 'failing', at: NOW, detail: 'ws-audit --expire measured nothing: x' },
    }];
    const entries = new Map([failing('archived-1', HELD), failing('archived-2', listed), failing('archived-3', HELD)]);
    const out = expiryAttention(entries, false);
    expect(out.map((a) => a.kind)).toEqual(['failing', 'failing', 'failing']);
    expect(out.map((a) => a.sessionId).sort()).toEqual(['archived-1', 'archived-2', 'archived-3']);
  });
});

describe('the reclaim carriage', () => {
  const doc = (extra: Record<string, unknown> = {}): string =>
    JSON.stringify({ id: 'project-a-child-1', mode: 'reclaim', verdict: 'unmeasured', detail: 'rows', ...extra });

  it('the reclaim audit\'s unmeasured document carries heldBy to the sweep entry', () => {
    const read = parseChildReclaimAuditFailed('project-a-child-1', doc(heldDoc()), '');
    expect(read).toMatchObject({ kind: 'unmeasured', heldBy: HELD });
    if (read.kind !== 'unmeasured') throw new Error('unreachable');
    const outcome = childReclaimSweepOutcomeOf(failedOutcome(read.heldBy));
    expect(outcome).toMatchObject({ kind: 'failed', stuck: false, heldBy: HELD });
    const entry = childReclaimNextEntry(reclaimEntry(), outcome, ask(NOW), { monoMs: NOW, wallMs: NOW }, PASS)!;
    expect(entry.heldBy).toEqual(HELD);
  });

  it('an older document (no heldBy key) gives absent, and the entry carries nothing but absent', () => {
    const read = parseChildReclaimAuditFailed('project-a-child-1', doc(), '');
    expect(read).toMatchObject({ kind: 'unmeasured', heldBy: { kind: 'absent' } });
    expect(heldByOf(JSON.parse(doc()))).toEqual({ kind: 'absent' });
    const entry = childReclaimNextEntry(reclaimEntry(), childReclaimSweepOutcomeOf(failedOutcome()), ask(NOW),
      { monoMs: NOW, wallMs: NOW }, PASS)!;
    expect(entry.heldBy).toBeUndefined();
  });

  it('a later refusal or deferral clears the sweep entry\'s heldBy', () => {
    const held = { ...reclaimEntry(), heldBy: HELD };
    const refused = childReclaimNextEntry(held, { kind: 'refused', token: 'branch-elsewhere' }, ask(NOW + 1), { monoMs: NOW + 1, wallMs: NOW + 1 }, PASS)!;
    expect(refused.heldBy).toBeUndefined();
    const deferred = childReclaimNextEntry(held, { kind: 'deferred', why: 'presence' }, ask(NOW + 1), { monoMs: NOW + 1, wallMs: NOW + 1 }, PASS)!;
    expect(deferred.heldBy).toBeUndefined();
    const failedAgain = childReclaimNextEntry(held, childReclaimSweepOutcomeOf(failedOutcome()), ask(NOW + 1), { monoMs: NOW + 1, wallMs: NOW + 1 }, PASS)!;
    expect(failedAgain.heldBy, 'a failure with no rows is the latest answer too').toBeUndefined();
  });
});

describe('the expiry carriage', () => {
  const ID = 'archived-1';
  const doc = (extra: Record<string, unknown> = {}): string => JSON.stringify({
    session: ID, mode: 'expire', archivedAt: 1_789_000_000, expiresAt: 1_789_604_800, exists: true, verdict: 'unmeasured',
    detail: 'rows', ...extra,
  });

  it('the expiry audit\'s unmeasured document carries heldBy to the entry, through the learn and the act\'s own audit', () => {
    const read = parseExpireAudit(ID, false, doc(heldDoc()));
    expect(read).toMatchObject({ kind: 'unreadable', heldBy: HELD });
    const learned = archivedExpiryLearned(archivedExpiryEntry(1_789_000_000), read, NOW, PASS);
    expect(learned.heldBy).toEqual(HELD);
    if (read.kind !== 'unreadable') throw new Error('unreachable');
    const acted = archivedExpiryNextEntry(archivedExpiryEntry(1_789_000_000),
      { kind: 'audit-failed', detail: read.detail, ...(read.heldBy === undefined ? {} : { heldBy: read.heldBy }) }, NOW, PASS)!;
    expect(acted.heldBy).toEqual(HELD);
  });

  it('any other expiry answer clears it', () => {
    const held = { ...archivedExpiryEntry(1_789_000_000), heldBy: HELD };
    const document: ExpireAuditRead = {
      kind: 'document', archivedAt: 1_789_000_000, expiresAt: { kind: 'at', at: 1_789_604_800 }, sensitive: 0, inUse: [],
      verdict: { kind: 'refused', token: 'not-expired' },
    } as never;
    expect(archivedExpiryLearned(held, document, NOW, PASS).heldBy).toBeUndefined();
    expect(archivedExpiryLearned(held, { kind: 'unreadable', detail: 'x' }, NOW, PASS).heldBy).toBeUndefined();
    expect(archivedExpiryNextEntry(held, { kind: 'audit-failed', detail: 'x' }, NOW, PASS)!.heldBy).toBeUndefined();
    expect(archivedExpiryNextEntry(held, { kind: 'restart', detail: 'x' }, NOW, PASS)!.heldBy).toBeUndefined();
    expect(archivedExpiryNextEntry(held, { kind: 'deferred', why: 'presence', detail: 'x' }, NOW, PASS)!.heldBy).toBeUndefined();
  });

  it('a document of another row, or a different mode, carries no heldBy', () => {
    expect(parseExpireAudit(ID, false, doc({ session: 'other', ...heldDoc() }))).not.toHaveProperty('heldBy');
  });
});

describe('the collect carriage', () => {
  const doc = (extra: Record<string, unknown> = {}): string => JSON.stringify({
    session: 'tmp-1', mode: 'collect', exists: true, collect: { leaf: '/x/leaf', witness: null, unmeasured: 'rows' },
    verdict: 'unmeasured', detail: 'rows', ...extra,
  });

  it('the collect audit\'s unmeasured document carries heldBy to the entry', () => {
    const audit = parseCollectAudit('tmp-1', false, doc(heldDoc()), '');
    expect(audit).toMatchObject({ kind: 'unmeasured', probe: 'rows', heldBy: HELD });
    const e = collectAfterAudit(collectFirstSighting(1), audit, step(OBSERVE0, 2), true);
    expect(e.heldBy).toEqual(HELD);
  });

  it('an older collect document gives absent', () => {
    const audit = parseCollectAudit('tmp-1', false, doc(), '');
    expect(audit).toMatchObject({ kind: 'unmeasured', heldBy: { kind: 'absent' } });
  });

  it('a later collect audit clears it', () => {
    const held = { ...collectFirstSighting(1), heldBy: HELD };
    expect(collectAfterAudit(held, verdict('in-use'), step(OBSERVE0, 2), true).heldBy).toBeUndefined();
    expect(collectAfterAudit(held, { kind: 'no-document', stderr: 'killed' }, step(OBSERVE0, 3), true).heldBy).toBeUndefined();
    expect(collectAfterAudit(held, { kind: 'unreadable', detail: 'x' }, step(OBSERVE0, 4), true).heldBy).toBeUndefined();
  });
});
const OBSERVE0 = 60_000;

describe('the fold sits at composition', () => {
  const heldReads = (): Record<string, HeldByRead> => Object.fromEntries(CHILDREN.map((id) => [id, listed]));
  const rowsOf = () => childReclaimAttention(reclaimInput()) as ChildReclaimAttention[];

  it('three held children fold into the row\'s line and the lanes\' lists are untouched', () => {
    const list = rowsOf();
    const input = status(list);
    const before = structuredClone(input);
    const out = withCleanupHeldBy(input, { reclaim: lane(heldReads()), expire: none, collect: none }, [{ id: 'row-a', workspace: null }]);
    expect(out.childReclaimAttention).toHaveLength(1);
    expect(out.childReclaimAttention[0]).toMatchObject({ kind: 'terminal', token: 'branch-elsewhere' });
    expect(out.cleanupHeldBy).toHaveLength(1);
    expect(out.cleanupHeldBy![0]!.holds.reclaim).toBe(3);
    // the departure: the input status and the lane's own list are what they were
    expect(input).toEqual(before);
    expect(input.childReclaimAttention).toBe(list);
    expect(list).toHaveLength(4);
    expect(out.childReclaimAttention).not.toBe(list);
  });

  it('the branch-elsewhere child keeps its own item', () => {
    const list = rowsOf();
    const out = withCleanupHeldBy(status(list),
      { reclaim: lane({ ...heldReads(), 'project-a-child-4': listed }), expire: none, collect: none }, null);
    expect(out.childReclaimAttention.map(ids)).toEqual(['project-a-child-4']);
  });

  it('a child whose read is absent (older ccd) keeps its item', () => {
    const list = rowsOf();
    const out = withCleanupHeldBy(status(list), { reclaim: lane({ ...heldReads(), 'project-a-child-1': { kind: 'absent' } }), expire: none, collect: none }, null);
    expect(out.childReclaimAttention.map(ids)).toEqual(['project-a-child-1', 'project-a-child-4']);
  });

  it('a malformed read keeps its item', () => {
    const out = withCleanupHeldBy(status(rowsOf()), { reclaim: lane({ ...heldReads(), 'project-a-child-2': { kind: 'malformed' } }), expire: none, collect: none }, null);
    expect(out.childReclaimAttention.map(ids)).toEqual(['project-a-child-2', 'project-a-child-4']);
  });

  const expFailing = (id: string): ExpiryAttention =>
    ({ sessionId: id, kind: 'failing', sentence: 's', archivedAt: 1, expiresAt: 2, at: 3 });
  const exp = (): ExpiryAttention[] => [expFailing('archived-1'), expFailing('archived-2'), expFailing('archived-3')];

  it('the expiry lane\'s failing items: held ones fold and the others keep their item', () => {
    const out = withCleanupHeldBy(status([], exp()), { reclaim: none, expire: lane({ 'archived-1': listed, 'archived-2': listed, 'archived-3': listed }), collect: none }, null);
    expect(out.expiryAttention).toEqual([]);
    expect(out.cleanupHeldBy![0]!.holds.expire).toBe(3);
  });

  it('an expiry child whose read is absent keeps its item', () => {
    const out = withCleanupHeldBy(status([], exp()), { reclaim: none, expire: lane({ 'archived-1': { kind: 'absent' }, 'archived-2': listed, 'archived-3': undefined }), collect: none }, null);
    expect(out.expiryAttention!.map((a) => a.sessionId)).toEqual(['archived-1', 'archived-3']);
  });

  it('an expiry child with a malformed read keeps its item', () => {
    const out = withCleanupHeldBy(status([], exp()), { reclaim: none, expire: lane({ 'archived-1': { kind: 'malformed' }, 'archived-2': listed, 'archived-3': listed }), collect: none }, null);
    expect(out.expiryAttention!.map((a) => a.sessionId)).toEqual(['archived-1']);
  });

  it('an expiry child that is not held by a row (its read is none) keeps its item', () => {
    const out = withCleanupHeldBy(status([], exp()), { reclaim: none, expire: lane({ 'archived-1': { kind: 'none' }, 'archived-2': listed, 'archived-3': listed }), collect: none }, null);
    expect(out.expiryAttention!.map((a) => a.sessionId)).toEqual(['archived-1']);
  });

  it('a child held by a row but with its own fault keeps its item', () => {
    const own: HeldByRead = { kind: 'rows', own: true, rows: [{ id: 'row-a', word: 'gone-unrecorded', workspace: 'absent' }] };
    const out = withCleanupHeldBy(status(rowsOf(), exp()),
      { reclaim: lane({ ...heldReads(), 'project-a-child-1': own }), expire: lane({ 'archived-1': own, 'archived-2': listed }), collect: none }, null);
    expect(out.childReclaimAttention.map(ids)).toEqual(['project-a-child-1', 'project-a-child-4']);
    expect(out.expiryAttention!.map((a) => a.sessionId)).toEqual(['archived-1', 'archived-3']);
    // its row is still listed in the row's line: the child holds nothing more than the others do
    expect(out.cleanupHeldBy![0]!.holds.reclaim).toBe(3);
  });
});

describe('a row named by an older document', () => {
  it('a workspace row named by an older document without a workspace key gets no forget', () => {
    const read = heldByOf({ heldBy: [{ id: 'row-a', word: 'gone-unrecorded' }], heldByOwn: false });
    expect(read).toEqual({ kind: 'rows', own: false, rows: [{ id: 'row-a', word: 'gone-unrecorded', workspace: null } satisfies HeldByRow] });
    const [item] = cleanupHeldBy([{ lane: 'reclaim', subject: 'project-a-child-1', read }], (id) => (id === 'row-a' ? null : undefined));
    expect(item!.act).toBe('recheck');
    expect(cleanupHeldByAct('gone-unrecorded', null, null)).toBe('recheck');
  });
});
