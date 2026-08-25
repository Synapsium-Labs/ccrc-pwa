// Wave 7's pure half of the claim: the decision, with no database in the
// room. The CAS itself is part B (store + tx()); what THIS file pins is the
// decision table both the route and the sweeps will consume — and the D12
// sentences that must survive every refactor: all-or-nothing, doubt is not
// death, the hard cap is never extended, and the conflict is an ADDRESS.
import { describe, it, expect } from 'vitest';
import { CLAIM_LEASE_MS } from '../../shared/api.js';
import {
  claimExpiry, decideClaim, normalizeClaimPath, pathsOverlap, type ClaimRow,
} from '../src/coord/claims.js';

const NOW = 1_800_000_000_000;

const row = (over: Partial<ClaimRow> = {}): ClaimRow => ({
  id: 7, project: 'demo', paths: ['server/src/coord/store.ts'],
  heldBy: 'demo-quiet-mesa', heldByUuid: 'a'.repeat(36),
  intent: 'store methods for wave 7', runId: 42,
  expiresAt: NOW + 10 * 60_000, holderDeliverable: 'yes',
  ...over,
});

describe('normalizeClaimPath', () => {
  it('strips a leading ./ and a trailing slash — shared/ and shared name one directory', () => {
    expect(normalizeClaimPath('shared/')).toBe('shared');
    expect(normalizeClaimPath('./shared/api.ts')).toBe('shared/api.ts');
  });

  it("refuses '.' and '' — claiming the whole repo IS the module wedge (D12)", () => {
    expect(normalizeClaimPath('.')).toBeNull();
    expect(normalizeClaimPath('')).toBeNull();
    expect(normalizeClaimPath('./')).toBeNull();
  });

  it('refuses what defeats prefix containment: absolute paths and dot segments', () => {
    expect(normalizeClaimPath('/etc/passwd')).toBeNull();
    expect(normalizeClaimPath('shared/../ccd')).toBeNull();
    expect(normalizeClaimPath('shared/./api.ts')).toBeNull();
    expect(normalizeClaimPath('a//b')).toBeNull();
  });
});

describe('pathsOverlap: exact match AND directory-prefix containment, both directions', () => {
  it('a directory contains its file, and a file is contained by its directory', () => {
    expect(pathsOverlap('shared', 'shared/api.ts')).toBe(true);
    expect(pathsOverlap('shared/api.ts', 'shared')).toBe(true);
    expect(pathsOverlap('shared/api.ts', 'shared/api.ts')).toBe(true);
  });

  it('a NAME prefix is not a DIRECTORY prefix', () => {
    expect(pathsOverlap('shared', 'shared-utils/api.ts')).toBe(false);
    expect(pathsOverlap('ccd/ccd', 'ccd/ccd-helpers')).toBe(false);
  });
});

