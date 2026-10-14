// One Docs visit's state (spec 2026-10-01 4.3): the tree slots, the file slots, the leaf's expected pin, auto-refresh
// once per open, the retry plan's timers and the three lock ages (refinement (l)), and the re-list triggers (a
// refresh answer, a file read that says the listing is stale, a return to the tab after DOCS_STALE_MS, a sign-in).
// A visit is one mount of the hook: everything it remembers, including which keys it auto-refreshed and which
// failures it auto-retried, dies with the mount, so reopening the screen is a new visit.
//
// Every request is started from an effect or an answer handler, never from render; render only reads. The visit's
// memory lives in refs (so an answer handler always reads the newest state, and StrictMode's second effect pass sees
// the first pass's in-flight request), and a version counter re-renders when an answer lands.
import { useEffect, useReducer, useRef, useState } from 'react';
import {
  DOCS_CLASS_CAP, DOCS_STALE_MS, contentClass, docsRefText, entryView,
  type DocPin, type DocsEntry, type DocsFailure, type DocsFailureBody, type DocsFileResponse, type DocsPageLocation,
  type DocsRefreshFetch, type DocsRefSpec, type DocsTreeOk, type DocsTreeResponse,
} from '../../../shared/docs';
import { onAuthRegained } from '../lib/auth';
import {
  docsRetryPlan, type DocsClientSlot, type DocsFileAnswer, type DocsLoaders, type DocsNotOk,
  type DocsRefreshLoaderAnswer, type DocsTreeAnswer,
} from './failures';
import { DOCS_RELIST_WORDS } from './docsText';

/** A tree slot, exactly spec 4.3's type. `loading` is also what a page shows before its first GET has started. */
export type TreeSlot =
  | { s: 'loading' }
  | { s: 'ok'; answer: DocsTreeResponse; receivedAt: number }
  | { s: 'failed'; body: DocsFailureBody }
  | DocsClientSlot;

/** The current leaf's body. Every arm but `none` carries the pin it is about.
 *  - `none`: no file request is due here: the tree slot is not `ok`, the page is not a leaf of this tree, `pinFor`
 *    answered null, or the leaf is a raster (`DocImage` loads its bytes through `loaders.raster`).
 *  - `too-large`: the listed size is over `DOCS_CLASS_CAP` for the path's class; nothing was requested (spec 4.4).
 *  - `changing`: a read answered a word that means the listing moved (`DOCS_RELIST_WORDS`) after the one automatic
 *    re-list was spent; the page offers Retry.
 *  - `ok`: `pin` is the OPENED pin. After a re-list it can be older than `pinFor`'s answer only while the new pin's
 *    read is in flight (the old body stays on screen). */
export type FileSlot =
  | { s: 'none' }
  | { s: 'loading'; pin: DocPin }
  | { s: 'ok'; pin: DocPin; answer: DocsFileResponse; receivedAt: number }
  | { s: 'failed'; pin: DocPin; body: DocsFailureBody }
  | { s: 'too-large'; pin: DocPin; size: number; cap: number }
  | { s: 'changing'; pin: DocPin; word: DocsFailure }
  | (DocsClientSlot & { pin: DocPin });

/** The refresh state of the current tree key (spec 4.5's freshness chip reads it beside the tree's own facts).
 *  - `idle`: no refresh this visit for this key.
 *  - `fetching`: a POST is in flight.
 *  - `answered`: the route answered `fetch`; `at` is when (Date.now()).
 *  - `soon`: `fetch-too-soon`; one automatic POST is due at `retryAt` (Date.now() clock).
 *  - `stale-lock`: `ref-locked` with a lock at least `DOCS_LOCK_STALE_MS` old; no automatic retry. `ref` null: the
 *    answer named no ref.
 *  - `refresh-failed`: the POST itself got no route answer (a word from the route, or a client slot).
 *  - `relist-failed`: a re-list (a refresh's tree, or a GET) failed while a listing was held; the listing stays. */
