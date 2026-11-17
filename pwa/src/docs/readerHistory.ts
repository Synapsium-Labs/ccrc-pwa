// One reader body's history lifecycle (native Docs reader, completion plan Task 12 part B; the rich-docs spec's G5, G6 and
// M8.22). Ring L4 delivery: it reads, sequences and checks that its body is still the live one, and decides nothing the
// policy owners decide. The decisions are `reader/history.ts`'s (`readerVersionSeed`, `readerVersionMove`,
// `readerChangesBase`) and `reader/diff.ts`'s (`readerDiff`); the page a version move opens is `docsLocation`'s and
// `docsPageUrl`'s, a show's text is `docMarkdownSource`'s, and every read goes through the screen's own loaders and queue.
//
// `startReaderHistory` runs once per body, as the body's render starts, so the doc's commit list is read beside the render
// and the images. Everything it hands out is closed over that body's immutable pin and text and its `AbortSignal`: a body
// that has ended (its key changed, it fell back, it unmounted) answers `null` or does nothing, so a late answer never
// reaches the next body.
//
// The day filter a version list is cut to (`only`) is kept in the visit's `history.state` and never in the URL (M8.22): the
// URL names the commit, and the same URL is two entries with two filters when the user went back. `openVersion` records
// the filter it wants for the URL it opens; the page that mounts on that URL turns it into a mark in the entry it stands
// on, as the mockup viewer does for its full-frame entry (`MockupView.tsx`'s `pendingFullFrom`). A page load clears it.
import { useEffect, useState } from 'react';
import { docsPageUrl, isDocsCommit, type DocPin, type DocsLogOk, type DocsPageLocation, type DocsShowOk } from '../../../shared/docs';
import { navigate } from '../lib/router';
import { docMarkdownSource } from './DocMarkdown';
import { docsLocation } from './docsLinks';
import type { DocsHistoryLoader, DocsLoaders } from './failures';
import type { FetchQueue } from './fetchQueue';
import { readerDiff } from './reader/diff';
import { readerChangesBase, readerVersionMove, readerVersionSeed, type ReaderVersionSeed } from './reader/history';

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
  readonly loaders: Pick<DocsLoaders, 'file'> | null;
  readonly queue: FetchQueue | null;
  /** The body's: aborted when the body ends. */
  readonly signal: AbortSignal;
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
  /** The marks of the changes between the commit `sha` and this body, or `null` for unavailable. */
  changes(sha: string): Promise<ReaderChangeMarks | null>;
  openVersion(v: { sha?: string; only?: string }): void;
}

/** The filter `openVersion` last asked for, with the URL it opened. Module state: a page load clears it. */
let pending: { readonly href: string; readonly only: string | null } | null = null;

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
    addEventListener('popstate', sync);
    return () => removeEventListener('popstate', sync);
  }, []);
  return only;
}

export function startReaderHistory(i: ReaderHistoryInput): ReaderHistoryBody {
  const ended = (): boolean => i.signal.aborted;
  const draft = i.show.source === 'draft';
  const served = (draft ? i.show.head : i.show.commit) ?? '';
  const pin = i.pin;

  /** The committed log at the opened pin: `null` for anything that is not a complete answer. */
  const readLog = async (): Promise<DocsLogOk | null> => {
    if (draft || i.history === null || pin.kind !== 'committed' || !isDocsCommit(served)) return null;
    try {
      const a = await i.history.history(i.project, { commit: pin.commit, section: pin.section, path: pin.path });
      return a.s === 'ok' ? a.value.log : null;
    } catch {
      return null;
    }
  };
  const endedFirst = new Promise<null>((resolve) => {
    if (ended()) resolve(null);
    else i.signal.addEventListener('abort', () => resolve(null), { once: true });
  });
  const seed: Promise<ReaderVersionSeed | null> = Promise.race([
    readLog().then((log) => (ended() ? null : readerVersionSeed(served, draft, log, i.only))),
    endedFirst,
  ]);

  /** The text of a committed pin's file through the queue: `null` for a failure word, a client slot, a body that is not
   *  Markdown text, a rejection and an abort. */
  const textAt = async (loaders: Pick<DocsLoaders, 'file'>, queue: FetchQueue, p: DocPin): Promise<string | null> => {
    try {
      const a = await queue.run((s) => loaders.file(i.project, p, s), i.signal);
      if (a.s !== 'ok') return null;
      const src = docMarkdownSource(a.value.show);
      return src.kind === 'markdown' ? src.text : null;
    } catch {
      return null;
    }
  };

  return {
    seed,
    async changes(sha) {
      if (ended() || i.loaders === null || i.queue === null) return null;
      const base = readerChangesBase(pin, sha);
      if (base === null) return null;
      const [head, before] = await Promise.all([textAt(i.loaders, i.queue, pin), textAt(i.loaders, i.queue, base)]);
      // The marks are keyed to the bytes the frame rendered: a head that differs from them is not this body's.
      if (ended() || head === null || before === null || head !== i.text) return null;
      const d = readerDiff(before, head);
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