describe('decideClaim', () => {
  it('grants a disjoint set, returning the NORMALIZED paths for the store to insert', () => {
    const d = decideClaim([row()], {
      project: 'demo', paths: ['pwa/src/App.tsx', 'shared/'], sessionId: 'demo-brisk-ridge',
    });
    expect(d).toEqual({ ok: true, paths: ['pwa/src/App.tsx', 'shared'] });
  });

  it('refuses bad-path and names EVERY refused path — before any conflict is even considered', () => {
    const d = decideClaim([], {
      project: 'demo', paths: ['.', 'ccd/ccd', ''], sessionId: 'demo-brisk-ridge',
    });
    expect(d).toEqual({ refused: 'bad-path', paths: ['.', ''] });
  });

  it('reports a containment conflict — the held DIRECTORY blocks the requested FILE', () => {
    const d = decideClaim([row({ paths: ['shared'] })], {
      project: 'demo', paths: ['shared/api.ts'], sessionId: 'demo-brisk-ridge',
    });
    if (!('conflict' in d)) throw new Error(`expected conflict, got ${JSON.stringify(d)}`);
    expect(d.conflict).toHaveLength(1);
    expect(d.conflict[0]).toMatchObject({
      path: 'shared/api.ts', claimedPath: 'shared', claimId: 7,
      heldBy: 'demo-quiet-mesa', intent: 'store methods for wave 7',
      runId: 42, expiresAt: NOW + 10 * 60_000, deliverable: 'yes',
    });
  });

  it('reports the reverse containment too — the held FILE blocks the requested DIRECTORY', () => {
    const d = decideClaim([row({ paths: ['shared/api.ts'] })], {
      project: 'demo', paths: ['shared/'], sessionId: 'demo-brisk-ridge',
    });
    if (!('conflict' in d)) throw new Error('expected conflict');
    expect(d.conflict[0]).toMatchObject({ path: 'shared', claimedPath: 'shared/api.ts' });
  });

  it("the holder's OWN live row is never a conflict — re-POSTing the same paths is the renewal door (D12)", () => {
    const d = decideClaim([row({ heldBy: 'demo-quiet-mesa' })], {
      project: 'demo', paths: ['server/src/coord/store.ts'], sessionId: 'demo-quiet-mesa',
    });
    expect(d).toEqual({ ok: true, paths: ['server/src/coord/store.ts'] });
  });

  it('another PROJECT is another namespace — same path, no conflict', () => {
    const d = decideClaim([row({ project: 'other' })], {
      project: 'demo', paths: ['server/src/coord/store.ts'], sessionId: 'demo-brisk-ridge',
    });
    expect(d).toEqual({ ok: true, paths: ['server/src/coord/store.ts'] });
  });

  it("the mailHint is a pre-addressed envelope while the holder is deliverable, and null — the operator escalation — when it is not; never a silent send", () => {
    const yes = decideClaim([row()], {
      project: 'demo', paths: ['server/src/coord/store.ts'], sessionId: 'demo-brisk-ridge',
    });
    if (!('conflict' in yes)) throw new Error('expected conflict');
    expect(yes.conflict[0]!.mailHint).toEqual({
      toId: 'demo-quiet-mesa', subject: 'claim conflict: server/src/coord/store.ts',
    });

    // Doubt is not undeliverability (D9): an 'unknown' holder KEEPS its envelope.
    const unknown = decideClaim([row({ holderDeliverable: 'unknown' })], {
      project: 'demo', paths: ['server/src/coord/store.ts'], sessionId: 'demo-brisk-ridge',
    });
    if (!('conflict' in unknown)) throw new Error('expected conflict');
    expect(unknown.conflict[0]!.mailHint).toEqual({
      toId: 'demo-quiet-mesa', subject: 'claim conflict: server/src/coord/store.ts',
    });

    // 'no:<reason>' degrades the hint to null — the L0 contract's spelling of
    // "escalate to the operator instead of mailing"; the measured reason still
    // rides `deliverable`, so nothing is silently dropped.
    const no = decideClaim([row({ holderDeliverable: 'no:session-gone' })], {
      project: 'demo', paths: ['server/src/coord/store.ts'], sessionId: 'demo-brisk-ridge',
    });
    if (!('conflict' in no)) throw new Error('expected conflict');
    expect(no.conflict[0]!.mailHint).toBeNull();
    expect(no.conflict[0]!.deliverable).toBe('no:session-gone');
  });
});

