// The native Docs reader's server-side caches (design 2026-10-01, section 6.5, section 3.12; W3 refinements (l) and
// (p)): L4. The committed blob LRU, the listing map, the draft `fp -> size` map and the per-node index micro-cache,
// every key carrying the node. The routes (Tasks 6 and 7) build one set per composition through `docsCaches()`,
// never at module scope, so two compositions (two `buildServer` calls, two tests) share nothing.
//
// Ring (M7.10; the ring guard in `single-definition.test.ts`): this file holds no clock (every caller passes
// `nowMs`) and DECIDES NOTHING. Every key is an L1 builder (`docsBlobKey`, `docsListingKey`, `docsDraftSizeKey`; the
// index micro-cache's key is the node itself), every bound an L1 constant, and whether a committed hit may be served
// or a show may fill is L1's `docsCacheVerdict` and `docsCacheFill`, applied by the routes. What stays here is
// bookkeeping: insertion-ordered `Map`s used as LRUs (a read or a write moves its key to the end; eviction takes the
// first key), the charges, the counts, and the comparisons of a running total or an age against an L1 bound.
import type { DocSectionSlug, DocsIndexOk, DocsShowOk, DocsTreeOk } from '../../../shared/docs.js';
import {
  DOCS_CACHE_BYTES, DOCS_DRAFT_SIZE_ENTRIES, DOCS_INDEX_CACHE_MS, DOCS_LISTING_MAP_ENTRIES, docsBlobKey,
  docsDraftSizeKey, docsListingKey, type DocsListedFile,
} from './policy.js';

/** One cached committed show: the verified answer and its decoded bytes (section 6.5: filled only from an ok
 *  committed answer that passed checks 8 and 9, and the routes' `docsShowBound`). */
export interface DocsCachedShow {
  answer: DocsShowOk;
  bytes: Uint8Array;
}

/** The committed blob LRU (section 6.5), keyed `node NUL repoKey NUL blob`, within `DOCS_CACHE_BYTES`. `get`
 *  answers `undefined` for one meaning: not cached. `bytes()` is the running charge, `size()` the entry count. */
export interface DocsBlobCache {
  get(node: string, repoKey: string, blob: string): DocsCachedShow | undefined;
  set(node: string, repoKey: string, blob: string, value: DocsCachedShow): void;
  bytes(): number;
  size(): number;
}

/**
 * The listing map (section 6.5): `(node, project, commit) -> {repoKey, files, refsAt}`, fed from every ok tree answer
 * the routes forward, AFTER `docsAnswerShape` passed it. `lookup` answers `undefined` for one meaning: no listing
 * entry for that (node, project, commit, section, path). `servedRefAgeMs` answers `undefined` for one meaning: that
 * `servedRef` was never recorded for that commit. `entries()` is the summed committed-entry count the bound applies
 * to; `commits()` the number of commits held.
 */
export interface DocsListingMap {
  record(node: string, tree: DocsTreeOk, nowMs: number): void;
  lookup(node: string, project: string, commit: string, section: DocSectionSlug, path: string):
    { repoKey: string; file: DocsListedFile } | undefined;
  servedRefAgeMs(node: string, project: string, commit: string, servedRef: string, nowMs: number): number | undefined;
  entries(): number;
  commits(): number;
}

/** The draft `fp -> size` map (section 6.5, section 3.12), node-keyed, LRU within `DOCS_DRAFT_SIZE_ENTRIES`. `get`
 *  answers `undefined` for one meaning: no size recorded for that fingerprint on that node. */
export interface DocsDraftSizes {
  record(node: string, tree: DocsTreeOk): void;
  get(node: string, fp: string): number | undefined;
  size(): number;
}

/** The per-node index micro-cache (section 6.5). `get` answers `undefined` for one meaning: nothing usable (absent,
 *  dropped, or not within `0 <= age < DOCS_INDEX_CACHE_MS`); a hit carries its age for `cacheAgeMs`. */
