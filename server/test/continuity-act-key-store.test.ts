// Overlord W1 door process A1 (plan `w1-door-process.md` Task 1): `continuity_act_keys` on a fixture coord.db. Its three
// writers (`issueActKey` once, `noteRefusedClaim`, `advanceActCounter` only upward), its two reads, which tell a failed read
// from `'none'`, and the claim's two start reads (`newestMintedStartOf`, `startByNonce`) beside the start's nonce hash.
import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { MIGRATIONS } from '../src/coord/schema.js';
import { actKeyByNonce, actKeyOf, advanceActCounter, issueActKey, noteRefusedClaim } from '../src/continuity/actKeyStore.js';
import { genExpectOf, newestMintedStartOf, startByNonce, type MintInput } from '../src/continuity/continuityStore.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);

const NOW = 1_800_000_000_000;
const ID = 'lane-a-project-a';
const KEY = 'c'.repeat(64);
const KEY_SHA = createHash('sha256').update(KEY, 'utf8').digest('hex');
const N1 = '1'.repeat(64);
const N2 = '2'.repeat(64);
const store = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-actkey-'), '.ccrc', 'coord.db')));
let reports = 0;
const startOf = (s: CoordStore, source: string, reportedAt: number, doorNonceSha256: string | null = null): number => {
  reports += 1;
  const r = s.insertStart({ sessionId: ID, reportId: `r-${reports}`, uuid: '11111111-2222-3333-4444-555555555555', source,
    model: 'claude-opus-5-5', rowIncarnation: null, reportedAt, receivedAt: reportedAt, doorNonceSha256 });
  if (!r.ok) throw new Error('start not recorded');
  return r.id;
};
const mintIn = (startId: number, over: Partial<MintInput> = {}): MintInput => ({
  identity: ID, sessionId: ID, role: 'coordinator', term: 1, rowIncarnation: null, startId, startReportedAt: NOW,
  resumed: false, model: 'claude-opus-5-5', lane: 'lane-a', host: null, outcome: 'crashed', mono: 1_000, proc: 'p1', now: NOW, ...over,
});
/** Mint the identity's next generation from `startId`, ending the live one as the generations lane does. */
const mint = (s: CoordStore, startId: number): number => {
  const live = s.liveGenerations();
  if (!live.ok) throw new Error(live.detail);
  const old = live.rows.find((g) => g.identity === ID);
  const r = s.mintGeneration(mintIn(startId), old === undefined ? null : genExpectOf(old), true);
  if (!r.ok) throw new Error('not minted');
  return r.id;
};

describe('continuity_act_keys: the migration', () => {
  it('is the entry that creates the table and adds the start\'s nonce column', () => {
    const slot = MIGRATIONS.findIndex((m) => m.includes('CREATE TABLE continuity_act_keys'));
    expect(slot).toBe(MIGRATIONS.length - 1);
    expect(MIGRATIONS[slot]).toContain('ALTER TABLE continuity_starts ADD COLUMN doorNonceSha256 TEXT');
  });
});

describe('issueActKey', () => {
  it('inserts once; a second insert for the same generation or the same hash answers refused, never a throw', () => {
    const s = store();
    expect(issueActKey(s.db, { generationId: 1, nonceSha256: N1, keySha256: KEY_SHA, issuedAt: NOW })).toEqual({ ok: true });
    expect(issueActKey(s.db, { generationId: 1, nonceSha256: N2, keySha256: KEY_SHA, issuedAt: NOW })).toEqual({ ok: false, error: 'refused' });
    expect(issueActKey(s.db, { generationId: 2, nonceSha256: N1, keySha256: KEY_SHA, issuedAt: NOW })).toEqual({ ok: false, error: 'refused' });
    expect(actKeyOf(s.db, 1)).toEqual({ ok: true, value: { generationId: 1, nonceSha256: N1, keySha256: KEY_SHA, issuedAt: NOW,
      counter: 0, claimsRefused: 0, lastRefusedAt: null } });
  });
  it('the table never holds the key itself', () => {
    const s = store();
    issueActKey(s.db, { generationId: 1, nonceSha256: N1, keySha256: KEY_SHA, issuedAt: NOW });
    const cells = (s.db.prepare('SELECT * FROM continuity_act_keys').all() as Record<string, unknown>[]).flatMap((r) => Object.values(r));
    expect(cells).not.toContain(KEY);
    expect(cells.some((c) => typeof c === 'string' && c.includes(KEY))).toBe(false);
  });
  it('a missing table answers write-failed, never a throw', () => {
    const s = store();
    s.db.exec('DROP TABLE continuity_act_keys');
    expect(issueActKey(s.db, { generationId: 1, nonceSha256: N1, keySha256: KEY_SHA, issuedAt: NOW })).toEqual({ ok: false, error: 'write-failed' });
  });
});

