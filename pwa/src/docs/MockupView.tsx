// The mockup viewer (native Docs reader, completion plan Task 8, C2; base spec 2026-10-01 5.6.1-5.6.8; rows M5.13-M5.16,
// M5.21, M5.22). Ring L4 delivery: it runs the pipeline C1 built and draws what comes out, and decides nothing about
// admission (the planner's), the page's bytes (the build's) or a limit (`policy.ts`'s). In order (5.6.2):
//   1. the leaf's text (`docMarkdownSource`);
//   2. the pre-scan: a refusal is shown with Source and Download, and no parser is ever constructed;
//   3. the gate: a page over `MOCKUP_AUTO_RENDER_BYTES` waits for a tap before anything is parsed;
//   4. `parseMockup`, once per view;
//   5. one ATTEMPT per (context, retry): extract, plan, load, build. Each attempt has its own `AbortController` and its
//      own generation number: an unmount or a new attempt aborts the old one, and every async continuation checks its
//      generation first, so a late result never publishes into a later attempt;
//   6. the frame (`MockupFrame`), keyed by mode and a nonce, never by author text, so Stop, Run, Reload and Load
//      external each make a NEW element, and the toolbar, the badges, the census and the links list.
// Export reads what the view publishes (`usePublishExportBody`; completion plan Task 9): the render gate publishes
// `GATE_BODY`, a page the pre-scan refuses publishes its source as a `plain` body with the refused-export note, and an
// attempt publishes a `mockup` body (its parsed Document, its plan and the promise of its load's end) from the moment it
// has a plan; parsing and planning publish nothing. A superseded attempt's promise ends `{ s: 'ended' }`.
// The choices (Run scripts, Load external) live in this view's state only: no storage, no URL key. The view is keyed by
// the caller (`DocsLeaf`) by the document's identity and the mode, so a new document or mode starts them over.
import { useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, QC_ACTIONS, Sheet } from '@ccrc/ui';
import {
  docsPageUrl, type DocSectionSlug, type DocsFailure, type DocsPageLocation, type DocsShowOk,
} from '../../../shared/docs';
import { openExternal, CodeBlock, PreHighlightContext } from '../lib/markdown';
import { useDocsHighlightStore } from '../lib/highlighterContext';
import { onAuthRegained } from '../lib/auth';
import { navigate } from '../lib/router';
import { DocsAssetContext } from './DocImage';
import { DOC_NOT_UTF8_NOTE, docMarkdownSource } from './DocMarkdown';
import { DocsFailureView } from './DocsFailureView';
import { GATE_BODY, usePublishExportBody, type ExportBody, type MockupExportAssets, type MockupLoadEnd } from './exportBody';
import { DocsPageLink } from './DocsTreeView';
import { docsLocation } from './docsLinks';
import {
  DOCS_RELIST_WORDS, DOCS_SHOW_NO_BYTES, DOCS_VIEW_TEXT, DOC_IMAGE_TEXT, EXPORT_TEXT, MOCKUP_REFUSAL_SENTENCE, MOCKUP_TEXT, fillSentence, kib, pluralS,
} from './docsText';
import { leafName } from './docsTree';
import { MockupFrame, mockupFrameProps } from './MockupFrame';
import { buildMockupSrcdoc, extractMockupRefs, loadMockupAssets, type MockupExtract } from './mockup/load';
import {
  capRows, censusCounts, censusOf, draftPinsOf, hasConservativeAdmission, linksOf, originsOf, pageHasScripts, type PageLink, type RouteOf,
} from './mockup/census';
import { scriptTextOrigins } from './mockup/origins';
import { parseMockup } from './mockup/parse';
import { MockupContextMismatch, planMockupAssets } from './mockup/plan';
import {
  MOCKUP_AUTO_RENDER_BYTES, MOCKUP_MAX_ATTRIBUTES, MOCKUP_MAX_DEPTH, MOCKUP_MAX_OPEN_FORMATTING, MOCKUP_MAX_TAGS,
} from './mockup/policy';
import type { HttpsOrigin, MockupAssetPlan, MockupAssetReader, MockupAssetResult, MockupContext } from './mockup/ports';
import { prescanMockup, type MockupPrescan } from './mockup/prescan';