export interface DocsIndexCache {
  get(node: string, nowMs: number): { index: DocsIndexOk; ageMs: number } | undefined;
  set(node: string, index: DocsIndexOk, nowMs: number): void;
  drop(node: string): void;
}

/** One composition's caches (Task 6's `DocsNodeLanes.caches`). */
export interface DocsCaches {
  blobs: DocsBlobCache;
  listing: DocsListingMap;
  draftSizes: DocsDraftSizes;
  index: DocsIndexCache;
}

/** A blob entry and the charge it was admitted with, so a replacement or an eviction gives back exactly that. */
interface BlobSlot {
  value: DocsCachedShow;
  charge: number;
}

/**
 * The committed blob LRU. A value's charge is `Buffer.byteLength` of BOTH stored representations: the decoded bytes
 * and the answer's one content field (`text` or `b64`), since the cache holds both. A value charged above the whole
 * budget is never stored and evicts nothing; re-setting a key gives its old charge back first; after a set, the
 * least recently used entries go until the total is within the budget, so the value just set (charged at most the
 * budget) is never evicted by its own set.
 */
function docsBlobCache(): DocsBlobCache {
  const slots = new Map<string, BlobSlot>();
  let total = 0;

  const charge = (value: DocsCachedShow): number =>
    value.bytes.byteLength + Buffer.byteLength(value.answer.text ?? value.answer.b64 ?? '');

  return {
    get(node, repoKey, blob) {
      const key = docsBlobKey(node, repoKey, blob);
      const slot = slots.get(key);
      if (slot === undefined) return undefined;
      slots.delete(key);
      slots.set(key, slot);
      return slot.value;
    },
    set(node, repoKey, blob, value) {
      const c = charge(value);
      if (c > DOCS_CACHE_BYTES) return;
      const at = docsBlobKey(node, repoKey, blob);
      const old = slots.get(at);
      if (old !== undefined) {
        slots.delete(at);
        total -= old.charge;
      }
      slots.set(at, { value, charge: c });
      total += c;
      while (total > DOCS_CACHE_BYTES) {
        const oldest = slots.keys().next().value as string;
        total -= (slots.get(oldest) as BlobSlot).charge;
        slots.delete(oldest);
      }
    },
    bytes: () => total,
    size: () => slots.size,
  };
}

/** One commit's listing: its repository key, its committed facts by section then path, how many it holds, and when
 *  each served ref was last recorded at this commit. Nested maps, so this file builds no key of its own. */
interface ListedCommit {
  repoKey: string;
  files: Map<DocSectionSlug, Map<string, DocsListedFile>>;
  count: number;
  refsAt: Map<string, number>;
}

/** The committed facts of one tree: exactly `{blob, size, kind}` per entry whose `committed` is not `null` (a
 *  draft-only row has no committed facts), copied, so no other field ccd sent rides into the map. */
function listedFiles(tree: DocsTreeOk): { files: Map<DocSectionSlug, Map<string, DocsListedFile>>; count: number } {
  const files = new Map<DocSectionSlug, Map<string, DocsListedFile>>();
  let count = 0;
  for (const e of tree.entries) {
    const c = e.committed;
    if (c === null) continue;
    let inSection = files.get(e.section);
    if (inSection === undefined) {
      inSection = new Map<string, DocsListedFile>();
      files.set(e.section, inSection);
    }
    if (!inSection.has(e.path)) count += 1;
    inSection.set(e.path, { blob: c.blob, size: c.size, kind: c.kind });
  }
  return { files, count };
}

/**
 * The listing map. A record of a commit already held replaces its repository key and files with the new tree's (the
 * count is given back first, so nothing is counted twice), keeps the served refs it had, stamps the new one, and
 * moves the commit to the end. After a record, whole commits go, least recently used first, until the summed count
 * is within `DOCS_LISTING_MAP_ENTRIES`; the commit just recorded is never evicted by its own record. A `lookup` that
 * finds the commit moves it to the end; `servedRefAgeMs` reads without moving.
 */