describe('advanceActCounter and noteRefusedClaim', () => {
  it('the counter changes only on a higher value, and a gap is accepted', () => {
    const s = store();
    issueActKey(s.db, { generationId: 1, nonceSha256: N1, keySha256: KEY_SHA, issuedAt: NOW });
    expect(advanceActCounter(s.db, 1, 1)).toEqual({ changed: true });
    expect(advanceActCounter(s.db, 1, 1)).toEqual({ changed: false });
    expect(advanceActCounter(s.db, 1, 0)).toEqual({ changed: false });
    expect(advanceActCounter(s.db, 1, 5)).toEqual({ changed: true });
    expect(advanceActCounter(s.db, 2, 9)).toEqual({ changed: false });
    expect(actKeyOf(s.db, 1)).toMatchObject({ ok: true, value: { counter: 5 } });
  });
  it('a refused claim raises claimsRefused and stamps lastRefusedAt on the row holding the hash', () => {
    const s = store();
    const g = mint(s, startOf(s, 'startup', NOW, N1));
    issueActKey(s.db, { generationId: g, nonceSha256: N1, keySha256: KEY_SHA, issuedAt: NOW });
    expect(noteRefusedClaim(s.db, N1, ID, NOW + 5)).toEqual({ changed: true });
    expect(noteRefusedClaim(s.db, N1, ID, NOW + 9)).toEqual({ changed: true });
    expect(noteRefusedClaim(s.db, N2, ID, NOW + 9)).toEqual({ changed: false });
    expect(actKeyOf(s.db, g)).toMatchObject({ ok: true, value: { claimsRefused: 2, lastRefusedAt: NOW + 9 } });
  });
  it('only the generation\'s own session raises its count: another session presenting the spent nonce changes nothing (review 2636 F2)', () => {
    const s = store();
    const g = mint(s, startOf(s, 'startup', NOW, N1));
    issueActKey(s.db, { generationId: g, nonceSha256: N1, keySha256: KEY_SHA, issuedAt: NOW });
    expect(noteRefusedClaim(s.db, N1, 'lane-b-project-a', NOW + 5)).toEqual({ changed: false });
    expect(actKeyOf(s.db, g)).toMatchObject({ ok: true, value: { claimsRefused: 0, lastRefusedAt: null } });
    expect(noteRefusedClaim(s.db, N1, ID, NOW + 7)).toEqual({ changed: true });
    expect(actKeyOf(s.db, g)).toMatchObject({ ok: true, value: { claimsRefused: 1, lastRefusedAt: NOW + 7 } });
  });
});

describe('the reads tell a failed read from none', () => {
  it('actKeyOf and actKeyByNonce answer none for no row, the row\'s generation for a spent nonce', () => {
    const s = store();
    expect(actKeyOf(s.db, 1)).toEqual({ ok: true, value: 'none' });
    expect(actKeyByNonce(s.db, N1)).toEqual({ ok: true, value: 'none' });
    issueActKey(s.db, { generationId: 4, nonceSha256: N1, keySha256: KEY_SHA, issuedAt: NOW });
    expect(actKeyByNonce(s.db, N1)).toEqual({ ok: true, value: { generationId: 4 } });
  });
  it('a missing table answers unmeasured with its detail, never none', () => {
    const s = store();
    s.db.exec('DROP TABLE continuity_act_keys');
    const a = actKeyOf(s.db, 1);
    const b = actKeyByNonce(s.db, N1);
    expect(a.ok).toBe(false);
    expect(b.ok).toBe(false);
    if (!a.ok) expect(a.detail).toContain('continuity_act_keys');
  });
});

