// `server/src/docs/cache.ts`, the native Docs reader's server-side caches (design 2026-10-01, section 6.5, section
// 3.12; W3 refinements (l) and (p)). Task 5 pins the units: M3.13 (every key carries the node: two node values give
// two entries in each cache, and two flights), the blob LRU (charged as BOTH stored representations, LRU not FIFO,
// never a value above the whole budget), the listing map (committed rows only, the three facts copied, whole
// commits evicted by file count, a re-record counted once, the served-ref ages), the draft size map and the index
// micro-cache. Task 6 appends the route-level describe (section 2 row 52, M6.11).
//
// Every bound is read from L1 (`policy.ts`), never typed here. Fixtures carry placeholders only.
import { describe, expect, it } from 'vitest';
import { docsCaches, type DocsCachedShow } from '../src/docs/cache.js';
import { docsFlights } from '../src/docs/lane.js';
import {
  DOCS_CACHE_BYTES, DOCS_DRAFT_SIZE_ENTRIES, DOCS_INDEX_CACHE_MS, DOCS_LISTING_MAP_ENTRIES, docsShowFlightKey,
  docsTreeFlightKey,
} from '../src/docs/policy.js';
import type { DocPin, DocsEntry, DocsIndexOk, DocsShowOk, DocsTreeOk } from '../../shared/docs.js';
import { blocker } from './docsRouteHelpers.js';

const MIB = 1048576;
const REPO = 'a'.repeat(32);
const BLOB = 'b'.repeat(40);
const COMMIT = 'c'.repeat(40);
const MAIN = 'refs/remotes/origin/main';
const WS = 'refs/heads/ws/a';

/** A 40-hex commit or blob from an index: distinct per `i`. */
const hex40 = (i: number): string => i.toString(16).padStart(40, '0');
/** A 64-hex fingerprint from an index: distinct per `i`. */
const hex64 = (i: number): string => i.toString(16).padStart(64, '0');

/** An ok utf8 show answer carrying `text` (its `size` the text's UTF-8 length). */
function textAnswer(text: string): DocsShowOk {
  return {
    v: 1, verb: 'docs-show', ok: true, elapsedMs: 3, source: 'committed', section: 'specs', path: 'x.md',
    size: Buffer.byteLength(text), sha256: 'd'.repeat(64), encoding: 'utf8', text,
    commit: COMMIT, blob: BLOB, mode: '100644', onRef: 'contains',
  };
}

/** A cached show whose answer carries `text` and whose decoded bytes are `bytes`. */
function shown(bytes: Uint8Array, text = ''): DocsCachedShow {
  return { answer: textAnswer(text), bytes };
}

/** A committed listing row; `extra` rides beside the three facts, as an unknown key from ccd would. */
function committedRow(path: string, blob: string, size: number | null, kind: 'file' | 'symlink' = 'file'): DocsEntry {
  return { section: 'specs', path, committed: { kind, blob, size, extra: 1 } as DocsEntry['committed'], draft: null };
}

/** A draft-only row: no committed facts, a draft with `fp` and `size` as given. */
function draftRow(path: string, fp: string | null, size: number | null): DocsEntry {
  return {
    section: 'specs', path, committed: null,
    draft: { state: 'untracked', kind: 'file', size, fp, trust: 'hash' },
  };
}

/** A complete ok tree of `project` at `commit`, served from `served`, with `entries`. */
function treeOf(commit: string, served: string, entries: DocsEntry[], project = 'demo', repoKey = REPO): DocsTreeOk {
  return {
    v: 1, verb: 'docs-tree', ok: true, elapsedMs: 5, project,
    repo: { key: repoKey, objectFormat: 'sha1', shallow: false },
    github: { state: 'named', slug: 'example-org/example-repo' },
    ref: {
      requested: null, served, name: 'main', side: 'origin', commit, via: 'default:origin-head', tried: [],
      relation: 'equal', counterpart: null,
    },
    mainCheckout: { path: '/tmp/example', branch: 'main', head: commit },
    sections: [], entries, unlisted: { count: 0, byReason: {} },
    drafts: { state: 'none', branch: 'main', skipped: [] },
    freshness: { remote: 'origin', trackedRef: MAIN, stamp: null, fetchHead: null },
  };
}