export type Freshness =
  | { s: 'idle' }
  | { s: 'fetching'; reason: 'auto' | 'manual' }
  | { s: 'answered'; fetch: DocsRefreshFetch; at: number }
  | { s: 'soon'; retryAt: number }
  | { s: 'stale-lock'; ref: string | null }
  | { s: 'refresh-failed'; answer: DocsNotOk }
  | { s: 'relist-failed'; answer: DocsNotOk };

const NUL = '\u0000';

/** A tree slot's key: the project and the ref as the page names it, never the path (spec 4.3), so every page of
 *  one (project, ref) shares one listing and two refs of one project are two slots. */
export function treeKey(project: string, ref: DocsRefSpec | null): string {
  return project + NUL + (ref === null ? '' : docsRefText(ref));
}

function findEntry(tree: DocsTreeOk, section: DocPin['section'], path: string): DocsEntry | undefined {
  return tree.entries.find((e) => e.section === section && e.path === path);
}

/** A file body's key (spec 4.3 item 2). A committed body is keyed by its blob (and its place, since the class comes
 *  from the path), so a file unchanged across a moving branch is not downloaded again; a committed pin whose entry
 *  is not committed in `tree` falls back to the exact commit. A draft is keyed by every field of its pin. */
export function fileKey(pin: DocPin, tree: DocsTreeOk): string {
  if (pin.kind === 'draft') return ['draft', pin.branch, pin.head, pin.section, pin.path, pin.fp].join(NUL);
  const blob = findEntry(tree, pin.section, pin.path)?.committed?.blob;
  return blob === undefined
    ? ['commit', pin.commit, pin.section, pin.path].join(NUL)
    : ['blob', blob, pin.section, pin.path].join(NUL);
}

/** The pin the tree implies for the page's leaf (spec 4.3 item 5; pure). Null has one meaning: the page opens no
 *  file in this tree (not a leaf page, no such entry, or `entryView` opens nothing for it). The default view
 *  (`page.ref === null`) never opens a draft; `view=committed` opens the committed side of a draft row, or nothing
 *  when there is none. */
export function pinFor(tree: DocsTreeOk, page: DocsPageLocation): DocPin | null {
  if (page.kind !== 'path' || page.dirSlash) return null;
  const entry = findEntry(tree, page.section, page.path);
  if (entry === undefined) return null;
  const view = entryView(entry, tree.drafts, page.ref === null ? 'default' : 'ref');
  if (view.opens === 'none') return null;
  const committed: DocPin = {
    kind: 'committed', commit: tree.ref.commit, servedRef: tree.ref.served, section: page.section, path: page.path,
  };
  if (view.opens === 'committed') return committed;
  if (page.view === 'committed') return view.offersCommitted ? committed : null;
  const drafts = tree.drafts;
  const fp = entry.draft?.fp;
  // entryView opens a draft only for an admitted holder's regular file with a fingerprint.
  if (drafts.state !== 'holder' || fp === undefined || fp === null) {
    throw new Error('pinFor: a draft opened with no holder or fingerprint');
  }
  return { kind: 'draft', branch: drafts.branch, head: drafts.worktree.head, section: page.section, path: page.path, fp };
}

/** One visit, as the Docs views read it. */
export interface DocsVisit {
  /** The current page's tree slot; null = the page names no project (the index, or a URL that did not parse). */
  readonly tree: TreeSlot | null;
  readonly file: FileSlot;
  readonly freshness: Freshness;
  /** The commit the current leaf now reads at (a committed pin's commit, a draft pin's holder HEAD) after a re-list
   *  changed its pin and the new read answered; null = no such change for this leaf in this visit. */
  readonly updatedTo: string | null;
  /** A fragment to scroll to once the body renders; null = nothing to scroll to. */
  readonly pendingFragment: string | null;
  /** GET the current tree again now: Retry on a failed slot, Re-list on an ok one. A no-op while one is in flight. */
  retryTree(): void;
  /** Read the current leaf again: after `changing`, re-list first; after any other failure, read again. */
  retryFile(): void;
  /** The freshness chip's tap: one manual POST, only while the tree slot is ok and no POST is in flight. */
  refreshManual(): void;
  /** `unresolved-ref`'s Fetch from origin: one manual POST, only while the slot holds that word. */
  fetchFromOrigin(): void;
  setFragment(fragment: string | null): void;
}

