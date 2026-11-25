// The review deciders (L1): expiry, the commit verdict, view coarsening, create admission and the owner's list.
// Task R1.2 of the draft-review plan. The fixture's three times are distinct on purpose (N3): a decider that reads the
// wrong one answers differently.

import { describe, expect, it } from 'vitest';
import { DOCS_EXPORT_MAX_BYTES, type DocsEntry, type DocsTreeOk } from '../../shared/docs.js';
import {
  REVIEW_IDLE_MS, REVIEW_MAX_LIVE, REVIEW_MAX_STORE_BYTES, REVIEW_RETENTION_MS, REVIEW_VIEW_COARSEN_MS,
} from '../../shared/docsReview.js';
import {
  admitCreate, commitVerdict, expiryOf, projectList, viewDue, type ReviewEntry, type ReviewTombstone,
} from '../src/review/policy.js';

const DAY = 86400000;
const NOW = Date.UTC(2026, 10, 20);
const TOKEN = 'A'.repeat(43);
const SHA = 'a'.repeat(40);
const BLOB = 'b'.repeat(40);
const OTHER_BLOB = 'c'.repeat(40);
const SERVED = 'refs/heads/feature-a';

// The three times derive from the EFFECTIVE `idleSince`, so a row that overrides it keeps `sharedAt` 3 days and
// `firstSharedAt` 5 days before it, as real data always is, and a decider reading `sharedAt` answers 3 days early.
function entry(over: Partial<ReviewEntry> = {}): ReviewEntry {
  const idleSince = over.idleSince ?? NOW - 1000;
  return {
    id: 'share-1',
    source: {
      project: 'project-a', section: 'specs', path: 'x.md', branch: 'feature-a', head: SHA, servedRef: SERVED,
      baseCommit: SHA, fp: 'd'.repeat(64), committedBlob: BLOB,
    },
    version: 1,
    sharedAt: idleSince - 3 * DAY,
    firstSharedAt: idleSince - 5 * DAY,
    idleSince,
    lastViewedAt: null,
    pinned: false,
    sha256: 'e'.repeat(64),
    size: 100,
    credentialShapes: 0,
    revoking: false,
    tokenHash: 'f'.repeat(64),
    token: TOKEN,
    rev: 1,
    ...over,
  };
}

function docsEntry(over: Partial<DocsEntry> = {}): DocsEntry {
  return {
    section: 'specs', path: 'x.md',
    committed: { kind: 'file', blob: BLOB, size: 10 },
    draft: null,
    ...over,
  };
}

function tree(entries: DocsEntry[], served = SERVED, project = 'project-a'): DocsTreeOk {
  return { project, ref: { served }, entries } as unknown as DocsTreeOk;
}

describe('expiryOf', () => {
  it('is expired at exactly REVIEW_IDLE_MS after idleSince', () => {
    const e = entry({ idleSince: NOW - REVIEW_IDLE_MS });
    expect(expiryOf(e, NOW)).toEqual({ live: false, why: 'expired' });
  });
  it('is live 1 ms before REVIEW_IDLE_MS after idleSince', () => {
    const e = entry({ idleSince: NOW - REVIEW_IDLE_MS + 1 });
    expect(expiryOf(e, NOW)).toEqual({ live: true });
  });
  it('keeps a pinned share live whatever its idleSince, inside retention', () => {
    const e = entry({ pinned: true, idleSince: NOW - 60 * DAY, firstSharedAt: NOW - 10 * DAY });
    expect(expiryOf(e, NOW)).toEqual({ live: true });
  });
  it('removes a pinned share at retention', () => {
    const e = entry({ pinned: true, idleSince: NOW - DAY, firstSharedAt: NOW - 30 * DAY });
    expect(expiryOf(e, NOW)).toEqual({ live: false, why: 'retention' });
  });
  it('is retention at exactly REVIEW_RETENTION_MS after firstSharedAt, and live 1 ms before', () => {
    expect(expiryOf(entry({ firstSharedAt: NOW - REVIEW_RETENTION_MS }), NOW)).toEqual({ live: false, why: 'retention' });
    expect(expiryOf(entry({ firstSharedAt: NOW - REVIEW_RETENTION_MS + 1 }), NOW)).toEqual({ live: true });
  });
  it('says retention before expired when both hold', () => {
    const e = entry({ idleSince: NOW - 10 * DAY, firstSharedAt: NOW - 31 * DAY });
    expect(expiryOf(e, NOW)).toEqual({ live: false, why: 'retention' });
  });
});