/** A tree of `n` committed file rows (`f<i>.md`) at `commit`. */
function bigTree(commit: string, n: number): DocsTreeOk {
  const entries: DocsEntry[] = [];
  for (let i = 0; i < n; i += 1) entries.push(committedRow(`f${i}.md`, BLOB, 10));
  return treeOf(commit, MAIN, entries);
}

/** An ok index naming `project`. */
function indexOf(project: string): DocsIndexOk {
  return {
    v: 1, verb: 'docs-index', ok: true, elapsedMs: 2, unlisted: 0, duplicates: [],
    projects: [{ project, state: 'ready', github: { state: 'none' } }],
  };
}

const live = (): AbortSignal => new AbortController().signal;

describe('docs caches — every key carries the node (spec 2026-10-01 M3.13, section 3.12)', () => {
  it('blob cache: the same (repoKey, blob) under two nodes is two entries, each answering its own value', () => {
    const { blobs } = docsCaches();
    const one = shown(new Uint8Array(3), 'one');
    const two = shown(new Uint8Array(3), 'two');
    blobs.set('n1', REPO, BLOB, one);
    blobs.set('n2', REPO, BLOB, two);
    expect(blobs.size()).toBe(2);
    expect(blobs.get('n1', REPO, BLOB)).toBe(one);
    expect(blobs.get('n2', REPO, BLOB)).toBe(two);
  });

  it('listing map: the same tree under two nodes is two commits, and a lookup under a node never recorded misses', () => {
    const { listing } = docsCaches();
    const tree = treeOf(COMMIT, MAIN, [committedRow('x.md', BLOB, 7)]);
    listing.record('n1', tree, 1000);
    expect(listing.lookup('n2', 'demo', COMMIT, 'specs', 'x.md')).toBeUndefined();
    expect(listing.servedRefAgeMs('n2', 'demo', COMMIT, MAIN, 1000)).toBeUndefined();
    listing.record('n2', tree, 1000);
    expect(listing.commits()).toBe(2);
    expect(listing.entries()).toBe(2);
  });

  it('draft sizes: one fingerprint under two nodes keeps two sizes', () => {
    const { draftSizes } = docsCaches();
    const fp = hex64(1);
    draftSizes.record('n1', treeOf(COMMIT, MAIN, [draftRow('d.md', fp, 5)]));
    draftSizes.record('n2', treeOf(COMMIT, MAIN, [draftRow('d.md', fp, 7)]));
    expect(draftSizes.size()).toBe(2);
    expect(draftSizes.get('n1', fp)).toBe(5);
    expect(draftSizes.get('n2', fp)).toBe(7);
  });

  it('index micro-cache: one node\'s index is not another\'s', () => {
    const { index } = docsCaches();
    index.set('n1', indexOf('a'), 0);
    expect(index.get('n2', 1)).toBeUndefined();
    expect(index.get('n1', 1)?.index.projects[0].project).toBe('a');
  });

  it('single-flight: the same tree or show under two nodes starts two flights; the same node twice starts one', () => {
    const flights = docsFlights();
    const b = blocker<number>();
    void flights.join(docsTreeFlightKey('n1', 'demo', null, 0), live(), () => b.exec());
    void flights.join(docsTreeFlightKey('n2', 'demo', null, 0), live(), () => b.exec());
    void flights.join(docsTreeFlightKey('n1', 'demo', null, 0), live(), () => b.exec());
    expect(b.started()).toBe(2);
    const pin: DocPin = { kind: 'committed', commit: COMMIT, servedRef: MAIN, section: 'specs', path: 'x.md' };
    void flights.join(docsShowFlightKey('n1', 'demo', pin, 100), live(), () => b.exec());
    void flights.join(docsShowFlightKey('n2', 'demo', pin, 100), live(), () => b.exec());
    expect(b.started()).toBe(4);
    expect(flights.size()).toBe(4);
  });

  it('each docsCaches() call is its own set: nothing is shared at module scope', () => {
    const a = docsCaches();
    const b = docsCaches();
    a.blobs.set('n1', REPO, BLOB, shown(new Uint8Array(1)));
    a.listing.record('n1', treeOf(COMMIT, MAIN, [committedRow('x.md', BLOB, 1)]), 0);
    a.draftSizes.record('n1', treeOf(COMMIT, MAIN, [draftRow('d.md', hex64(1), 1)]));
    a.index.set('n1', indexOf('a'), 0);
    expect(b.blobs.size()).toBe(0);
    expect(b.listing.commits()).toBe(0);
    expect(b.draftSizes.size()).toBe(0);
    expect(b.index.get('n1', 1)).toBeUndefined();
  });
});