type Leaf = DocsPageLocation & { kind: 'path' };

export interface MockupViewProps {
  readonly show: DocsShowOk;
  readonly context: MockupContext;
  readonly reader: MockupAssetReader;
  /** The leaf page: Full screen, New tab and Close build their URLs from it, and `frame` says inline or full (D-8711). */
  readonly page: Leaf;
  /** The visit's tree re-list (`visit.retryTree`) (D-8711). */
  readonly relist: () => void;
  /** The leaf's own Download button (D-8711). */
  readonly download: ReactNode;
}

/** The closed line that ends a fold which lists only its first rows: how many more it does not list, or nothing. */
function MoreNotListed(p: { readonly n: number }): ReactNode {
  return p.n > 0 ? <p className="docs-note docs-mockup-more">{fillSentence(MOCKUP_TEXT.moreNotListed, { n: p.n })}</p> : null;
}

/** The view's one hand-drawn button: a bordered `.docs-leaf-action`, as Source and Download are. `pressed` is a toggle's state. */
function Action(p: { readonly onClick: () => void; readonly pressed?: boolean; readonly children: ReactNode }): ReactNode {
  return <button type="button" className="docs-leaf-action" aria-pressed={p.pressed} onClick={p.onClick}>{p.children}</button>;
}

/** A status line with the one button that answers it (the second-load notice's Reload mockup, the changing note's Retry). */
function NoteAction(p: { readonly note: string; readonly label: string; readonly onClick: () => void }): ReactNode {
  return (
    <div className="docs-mockup-away" role="status">
      <p className="docs-note">{p.note}</p>
      <Action onClick={p.onClick}>{p.label}</Action>
    </div>
  );
}

/** A collapsed fold whose rows are drawn only while it is open, so a page with thousands of references costs nothing until
 *  it is opened. Its summary is the control (`.docs-mockup-fold > summary`, which carries the floor). */
function Fold(p: { readonly className: string; readonly summary: string; readonly rows: () => ReactNode }): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <details className={`${p.className} docs-mockup-fold`} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{p.summary}</summary>
      {open && p.rows()}
    </details>
  );
}

/** Source: the file as one `CodeBlock` on a one-block highlight store (`xml`), plain first and coloured off the main
 *  thread, as a text leaf is. Mounted only while Source is open, so the store lives only then. */
/** The grammar Source colours an HTML page with (base 5.6.7: hljs `xml`), named once: the store's seed and the code
 *  element's class, which is what the highlighter is asked with, can never disagree. */
const SOURCE_LANG = 'xml';

function MockupSource(p: { readonly text: string }): ReactNode {
  const store = useDocsHighlightStore(useMemo(() => [{ lang: SOURCE_LANG, raw: p.text.replace(/\n$/, '') }], [p.text]));
  return (
    <PreHighlightContext value={store}>
      <CodeBlock><code className={'language-' + SOURCE_LANG}>{p.text}</code></CodeBlock>
    </PreHighlightContext>
  );
}

/** The Source toggle, Download, and the source under them: the whole of a page that has no frame to show. */
function SourceActions(p: { readonly text: string; readonly download: ReactNode; readonly lead?: ReactNode }): ReactNode {
  const [source, setSource] = useState(false);
  return (
    <>
      <div className="docs-leaf-actions">
        {p.lead}
        <Action pressed={source} onClick={() => setSource((s) => !s)}>{DOCS_VIEW_TEXT.source}</Action>
        {p.download}
      </div>
      {source && <MockupSource text={p.text} />}
    </>
  );
}

/** The refusal line, its reason, the measured counts and the limits, then Source and Download (base 5.6.8). */
function Refusal(p: { readonly prescan: Extract<MockupPrescan, { ok: false }>; readonly text: string; readonly download: ReactNode; readonly chip: ReactNode }): ReactNode {
  const { prescan } = p;
  return (
    <div className="docs-mockup" data-state="refused">
      {p.chip}
      <p className="docs-note">{MOCKUP_TEXT.tooComplex}</p>
      <p className="docs-note">{fillSentence(MOCKUP_TEXT.refusal, { reason: MOCKUP_REFUSAL_SENTENCE[prescan.why] })}</p>
      <p className="docs-note">
        {fillSentence(MOCKUP_TEXT.measured, {
          depth: prescan.depth, tags: prescan.tags, formatting: prescan.formatting, maxDepth: MOCKUP_MAX_DEPTH,
          maxTags: MOCKUP_MAX_TAGS, maxFormatting: MOCKUP_MAX_OPEN_FORMATTING, maxAttributes: MOCKUP_MAX_ATTRIBUTES,
        })}
      </p>
      <SourceActions text={p.text} download={p.download} />
    </div>
  );
}