describe('the claim\'s start reads', () => {
  it('the column is stored, and absent reads null', () => {
    const s = store();
    startOf(s, 'startup', NOW, N1);
    startOf(s, 'clear', NOW + 1);
    expect(s.db.prepare('SELECT doorNonceSha256 FROM continuity_starts ORDER BY id').all()).toEqual([{ doorNonceSha256: N1 }, { doorNonceSha256: null }]);
  });
  it('newestMintedStartOf reads the newest start the lane minted from, never one it declined or has not judged', () => {
    const s = store();
    expect(newestMintedStartOf(s.db, ID)).toEqual({ ok: true, value: 'none' });
    const a = startOf(s, 'startup', NOW, N1);
    expect(newestMintedStartOf(s.db, ID)).toEqual({ ok: true, value: 'none' });
    const g = mint(s, a);
    expect(newestMintedStartOf(s.db, ID)).toEqual({ ok: true,
      value: { startId: a, reportedAt: NOW, nonceSha256: N1, generation: { id: g, n: 1, state: 'carded' } } });
    // A compaction repeats its process's hash, a fork and a nested process's start are not this identity's next life, and a
    // newer spawn's start is not minted yet: none of them is a start the lane minted from.
    startOf(s, 'compact', NOW + 10, N1);
    startOf(s, 'fork', NOW + 20, N2);
    startOf(s, 'resume', NOW + 25, N1);
    const b = startOf(s, 'resume', NOW + 30, N2);
    expect(newestMintedStartOf(s.db, ID)).toMatchObject({ ok: true, value: { startId: a } });
    const h = mint(s, b);
    expect(newestMintedStartOf(s.db, ID)).toEqual({ ok: true,
      value: { startId: b, reportedAt: NOW + 30, nonceSha256: N2, generation: { id: h, n: 2, state: 'carded' } } });
  });
  it('the session\'s start order is reportedAt, so a resend received late is not the newest', () => {
    const s = store();
    const late = startOf(s, 'clear', NOW + 100, N2);
    const early = startOf(s, 'startup', NOW, N1);
    mint(s, late);
    mint(s, early);
    expect(newestMintedStartOf(s.db, ID)).toMatchObject({ ok: true, value: { startId: late, reportedAt: NOW + 100 } });
  });
  it('startByNonce reads the newest start carrying the hash, with and without a minted generation', () => {
    const s = store();
    const a = startOf(s, 'startup', NOW, N1);
    expect(startByNonce(s.db, ID, N1)).toEqual({ ok: true, value: { startId: a, reportedAt: NOW, nonceSha256: N1, generation: 'not-minted' } });
    expect(startByNonce(s.db, ID, N2)).toEqual({ ok: true, value: 'none' });
    expect(startByNonce(s.db, 'lane-b-project-a', N1)).toEqual({ ok: true, value: 'none' });
    const g = mint(s, a);
    startOf(s, 'compact', NOW + 5, N1);
    expect(startByNonce(s.db, ID, N1)).toEqual({ ok: true,
      value: { startId: a, reportedAt: NOW, nonceSha256: N1, generation: { id: g, n: 1, state: 'carded' } } });
  });
  it('a nested process\'s start carries the spawn\'s hash and the lane declines it: the claim still reads the minted start (review 2636 F1)', () => {
    const s = store();
    const a = startOf(s, 'startup', NOW, N1);
    const g = mint(s, a);
    // A nested Claude Code process in the pane inherits the spawn's environment, so its start report carries the same hash;
    // the lane declines it (`foreign-uuid`) and mints nothing from it.
    const nested = startOf(s, 'resume', NOW + 50, N1);
    expect(nested).toBeGreaterThan(a);
    expect(startByNonce(s.db, ID, N1)).toMatchObject({ ok: true, value: { startId: a, generation: { id: g } } });
    expect(newestMintedStartOf(s.db, ID)).toMatchObject({ ok: true, value: { startId: a } });
  });
  it('a missing table answers unmeasured, never none', () => {
    const s = store();
    s.db.exec('DROP TABLE continuity_act_keys');
    s.db.exec('ALTER TABLE continuity_starts DROP COLUMN doorNonceSha256');
    expect(newestMintedStartOf(s.db, ID).ok).toBe(false);
    expect(startByNonce(s.db, ID, N1).ok).toBe(false);
  });
});