describe('docs caches — the committed blob LRU (section 6.5; refinement (l))', () => {
  const one = new Uint8Array(MIB);

  it('65 values of 1 MiB stay within DOCS_CACHE_BYTES: the first is evicted, the second kept', () => {
    const { blobs } = docsCaches();
    for (let i = 0; i < 65; i += 1) blobs.set('n1', REPO, hex40(i), shown(one));
    expect(blobs.bytes()).toBeLessThanOrEqual(DOCS_CACHE_BYTES);
    expect(blobs.bytes()).toBe(64 * MIB);
    expect(blobs.size()).toBe(64);
    expect(blobs.get('n1', REPO, hex40(0))).toBeUndefined();
    expect(blobs.get('n1', REPO, hex40(1))).toBeDefined();
    expect(blobs.get('n1', REPO, hex40(64))).toBeDefined();
  });

  it('LRU, not FIFO: a get on the second before the 65th set keeps it, and the third goes instead', () => {
    const { blobs } = docsCaches();
    for (let i = 0; i < 64; i += 1) blobs.set('n1', REPO, hex40(i), shown(one));
    expect(blobs.get('n1', REPO, hex40(0))).toBeDefined();
    blobs.set('n1', REPO, hex40(64), shown(one));
    expect(blobs.get('n1', REPO, hex40(0))).toBeDefined();
    expect(blobs.get('n1', REPO, hex40(1))).toBeUndefined();
    expect(blobs.get('n1', REPO, hex40(2))).toBeDefined();
  });

  it('a value charged exactly the budget is stored and evicts everything else', () => {
    const { blobs } = docsCaches();
    blobs.set('n1', REPO, hex40(1), shown(new Uint8Array(10)));
    blobs.set('n1', REPO, hex40(2), shown(new Uint8Array(DOCS_CACHE_BYTES - 4), 'abcd'));
    expect(blobs.size()).toBe(1);
    expect(blobs.bytes()).toBe(DOCS_CACHE_BYTES);
    expect(blobs.get('n1', REPO, hex40(2))).toBeDefined();
  });

  it('a value of DOCS_CACHE_BYTES + 1 in bytes alone is never stored and evicts nothing', () => {
    const { blobs } = docsCaches();
    blobs.set('n1', REPO, hex40(1), shown(new Uint8Array(10)));
    blobs.set('n1', REPO, hex40(2), shown(new Uint8Array(DOCS_CACHE_BYTES + 1)));
    expect(blobs.size()).toBe(1);
    expect(blobs.bytes()).toBe(10);
    expect(blobs.get('n1', REPO, hex40(2))).toBeUndefined();
    expect(blobs.get('n1', REPO, hex40(1))).toBeDefined();
  });

  it('the text counts toward the charge: bytes of budget - 4 and 5 bytes of text are never stored', () => {
    const { blobs } = docsCaches();
    blobs.set('n1', REPO, hex40(1), shown(new Uint8Array(10)));
    blobs.set('n1', REPO, hex40(2), shown(new Uint8Array(DOCS_CACHE_BYTES - 4), 'abcde'));
    expect(blobs.size()).toBe(1);
    expect(blobs.bytes()).toBe(10);
  });

  it('a value whose utf8 text is n bytes (and n decoded bytes) is charged 2n, by byte length, not by length', () => {
    const { blobs } = docsCaches();
    const text = 'é'.repeat(3);
    blobs.set('n1', REPO, BLOB, shown(new Uint8Array(Buffer.from(text, 'utf8')), text));
    expect(blobs.bytes()).toBe(12);
  });

  it('a base64 answer is charged its decoded bytes plus its b64 text', () => {
    const { blobs } = docsCaches();
    const answer: DocsShowOk = {
      v: 1, verb: 'docs-show', ok: true, elapsedMs: 3, source: 'committed', section: 'specs', path: 'x.png',
      size: 4, sha256: 'd'.repeat(64), encoding: 'base64', b64: 'AAECAw==', commit: COMMIT, blob: BLOB,
      mode: '100644', onRef: 'contains',
    };
    blobs.set('n1', REPO, BLOB, { answer, bytes: new Uint8Array([0, 1, 2, 3]) });
    expect(blobs.bytes()).toBe(12);
  });

  it('re-setting a key replaces its charge, never adds to it', () => {
    const { blobs } = docsCaches();
    blobs.set('n1', REPO, BLOB, shown(new Uint8Array(10)));
    blobs.set('n1', REPO, hex40(1), shown(new Uint8Array(5)));
    blobs.set('n1', REPO, BLOB, shown(new Uint8Array(20)));
    expect(blobs.size()).toBe(2);
    expect(blobs.bytes()).toBe(25);
    expect(blobs.get('n1', REPO, BLOB)?.bytes.byteLength).toBe(20);
  });
});