/** Where the leaf's `?frame=full` entry came from: `Full screen` sets it just before it navigates, and the full-frame view
 *  that mounts on that URL turns it into a mark in `history.state` of the entry it stands on. A page loaded straight at
 *  the full URL has none, so its Close navigates to the leaf. Module state: a page load clears it. */
let pendingFullFrom: { readonly to: string; readonly from: string } | null = null;
const FROM_KEY = 'ccrcMockupFrom';

const urlOf = (page: Leaf, frame: 'inline' | 'full'): string => docsPageUrl({ ...page, frame });

/** The attempt's published result: what the view built the page from. */
interface Loaded {
  readonly extract: MockupExtract;
  readonly result: MockupAssetResult;
}

function MockupLive(p: MockupViewProps & {
  readonly doc: Document; readonly text: string; readonly chip: ReactNode;
}): ReactNode {
  const { doc, context, page } = p;
  const full = page.frame === 'full';
  const assets = useContext(DocsAssetContext);
  const onDraftAsset = assets?.onDraftAsset;
  const [scripted, setScripted] = useState(false);
  const [chosen, setChosen] = useState<readonly HttpsOrigin[]>([]);
  const [nonce, setNonce] = useState(0);
  const [away, setAway] = useState(false);
  const [source, setSource] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  // The current attempt's plan and the end of its load, for Export; `null` between attempts.
  const [exported, setExported] = useState<MockupExportAssets | null>(null);
  const [fatal, setFatal] = useState<{ readonly error: unknown } | null>(null);
  // The attempt number: a new value starts a new attempt over the same context (a sign-in).
  const [attemptNo, setAttemptNo] = useState(0);
  // The current attempt finished after a movement it was not allowed to re-list for: the changing note and Retry show.
  const [changing, setChanging] = useState(false);
  const generation = useRef(0);
  // The automatic re-list is at most ONE per mounted view (base 2 (e), spec 4.3 item 1): once taken, a later movement in
  // this view only marks its attempt's rows failed and shows the changing note. The caller keys the view by the
  // document's identity, so a same-blob re-list does not reset this.
  const autoRelisted = useRef(false);
  // The host's re-list and the page's history, read when a movement is reported (neither restarts an attempt).
  const host = useRef({ relist: p.relist, historical: page.at !== null });
  useEffect(() => {
    host.current = { relist: p.relist, historical: page.at !== null };
  });

  const hasScripts = useMemo(() => pageHasScripts(doc), [doc]);

  // ONE ATTEMPT per (context, reader, attempt number). Its controller and generation are its own: the cleanup, which runs
  // on unmount and before the next attempt, aborts it and invalidates its generation, and the continuation checks the
  // generation before it publishes anything.
  //
  // The attempt reads through an OBSERVING reader that passes every answer through unchanged and reports a movement word
  // (`DOCS_RELIST_WORDS`) answered to THIS attempt (a stale generation's report is ignored). `loadMockupAssets` itself
  // never relists (D-8660); the view decides, here:
  //   - a historical page: the word is that row's failure and nothing else (the commit is the URL's, no re-list changes it);
  //   - the first movement in this view: the attempt is aborted at once (that disposes of its buffered discoveries, pending
  //     reads, assets and reservations), what is shown is dropped, Export's body is withdrawn, the changing note and Retry show at once, and the host's re-list is asked ONCE; the next context
  //     starts a fresh attempt from scratch (a new plan from the new context, never an extension of this one's);
  //   - any later movement in this view: no re-list; the attempt finishes with that row failed, and the changing note and
  //     Retry show.
  const { pin } = context;
  useEffect(() => {
    generation.current += 1;
    const mine = generation.current;
    const ctl = new AbortController();
    let extract: MockupExtract;
    let plan: MockupAssetPlan;
    try {
      extract = extractMockupRefs(doc, `${pin.section}/${pin.path}`);
      plan = planMockupAssets(extract.refs, context);
    } catch (e) {
      // The leaf is mid-update (its listing no longer opens this pin): start nothing, keep what is shown, and wait for
      // the next context.
      if (e instanceof MockupContextMismatch) return undefined;
      setFatal({ error: e });
      return undefined;
    }
    setChanging(false);
    // The attempt's end for Export: resolved once, by whichever comes first (its result, its failure, its abort).
    let end!: (e: MockupLoadEnd) => void;
    const settled = new Promise<MockupLoadEnd>((resolve) => { end = resolve; });
    setExported({ plan, settled });
    const moved = (): void => {
      if (generation.current !== mine || host.current.historical) return;
      if (autoRelisted.current) {
        setChanging(true);
        return;
      }
      autoRelisted.current = true;
      generation.current += 1;
      ctl.abort();
      end({ s: 'ended' });
      setLoaded(null);
      // Export waits for the next context: the header reads "Preparing…", and no file is offered over an attempt that was
      // aborted (every asset of it would be a placeholder). The next attempt publishes its own body.
      setExported(null);
      // The note and Retry show at once: if the re-list brings no new context (its GET failed) the view would otherwise
      // read Loading for good. The next attempt clears the note (review M4).
      setChanging(true);
      host.current.relist();
    };
    const observing: MockupAssetReader = {
      read: async (readPin, signal) => {
        const answer = await p.reader.read(readPin, signal);
        if (answer.kind === 'failed' && DOCS_RELIST_WORDS.has(answer.failure as DocsFailure)) moved();
        return answer;
      },
    };
    loadMockupAssets(plan, observing, ctl.signal).then(
      (result) => {
        if (generation.current !== mine) {
          end({ s: 'ended' });
          return;
        }
        end({ s: 'loaded', result });
        // Each published build gets its own frame element: a new srcdoc on a showing iframe is reloaded in place by a
        // browser, and its second `load` would read as the document navigating away (review I1).
        setLoaded({ extract, result });
        setNonce((n) => n + 1);
      },
      (error: unknown) => {
        end({ s: 'ended' });
        if (generation.current !== mine || ctl.signal.aborted) return;
        setFatal({ error });
      },
    );
    return () => {
      ctl.abort();
      generation.current += 1;
      end({ s: 'ended' });
      setExported(null);
    };
  }, [doc, context, pin.section, pin.path, p.reader, attemptNo]);

  // Sign-in: a result with a row `failed` with `auth` waits for the session to come back, then reads again in ONE new
  // attempt over the current context. It unsubscribes when it fires, when the result changes and on unmount.
  useEffect(() => {
    if (loaded === null || !loaded.result.plan.rows.some((r) => r.verdict.v === 'failed' && r.verdict.failure === 'auth')) return undefined;
    const off = onAuthRegained(() => {
      off();
      setAttemptNo((n) => n + 1);
    });
    return off;
  }, [loaded]);
  // Retry re-lists and nothing else: the context that re-list produces starts the attempt, so none runs over the stale listing
  // (review M5).
  const retry = (): void => host.current.relist();

  // The attempt's Export body, from the moment it has a plan; it changes only with the attempt.
  const exportBody = useMemo<ExportBody | null>(
    () => (exported === null ? null : { kind: 'mockup', text: p.text, doc, assets: exported }),
    [exported, p.text, doc],
  );
  usePublishExportBody(exportBody);

  if (fatal !== null) throw fatal.error;

  const scriptOrigins = useMemo(
    () => (loaded === null ? [] : [...new Set(loaded.extract.scriptTexts.flatMap((t) => scriptTextOrigins(t)))]),
    [loaded],
  );
  const origins = useMemo(
    () => (loaded === null ? null : originsOf(loaded.result.plan.rows, scriptOrigins, location.hostname)),
    [loaded, scriptOrigins],
  );
  // A chosen origin the current page no longer names is dropped before the build, so the policy never lists one.
  const extra = useMemo(
    () => (origins === null ? [] : chosen.filter((o) => origins.offered.some((x) => x.origin === o))),
    [chosen, origins],
  );
  const build = useMemo(
    () => (loaded === null ? null : buildMockupSrcdoc(doc, loaded.result, extra, scripted)),
    [doc, loaded, extra, scripted],
  );

  // Counted only for a page that renders: a build over the size cap keeps its inline draft rows, but shows no embed (review M3).
  const draftPins = useMemo(() => (build === null || !build.ok ? 0 : draftPinsOf(build.plan.rows, context.project)), [build, context.project]);
  useEffect(() => {
    if (draftPins === 0 || onDraftAsset === undefined) return undefined;
    onDraftAsset(draftPins);
    return () => onDraftAsset(-draftPins);
  }, [draftPins, onDraftAsset]);

  // The full-frame view marks the entry it stands on when it came from this leaf's Full screen.
  useEffect(() => {
    if (!full) return;
    const here = location.pathname + location.search;
    const pending = pendingFullFrom;
    pendingFullFrom = null;
    if (pending !== null && pending.to === here) {
      history.replaceState({ ...(history.state as object | null), [FROM_KEY]: pending.from }, '');
    }
  }, [full]);

  // The in-app route of a doc target: the one builder of a page location (`docsLocation`), at this page's project, ref and version.
  const routeOf = useMemo<RouteOf>(
    () => (section: DocSectionSlug, path: string): string => docsPageUrl(docsLocation(
      { kind: 'project', project: page.project, ref: page.ref }, { kind: 'path', section, path, dirSlash: false, at: page.at },
    )),
    [page.project, page.ref, page.at],
  );
  const census = useMemo(
    () => (loaded === null || build === null || origins === null ? [] : censusOf(build.plan.rows, loaded.extract, scriptOrigins, origins, routeOf)),
    [loaded, build, origins, scriptOrigins, routeOf],
  );
  // The fold summaries count every reference; the folds draw the first rows only (`capRows`).
  const { loaded: loadedCount, notLoaded } = censusCounts(census);
  const censusDrawn = useMemo(() => capRows(census), [census]);
  const links = useMemo(() => linksOf(doc, page, routeOf), [doc, page, routeOf]);
  const linksDrawn = useMemo(() => capRows(links), [links]);

  const leafUrl = urlOf(page, 'inline');
  const fullUrl = urlOf(page, 'full');
  const remount = (): void => setNonce((n) => n + 1);
  const close = (): void => {
    const state = history.state as Record<string, unknown> | null;
    if (state !== null && state[FROM_KEY] === leafUrl) history.back();
    else navigate(leafUrl);
  };
  const goFull = (): void => {
    pendingFullFrom = { to: fullUrl, from: leafUrl };
    navigate(fullUrl);
  };
  const confirmExternal = (): void => {
    setChosen(origins === null ? [] : origins.offered.map((o) => o.origin));
    setSheet(false);
    remount();
  };

  let region: ReactNode;
  if (build === null) {
    region = <p className="docs-loading">{DOCS_VIEW_TEXT.loading}</p>;
  } else if (!build.ok) {
    region = <p className="docs-note">{MOCKUP_TEXT.tooLarge}</p>;
  } else if (away) {
    region = (
      <NoteAction note={MOCKUP_TEXT.navigatedAway} label={MOCKUP_TEXT.reload} onClick={() => { setAway(false); remount(); }} />
    );
  } else {
    // The canvas's holder draws in the light palette (`data-theme`), so `--mockup-canvas` is the light white surface in
    // every theme (docs.css): a srcdoc is transparent and mockups are authored on white (base 5.6.7).
    region = (
      <div className="docs-mockup-canvas" data-theme="light">
        <MockupFrame
          key={`${scripted ? 'scripted' : 'static'}\u0000${nonce}`}
          {...mockupFrameProps(build.page, scripted, fillSentence(MOCKUP_TEXT.frameTitle, { name: leafName(page.path) }), () => setAway(true))}
        />
      </div>
    );
  }
  const framed = build !== null && build.ok;
  const offeredCount = origins === null ? 0 : origins.offered.length;
  const scriptsOffBadge = hasScripts && !scripted;
  const conservative = build !== null && hasConservativeAdmission(build.plan.rows);

  return (
    <div className="docs-mockup" data-frame={full ? 'full' : 'inline'} data-state={framed ? 'framed' : 'loading'}>
      {full && (
        <div className="docs-mockup-bar">
          <Action onClick={close}>{MOCKUP_TEXT.close}</Action>
        </div>
      )}
      {p.chip}
      {!full && framed && (draftPins > 0 || scriptsOffBadge || notLoaded > 0) && (
        <div className="docs-mockup-badges">
          {draftPins > 0 && <span className="docs-badge">{fillSentence(MOCKUP_TEXT.embeds, { k: draftPins, s: pluralS(draftPins) })}</span>}
          {scriptsOffBadge && <span className="docs-badge">{MOCKUP_TEXT.scriptsOff}</span>}
          {notLoaded > 0 && <span className="docs-badge">{fillSentence(MOCKUP_TEXT.notLoaded, { n: notLoaded })}</span>}
        </div>
      )}
      {!full && (
        <div className="docs-leaf-actions docs-mockup-toolbar">
          {framed && hasScripts && (
            <Action onClick={() => { setScripted((s) => !s); setAway(false); remount(); }}>
              {scripted ? MOCKUP_TEXT.stopScripts : MOCKUP_TEXT.runScripts}
            </Action>
          )}
          {framed && offeredCount > 0 && (
            <Action onClick={() => setSheet(true)}>{fillSentence(MOCKUP_TEXT.loadExternal, { n: offeredCount })}</Action>
          )}
          {framed && <Action onClick={goFull}>{MOCKUP_TEXT.fullScreen}</Action>}
          {framed && <Action onClick={() => window.open(fullUrl, '_blank', 'noopener,noreferrer')}>{MOCKUP_TEXT.newTab}</Action>}
          <Action pressed={source} onClick={() => setSource((s) => !s)}>{DOCS_VIEW_TEXT.source}</Action>
          {p.download}
        </div>
      )}
      {changing && <NoteAction note={MOCKUP_TEXT.changing} label={MOCKUP_TEXT.retry} onClick={retry} />}
      {region}
      {!full && framed && (
        <Fold
          className="docs-mockup-census" summary={fillSentence(MOCKUP_TEXT.census, { loaded: loadedCount, notLoaded })}
          rows={() => (
            <>
              {conservative && <p className="docs-note docs-mockup-conservative">{MOCKUP_TEXT.conservative}</p>}
              <ul className="docs-mockup-rows">
                {censusDrawn.shown.map((r) => (
                  <li key={r.key} className="docs-mockup-row">
                    <span className="docs-mockup-ref">{r.ref}</span>
                    {r.target !== null && (
                      r.href !== null
                        ? <DocsPageLink href={r.href} className="docs-hint-link docs-mockup-target">{r.target}</DocsPageLink>
                        : <span className="docs-mockup-target">{r.target}</span>
                    )}
                    <span className="docs-mockup-verdict">{r.sentence}</span>
                    {r.hint && <span className="docs-mockup-hint">{MOCKUP_TEXT.vendor}</span>}
                    {r.size !== null && <span className="docs-mockup-size">{r.size}</span>}
                    {r.draft && <span className="doc-img-chip">{DOC_IMAGE_TEXT.draft}</span>}
                    {r.scriptText && <span className="docs-mockup-mark">{MOCKUP_TEXT.namedInScript}</span>}
                  </li>
                ))}
              </ul>
              <MoreNotListed n={censusDrawn.more} />
            </>
          )}
        />
      )}
      {!full && framed && links.length > 0 && (
        <Fold
          className="docs-mockup-links" summary={fillSentence(MOCKUP_TEXT.links, { n: links.length })}
          rows={() => (
            <>
              <ul className="docs-mockup-rows">
                {linksDrawn.shown.map((l, i) => <li key={i} className="docs-mockup-row"><LinkRow link={l} /></li>)}
              </ul>
              <MoreNotListed n={linksDrawn.more} />
            </>
          )}
        />
      )}
      {!full && source && <MockupSource text={p.text} />}
      {sheet && origins !== null && (
        <Sheet
          open
          onClose={() => setSheet(false)}
          title={MOCKUP_TEXT.externalTitle}
          footer={
            <div className={QC_ACTIONS}>
              <Button variant="primary" onClick={confirmExternal}>{MOCKUP_TEXT.externalLoad}</Button>
              <Button variant="ghost" onClick={() => setSheet(false)}>{MOCKUP_TEXT.externalCancel}</Button>
            </div>
          }
        >
          <div className="docs-mockup-sheet">
            <p className="docs-note">{MOCKUP_TEXT.externalNote}</p>
            <ul className="docs-mockup-rows">
              {origins.offered.map((o) => (
                <li key={o.origin} className="docs-mockup-row">
                  <span className="docs-mockup-target">{o.origin}</span>
                  {o.scriptText && <>{' '}<span className="docs-mockup-mark">{MOCKUP_TEXT.namedInScript}</span></>}
                </li>
              ))}
            </ul>
          </div>
        </Sheet>
      )}
      {full && !framed && build !== null && <SourceActions text={p.text} download={p.download} />}
    </div>
  );
}