describe("claimExpiry: D12's decision table", () => {
  const lease = { expiresAt: NOW + 10 * 60_000, hardExpiresAt: NOW + 4 * 3_600_000 };

  it('a holder measured RUNNING renews to now + CLAIM_LEASE_MS', () => {
    expect(claimExpiry(lease, NOW, 'running'))
      .toEqual({ act: 'renew', expiresAt: NOW + CLAIM_LEASE_MS });
  });

  it('a renewal CLAMPS at hardExpiresAt — the hard cap is never extended', () => {
    const nearCap = NOW + 4 * 3_600_000 - 60_000;
    expect(claimExpiry(lease, nearCap, 'running'))
      .toEqual({ act: 'renew', expiresAt: lease.hardExpiresAt });
  });

  it('a renewal that would not move the lease is a hold, not a zero-length write', () => {
    const atCap = { expiresAt: lease.hardExpiresAt, hardExpiresAt: lease.hardExpiresAt };
    expect(claimExpiry(atCap, NOW + 4 * 3_600_000 - 60_000, 'running')).toEqual({ act: 'hold' });
  });

  it('a holder measured GONE lapses at the STANDING expiresAt — not one tick before', () => {
    expect(claimExpiry(lease, NOW + 9 * 60_000, 'gone')).toEqual({ act: 'hold' });
    expect(claimExpiry(lease, NOW + 10 * 60_000, 'gone'))
      .toEqual({ act: 'lapse', endedBy: 'session-gone' });
  });

  it('an UNMEASURABLE holder is HELD, even past its lease — doubt is not death (D12)', () => {
    expect(claimExpiry(lease, NOW + 3_600_000, 'unmeasurable')).toEqual({ act: 'hold' });
  });

  it('the hard cap fells every verdict alike — doubt cannot hold forever', () => {
    const atCap = NOW + 4 * 3_600_000;
    for (const v of ['running', 'gone', 'unmeasurable'] as const) {
      expect(claimExpiry(lease, atCap, v)).toEqual({ act: 'lapse', endedBy: 'hard-cap' });
    }
  });
});

describe('D12 properties: all-or-nothing, and the 409 names EVERY conflicting path', () => {
  it('five paths, one conflict — ZERO acquired', () => {
    const d = decideClaim(
      [row({ paths: ['server/src/coord/dispatch.ts'] })],
      { project: 'demo', sessionId: 'demo-brisk-ridge',
        paths: ['pwa/src/App.tsx', 'shared/roster.ts', 'agent/src/tail.ts',
                'server/src/coord/dispatch.ts', 'docs/README-notes.md'] },
    );
    // The ok arm carries the paths to insert; its absence IS "zero acquired".
    expect('ok' in d).toBe(false);
    if (!('conflict' in d)) throw new Error('expected conflict');
    expect(d.conflict.map((c) => c.path)).toEqual(['server/src/coord/dispatch.ts']);
  });

  it('two conflicting paths against two different holders — BOTH named, each with its own address', () => {
    const d = decideClaim(
      [
        row({ id: 1, heldBy: 'demo-quiet-mesa', paths: ['shared'] }),
        row({ id: 2, heldBy: 'demo-plain-harbor', paths: ['ccd/ccd'] }),
      ],
      { project: 'demo', sessionId: 'demo-brisk-ridge',
        paths: ['shared/api.ts', 'ccd/ccd', 'pwa/src/App.tsx'] },
    );
    if (!('conflict' in d)) throw new Error('expected conflict');
    const byPath = new Map(d.conflict.map((c) => [c.path, c.heldBy]));
    expect([...byPath.keys()].sort()).toEqual(['ccd/ccd', 'shared/api.ts']);
    expect(byPath.get('shared/api.ts')).toBe('demo-quiet-mesa');
    expect(byPath.get('ccd/ccd')).toBe('demo-plain-harbor');
  });

  it('one requested path overlapping TWO of a holder\'s own paths is ONE address, not two', () => {
    const d = decideClaim(
      [row({ paths: ['shared', 'shared/api.ts'] })],
      { project: 'demo', sessionId: 'demo-brisk-ridge', paths: ['shared'] },
    );
    if (!('conflict' in d)) throw new Error('expected conflict');
    expect(d.conflict).toHaveLength(1);
    expect(d.conflict[0]!.claimId).toBe(7);
  });

  it('a duplicated request path is deduped, not double-granted and not double-conflicted', () => {
    expect(decideClaim([], {
      project: 'demo', sessionId: 'demo-brisk-ridge', paths: ['shared/', 'shared'],
    })).toEqual({ ok: true, paths: ['shared'] });
  });
});