describe('docs caches — the listing map (section 6.5; refinement (l))', () => {
  it('records committed rows only, copying exactly {blob, size, kind}; a listed null size stays null', () => {
    const { listing } = docsCaches();
    const tree = treeOf(COMMIT, MAIN, [
      committedRow('x.md', BLOB, null),
      committedRow('link.md', hex40(9), 12, 'symlink'),
      draftRow('new.md', hex64(1), 3),
    ]);
    listing.record('n1', tree, 1000);
    expect(listing.entries()).toBe(2);
    expect(listing.commits()).toBe(1);
    expect(listing.lookup('n1', 'demo', COMMIT, 'specs', 'x.md'))
      .toEqual({ repoKey: REPO, file: { blob: BLOB, size: null, kind: 'file' } });
    expect(listing.lookup('n1', 'demo', COMMIT, 'specs', 'link.md'))
      .toEqual({ repoKey: REPO, file: { blob: hex40(9), size: 12, kind: 'symlink' } });
    expect(listing.lookup('n1', 'demo', COMMIT, 'specs', 'new.md')).toBeUndefined();
    expect(listing.lookup('n1', 'demo', COMMIT, 'plans', 'x.md')).toBeUndefined();
    expect(listing.lookup('n1', 'b', COMMIT, 'specs', 'x.md')).toBeUndefined();
  });

  it('11 trees of 5000 committed rows: at most DOCS_LISTING_MAP_ENTRIES, 10 commits, the first evicted', () => {
    const { listing } = docsCaches();
    for (let i = 0; i < 11; i += 1) listing.record('n1', bigTree(hex40(i), 5000), 0);
    expect(listing.entries()).toBeLessThanOrEqual(DOCS_LISTING_MAP_ENTRIES);
    expect(listing.entries()).toBe(50000);
    expect(listing.commits()).toBe(10);
    expect(listing.lookup('n1', 'demo', hex40(0), 'specs', 'f0.md')).toBeUndefined();
    expect(listing.lookup('n1', 'demo', hex40(1), 'specs', 'f0.md')).toBeDefined();
    expect(listing.lookup('n1', 'demo', hex40(10), 'specs', 'f0.md')).toBeDefined();
  });

  it('LRU by commit: a lookup on the first before the 11th record keeps it, and the second goes instead', () => {
    const { listing } = docsCaches();
    for (let i = 0; i < 10; i += 1) listing.record('n1', bigTree(hex40(i), 5000), 0);
    expect(listing.lookup('n1', 'demo', hex40(0), 'specs', 'f0.md')).toBeDefined();
    listing.record('n1', bigTree(hex40(10), 5000), 0);
    expect(listing.lookup('n1', 'demo', hex40(0), 'specs', 'f0.md')).toBeDefined();
    expect(listing.lookup('n1', 'demo', hex40(1), 'specs', 'f0.md')).toBeUndefined();
    expect(listing.commits()).toBe(10);
  });

  it('a commit alone above the bound is kept by its own record (the newest is never evicted)', () => {
    const { listing } = docsCaches();
    listing.record('n1', bigTree(hex40(1), 10), 0);
    listing.record('n1', bigTree(hex40(2), DOCS_LISTING_MAP_ENTRIES + 1), 0);
    expect(listing.commits()).toBe(1);
    expect(listing.entries()).toBe(DOCS_LISTING_MAP_ENTRIES + 1);
    expect(listing.lookup('n1', 'demo', hex40(2), 'specs', 'f0.md')).toBeDefined();
  });

  it('re-recording a known commit counts its rows once and stamps each served ref; ages are nowMs - recordedAt', () => {
    const { listing } = docsCaches();
    const rows = [committedRow('x.md', BLOB, 7), committedRow('y.md', hex40(3), 8)];
    listing.record('n1', treeOf(COMMIT, MAIN, rows), 1000);
    listing.record('n1', treeOf(COMMIT, WS, rows), 1100);
    expect(listing.entries()).toBe(2);
    expect(listing.commits()).toBe(1);
    expect(listing.servedRefAgeMs('n1', 'demo', COMMIT, MAIN, 1500)).toBe(500);
    expect(listing.servedRefAgeMs('n1', 'demo', COMMIT, WS, 1500)).toBe(400);
    listing.record('n1', treeOf(COMMIT, MAIN, rows), 1400);
    expect(listing.entries()).toBe(2);
    expect(listing.servedRefAgeMs('n1', 'demo', COMMIT, MAIN, 1500)).toBe(100);
    expect(listing.servedRefAgeMs('n1', 'demo', COMMIT, WS, 1500)).toBe(400);
  });

  it('a re-record takes the new tree\'s repository key and rows', () => {
    const { listing } = docsCaches();
    listing.record('n1', treeOf(COMMIT, MAIN, [committedRow('x.md', BLOB, 7)]), 0);
    listing.record('n1', treeOf(COMMIT, MAIN, [committedRow('z.md', BLOB, 9)], 'demo', 'e'.repeat(32)), 0);
    expect(listing.entries()).toBe(1);
    expect(listing.lookup('n1', 'demo', COMMIT, 'specs', 'x.md')).toBeUndefined();
    expect(listing.lookup('n1', 'demo', COMMIT, 'specs', 'z.md'))
      .toEqual({ repoKey: 'e'.repeat(32), file: { blob: BLOB, size: 9, kind: 'file' } });
  });

  it('servedRefAgeMs: 599999 at t0 + 599999; an unrecorded ref or commit is undefined', () => {
    const { listing } = docsCaches();
    listing.record('n1', treeOf(COMMIT, MAIN, [committedRow('x.md', BLOB, 7)]), 5000);
    expect(listing.servedRefAgeMs('n1', 'demo', COMMIT, MAIN, 5000 + 599999)).toBe(599999);
    expect(listing.servedRefAgeMs('n1', 'demo', COMMIT, WS, 5000)).toBeUndefined();
    expect(listing.servedRefAgeMs('n1', 'demo', hex40(1), MAIN, 5000)).toBeUndefined();
  });
});

