// A Markdown leaf's rich reader (native Docs reader, W8a Task 8; the rich-docs spec's (docs/superpowers/specs/2026-10-12-rich-docs-reader-and-shared-renderer-design.md, amended 2026-10-31)
// section 4.1 (host, focus, remount) and section 4.6 (every trigger, the fixed note), M8.7, M8.11, M8.17, M8.19 and the W8a plan's refinement (g)).
// Ring L4 delivery: it runs the render, the images and the mount under one `AbortController` and acts on what the
// policy owners answer (`routeReaderLink`, `copyDecision`, `readerDocKey`, `readerPrefsOf`, `readerBodyReducer`); it
// decides none of it. (The frame's start watchdog is the adapter's, `mountReader`'s, from the same policy.)
//
// Where a body lands, in the order of section 4.6 (the architecture's R6):
//   G1  no reader (`MarkdownBody` does not mount this component at all): the plain view as today;
//   G2  bytes over `DOCS_RENDER_GATE_BYTES`: `DocMarkdown`, which asks first. No render and no mount;
//   G4  a render that was refused, not rendered, threw, or whose worker failed or is unavailable: `DocMarkdown`, which
//       says its own note. The reason goes to the console;
//   G5  a render timeout: `DocPlain` with the timeout note, and no second parse;
//   G3  an adapter chunk that does not load, or a mount that rejects for any cause: the fixed note over `DocMarkdown`;
//   G6  the frame's own `onFallback`: the same, after the mount is destroyed;
//   G7  a Mermaid chunk that does not load is `mountReader`'s own on request (it drops the scan and still mounts), and
//       the library's own after `ready` (every figure stays its source, with the load note).
// On the Docs screen the mount asks for the bar the screen's slot names (`docs/readerBar.ts`), as it starts; on ccrc's
// bar the handle (the title, the commands, the progress) is published while the frame is ready (the library 1.1
// take-up plan, refinement (i)).
// A body stays where it landed until its `bodyKey` changes (`MarkdownBody` keys this component by it), so a fallback
// never mounts again. The reason of G3, G4 and G6 is kept for the console and never reaches the page.
// One thing starts the body again: images that answered 401 (`ReaderImages.auth`). Those images show the frame's own
// "not loaded" chip, and signing in cures them, so a body whose images reported one listens for `onAuthRegained` (the plain
// view's precedent, `useImageSrc`) and, when it fires, `ReaderFrame` starts a NEW body (it keys the body by the count of
// those sign-ins): the old body's cleanup tears the mount down and gives its drafts back, and the new body runs the render,
// the images and the mount from `rendering`, its "Formatting…" note shown, once per sign-in. A run inside the old body would
// start where that body landed, and `readerBodyReducer` takes `plain` only from `rendering` and `ready` only from
// `mounting`, so a second render that timed out or was refused would land nowhere (review 2361 F1). The body listens from
// before its images walk: sign-in is announced once, and a sign-in that completes while a queued load is still pending is
// latched, so a walk that ends with a 401 starts the new body at once, with no mount of its own (review 2372 F1). A body whose
// images reported none stops listening when the walk ends.
//
// A body also owns its history (completion plan Task 12 part B, `readerHistory.ts`): when the leaf hands it the opened pin
// (`opened`), the body's run starts the commit-list read as the render starts, so it runs beside the render and the images,
// and awaits the seed once the images are in and before the mount. The mount then carries the version seed (the served
// commit, the draft flag, the commits and the day filter) and the `changes` and `openVersion` of that body, which are closed
// over the body's own pin and text and answer nothing once the body ends. The document carries no version of its own: the
// seed is the one carrier. Without `opened` there is no history read and no version list, and the seed is the served hash alone.
//
// The library's host and the frame's asset texts reach the main bundle only through the two literal dynamic imports in
// `lazyMountReader`; this file names the adapter's types with `import type` only.
import { THEMES } from '@ccrc/ui';
import { useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import type { DocPin, DocsPageLocation, DocsShowOk } from '../../../shared/docs';
import { utf8ByteLength } from '../lib/markdownGuard';
import { DOCS_PARSE_BUDGET_MS, DOCS_RENDER_GATE_BYTES } from '../lib/markdownLimits';
import type { MarkdownParser } from '../lib/markdownRunner';
import type { ReaderRenderOutcome } from '../lib/readerRenderJob';
import { onAuthRegained } from '../lib/auth';
import { navigate, replaceFragment } from '../lib/router';
import { useThemeChoice } from '../lib/theme';
import { DocsAssetContext } from './DocImage';
import type { DocsHistoryLoader } from './failures';
import type { DocLinkContextValue } from './DocLink';
import { DocMarkdown, DocPlain, docMarkdownSource, docsPlainNote, DOC_FORMATTING } from './DocMarkdown';
import {
  ReaderCopyFailedSheet, ReaderCopySheet, ReaderLinkSheet,
  type ReaderCopyAsk, type ReaderCopyFailedAsk, type ReaderLinkAsk,
} from './ReaderSheets';
import type { ReaderImages, loadReaderImages } from './reader/images';
import type { ReaderMount, ReaderMountInput, ReaderThemePref } from './reader/bridge';
import { readerVersionSeed } from './reader/history';
import { startReaderHistory } from './readerHistory';
import {
  copyDecision, readerBarTitle, readerBodyReducer, readerDocKey, readerPrefsOf, routeReaderLink,
  type ReaderBodyState, type ReaderLink,
} from './reader/policy';
import { READER_FALLBACK_NOTE, type ReaderHiddenChar } from './reader/readerText';
import { ReaderBarContext, createReaderProgress, usePublishReaderBar, type ReaderBar } from './readerBar';
import { leafName } from './docsTree';
import { copyText } from './share';
import { READER_BODY, usePublishExportBody } from './exportBody';

type LinkBase = Omit<DocLinkContextValue, 'urls'>;

/** What the leaf needs of the reader: the render job, the mount, and the page's images. A test injects all three. */
export interface ReaderDeps {
  render(src: string, o: { budgetMs: number; signal?: AbortSignal }): Promise<ReaderRenderOutcome>;
  mount(el: HTMLElement, input: ReaderMountInput): Promise<ReaderMount>;
  images: typeof loadReaderImages;
  /** The doc's commit list (B2's history loader). Absent, no commit list is read. */
  readonly history?: DocsHistoryLoader;
}

/** The default `mount`: the adapter and the frame's texts load on first use, each through its own literal `import()`
 *  (so the library's host and the asset strings are chunks, and the main bundle holds neither). A rejected import
 *  rejects this promise whole, and the caller falls back (G3). */
export const lazyMountReader: ReaderDeps['mount'] = async (el, input) => {
  const [{ mountReader }, { loadReaderAssets, loadMermaidAsset }] = await Promise.all([
    import('./reader/bridge'),
    import('./reader/assets'),
  ]);
  return mountReader(el, input, { assets: loadReaderAssets, mermaid: loadMermaidAsset });
};

export interface ReaderFrameProps {
  readonly show: DocsShowOk;
  readonly bodyKey: string;
  readonly link: LinkBase;
  readonly parser: MarkdownParser;
  readonly reader: ReaderDeps;
  /** What the body's history is read for: the pin the leaf opened it at, the page now and the day filter of the history
   *  entry the page stands on. Absent, no history is read and the frame offers no `changes` or `openVersion`. */
  readonly opened?: { readonly pin: DocPin; readonly page: DocsPageLocation & { kind: 'path' }; readonly only: string | null };
  /** The visit's pending fragment: handed to the frame as its `initialHash` when it mounts. */
  readonly pendingFragment: string | null;
  /** Called once the fragment is handed over. */
  onFragmentConsumed(): void;
}

/** What is asked of the reader in a sheet. */
type Ask =
  | { readonly kind: 'link'; readonly ask: ReaderLinkAsk }
  | { readonly kind: 'copy'; readonly ask: ReaderCopyAsk }
  | { readonly kind: 'copy-failed'; readonly ask: ReaderCopyFailedAsk };

const NO_IMAGES: ReaderImages = { urls: {}, drafts: 0, auth: 0 };

/** The pending fragment as the frame's `initialHash`: the address bar holds it percent-encoded, and the frame matches
 *  decoded ids. A malformed escape keeps the raw text (as `fragmentTarget` does in the plain view). */
function decodedFragment(fragment: string | null): string | null {
  if (fragment === null) return null;
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}

/** What was thrown, for the console only: an error's name and message, else its type. */
function reasonOf(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : typeof e;
}

/** Why a render did not succeed, for the console only: the arm, then the arm's own reason (a refusal's rule and line, which
 *  limit or failure a not-rendered answer names, the thrown error's name). Names and numbers only; the document's text is
 *  never part of an outcome, so it is never part of this line. */
function outcomeReason(o: Exclude<ReaderRenderOutcome, { kind: 'rendered' | 'timeout' }>): string {
  switch (o.kind) {
    case 'refused':
      return `refused: ${o.why} at line ${o.line}`;
    case 'not-rendered':
      return `not-rendered: ${o.why}`;
    case 'threw':
    case 'worker-failed':
      return `${o.kind}: ${o.error}`;
    case 'worker-unavailable':
      return o.kind;
  }
}

/** Tells Export that the reader frame shows this body (refinement (a)). Mounted in the frame's arm only, so a fallback's
 *  plain view publishes its own body in its place. */
function ReaderShown(): null {
  usePublishExportBody(READER_BODY);
  return null;
}

/** Publishes the frame's bar for the Docs header while the frame is ready (the take-up plan, refinement (i)). Mounted in
 *  the ready arm only, so a fallback or an unmount withdraws it. */
function ReaderBarShown(p: { readonly bar: ReaderBar }): null {
  usePublishReaderBar(p.bar);
  return null;
}

/** A Markdown body in the rich reader. `MarkdownBody` answers the two byte kinds that are not Markdown before it mounts
 *  this, so `null` here has one meaning: that answer was not Markdown, and the caller has shown it already. */
export function ReaderFrame(p: ReaderFrameProps): ReactNode {
  const src = useMemo(() => docMarkdownSource(p.show), [p.show]);
  /** How many times sign-in has returned over a body with 401 images: the body's key, so each one starts a new body. */
  const [signedIn, setSignedIn] = useState(0);
  if (src.kind !== 'markdown') return null;
  return <ReaderBody key={signedIn} {...p} text={src.text} onSignedIn={() => setSignedIn((n) => n + 1)} />;
}

function ReaderBody(p: ReaderFrameProps & { readonly text: string; readonly onSignedIn: () => void }): ReactNode {
  const { text } = p;
  const bytes = useMemo(() => utf8ByteLength(text), [text]);
  const overGate = bytes > DOCS_RENDER_GATE_BYTES;
  const assets = useContext(DocsAssetContext);
  const prefs = readerPrefsOf(useThemeChoice(), THEMES).theme;
  const link = useMemo<DocLinkContextValue>(() => ({ ...p.link, urls: new WeakMap() }), [p.link]);
  const [state, dispatch] = useReducer(
    readerBodyReducer, undefined, (): ReaderBodyState => (overGate ? { s: 'plain', why: 'over-gate' } : { s: 'rendering' }),
  );
  const [ask, setAsk] = useState<Ask | null>(null);
  /** The bar this body's frame publishes once ready; `null`: its frame is on its own bar, or not mounted yet. */
  const [bar, setBar] = useState<ReaderBar | null>(null);
  const barSlot = useContext(ReaderBarContext);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mountRef = useRef<ReaderMount | null>(null);
  /** The frame theme the frame was last given: the mount's seed, then each `setPrefs`. */
  const seededPrefs = useRef<ReaderThemePref['theme'] | null>(null);
  /** The latest props, for the callbacks the frame holds for its whole life. */
  const live = useRef({ props: p, link, assets, prefs, barSlot });
  useEffect(() => {
    live.current = { props: p, link, assets, prefs, barSlot };
  });

  // A later change of the DERIVED theme reaches the frame as its `prefs` operation: no remount, so the reading position
  // survives, and a switch between two palettes of one mode sends nothing.
  useEffect(() => {
    const m = mountRef.current;
    if (m === null || seededPrefs.current === prefs) return;
    seededPrefs.current = prefs;
    m.setPrefs({ theme: prefs });
  }, [prefs]);

  useEffect(() => {
    if (overGate) return undefined;
    const ac = new AbortController();
    let mount: ReaderMount | null = null;
    let landed = false;
    let counted = 0;
    let uncount: ((delta: number) => void) | null = null;
    /** The listener for sign-in: subscribed before the images walk, and kept after it only when the walk reported a 401. */
    let unwatchAuth: (() => void) | null = null;

    const drop = (): void => {
      mount?.destroy();
      mount = null;
      mountRef.current = null;
    };
    /** The drafts this body counted go back once: a fallback hands the page to the plain view, which counts its own. */
    const giveBack = (): void => {
      if (counted !== 0 && uncount !== null) uncount(-counted);
      counted = 0;
    };
    const unwatch = (): void => {
      unwatchAuth?.();
      unwatchAuth = null;
    };
    /** G3 and G6: the mount, if any, goes; the fixed note shows; the reason stays in the console. */
    const fallBack = (reason: string): void => {
      if (ac.signal.aborted || landed) return;
      landed = true;
      unwatch();
      console.warn(`ccrc: reader fell back (${reason})`);
      drop();
      giveBack();
      dispatch({ e: 'fallback', reason });
    };
    /** G4 and G5: the plain view, decided before any mount. */
    const goPlain = (why: string, budgetMs?: number): void => {
      if (ac.signal.aborted || landed) return;
      landed = true;
      dispatch(budgetMs === undefined ? { e: 'plain', why } : { e: 'plain', why, budgetMs });
    };

    const onLink = (l: ReaderLink): void => {
      const cur = live.current;
      const r = routeReaderLink(cur.link, l, location.hostname);
      switch (r.kind) {
        case 'in-app':
          if (r.fragment !== null) cur.link.onFragment(r.fragment, r.href);
          navigate(r.href);
          break;
        case 'hash':
          replaceFragment(r.id);
          break;
        case 'sheet':
          setAsk({ kind: 'link', ask: { url: r.url, host: r.host, foreign: r.foreign } });
          break;
        case 'inert':
          break;
      }
    };
    const onCopy = (t: string, hidden: readonly ReaderHiddenChar[]): void => {
      const d = copyDecision(t, hidden);
      if (d.kind === 'sheet') {
        setAsk({ kind: 'copy', ask: { text: d.text, hidden: d.hidden, failed: false } });
        return;
      }
      copyText(d.text).catch(() => setAsk({ kind: 'copy-failed', ask: { text: d.text } }));
    };

    void (async () => {
      const first = live.current;
      // The body's history starts with its render, so the commit list is read beside the render and the images.
      const opened = first.props.opened;
      const history = opened === undefined ? null : startReaderHistory({
        project: first.props.link.project, show: first.props.show, text, pin: opened.pin,
        page: () => (live.current.props.opened ?? opened).page, only: opened.only,
        history: first.props.reader.history ?? null, loaders: first.assets?.loaders ?? null,
        queue: first.assets?.queue ?? null, signal: ac.signal,
      });
      let outcome: ReaderRenderOutcome;
      try {
        outcome = await first.props.reader.render(text, { budgetMs: DOCS_PARSE_BUDGET_MS(bytes), signal: ac.signal });
      } catch (e) {
        if (ac.signal.aborted) return;
        console.warn(`ccrc: reader render rejected (${reasonOf(e)})`);
        goPlain('render-rejected');
        return;
      }
      if (ac.signal.aborted) return;
      if (outcome.kind === 'timeout') {
        goPlain('timeout', outcome.budgetMs);
        return;
      }
      if (outcome.kind !== 'rendered') {
        const reason = outcomeReason(outcome);
        console.warn(`ccrc: reader not rendered (${reason})`);
        goPlain(reason);
        return;
      }

      const second = live.current;
      // Sign-in is listened for from before the images walk, not after it: `clearAuthLost` announces once, to the listeners
      // already subscribed, and a sign-in can complete while a queued image load is still pending (review 2372 F1). The
      // listener latches that sign-in; once the walk has ended, a 401 left in it starts the new body at once.
      let regained = false;
      /** Set once the walk has reported a 401: from then on a sign-in starts the new body itself. */
      let watching = false;
      unwatchAuth = onAuthRegained(() => {
        if (!watching) {
          regained = true;
          return;
        }
        // Sign-in returned: `ReaderFrame` starts a new body, whose run asks the images again; this body's cleanup ends this run.
        unwatch();
        live.current.props.onSignedIn();
      });
      let images: ReaderImages;
      try {
        images = second.assets === null
          ? NO_IMAGES
          : await second.props.reader.images(outcome.images, second.link, second.assets, ac.signal);
      } catch (e) {
        if (ac.signal.aborted) return;
        fallBack(`images ${reasonOf(e)}`);
        return;
      }
      if (ac.signal.aborted || landed) return;
      if (images.auth === 0) {
        unwatch();
      } else if (regained) {
        // A sign-in completed during the walk, after a load answered 401: the new body asks the images again, so this body
        // counts no drafts and mounts nothing.
        unwatch();
        live.current.props.onSignedIn();
        return;
      } else {
        watching = true;
      }
      if (second.assets !== null && images.drafts !== 0) {
        counted = images.drafts;
        uncount = second.assets.onDraftAsset;
        uncount(counted);
      }

      // The version seed: the served commit (or a draft's head) with the doc's commits and the day filter. It is awaited here,
      // after the images, so the frame is seeded when it mounts; a body that ended or landed meanwhile mounts nothing.
      const shown = first.props.show;
      const seed = history === null
        ? readerVersionSeed((shown.source === 'draft' ? shown.head : shown.commit) ?? '', shown.source === 'draft', null, null)
        : await history.seed;
      if (ac.signal.aborted || landed) return;

      const cur = live.current;
      const el = hostRef.current;
      if (el === null) {
        fallBack('no host element');
        return;
      }
      dispatch({ e: 'mount' });
      seededPrefs.current = cur.prefs;
      // The bar is read once, here: the frame keeps it for its life (refinement (f)).
      const chrome = cur.barSlot?.chrome ?? 'frame-bar';
      const progress = chrome === 'host-bar' ? createReaderProgress() : null;
      const input: ReaderMountInput = {
        document: {
          result: outcome.result,
          scan: { mermaid: outcome.mermaid },
          images: images.urls,
          initialHash: decodedFragment(cur.props.pendingFragment),
        },
        // The W8a plan's refinement (k) and Task 12: the commit a committed doc was read at, or the head a draft was read over
        // with its flag, with the doc's commits and the day filter. Absent for a served hash that is not a full commit.
        ...(seed === null ? {} : { version: seed }),
        ...(history === null ? {} : {
          changes: (sha: string) => history.changes(sha),
          openVersion: (v: { sha?: string; only?: string }) => history.openVersion(v),
        }),
        bytes,
        docKey: readerDocKey(cur.props.link.project, cur.props.show.section, cur.props.show.path),
        title: leafName(cur.props.show.path),
        prefs: { theme: cur.prefs },
        onLink,
        onHash: replaceFragment,
        copy: onCopy,
        onReady: () => {
          if (!ac.signal.aborted && !landed) dispatch({ e: 'ready' });
        },
        onFallback: (r) => fallBack(String(r)),
        chrome,
        ...(progress === null ? {} : { onProgress: (share: number) => progress.set(share) }),
      };
      performance.mark('ccrc-reader-mount-start');
      let m: ReaderMount;
      try {
        m = await cur.props.reader.mount(el, input);
      } catch (e) {
        fallBack(`mount ${reasonOf(e)}`);
        return;
      } finally {
        performance.mark('ccrc-reader-mount-end');
      }
      if (ac.signal.aborted || landed) {
        m.destroy();
        return;
      }
      mount = m;
      mountRef.current = m;
      if (progress !== null) {
        setBar({
          title: readerBarTitle(outcome.result.meta.title, leafName(cur.props.show.path)),
          command: (name) => m.command?.(name),
          progress,
        });
      }
      // The fragment is spent only once the frame is up: a fallback before this keeps it for the plain view's scroll.
      if (cur.props.pendingFragment !== null) cur.props.onFragmentConsumed();
      const latest = live.current.prefs;
      if (latest !== seededPrefs.current) {
        seededPrefs.current = latest;
        m.setPrefs({ theme: latest });
      }
    })();

    return () => {
      ac.abort();
      unwatch();
      drop();
      giveBack();
    };
  }, [overGate, text, bytes]);

  /** A write from a sheet's own button: the sheet closes when it lands and stays, saying so, when the clipboard refuses. */
  const writeFromSheet = (text: string, onRefused: () => void): void => {
    copyText(text).then(() => setAsk(null), onRefused);
  };

  const sheets = (
    <>
      <ReaderLinkSheet
        ask={ask?.kind === 'link' ? ask.ask : null}
        onCancel={() => setAsk(null)}
        onOpen={(a) => {
          setAsk(null);
          window.open(a.url, '_blank', 'noopener,noreferrer');
        }}
      />
      <ReaderCopySheet
        ask={ask?.kind === 'copy' ? ask.ask : null}
        onCancel={() => setAsk(null)}
        onCopy={(a) => writeFromSheet(a.text, () => setAsk({ kind: 'copy', ask: { ...a, failed: true } }))}
      />
      <ReaderCopyFailedSheet
        ask={ask?.kind === 'copy-failed' ? ask.ask : null}
        onClose={() => setAsk(null)}
        onRetry={(a) => writeFromSheet(a.text, () => setAsk({ kind: 'copy-failed', ask: a }))}
      />
    </>
  );

  switch (state.s) {
    case 'fallback':
      return (
        <>
          <p className="doc-plain-note">{READER_FALLBACK_NOTE}</p>
          <DocMarkdown text={text} pinKey={p.bodyKey} parser={p.parser} link={p.link} />
        </>
      );
    case 'plain':
      return state.budgetMs === undefined
        ? <DocMarkdown text={text} pinKey={p.bodyKey} parser={p.parser} link={p.link} />
        : <DocPlain text={text} note={docsPlainNote({ kind: 'timeout', budgetMs: state.budgetMs })} />;
    default:
      return (
        <>
          {state.s !== 'ready' && <p className="doc-formatting">{DOC_FORMATTING}</p>}
          <div className="docs-reader" ref={hostRef} />
          {sheets}
          <ReaderShown />
          {state.s === 'ready' && bar !== null && <ReaderBarShown bar={bar} />}
        </>
      );
  }
}