function LinkRow(p: { readonly link: PageLink }): ReactNode {
  const { link } = p;
  switch (link.kind) {
    case 'doc':
      return <DocsPageLink href={link.href} className="docs-hint-link">{link.text}</DocsPageLink>;
    case 'external':
      return (
        <a href={link.url} className="docs-hint-link" target="_blank" rel="noopener noreferrer" onClick={(e) => openExternal(e, link.url)}>
          {link.text}
        </a>
      );
    case 'text':
      return <>{link.text}</>;
  }
}

/** What a page the pre-scan refuses publishes for Export: its source as plain text, with the refused-export note (base
 *  5.6.9 step 1). */
const refusedBody = (text: string): ExportBody => ({ kind: 'plain', text, note: EXPORT_TEXT.mockupRefused });

/** Parses the page once (after the gate) and hands the document to the live view, or shows the refusal. */
function MockupRun(p: MockupViewProps & { readonly text: string; readonly chip: ReactNode }): ReactNode {
  const parsed = useMemo(() => parseMockup(p.text), [p.text]);
  usePublishExportBody(useMemo(() => (parsed.ok ? null : refusedBody(p.text)), [parsed.ok, p.text]));
  if (!parsed.ok) return <Refusal prescan={parsed.prescan as Extract<MockupPrescan, { ok: false }>} text={p.text} download={p.download} chip={p.chip} />;
  return <MockupLive {...p} doc={parsed.doc} />;
}