describe('docs caches — the draft size map (section 6.5, section 3.12)', () => {
  /** One tree whose `n` draft rows carry fingerprints `hex64(from) ..`, each its index as its size. */
  const drafts = (from: number, n: number): DocsTreeOk => {
    const rows: DocsEntry[] = [];
    for (let i = from; i < from + n; i += 1) rows.push(draftRow(`d${i}.md`, hex64(i), i));
    return treeOf(COMMIT, MAIN, rows);
  };

  it('10001 distinct fingerprints keep DOCS_DRAFT_SIZE_ENTRIES; the first is gone, the last kept', () => {
    const { draftSizes } = docsCaches();
    draftSizes.record('n1', drafts(0, DOCS_DRAFT_SIZE_ENTRIES + 1));
    expect(draftSizes.size()).toBe(DOCS_DRAFT_SIZE_ENTRIES);
    expect(draftSizes.get('n1', hex64(0))).toBeUndefined();
    expect(draftSizes.get('n1', hex64(1))).toBe(1);
    expect(draftSizes.get('n1', hex64(DOCS_DRAFT_SIZE_ENTRIES))).toBe(DOCS_DRAFT_SIZE_ENTRIES);
  });

  it('LRU: a get on the first before one more record keeps it, and the second goes instead', () => {
    const { draftSizes } = docsCaches();
    draftSizes.record('n1', drafts(0, DOCS_DRAFT_SIZE_ENTRIES));
    expect(draftSizes.get('n1', hex64(0))).toBe(0);
    draftSizes.record('n1', drafts(DOCS_DRAFT_SIZE_ENTRIES, 1));
    expect(draftSizes.get('n1', hex64(0))).toBe(0);
    expect(draftSizes.get('n1', hex64(1))).toBeUndefined();
  });

  it('a draft whose fp or size is null, and a committed-only row, record nothing; a listed 0 is a size', () => {
    const { draftSizes } = docsCaches();
    draftSizes.record('n1', treeOf(COMMIT, MAIN, [
      draftRow('a.md', null, 5), draftRow('b.md', hex64(2), null), committedRow('c.md', BLOB, 4),
      draftRow('e.md', hex64(3), 0),
    ]));
    expect(draftSizes.size()).toBe(1);
    expect(draftSizes.get('n1', hex64(2))).toBeUndefined();
    expect(draftSizes.get('n1', hex64(3))).toBe(0);
  });
});

