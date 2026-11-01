// A Markdown leaf's rich reader (native Docs reader, W8a Task 8; the 2026-10-31 reader-frame spec's section 4.1 (host,
// focus, remount) and section 4.6 (every trigger, the fixed note), M8.7, M8.11, M8.17, M8.19 and refinement (g)).
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
//   G7  a Mermaid chunk that does not load is `mountReader`'s own (it drops the scan and still mounts).
// A body stays where it landed until its `bodyKey` changes (`MarkdownBody` keys this component by it), so a fallback
// never mounts again. The reason of G3, G4 and G6 is kept for the console and never reaches the page.
//
// The library's host and the frame's asset texts reach the main bundle only through the two literal dynamic imports in
// `lazyMountReader`; this file names the adapter's types with `import type` only.
import { THEMES } from '@ccrc/ui';
import { useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import type { DocsShowOk } from '../../../shared/docs';
import { utf8ByteLength } from '../lib/markdownGuard';
import { DOCS_PARSE_BUDGET_MS, DOCS_RENDER_GATE_BYTES } from '../lib/markdownLimits';
import type { MarkdownParser } from '../lib/markdownRunner';
import type { ReaderRenderOutcome } from '../lib/readerRenderJob';
import { navigate, replaceFragment } from '../lib/router';
import { useThemeChoice } from '../lib/theme';
import { DocsAssetContext } from './DocImage';
import type { DocLinkContextValue } from './DocLink';
import { DocMarkdown, DocPlain, docMarkdownSource, docsPlainNote, DOC_FORMATTING } from './DocMarkdown';
import {
  ReaderCopyFailedSheet, ReaderCopySheet, ReaderLinkSheet,
  type ReaderCopyAsk, type ReaderCopyFailedAsk, type ReaderLinkAsk,
} from './ReaderSheets';
import type { ReaderImages, loadReaderImages } from './reader/images';
import type { ReaderMount, ReaderMountInput, ReaderThemePref } from './reader/bridge';
import {
  copyDecision, readerBodyReducer, readerDocKey, readerPrefsOf, routeReaderLink, type ReaderBodyState, type ReaderLink,
} from './reader/policy';
import { READER_FALLBACK_NOTE, type ReaderHiddenChar } from './reader/readerText';
import { leafName } from './docsTree';
import { copyText } from './share';

type LinkBase = Omit<DocLinkContextValue, 'urls'>;

/** What the leaf needs of the reader: the render job, the mount, and the page's images. A test injects all three. */
export interface ReaderDeps {
  render(src: string, o: { budgetMs: number; signal?: AbortSignal }): Promise<ReaderRenderOutcome>;
  mount(el: HTMLElement, input: ReaderMountInput): Promise<ReaderMount>;
  images: typeof loadReaderImages;
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

const NO_IMAGES: ReaderImages = { urls: {}, drafts: 0 };

/** What was thrown, for the console only: an error's name and message, else its type. */
function reasonOf(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : typeof e;
}

/** A Markdown body in the rich reader. `MarkdownBody` answers the two byte kinds that are not Markdown before it mounts
 *  this, so `null` here has one meaning: that answer was not Markdown, and the caller has shown it already. */
export function ReaderFrame(p: ReaderFrameProps): ReactNode {
  const src = useMemo(() => docMarkdownSource(p.show), [p.show]);
  if (src.kind !== 'markdown') return null;
  return <ReaderBody {...p} text={src.text} />;
}

function ReaderBody(p: ReaderFrameProps & { readonly text: string }): ReactNode {
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
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mountRef = useRef<ReaderMount | null>(null);
  /** The frame theme the frame was last given: the mount's seed, then each `setPrefs`. */
  const seededPrefs = useRef<ReaderThemePref['theme'] | null>(null);
  /** The latest props, for the callbacks the frame holds for its whole life. */
  const live = useRef({ props: p, link, assets, prefs });
  useEffect(() => {
    live.current = { props: p, link, assets, prefs };
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
    /** G3 and G6: the mount, if any, goes; the fixed note shows; the reason stays in the console. */
    const fallBack = (reason: string): void => {
      if (ac.signal.aborted || landed) return;
      landed = true;
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
        console.warn(`ccrc: reader not rendered (${outcome.kind})`);
        goPlain(outcome.kind);
        return;
      }

      const second = live.current;
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
      if (second.assets !== null && images.drafts !== 0) {
        counted = images.drafts;
        uncount = second.assets.onDraftAsset;
        uncount(counted);
      }

      const cur = live.current;
      const el = hostRef.current;
      if (el === null) {
        fallBack('no host element');
        return;
      }
      dispatch({ e: 'mount' });
      seededPrefs.current = cur.prefs;
      const input: ReaderMountInput = {
        document: {
          result: outcome.result,
          scan: { mermaid: outcome.mermaid },
          images: images.urls,
          initialHash: cur.props.pendingFragment,
          // Refinement (k): the commit a committed doc was read at, or the head a draft was read over with its flag.
          // The adapter keeps this only for a full hex sha (`withServedVersion`).
          version: cur.props.show.source === 'draft'
            ? { sha: cur.props.show.head ?? null, draft: true }
            : { sha: cur.props.show.commit ?? null, draft: false },
        },
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
        </>
      );
  }
}
