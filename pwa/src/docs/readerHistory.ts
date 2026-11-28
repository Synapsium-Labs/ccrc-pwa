// One reader body's history lifecycle (native Docs reader, completion plan Task 12 part B; the rich-docs spec's G5, G6 and
// M8.22). Ring L4 delivery: it reads, sequences and checks that its body is still the live one, and decides nothing the
// policy owners decide. The decisions are `reader/history.ts`'s (`readerServedHash`, `readerLogAsk`, `readerVersionSeed`,
// `readerVersionMove`, `readerChangesBase`, `readerChangesTexts`) and `reader/diff.ts`'s (`readerDiff`); the page a version
// move opens is `docsLocation`'s and `docsPageUrl`'s, and a show's text is `docMarkdownSource`'s.
//
// `startReaderHistory` runs once per body, as the body's render starts, so the doc's commit list is read beside the render
// and the images. What it hands out is closed over that body's immutable pin and text and checks that the body is still the
// live one: a body that has ended (its key changed, it fell back, it unmounted) answers `null` or does nothing, so a late
// answer never reaches the next body. Its two kinds of read differ:
// - `changes` reads the head and the base through the screen's own file loader and fetch queue, with the body's
//   `AbortSignal`, so a body that ends aborts them. A body that is one part of a longer text (`part`, X2 P6.1 Step 0c) reads
//   the base alone, by range from the blob a `too-large` answer names when it is above the class cap, takes the head's whole
//   text from the part context, and marks this part (`reader/partChanges.ts`). The range read runs its calls through the same
//   queue, and the base text is kept for the history's life, one entry keyed by its pin;
// - the log is read through the screen's history loader, which takes no signal and is not queued, so the read is not
//   cancellable: a body that ends first resolves its seed `null` at once and drops the late answer, and a remount reads the
//   log again. The mount waits for the seed with no client time limit, as the docs loaders have none by design (the server
//   bounds the read).
//
// The comparison base (X2 P5.4, parity spec 5.6): every `changes(sha)` request first asks `readerChangesBaseToRecord` (L1, the
// library's own "which request to record" rule) whether it is a pick of the reader's own, and a pick is kept per doc in the tab's
// session storage (`readerDocChangesBaseKey`), so `changesBase()` seeds it into the next mount of the same doc in the same tab (a
// reload, a link back) and never into another tab. The shas a mount was seeded with (the last visit's, from the library's `seen`
// field in page storage, judged by `readerSeenSha` and never trusted for its shape, and the base) are read when `changesBase()` is
// asked, right before each mount, and kept per body: the frame moves `seen` before it asks, so no later reading stands for them.
// Nothing is written to `seen`.
//
// The day filter a version list is cut to (`only`) is kept in the visit's `history.state` and never in the URL (M8.22): the
// URL names the commit, and the same URL is two entries with two filters when the user went back. `openVersion` records
// the filter it wants for the URL it opens; the page that mounts on that URL turns it into a mark in the entry it stands
// on, as the mockup viewer does for its full-frame entry (`MockupView.tsx`'s `pendingFullFrom`). A page load clears it.
import { useEffect, useState } from 'react';
import {
  docListPinKey, docsPageUrl, type DocPin, type DocsFailureBody, type DocsLogOk, type DocsPageLocation, type DocsShowOk,
} from '../../../shared/docs';
import { onPop } from '../lib/popstate';
import { navigate } from '../lib/router';
import { docMarkdownSource } from './DocMarkdown';
import { docsLocation } from './docsLinks';
import type { DocsHistoryLoader, DocsLoaders } from './failures';
import type { FetchQueue } from './fetchQueue';
import { readerDiff } from './reader/diff';
import {
  readerChangesBase, readerChangesBaseToRecord, readerChangesTexts, readerDocChangesBaseKey, readerLogAsk, readerSeenKey, readerSeenSha,
  readerServedHash, readerVersionMove, readerVersionSeed,
  type ReaderPinRead, type ReaderVersionSeed,
} from './reader/history';
import { readerDocKey } from './reader/policy';
import { enumerablePageStorage, readKey, tabStorage, writeKey } from '../lib/storage';
import { partChangeTexts } from './reader/partChanges';
import type { MdPart } from './range/mdParts';
import { rangeOfTooLarge } from './range/rangePolicy';
import { readRange, type RangeLoader } from './range/readRange';

/** The key of the day filter in a history entry's state. */
export const READER_ONLY_STATE_KEY = 'ccrcReaderOnly';