describe('docs caches — the index micro-cache (section 6.5)', () => {
  it('a hit carries its age until DOCS_INDEX_CACHE_MS; at the bound it is gone', () => {
    const { index } = docsCaches();
    const ix = indexOf('a');
    index.set('n1', ix, 1000);
    expect(index.get('n1', 1000)).toEqual({ index: ix, ageMs: 0 });
    expect(index.get('n1', 1000 + DOCS_INDEX_CACHE_MS - 1)).toEqual({ index: ix, ageMs: DOCS_INDEX_CACHE_MS - 1 });
    expect(index.get('n1', 1000 + DOCS_INDEX_CACHE_MS)).toBeUndefined();
  });

  it('a clock that went back vouches for nothing', () => {
    const { index } = docsCaches();
    index.set('n1', indexOf('a'), 1000);
    expect(index.get('n1', 999)).toBeUndefined();
  });

  it('drop forgets the node at once and leaves every other node; a set after it is a fresh entry', () => {
    const { index } = docsCaches();
    index.set('n1', indexOf('a'), 0);
    index.set('n2', indexOf('b'), 0);
    index.drop('n1');
    expect(index.get('n1', 1)).toBeUndefined();
    expect(index.get('n2', 1)?.index.projects[0].project).toBe('b');
    index.set('n1', indexOf('c'), 10);
    expect(index.get('n1', 10)).toEqual({ index: indexOf('c'), ageMs: 0 });
  });
});
