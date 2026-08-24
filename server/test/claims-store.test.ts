// Build 9 wave 7 (D11/D12): the claim CAS. THE IN-TRANSACTION READ IS THE CAS;
// THE PARTIAL UNIQUE INDEX IS THE BACKSTOP — both directions are pinned here,
// in that order, so neither can be "simplified away" as redundant.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { mkTmp } from './tmpHelpers.js';
import { CLAIM_LEASE_MS, CLAIM_HARD_CAP_MS } from '../../shared/api.js';

const store = (): CoordStore =>
  new CoordStore(openCoordDb(path.join(mkTmp('ccrc-claims-'), '.ccrc', 'coord.db')));

const NOW = 1_785_300_000_000;

const attempt = (s: CoordStore, over: Partial<Parameters<CoordStore['claimAttempt']>[0]> = {}) =>
  s.claimAttempt({
    project: 'demo', paths: ['server/src/io.ts'], sessionId: 'demo-quiet-basin',
    uuid: 'u-1', runId: null, intent: 'measured-read seam', now: NOW, ...over,
  });

describe('CoordStore.claimAttempt', () => {
  it('acquires: live, leased 45 min, hard-capped 8 h, intent carried', () => {
    const s = store();
    const r = attempt(s);
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) throw new Error('unreachable');
    expect(r.claims).toHaveLength(1);
    expect(r.claims[0]).toMatchObject({
      project: 'demo', paths: ['server/src/io.ts'], heldBy: 'demo-quiet-basin',
      heldByUuid: 'u-1', runId: null, intent: 'measured-read seam', state: 'live',
      createdAt: NOW, renewedAt: NOW,
      expiresAt: NOW + CLAIM_LEASE_MS, hardExpiresAt: NOW + CLAIM_HARD_CAP_MS,
      endedAt: null, endedBy: null,
    });
    expect(s.activeClaims()).toHaveLength(1);
  });

  it('claimsForProject: live only by default; all=true is the history read', () => {
    const s = store();
    attempt(s);
    expect(s.claimsForProject('demo')).toHaveLength(1);
    expect(s.claimsForProject('demo', true)).toHaveLength(1);
    expect(s.claimsForProject('other-project')).toEqual([]);
  });

  it('ALL-OR-NOTHING: one conflict refuses every path, and names EVERY conflicting path', () => {
    const s = store();
    attempt(s, { paths: ['shared/api.ts', 'server/src/io.ts'] });
    const r = attempt(s, {
      sessionId: 'demo-calm-mesa', uuid: 'u-2',
      paths: ['shared/api.ts', 'server/src/io.ts', 'docs/notes.md'],
    });
    expect(r).toMatchObject({ ok: false, why: 'conflict' });
    if (r.ok || r.why !== 'conflict') throw new Error('unreachable');
    expect(r.conflicts.map((c) => c.path).sort()).toEqual(['server/src/io.ts', 'shared/api.ts']);
    // The conflict IS the address (D12): holder, uuid, intent, lease — and the
    // store passes decideClaim's envelope through untouched: an unmeasured
    // holder reads 'unknown', and unknown KEEPS its mailHint (doubt is not no).
    expect(r.conflicts[0]).toMatchObject({
      heldBy: 'demo-quiet-basin', heldByUuid: 'u-1',
      intent: 'measured-read seam', runId: null, expiresAt: NOW + CLAIM_LEASE_MS,
      deliverable: 'unknown',
      mailHint: { toId: 'demo-quiet-basin', subject: 'claim conflict: shared/api.ts' },
    });
    // zero acquired — docs/notes.md was NOT claimed on the side
    const after = s.claimsForProject('demo');
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ heldBy: 'demo-quiet-basin' });
    expect(after.flatMap((c) => [...c.paths]).sort()).toEqual(
      ['server/src/io.ts', 'shared/api.ts']);
  });

  it('directory-prefix containment conflicts BOTH WAYS — the rule no index can express', () => {
    const s = store();
    attempt(s, { paths: ['shared'] });
    const inner = attempt(s, { sessionId: 'demo-calm-mesa', uuid: 'u-2', paths: ['shared/api.ts'] });
    expect(inner).toMatchObject({ ok: false, why: 'conflict' });
    attempt(s, { sessionId: 'demo-warm-ridge', uuid: 'u-3', paths: ['server/src/io.ts'] });
    const outer = attempt(s, { sessionId: 'demo-calm-mesa', uuid: 'u-2', paths: ['server'] });
    expect(outer).toMatchObject({ ok: false, why: 'conflict' });
  });

  it("a claim on '.' is refused bad-path — claiming the whole repo IS the module wedge", () => {
    const s = store();
    expect(attempt(s, { paths: ['.'] })).toMatchObject({ ok: false, why: 'bad-path', paths: ['.'] });
    expect(s.activeClaims()).toEqual([]);
  });

  it('re-POSTing the same path RENEWS and re-writes intent — one row, not two (D12 ruling 3)', () => {
    const s = store();
    const first = attempt(s);
    if (!first.ok) throw new Error('unreachable');
    const again = attempt(s, { intent: 'now migrating the seam', now: NOW + 600_000 });
    expect(again).toMatchObject({ ok: true });
    if (!again.ok) throw new Error('unreachable');
    expect(again.claims[0]).toMatchObject({
      id: first.claims[0]!.id,                      // the SAME row
      intent: 'now migrating the seam',
      renewedAt: NOW + 600_000,
      expiresAt: NOW + 600_000 + CLAIM_LEASE_MS,
      hardExpiresAt: NOW + CLAIM_HARD_CAP_MS,       // NEVER moved by a renewal
      createdAt: NOW,
    });
    expect(s.claimsForProject('demo', true)).toHaveLength(1);
  });

  it('EXPIRY RIDES EVERY ATTEMPT — a claim route never sees a stale row even with the watcher wedged', () => {
    const s = store();
    attempt(s);                                              // lease ends NOW + CLAIM_LEASE_MS
    const later = attempt(s, {
      sessionId: 'demo-calm-mesa', uuid: 'u-2', now: NOW + CLAIM_LEASE_MS + 1,
    });
    expect(later).toMatchObject({ ok: true });               // the stale holder no longer blocks
    // LAPSE, NOT DELETE: the expired row survives as history, in the same tx.
    const rows = s.claimsForProject('demo', true);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ heldBy: 'demo-quiet-basin', state: 'lapsed',
      endedAt: NOW + CLAIM_LEASE_MS + 1, endedBy: 'expired' });
    expect(rows[1]).toMatchObject({ heldBy: 'demo-calm-mesa', state: 'live' });
  });

  it('the hard cap wins the word when a row is past BOTH bounds', () => {
    const s = store();
    attempt(s);
    attempt(s, { sessionId: 'demo-calm-mesa', uuid: 'u-2', now: NOW + CLAIM_HARD_CAP_MS + 1 });
    expect(s.claimsForProject('demo', true)[0]).toMatchObject(
      { state: 'lapsed', endedBy: 'hard-cap' });
  });

  it('a renewal NEVER extends past the hard cap — the 8 h bound no re-POST can move', () => {
    // A MARCH of renewals, each within the standing lease, up to the cap's
    // shadow — a single 8-hour jump would find the lease already lapsed (the
    // in-tx expiry pre-pass is FIRST, D11 step 1) and mint a fresh row, which
    // is correct and not this test's subject.
    const s = store();
    const first = attempt(s);
    if (!first.ok) throw new Error('unreachable');
    let last = first;
    for (let k = 1; k <= 11; k++) {
      const r = attempt(s, { now: NOW + k * 2_400_000 });   // every 40 min < the 45 min lease
      if (!r.ok) throw new Error('unreachable');
      last = r;
    }
    expect(last.claims[0]!.id).toBe(first.claims[0]!.id);   // renewed throughout, never re-minted
    expect(last.claims[0]!.expiresAt).toBe(NOW + CLAIM_HARD_CAP_MS);
  });
});