type Target = { readonly project: string; readonly ref: DocsRefSpec | null };
type FileEntry = { slot: Exclude<FileSlot, { s: 'none' } | { s: 'too-large' }>; treeKey: string; awaitingRelist: boolean };
type Wanted =
  | { kind: 'none' }
  | { kind: 'too-large'; slot: FileSlot }
  | { kind: 'read'; target: Target; tKey: string; fKey: string; leaf: string; pin: DocPin };

interface Store {
  alive: boolean;
  readonly targets: Map<string, Target>;
  readonly trees: Map<string, TreeSlot>;
  readonly treeInflight: Set<string>;
  readonly refreshInflight: Set<string>;
  readonly freshness: Map<string, Freshness>;
  readonly files: Map<string, FileEntry>;
  /** Per leaf (tree key, section, path, view): the file key last shown `ok`, and the commit its pin named then. */
  readonly shown: Map<string, { readonly fKey: string; readonly commit: string }>;
  readonly updatedTo: Map<string, string>;
  readonly timers: Set<ReturnType<typeof setTimeout>>;
  /** The pending automatic refresh retry per tree key: a POST of any kind for the key ends it. */
  readonly refreshTimers: Map<string, ReturnType<typeof setTimeout>>;
  /** The in-flight file reads, each with the file key whose entry it is the single-flight mark of. */
  readonly aborts: Map<AbortController, string>;
  /** The last request number handed out (a GET takes one when it STARTS, a POST when its answer ARRIVES), and per tree key the number
   *  of the answer that last set the slot: an older answer landing later is not applied. */
  seq: number;
  readonly slotSeq: Map<string, number>;
}

function newStore(): Store {
  return {
    alive: false, targets: new Map(), trees: new Map(), treeInflight: new Set(), refreshInflight: new Set(),
    freshness: new Map(), files: new Map(), shown: new Map(), updatedTo: new Map(),
    timers: new Set(), refreshTimers: new Map(), aborts: new Map(), seq: 0, slotSeq: new Map(),
  };
}

function targetOf(page: DocsPageLocation | null): Target | null {
  if (page === null || page.kind === 'index') return null;
  return { project: page.project, ref: page.ref };
}

/** Spec 2 row 60's PWA half (refinement (m)): a `refs/heads/` view never auto-POSTs, whatever `refreshDue` says. */
function isLocalHeadsRef(ref: DocsRefSpec | null): boolean {
  return ref !== null && ref.kind === 'qualified' && ref.ref.startsWith('refs/heads/');
}

function samePin(a: DocPin, b: DocPin): boolean {
  if (a.kind === 'committed' && b.kind === 'committed') {
    return a.commit === b.commit && a.servedRef === b.servedRef && a.section === b.section && a.path === b.path;
  }
  if (a.kind === 'draft' && b.kind === 'draft') {
    return a.branch === b.branch && a.head === b.head && a.section === b.section && a.path === b.path && a.fp === b.fp;
  }
  return false;
}

function wantedFile(slot: TreeSlot | null, page: DocsPageLocation | null, target: Target | null): Wanted {
  if (slot?.s !== 'ok' || page?.kind !== 'path' || target === null) return { kind: 'none' };
  const tree = slot.answer.tree;
  const pin = pinFor(tree, page);
  if (pin === null || contentClass(page.path) === 'raster') return { kind: 'none' };
  const entry = findEntry(tree, page.section, page.path);
  const size = pin.kind === 'draft' ? entry?.draft?.size : entry?.committed?.size;
  const cap = DOCS_CLASS_CAP[contentClass(page.path)];
  if (typeof size === 'number' && size > cap) return { kind: 'too-large', slot: { s: 'too-large', pin, size, cap } };
  const tKey = treeKey(target.project, target.ref);
  const leaf = [tKey, page.section, page.path, page.view].join(NUL);
  return { kind: 'read', target, tKey, fKey: fileKey(pin, tree), leaf, pin };
}

function pinCommit(pin: DocPin): string {
  return pin.kind === 'committed' ? pin.commit : pin.head;
}