/** What one body gives its history. */
export interface ReaderHistoryInput {
  readonly project: string;
  /** The body's answer: its commit or head, source, section and path. */
  readonly show: DocsShowOk;
  /** The text the frame renders (`docMarkdownSource(show).text`). */
  readonly text: string;
  /** The body's opened pin, immutable for the body. */
  readonly pin: DocPin;
  /** The page now, read when a version op runs. */
  readonly page: () => DocsPageLocation & { kind: 'path' };
  /** The day filter of the history entry the page stands on. */
  readonly only: string | null;
  readonly history: DocsHistoryLoader | null;
  /** `range` is read only for the base of a part above the class cap (`part`), by the blob its `too-large` answer names. */
  readonly loaders: Pick<DocsLoaders, 'file' | 'range'> | null;
  readonly queue: FetchQueue | null;
  /** The body's: aborted when the body ends. */
  readonly signal: AbortSignal;
  /** Set when the body is one part of a longer text (`PartContext`): the whole text the leaf read and this part's cut. Its
   *  `changes` then reads only the base and marks this part (`partChangeTexts`); `text` is the part's rendered text. Absent or
   *  `null`, the body is the whole text, as before. */
  readonly part?: { readonly whole: string; readonly part: MdPart } | null;
}

/** The marks of the changes since a base commit, in the frame's shape. */
export interface ReaderChangeMarks {
  readonly ranges: readonly (readonly [number, number])[];
  readonly removedAfter: readonly number[];
}

export interface ReaderHistoryBody {
  /** The seed for this body's mount; resolves once and never rejects: `null` for a served hash that is not a full commit,
   *  and for a body that ended first. */
  readonly seed: Promise<ReaderVersionSeed | null>;
  /** The comparison base this tab holds for the doc (X2 P5.4), read now from session storage: the stored text, or `null` for none (no
   *  base kept, no per-doc key, an unreadable store). Not judged here: whether it is a full sha is `policy.ts#readerSeedChangesBase`'s
   *  one judgement. Asked by the bridge right before each library mount, so a mount made after a pick seeds the pick, and the call is
   *  the record of what that mount was seeded with: it adds the base and the last visit's sha as they stand to the body's seeded shas,
   *  which no request for them is then recorded against. */
  changesBase(): string | null;
  /** The marks of the changes between the commit `sha` and this body, or `null` for unavailable. */
  changes(sha: string): Promise<ReaderChangeMarks | null>;
  openVersion(v: { sha?: string; only?: string }): void;
}

/** The filter `openVersion` last asked for, with the URL it opened. Module state: a page load clears it. */
let pending: { readonly href: string; readonly only: string | null } | null = null;

/** Tests only: forget the pending filter, so one case's `openVersion` that nothing consumed never reaches the next case. */
export function resetReaderOnlyForTests(): void {
  pending = null;
}

const UNAVAILABLE: ReaderPinRead = { kind: 'unavailable' };

const hereUrl = (): string => location.pathname + location.search;

/** The day filter of the entry the page stands on. The pending filter is the answer for the URL it was set for, and with
 *  `apply` it is spent and written into this entry's state. Any other entry answers its own mark, or none. */
function entryOnly(apply: boolean): string | null {
  const p = pending;
  if (p !== null && p.href === hereUrl()) {
    if (apply) {
      pending = null;
      if (p.only !== null) {
        try {
          history.replaceState({ ...(history.state as object | null), [READER_ONLY_STATE_KEY]: p.only }, '');
        } catch {
          // The entry cannot be marked: this page still reads with the filter, and a reload shows none.
        }
      }
    }
    return p.only;
  }
  const s: unknown = history.state;
  if (typeof s !== 'object' || s === null) return null;
  const mark = (s as Record<string, unknown>)[READER_ONLY_STATE_KEY];
  return typeof mark === 'string' ? mark : null;
}

/** The day filter of the history entry the page stands on, for the leaf to hand its body. It follows every move through
 *  the visit's entries (`popstate`, which the router's `navigate` fires too) and writes nothing while it renders. */
export function useReaderOnly(): string | null {
  const [only, setOnly] = useState<string | null>(() => entryOnly(false));
  useEffect(() => {
    const sync = (): void => setOnly(entryOnly(true));
    sync();
    return onPop(sync);
  }, []);
  return only;
}