describe('commitVerdict', () => {
  it('is committed for a changed blob', () => {
    expect(commitVerdict(entry(), tree([docsEntry({ committed: { kind: 'file', blob: OTHER_BLOB, size: 1 } })])))
      .toBe('committed');
  });
  it('is committed for null to a blob', () => {
    const e = entry();
    e.source.committedBlob = null;
    expect(commitVerdict(e, tree([docsEntry()]))).toBe('committed');
  });
  it('is keep for an equal blob, whatever the draft fingerprint says', () => {
    const e = entry();
    e.source.fp = '9'.repeat(64);
    expect(commitVerdict(e, tree([docsEntry({ draft: { state: 'modified', kind: 'file', size: 1, fp: '8'.repeat(64), trust: 'hash' } })])))
      .toBe('keep');
  });
  it('is keep for an uncommitted file still uncommitted', () => {
    const e = entry();
    e.source.committedBlob = null;
    expect(commitVerdict(e, tree([docsEntry({ committed: null })]))).toBe('keep');
  });
  it('is unmeasured for a null tree', () => {
    expect(commitVerdict(entry(), null)).toBe('unmeasured');
  });
  it('is unmeasured for a tree served at another ref', () => {
    expect(commitVerdict(entry(), tree([docsEntry({ committed: { kind: 'file', blob: OTHER_BLOB, size: 1 } })], 'refs/heads/other')))
      .toBe('unmeasured');
  });
  it('is unmeasured for a missing entry', () => {
    expect(commitVerdict(entry(), tree([docsEntry({ path: 'y.md' })]))).toBe('unmeasured');
  });
  it('is unmeasured for a same-path entry in another section', () => {
    expect(commitVerdict(entry(), tree([docsEntry({ section: 'plans' })]))).toBe('unmeasured');
  });
  it('is unmeasured for another project\'s tree at the same ref, section and path', () => {
    expect(commitVerdict(entry(), tree([docsEntry({ committed: { kind: 'file', blob: OTHER_BLOB, size: 1 } })], SERVED, 'project-b')))
      .toBe('unmeasured');
  });
});

describe('viewDue', () => {
  it('is true when never viewed', () => {
    expect(viewDue(entry({ lastViewedAt: null }), NOW)).toBe(true);
  });
  it('is false at 59 999 ms and true at 60 000 ms', () => {
    expect(viewDue(entry({ lastViewedAt: NOW - (REVIEW_VIEW_COARSEN_MS - 1) }), NOW)).toBe(false);
    expect(viewDue(entry({ lastViewedAt: NOW - REVIEW_VIEW_COARSEN_MS }), NOW)).toBe(true);
  });
});

describe('admitCreate', () => {
  const base = { size: 10, live: 0, storeBytes: 0, replacing: null };
  it('admits a small share into an empty store', () => {
    expect(admitCreate(base)).toEqual({ ok: true });
  });
  it('says too-large before store-full', () => {
    expect(admitCreate({ size: DOCS_EXPORT_MAX_BYTES + 1, live: REVIEW_MAX_LIVE, storeBytes: REVIEW_MAX_STORE_BYTES, replacing: null }))
      .toEqual({ ok: false, why: 'too-large' });
  });
  it('admits a share of exactly the export cap', () => {
    expect(admitCreate({ ...base, size: DOCS_EXPORT_MAX_BYTES })).toEqual({ ok: true });
  });
  it('refuses the 65th live share and admits the 64th', () => {
    expect(admitCreate({ ...base, live: REVIEW_MAX_LIVE - 1 })).toEqual({ ok: true });
    expect(admitCreate({ ...base, live: REVIEW_MAX_LIVE })).toEqual({ ok: false, why: 'store-full' });
  });
  it('refuses a new share one byte past REVIEW_MAX_STORE_BYTES and admits one landing exactly on it', () => {
    expect(admitCreate({ ...base, storeBytes: REVIEW_MAX_STORE_BYTES - 10 })).toEqual({ ok: true });
    expect(admitCreate({ ...base, storeBytes: REVIEW_MAX_STORE_BYTES - 9 })).toEqual({ ok: false, why: 'store-full' });
  });
  it('admits a re-share when the store is exactly full, counting the replaced share out', () => {
    expect(admitCreate({ size: 10, live: REVIEW_MAX_LIVE, storeBytes: REVIEW_MAX_STORE_BYTES, replacing: { size: 10 } }))
      .toEqual({ ok: true });
  });
  it('nets the replaced share out of the bytes only by its own size', () => {
    expect(admitCreate({ size: 11, live: 1, storeBytes: REVIEW_MAX_STORE_BYTES, replacing: { size: 10 } }))
      .toEqual({ ok: false, why: 'store-full' });
  });
});