/** The mockup viewer (base 5.6.7). */
export function MockupView(p: MockupViewProps): ReactNode {
  const { show } = p;
  const src = useMemo(() => docMarkdownSource(show), [show]);
  const [tapped, setTapped] = useState(false);
  const text = src.kind === 'no-bytes' ? '' : src.text;
  const gated = show.size > MOCKUP_AUTO_RENDER_BYTES && !tapped;
  // Over the gate the pre-scan still runs (it is linear and builds no parser), so a page it refuses says so before a tap.
  const pre = useMemo(() => (gated && src.kind !== 'no-bytes' ? prescanMockup(text) : null), [gated, src.kind, text]);
  // The gate and a refusal over it publish here; a page under the gate publishes from `MockupRun` and `MockupLive`.
  usePublishExportBody(useMemo<ExportBody | null>(() => {
    if (!gated || src.kind === 'no-bytes') return null;
    return pre !== null && !pre.ok ? refusedBody(text) : GATE_BODY;
  }, [gated, src.kind, pre, text]));
  if (src.kind === 'no-bytes') {
    return <DocsFailureView answer={{ s: 'failed', body: { ok: false, failure: 'malformed-answer', why: DOCS_SHOW_NO_BYTES } }} />;
  }
  const chip = src.kind === 'not-utf8' ? <p className="doc-plain-note">{DOC_NOT_UTF8_NOTE}</p> : null;
  if (pre !== null && !pre.ok) return <Refusal prescan={pre} text={text} download={p.download} chip={chip} />;
  if (gated) {
    return (
      <div className="docs-mockup" data-state="gated">
        {chip}
        <SourceActions
          text={text} download={p.download}
          lead={(
            <Action onClick={() => setTapped(true)}>{fillSentence(MOCKUP_TEXT.render, { size: kib(show.size) })}</Action>
          )}
        />
      </div>
    );
  }
  return <MockupRun {...p} text={text} chip={chip} />;
}