/** The visit for `page` (null = a URL that failed to parse: no request). `loaders` may change identity between
 *  renders; the newest is used for every later request. */
export function useDocsVisit(page: DocsPageLocation | null, loaders: DocsLoaders): DocsVisit {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const [pendingFragment, setFragment] = useState<string | null>(null);
  const loadersRef = useRef(loaders);
  loadersRef.current = loaders;
  const pageRef = useRef(page);
  pageRef.current = page;
  // Spec 4.3 items 3 and 4: one Set each, per mount. A key is added BEFORE its POST, synchronously.
  const autoRefreshed = useRef(new Set<string>());
  const autoRetried = useRef(new Set<string>());
  const storeRef = useRef<Store | null>(null);
  storeRef.current ??= newStore();
  const st = storeRef.current;

  const changed = (): void => {
    if (st.alive) bump();
  };
  const later = (ms: number, fn: () => void): ReturnType<typeof setTimeout> => {
    const t = setTimeout(() => {
      st.timers.delete(t);
      fn();
    }, ms);
    st.timers.add(t);
    return t;
  };
  /** True while `key` is the tree key of the page now open: a retry for a page the user left is not made. */
  const isCurrentKey = (key: string): boolean => {
    const now = targetOf(pageRef.current);
    return now !== null && treeKey(now.project, now.ref) === key;
  };
  /** A request's number: a GET takes it when it starts, a refresh POST when its answer arrives. */
  const nextSeq = (): number => {
    st.seq += 1;
    return st.seq;
  };
  /** Whether an answer to the request numbered `seq` is at least as new as the answer that last set `key`'s slot. */
  const isNewest = (key: string, seq: number): boolean => seq >= (st.slotSeq.get(key) ?? 0);
  /** One automatic retry per (request kind, key, word) for the whole visit; true when this call takes it. */
  const takeAutoRetry = (scope: string, key: string, word: string): boolean => {
    const id = [scope, key, word].join(NUL);
    if (autoRetried.current.has(id)) return false;
    autoRetried.current.add(id);
    return true;
  };

  /** Drop every file entry that waited for `tKey`'s re-list, so the next render reads its leaf again. */
  const releaseRelistWaiters = (tKey: string): void => {
    for (const [fKey, e] of st.files) if (e.awaitingRelist && e.treeKey === tKey) st.files.delete(fKey);
  };

  const setTreeOk = (key: string, seq: number, answer: DocsTreeResponse): void => {
    st.slotSeq.set(key, seq);
    st.trees.set(key, { s: 'ok', answer, receivedAt: Date.now() });
    if (st.freshness.get(key)?.s === 'relist-failed') st.freshness.set(key, { s: 'idle' });
  };

  const refresh = (target: Target, reason: 'auto' | 'manual'): void => {
    const key = treeKey(target.project, target.ref);
    if (st.refreshInflight.has(key)) return;
    // A POST now answers whatever a pending automatic retry was waiting to ask.
    const pending = st.refreshTimers.get(key);
    if (pending !== undefined) {
      clearTimeout(pending);
      st.timers.delete(pending);
      st.refreshTimers.delete(key);
    }
    st.refreshInflight.add(key);
    st.freshness.set(key, { s: 'fetching', reason });
    const body = { ref: target.ref === null ? null : docsRefText(target.ref), reason };
    void loadersRef.current.refresh(target.project, body).then((a) => {
      st.refreshInflight.delete(key);
      if (!st.alive) return;
      // Numbered when it ARRIVES: the route read its tree after its fetch, so it is newer than any GET that
      // started before this answer, however early the POST began.
      applyRefresh(target, key, reason, nextSeq(), a);
      changed();
    }, (err: unknown) => {
      // The mark is the single-flight guard: a loader that rejects must not leave the key pinned for good.
      st.refreshInflight.delete(key);
      throw err;
    });
  };

  /** An automatic refresh retry for `key`: ended by any later POST for the key, skipped once the page has left it. */
  const retryRefreshLater = (target: Target, key: string, reason: 'auto' | 'manual', ms: number): void => {
    const t = later(ms, () => {
      st.refreshTimers.delete(key);
      if (isCurrentKey(key)) refresh(target, reason);
    });
    st.refreshTimers.set(key, t);
  };

  const applyRefresh = (target: Target, key: string, reason: 'auto' | 'manual', seq: number, a: DocsRefreshLoaderAnswer): void => {
    const now = Date.now();
    if (a.s !== 'ok') {
      st.freshness.set(key, { s: 'refresh-failed', answer: a });
      if (a.s === 'failed') {
        const plan = docsRetryPlan(a.body);
        if (plan.kind === 'auto' && takeAutoRetry('refresh', key, a.body.failure)) {
          retryRefreshLater(target, key, reason, plan.afterMs);
        }
      }
      return;
    }
    const { fetch, tree } = a.value;
    if (fetch.state === 'failed') {
      // A fetch failure changes only the chip (spec 4.3): the listing it came with is the one already held.
      const body = fetch.failure;
      const plan = docsRetryPlan(body);
      let fresh: Freshness = { s: 'answered', fetch, at: now };
      if (plan.kind === 'auto' && takeAutoRetry('refresh', key, body.failure)) {
        retryRefreshLater(target, key, reason, plan.afterMs);
        if (body.failure === 'fetch-too-soon') fresh = { s: 'soon', retryAt: now + plan.afterMs };
      } else if (body.failure === 'ref-locked' && plan.kind === 'none') {
        fresh = { s: 'stale-lock', ref: typeof body.ref === 'string' ? body.ref : null };
      }
      st.freshness.set(key, fresh);
      return;
    }
    // The fetch happened whatever the listing's order: the chip says so. A listing older than the one the slot
    // holds is not applied (a GET that started before this answer arrived).
    if (!isNewest(key, seq)) {
      st.freshness.set(key, { s: 'answered', fetch, at: now });
    } else if (tree.ok) {
      setTreeOk(key, seq, tree);
      releaseRelistWaiters(key);
      st.freshness.set(key, { s: 'answered', fetch, at: now });
    } else if (st.trees.get(key)?.s === 'ok') {
      st.freshness.set(key, { s: 'relist-failed', answer: { s: 'failed', body: tree } });
    } else {
      st.slotSeq.set(key, seq);
      st.trees.set(key, { s: 'failed', body: tree });
      st.freshness.set(key, { s: 'answered', fetch, at: now });
    }
  };

  const listTree = (target: Target): void => {
    const key = treeKey(target.project, target.ref);
    if (st.treeInflight.has(key)) return;
    st.treeInflight.add(key);
    st.targets.set(key, target);
    // A held listing stays on screen through its re-list; anything else shows loading.
    if (st.trees.get(key)?.s !== 'ok') st.trees.set(key, { s: 'loading' });
    const seq = nextSeq();
    void loadersRef.current.tree(target.project, target.ref).then((a) => {
      st.treeInflight.delete(key);
      if (!st.alive) return;
      applyTreeGet(target, key, seq, a);
      changed();
    }, (err: unknown) => {
      st.treeInflight.delete(key);
      throw err;
    });
  };

  const applyTreeGet = (target: Target, key: string, seq: number, a: DocsTreeAnswer): void => {
    releaseRelistWaiters(key);
    // A GET started before the answer that last set the slot says what the listing was, not what it is.
    if (!isNewest(key, seq)) return;
    const relisted = st.trees.get(key)?.s === 'ok';
    if (a.s === 'ok') {
      setTreeOk(key, seq, a.value);
      // Auto-refresh (spec 4.3): when the slot BECOMES ok (a re-list of a held listing is a GET only, M4.A3), once
      // per key per visit, and never on a refs/heads/ view (refinement (m)).
      if (!relisted && a.value.refreshDue && !isLocalHeadsRef(target.ref) && !autoRefreshed.current.has(key)) {
        autoRefreshed.current.add(key);
        refresh(target, 'auto');
      }
      return;
    }
    if (relisted && a.s !== 'auth') {
      st.freshness.set(key, { s: 'relist-failed', answer: a });
      return;
    }
    st.slotSeq.set(key, seq);
    st.trees.set(key, a);
    if (a.s === 'failed') {
      const plan = docsRetryPlan(a.body);
      if (plan.kind === 'auto' && takeAutoRetry('tree', key, a.body.failure)) {
        later(plan.afterMs, () => {
          if (isCurrentKey(key)) listTree(target);
        });
      }
    }
  };

  const readFile = (w: Extract<Wanted, { kind: 'read' }>): void => {
    const { fKey, tKey, pin } = w;
    // The entry is the single-flight mark: the effect starts a read only for a key with no entry.
    st.files.set(fKey, { slot: { s: 'loading', pin }, treeKey: tKey, awaitingRelist: false });
    const ctl = new AbortController();
    st.aborts.set(ctl, fKey);
    void loadersRef.current.file(w.target.project, pin, ctl.signal).then((a) => {
      st.aborts.delete(ctl);
      if (!st.alive) return;
      applyFile(w, a);
      changed();
    }, (err: unknown) => {
      st.aborts.delete(ctl);
      if (ctl.signal.aborted) return;
      throw err;
    });
  };

  const applyFile = (w: Extract<Wanted, { kind: 'read' }>, a: DocsFileAnswer): void => {
    const { fKey, tKey, pin } = w;
    const put = (slot: FileEntry['slot'], awaitingRelist = false): FileEntry => {
      const e: FileEntry = { slot, treeKey: tKey, awaitingRelist };
      st.files.set(fKey, e);
      return e;
    };
    if (a.s === 'ok') {
      put({ s: 'ok', pin, answer: a.value, receivedAt: Date.now() });
      return;
    }
    if (a.s !== 'failed') {
      put({ ...a, pin });
      return;
    }
    const word = a.body.failure;
    if (DOCS_RELIST_WORDS.has(word)) {
      // Spec 4.3 item 1: the listing moved under the read. Re-list once automatically, then "changing, Retry".
      if (takeAutoRetry('file', fKey, word)) {
        put({ s: 'loading', pin }, true);
        listTree(w.target);
      } else {
        put({ s: 'changing', pin, word });
      }
      return;
    }
    const failed = put({ s: 'failed', pin, body: a.body });
    const plan = docsRetryPlan(a.body);
    if (plan.kind === 'auto' && takeAutoRetry('file', fKey, word)) {
      later(plan.afterMs, () => {
        // Only the failed entry this timer was set for: a Retry since then has put another in its place.
        if (st.files.get(fKey) !== failed) return;
        st.files.delete(fKey);
        changed();
      });
    }
  };

  // The mount: sign-in re-fetches, a return to the tab re-lists a stale listing, and unmount ends every timer and
  // read. StrictMode runs this twice; nothing here starts a request, so the second pass changes nothing.
  useEffect(() => {
    st.alive = true;
    const unsubscribe = onAuthRegained(() => {
      for (const [key, slot] of st.trees) {
        const target = st.targets.get(key);
        if (slot.s === 'auth' && target !== undefined) listTree(target);
      }
      for (const [fKey, e] of st.files) if (e.slot.s === 'auth') st.files.delete(fKey);
      changed();
    });
    const onVisibility = (): void => {
      if (document.visibilityState !== 'visible') return;
      const target = targetOf(pageRef.current);
      if (target === null) return;
      const slot = st.trees.get(treeKey(target.project, target.ref));
      // A GET, never a POST (spec 4.3, M4.A3).
      if (slot?.s === 'ok' && Date.now() - slot.receivedAt > DOCS_STALE_MS) listTree(target);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      st.alive = false;
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisibility);
      for (const t of st.timers) clearTimeout(t);
      st.timers.clear();
      for (const [c, fKey] of st.aborts) {
        c.abort();
        // The aborted read's answer is dropped, so its mark must go: the next effect pass reads again.
        if (st.files.get(fKey)?.slot.s === 'loading') st.files.delete(fKey);
      }
      st.aborts.clear();
      st.refreshTimers.clear();
      // A first GET still in flight is orphaned (its answer is dropped while not alive): its `loading` slot goes, so
      // the next effect pass lists again instead of waiting for ever on an answer that will not be read.
      for (const key of st.treeInflight) if (st.trees.get(key)?.s === 'loading') st.trees.delete(key);
    };
    // `st` is this mount's store: one object for the hook's life, so this runs once per mount (twice under
    // StrictMode, whose second pass finds nothing to start).
  }, [st]);

  const target = targetOf(page);
  const tKey = target === null ? null : treeKey(target.project, target.ref);
  const tree: TreeSlot | null = tKey === null ? null : (st.trees.get(tKey) ?? { s: 'loading' });
  const wanted = wantedFile(tree, page, target);

  // Start what this page needs and settle what it shows. Runs after every commit; every start is guarded.
  useEffect(() => {
    if (target !== null && tKey !== null && !st.trees.has(tKey)) listTree(target);
    if (wanted.kind !== 'read') return;
    const e = st.files.get(wanted.fKey);
    if (e === undefined) {
      readFile(wanted);
      return;
    }
    if (e.slot.s !== 'ok') return;
    let dirty = false;
    if (!samePin(e.slot.pin, wanted.pin)) {
      // The same blob at a newer commit: the bytes held are the bytes at the new pin.
      st.files.set(wanted.fKey, { ...e, slot: { ...e.slot, pin: wanted.pin } });
      dirty = true;
    }
    const prev = st.shown.get(wanted.leaf);
    const commit = pinCommit(wanted.pin);
    if (prev?.fKey !== wanted.fKey || prev.commit !== commit) {
      st.shown.set(wanted.leaf, { fKey: wanted.fKey, commit });
      // A new body at the same commit (a draft whose fingerprint moved) names no commit it was not already on.
      if (prev !== undefined && prev.fKey !== wanted.fKey && prev.commit !== commit) {
        st.updatedTo.set(wanted.leaf, commit);
        dirty = true;
      }
    }
    if (dirty) changed();
  });

  let file: FileSlot = { s: 'none' };
  let updatedTo: string | null = null;
  if (wanted.kind === 'too-large') file = wanted.slot;
  if (wanted.kind === 'read') {
    updatedTo = st.updatedTo.get(wanted.leaf) ?? null;
    const e = st.files.get(wanted.fKey);
    if (e !== undefined && e.slot.s !== 'loading') {
      file = e.slot;
    } else {
      // While the new pin's read is in flight, the leaf keeps the body it showed (spec 4.3: "keeping scroll").
      const prev = st.shown.get(wanted.leaf)?.fKey;
      const held = prev === undefined || prev === wanted.fKey ? undefined : st.files.get(prev);
      file = held?.slot.s === 'ok' ? held.slot : { s: 'loading', pin: wanted.pin };
    }
  }
  const freshness: Freshness = tKey === null ? { s: 'idle' } : (st.freshness.get(tKey) ?? { s: 'idle' });

  return {
    tree,
    file,
    freshness,
    updatedTo,
    pendingFragment,
    retryTree: () => {
      const t = targetOf(pageRef.current);
      if (t === null) return;
      listTree(t);
      changed();
    },
    retryFile: () => {
      const t = targetOf(pageRef.current);
      const slot = t === null ? undefined : st.trees.get(treeKey(t.project, t.ref));
      const w = wantedFile(slot ?? null, pageRef.current, t);
      if (w.kind !== 'read') return;
      const e = st.files.get(w.fKey);
      if (e === undefined || e.slot.s === 'ok' || e.slot.s === 'loading') return;
      if (e.slot.s === 'changing') {
        st.files.set(w.fKey, { slot: { s: 'loading', pin: w.pin }, treeKey: w.tKey, awaitingRelist: true });
        listTree(w.target);
      } else {
        st.files.delete(w.fKey);
      }
      changed();
    },
    refreshManual: () => {
      const t = targetOf(pageRef.current);
      if (t === null || st.trees.get(treeKey(t.project, t.ref))?.s !== 'ok') return;
      refresh(t, 'manual');
      changed();
    },
    fetchFromOrigin: () => {
      const t = targetOf(pageRef.current);
      const slot = t === null ? undefined : st.trees.get(treeKey(t.project, t.ref));
      if (t === null || slot?.s !== 'failed' || slot.body.failure !== 'unresolved-ref') return;
      refresh(t, 'manual');
      changed();
    },
    setFragment,
  };
}