export function startReaderHistory(i: ReaderHistoryInput): ReaderHistoryBody {
  const ended = (): boolean => i.signal.aborted;
  const draft = i.show.source === 'draft';
  const served = readerServedHash(i.show) ?? '';
  const pin = i.pin;

  /** The committed log at the opened pin: `null` for anything that is not a complete answer. */
  const readLog = async (): Promise<DocsLogOk | null> => {
    const ask = readerLogAsk(pin, draft, served);
    if (i.history === null || ask === null) return null;
    try {
      const a = await i.history.history(i.project, ask);
      return a.s === 'ok' ? a.value.log : null;
    } catch {
      return null;
    }
  };
  const endedFirst = new Promise<null>((resolve) => {
    if (ended()) resolve(null);
    else i.signal.addEventListener('abort', () => resolve(null), { once: true });
  });
  // The day filter the seed kept (a one-day version, `version.only` in the library's words): a mount seeded with one asks only that
  // day's sha, so no request of it is a pick (`readerChangesBaseToRecord`). Set when the seed is made, before the mount that asks.
  let seededOnly: string | null = null;
  const seed: Promise<ReaderVersionSeed | null> = Promise.race([
    readLog().then((log) => {
      const s = ended() ? null : readerVersionSeed(served, draft, log, i.only);
      seededOnly = s === null ? null : s.only;
      return s;
    }),
    endedFirst,
  ]);

  // The comparison base of the tab (X2 P5.4, parity spec 5.6): kept per doc in session storage, recorded by `changes` below, seeded
  // back by `changesBase`. The doc's key is the one the frame's own per-doc state uses; a doc with none keeps nothing.
  const docKey = readerDocKey(i.project, i.show.section, i.show.path);
  const lastVisit = (): string | null => (docKey === null ? null : readerSeenSha(readKey(readerSeenKey(docKey), enumerablePageStorage)));
  /** The stored text as it stands, a string or nothing: whether it is a full sha is the policy's one judgement
   *  (`readerSeedChangesBase`, on the way to the seed), so none is made here. */
  const storedBase = (): string | null => (docKey === null ? null : readKey(readerDocChangesBaseKey(docKey), tabStorage));
  // Every sha seeded into a library mount of this body, as each mount was made with it: the library writes `seen := this commit` BEFORE
  // it asks `changes(prior)`, so a reading of `seen` at the request is the commit itself, and another tab's open can move it between
  // two mounts. `changesBase()` is asked by the bridge synchronously right before each mount, so it reads the last visit and the
  // stored base THEN (the two the frame is then seeded with) and adds both; nothing is read at the request's time or at the body's start.
  const seededShas = new Set<string>();
  /** Keeps the sha of a request that is a pick of the reader's own (`readerChangesBaseToRecord`, the library's rule decides). A write
   *  that fails changes nothing: the next mount seeds the base it had. */
  const recordPick = (sha: string): void => {
    if (docKey === null) return;
    const rec = readerChangesBaseToRecord(sha, { seeded: seededShas, only: seededOnly });
    if (rec !== null) writeKey(readerDocChangesBaseKey(docKey), rec, tabStorage);
  };
  const changesBase = (): string | null => {
    const visit = lastVisit();
    if (visit !== null) seededShas.add(visit);
    const base = storedBase();
    if (base !== null) seededShas.add(base.toLowerCase());
    return base;
  };

  /** A committed pin's bytes read by range after the file route's `too-large`: the text, or `unavailable`. */
  const rangeText = async (
    loaders: Pick<DocsLoaders, 'file' | 'range'>, queue: FetchQueue, p: DocPin, body: DocsFailureBody,
  ): Promise<ReaderPinRead> => {
    const over = rangeOfTooLarge(body);
    const range = loaders.range;
    if (over === null || range === undefined) return UNAVAILABLE;
    // The prepare and each frame are queued calls, so a 64 MiB base shares the screen's fetch slots with its images instead of
    // taking them beside the queue; the queue's job signal follows the body's, so an abort still ends the read.
    const queued: RangeLoader = {
      prepare: (t, s) => queue.run((q) => range.prepare(t, q), s),
      frame: (t, snapshot, offset, length, s) => queue.run((q) => range.frame(t, snapshot, offset, length, q), s),
    };
    const read = await readRange(
      queued, { project: i.project, pin: p, range: { kind: 'blob', sha: over.blob }, size: over.size },
      { signal: i.signal, onProgress: () => {} },
    );
    if (!read.ok) return UNAVAILABLE;
    try {
      return { kind: 'text', text: new TextDecoder('utf-8', { fatal: true }).decode(read.bytes) };
    } catch {
      return UNAVAILABLE;
    }
  };

  /** One committed pin's file read through the queue, in `readerChangesTexts`'s shape: the text of a Markdown show, the
   *  server's failure word kept exactly as sent (what it means is L1's), and `unavailable` for a client slot, a body that
   *  is not Markdown text, a rejection and an abort. */
  const textAt = async (
    loaders: Pick<DocsLoaders, 'file' | 'range'>, queue: FetchQueue, p: DocPin, byRange = false,
  ): Promise<ReaderPinRead> => {
    try {
      const a = await queue.run((s) => loaders.file(i.project, p, s), i.signal);
      // The base of a part above the class cap: the file route answers `too-large` with the blob of the path at that commit, and
      // the same bytes are read by range, pinned by it (bounded by `DOCS_RANGE_MAX_BYTES`, abortable on the body's signal). An
      // answer that names no blob, or no loader, or a failed or non-UTF-8 read, is unavailable.
      if (a.s === 'failed' && byRange && a.body.failure === 'too-large') return await rangeText(loaders, queue, p, a.body);
      if (a.s === 'failed') return { kind: 'failed', failure: a.body.failure };
      if (a.s !== 'ok') return UNAVAILABLE;
      const src = docMarkdownSource(a.value.show);
      return src.kind === 'markdown' ? { kind: 'text', text: src.text } : UNAVAILABLE;
    } catch {
      return UNAVAILABLE;
    }
  };

  /** The base text of the last `changes` ask of a part, keyed by its pin; dropped when the body ends. */
  let baseCache: { readonly key: string; readonly read: Promise<ReaderPinRead> } | null = null;
  if (!ended()) i.signal.addEventListener('abort', () => { baseCache = null; }, { once: true });

  /** One part's marks: the base through `readerChangesBase` (a draft pin stays unavailable), the head's whole text from the part
   *  context (the bytes the leaf read, so no second read of the head), and `partChangeTexts` for this part's rendered text. */
  const partChanges = async (
    sha: string, ctx: { readonly whole: string; readonly part: MdPart }, loaders: Pick<DocsLoaders, 'file' | 'range'>, queue: FetchQueue,
  ): Promise<ReaderChangeMarks | null> => {
    const base = readerChangesBase(pin, sha);
    if (base === null) return null;
    // The base text read for a commit is kept for this history's life (one entry, up to 64 MiB), so asking again for the same
    // commit reads nothing; only a text is kept, so a failed read is read again, and the end of the body drops the entry.
    const key = docListPinKey(base);
    let entry = baseCache;
    if (entry === null || entry.key !== key) {
      const read = textAt(loaders, queue, base, true);
      const made = { key, read };
      entry = made;
      baseCache = made;
      void read.then((r) => { if (r.kind !== 'text' && baseCache === made) baseCache = null; });
    }
    const baseRead = await entry.read;
    if (ended()) return null;
    const texts = readerChangesTexts(baseRead, { kind: 'text', text: ctx.whole }, ctx.whole);
    return texts === null ? null : partChangeTexts(texts.before, ctx.whole, ctx.part, i.text);
  };

  return {
    seed,
    changesBase,
    async changes(sha) {
      if (ended() || i.loaders === null || i.queue === null) return null;
      // Every comparison reaches here, so a pick of the reader's is kept as the tab's base on its request (a comparison that then
      // answers unavailable is asked again by the next mount, as the library's own rule asks).
      recordPick(sha);
      if (i.part !== undefined && i.part !== null) return partChanges(sha, i.part, i.loaders, i.queue);
      const base = readerChangesBase(pin, sha);
      if (base === null) return null;
      const [headRead, baseRead] = await Promise.all([textAt(i.loaders, i.queue, pin), textAt(i.loaders, i.queue, base)]);
      if (ended()) return null;
      // The marks are keyed to the bytes the frame rendered: `readerChangesTexts` refuses a head that differs from them.
      const texts = readerChangesTexts(baseRead, headRead, i.text);
      if (texts === null) return null;
      const d = readerDiff(texts.before, texts.after);
      return d.kind === 'available' ? { ranges: d.ranges, removedAfter: d.removedAfter } : null;
    },
    openVersion(v) {
      if (ended()) return;
      const move = readerVersionMove(v);
      if (move === null) return;
      const href = docsPageUrl(docsLocation(i.page(), { kind: 'version', at: move.at }));
      pending = { href, only: move.only };
      navigate(href);
    },
  };
}