function docsListingMap(): DocsListingMap {
  const commits = new Map<string, ListedCommit>();
  let total = 0;

  return {
    record(node, tree, nowMs) {
      const key = docsListingKey(node, tree.project, tree.ref.commit);
      const { files, count } = listedFiles(tree);
      const known = commits.get(key);
      const refsAt = known === undefined ? new Map<string, number>() : known.refsAt;
      if (known !== undefined) {
        commits.delete(key);
        total -= known.count;
      }
      refsAt.set(tree.ref.served, nowMs);
      commits.set(key, { repoKey: tree.repo.key, files, count, refsAt });
      total += count;
      while (total > DOCS_LISTING_MAP_ENTRIES && commits.size > 1) {
        const oldest = commits.keys().next().value as string;
        total -= (commits.get(oldest) as ListedCommit).count;
        commits.delete(oldest);
      }
    },
    lookup(node, project, commit, section, path) {
      const key = docsListingKey(node, project, commit);
      const held = commits.get(key);
      if (held === undefined) return undefined;
      commits.delete(key);
      commits.set(key, held);
      const file = held.files.get(section)?.get(path);
      return file === undefined ? undefined : { repoKey: held.repoKey, file };
    },
    servedRefAgeMs(node, project, commit, servedRef, nowMs) {
      const at = commits.get(docsListingKey(node, project, commit))?.refsAt.get(servedRef);
      return at === undefined ? undefined : nowMs - at;
    },
    entries: () => total,
    commits: () => commits.size,
  };
}

/** The draft size map: every entry whose draft carries a string `fp` and a number `size` (a `null` either way is no
 *  size fact, so it is not recorded); a record or a read moves its key to the end; past `DOCS_DRAFT_SIZE_ENTRIES`
 *  the least recently used go. */
function docsDraftSizes(): DocsDraftSizes {
  const sizes = new Map<string, number>();

  return {
    record(node, tree) {
      for (const e of tree.entries) {
        const d = e.draft;
        if (d === null || typeof d.fp !== 'string' || typeof d.size !== 'number') continue;
        const key = docsDraftSizeKey(node, d.fp);
        sizes.delete(key);
        sizes.set(key, d.size);
      }
      while (sizes.size > DOCS_DRAFT_SIZE_ENTRIES) sizes.delete(sizes.keys().next().value as string);
    },
    get(node, fp) {
      const key = docsDraftSizeKey(node, fp);
      const size = sizes.get(key);
      if (size === undefined) return undefined;
      sizes.delete(key);
      sizes.set(key, size);
      return size;
    },
    size: () => sizes.size,
  };
}

/** The index micro-cache: one `{index, atMs}` per node. A hit needs `0 <= age < DOCS_INDEX_CACHE_MS` (a clock that
 *  went back vouches for nothing, as in `docsCacheVerdict`); `drop` forgets the node's entry at once. */
function docsIndexCache(): DocsIndexCache {
  const held = new Map<string, { index: DocsIndexOk; atMs: number }>();

  return {
    get(node, nowMs) {
      const e = held.get(node);
      if (e === undefined) return undefined;
      const ageMs = nowMs - e.atMs;
      if (!(ageMs >= 0 && ageMs < DOCS_INDEX_CACHE_MS)) return undefined;
      return { index: e.index, ageMs };
    },
    set(node, index, nowMs) {
      held.set(node, { index, atMs: nowMs });
    },
    drop(node) {
      held.delete(node);
    },
  };
}

/** A fresh set of caches for one composition (refinement (i)): nothing here lives at module scope. */
export function docsCaches(): DocsCaches {
  return {
    blobs: docsBlobCache(),
    listing: docsListingMap(),
    draftSizes: docsDraftSizes(),
    index: docsIndexCache(),
  };
}