describe('projectList', () => {
  const dark = { armed: false, signedIn: false, origin: 'https://h.example' };
  const open = { armed: true, signedIn: true, origin: 'https://h.example' };

  it('gives link null dark and signed out', () => {
    const [w] = projectList([entry()], [], dark);
    expect(w!.link).toBeNull();
  });
  it('gives link null when armed but signed out, and when signed in but dark', () => {
    expect(projectList([entry()], [], { ...open, signedIn: false })[0]!.link).toBeNull();
    expect(projectList([entry()], [], { ...open, armed: false })[0]!.link).toBeNull();
  });
  it('gives the link when armed and signed in', () => {
    const [w] = projectList([entry()], [], open);
    expect(w!.link).toBe(`https://h.example/review#${TOKEN}`);
    expect(w!.link).toMatch(/^https:\/\/h\.example\/review#[A-Za-z0-9_-]{43}$/);
  });
  it('gives a revoking share no link even armed and signed in', () => {
    const [w] = projectList([entry({ revoking: true })], [], open);
    expect(w!.link).toBeNull();
    expect(w!.revoking).toBe(true);
  });
  it('never puts token, tokenHash or rev on the wire', () => {
    const [w] = projectList([entry()], [], open);
    expect(Object.keys(w!)).not.toContain('token');
    expect(Object.keys(w!)).not.toContain('tokenHash');
    expect(Object.keys(w!)).not.toContain('rev');
    expect(w!.removed).toBeNull();
  });
  it('lists a tombstone as removed with no link, and after the live shares', () => {
    const t: ReviewTombstone = {
      id: 'gone-1', source: entry().source, version: 2, sharedAt: 1, firstSharedAt: 1, idleSince: 1, lastViewedAt: null,
      pinned: false, sha256: 'e'.repeat(64), size: 5, credentialShapes: 0, removed: { why: 'revoked', at: NOW },
    };
    const out = projectList([entry()], [t], open);
    expect(out.map((w) => w.id)).toEqual(['share-1', 'gone-1']);
    expect(out[1]!.link).toBeNull();
    expect(out[1]!.removed).toEqual({ why: 'revoked', at: NOW });
    expect(out[1]!.revoking).toBe(false);
  });
  it('puts exactly the wire fields on every row, a store-side field on a tombstone included', () => {
    const wire = ['id', 'source', 'version', 'sharedAt', 'firstSharedAt', 'idleSince', 'lastViewedAt', 'pinned', 'sha256',
      'size', 'credentialShapes', 'link', 'removed', 'revoking'].sort();
    // The store's tombstone carries its token hash to find its files; the type allows extra fields, the wire must not.
    const t = { id: 'gone-1', source: entry().source, version: 2, sharedAt: 1, firstSharedAt: 1, idleSince: 1,
      lastViewedAt: null, pinned: false, sha256: 'e'.repeat(64), size: 5, credentialShapes: 0,
      removed: { why: 'revoked' as const, at: NOW }, tokenHash: 'f'.repeat(64) } as ReviewTombstone;
    for (const w of projectList([entry()], [t], open)) expect(Object.keys(w).sort()).toEqual(wire);
  });
});