describe('CoordStore.claimRelease / claimBreak', () => {
  it('release ends a live claim; the row SURVIVES with endedAt/endedBy', () => {
    const s = store();
    const r = attempt(s);
    if (!r.ok) throw new Error('unreachable');
    const id = r.claims[0]!.id;
    expect(s.claimRelease(id, 'demo-quiet-basin', NOW + 1000)).toEqual(
      { ok: true, state: 'released' });
    expect(s.activeClaims()).toEqual([]);
    expect(s.claimsForProject('demo', true)[0]).toMatchObject(
      { state: 'released', endedAt: NOW + 1000, endedBy: 'demo-quiet-basin' });
  });

  it('a second release answers not-live — the caller learns ITS call was not the one', () => {
    const s = store();
    const r = attempt(s);
    if (!r.ok) throw new Error('unreachable');
    const id = r.claims[0]!.id;
    s.claimRelease(id, 'demo-quiet-basin', NOW + 1000);
    expect(s.claimRelease(id, 'demo-quiet-basin', NOW + 2000)).toEqual(
      { ok: false, why: 'not-live', state: 'released' });
    expect(s.claimRelease(9999, 'demo-quiet-basin')).toEqual(
      { ok: false, why: 'unknown-claim' });
  });

  it("break is the operator's door: state 'broken', endedBy recorded", () => {
    const s = store();
    const r = attempt(s);
    if (!r.ok) throw new Error('unreachable');
    expect(s.claimBreak(r.claims[0]!.id, 'operator', NOW + 1000)).toEqual(
      { ok: true, state: 'broken' });
    expect(s.claimsForProject('demo', true)[0]).toMatchObject(
      { state: 'broken', endedBy: 'operator' });
  });

  it('a released path is claimable again — the unique index is PARTIAL on purpose', () => {
    const s = store();
    const r = attempt(s);
    if (!r.ok) throw new Error('unreachable');
    s.claimRelease(r.claims[0]!.id, 'demo-quiet-basin', NOW + 1000);
    const again = attempt(s, { sessionId: 'demo-calm-mesa', uuid: 'u-2', now: NOW + 2000 });
    expect(again).toMatchObject({ ok: true });
    expect(s.claimsForProject('demo', true)).toHaveLength(2);   // history + the new claim
  });

  it('THE BACKSTOP IS REAL: a second LIVE row on one (project, path) throws loudly', () => {
    // D11 mechanism 2, exercised against the actual index — if a refactor
    // loses the transaction, THIS is the failure mode, never a duplicate.
    const s = store();
    attempt(s);                                              // claims row 1 + its live path row
    expect(() => s.db.prepare(
      'INSERT INTO claim_paths (claimId, project, path, live) ' +
      "VALUES (1, 'demo', 'server/src/io.ts', 1)",
    ).run()).toThrow(/UNIQUE|claim_one_owner/i);
  });
});
