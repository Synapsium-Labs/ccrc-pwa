// The reader's one adapter over the shared Markdown library's host mount (native Docs reader, W8a Task 7; the
// rich-docs spec's (amended 2026-10-31) M8.1, M8.15, M8.20 and section 4.4, the W8a plan's refinements (b), (c) and (k)). Ring L3: it is
// the one file that imports the library's host entry. What it hands the library is the whole of ccrc's control over
// the frame: W8a's fourteen keys (`assets`, `watchdogMs`, `store`, `storePrefix`, `docKey`, `prefs`, `mermaidDraw`,
// `title`, `focus` and the five callbacks), and since the library 1.1 take-up `loadMermaid` for a mount drawn after
// `ready`, and `features` (the frame's bar off, its top space trimmed) with `onProgress` for a mount on ccrc's bar (the
// take-up plan, refinements (c) and (g)). A Docs mount with history (`policy.ts#readerMountPlan`'s `history`) also
// passes `changes` and `openVersion` and the version seed (completion plan Task 12), when the input has them; the reader
// lab's mounts never do. A mount whose input has `onPlace` (the Docs reader's Back places, X2 P5.3, D-8763) hands it to the
// library, which then gives `onHash` its second argument (passed on as it came), and the mount's `closeOverlay` and `goto`
// call the live frame's (and `gotoTop`, Back to the top of the document); a `goto` called before the frame's `ready` is
// held, the latest only, and sent at `ready`, since the library drops such a command (a close then is dropped: a fresh
// frame has no overlay open); a mount made without `onPlace` passes none and does none of them (the library throws for
// such a host).
// Reader mode (X6 XR1.4 with XR2.1, D-8975, D-8805): every Docs mount asks for `onProgress` (`policy.ts#readerMountAsks`'s
// `progress`, on either bar) and, when the input has `onReader`, for the frame's `reader` acts (its `reader`); neither is the lab's. `setReading` is in place,
// never a remount, and `focus` focuses the live iframe; each library mount is sent the bridge's current reading before its `ready`.
// It never passes `mermaidGate`, so the Mermaid gate runs at the library's own caps.
//
// It decides nothing a policy file decides: the watchdog, the doc key and the prefs arrive already measured. It
// does three things of its own. It unwraps the library's callback shapes into ccrc's (the copy check's `hidden`
// list, the host link's fields). It keeps the version to what a full commit names (the W8a plan's refinement (k)), or,
// for a mount with history, to the validated seed `history.ts#readerVersionSeed` gave. And
// it gets the Mermaid text to the library by the draw's own path (the take-up plan, refinement (c)): drawn after
// `ready`, it hands the library the loader and awaits nothing, and the library asks only for a document its gate lets
// in; drawn on request or on open, it loads the text first, only for such a document, and a chunk that does not load
// drops the scan, so the figures show their source and the page still mounts (the W8a plan's refinement (c)).
//
// The layout (X2 P5.1, D-8762): a mount carries one of the five layouts (`input.layout`, absent `default`), hands the library its
// enhance bundle and stylesheet (`loadReaderAssets(layout)`) and names it in `adapters.layout`, which a `default` mount leaves out so
// its adapters are exactly what they were before layouts. `remount` mounts the same rendered document again in another layout (the
// Layout row's choice, and reader mode's entry and exit): the new layout's assets load first (the old frame stays meanwhile, and the
// texts a layout loaded once are kept, so a return to it swaps at once), then the old frame is destroyed and the new one mounted with
// no opening hash, so the stored reading place wins, and sent the reading in force before its `ready`. Texts that do not load keep
// the frame that was showing (never a fallback: a frame stands), a reading set while they load rides the swap, and an `openAt` drops
// the request: the anchor wins. The one exception is reader mode's own entry into `default` (`readerAnchorRidesSwap`): an `openAt`
// while that swap loads keeps it, and the anchor rides it, so the frame the anchor opens is the default one. A request for the layout
// the frame already carries drops a swap in flight and mounts nothing, and says so (`onKept`), like a swap that failed to load; an
// anchor that was riding a swap that is dropped or fails opens in the live layout then.
//
// The reading-layer flags (X2 P5.4, parity spec 5.6): every Docs mount's `features` carries `rules`, the In short switch and the
// vocabulary (`policy.ts#readerFeatures`, with ccrc's chrome switches on a host-bar mount in the same object; the reader lab's mounts
// seed none), and a mount whose input has `changesBase` hands the library the tab's comparison base for the doc as its `changesBase`
// adapter, read at each library mount, when the policy admits it (`readerSeedChangesBase`). Nothing here decides either.
//
// The storage port handed to the library is wrapped (`layoutKeepingPort`): the frame writes its whole prefs snapshot back on any
// prefs change, so every write of the prefs key keeps the `layout` stored at that moment (`policy.ts#withStoredLayoutKept`), and the
// device's layout has one writer, `layoutPref.ts` (I-3).
//
// `mountReader` remounts for `openAt` (a link to this very page, spelled with its file name): the old frame is
// destroyed and the same document is mounted again at the anchor, through the same mount function and adapters. The
// library's `update` is never called (it keeps the first mount's adapters, `focus` among them). A hosted mount follows
// appearance through `setAppearance`; a mode-only mount follows theme through `setPrefs`. Whether a mount focuses its frame is `policy.ts#readerMountFocusFor`'s, from one fact this file
// reads: `el.ownerDocument.activeElement` is a connected element outside `el`, other than the body and the document
// element. It is read once per library mount, after the last await and in the same synchronous run as the mount call.
// The watchdog, the draw mode, whether a storage port is handed over, whether the history is carried and whose bar the
// frame has are
// `policy.ts#readerMountPlan`'s, by the input's `profile` (none for the Docs reader, `lab-draw` for the reader lab's
// timed mounts: the reader lab plan, refinement (k)), its `chrome`, and the recorded E17 reading.
import * as frameLibrary from '@synapsium-labs/pinax-lib/frame';
import {
  mermaidGate, type FrameAssets, type PlaceKind, type RenderInput,
} from '@synapsium-labs/pinax-lib/frame';
import {
  mountDocFrame, type FallbackReason, type HiddenChar, type HostAdapters, type HostLink,
} from '@synapsium-labs/pinax-lib/host';
import { isDocsCommit } from '../../../../shared/docs';
import { READER_STORE_PREFIX } from '../../lib/readerLimits';
import { enumerablePageStorage, rewritingWrites, type EnumerableStoragePort } from '../../lib/storage';
import {
  READER_E17_MERMAID, READER_PREFS_KEY, isHostedMount, readerFeatures, readerMountAsks, readerMountFocusFor, readerMountPlan,
  readerSeedChangesBase, withStoredLayoutKept,
  type ReaderChrome, type ReaderCommand, type ReaderE17Reading, type ReaderFeatures, type ReaderLayout, type ReaderLink,
  type ReaderMountProfile, type ReaderReading, type ReaderAct,
} from './policy';
import { readerAnchorRidesSwap } from './readerMode';
import { loadMermaidAsset, loadReaderAssets, loadReaderFonts } from './assets';
import { readHostAppearance } from './hostAppearance';
import { readerAppearanceSupported } from './appearance';
import type { ReaderVersionSeed } from './history';

/** The theme choice the frame takes. */
export interface ReaderThemePref {
  readonly theme: 'light' | 'dark' | 'auto';
}

export interface ReaderMountInput {
  readonly document: RenderInput;
  /** The document's UTF-8 bytes: the watchdog is a function of it. */
  readonly bytes: number;
  /** `readerDocKey`'s answer: `null` is "no per-doc state for this doc". */
  readonly docKey: string | null;
  /** The document's file name: the frame's accessible name. The library refuses one outside 1 to 1024 code units;
   *  that rejection is the caller's fallback. */
  readonly title: string;
  readonly prefs: ReaderThemePref;
  readonly appearanceRoot?: HTMLElement;
  readonly onLink: (l: ReaderLink) => void;
  /** The frame went to the place `id`. With `onPlace` given the library says how: `entry.push` is true for a move that is a
   *  new place in the console's history, and `entry.from` is the library's own position token for the place left (or null).
   *  `entry.inGrammar` is the library's own `isFragmentId(id)`, asked here so the main bundle never imports the library
   *  (D-9117): a pushed jump names its id in the address only when it is true.
   *  Without `onPlace` the library calls it with the id alone. */
  readonly onHash: (id: string, entry?: {
    readonly push: boolean; readonly from: string | null; readonly inGrammar: boolean;
  }) => void;
  /** The frame reports its full-screen figure: `overlay` when it opened, `overlay-closed` when it closed. Giving it asks the
   *  frame for places (the seed's `bridge.places`) and makes `closeOverlay` and `goto` of the mount live. The reader lab
   *  passes none. */
  readonly onPlace?: (kind: PlaceKind) => void;
  readonly copy: (text: string, hidden: readonly HiddenChar[]) => void;
  readonly onReady: () => void;
  readonly onFallback: (r: FallbackReason) => void;
  /** Lab-only observation: the Mermaid asset failed or passed the mount deadline. */
  readonly onMermaidDrop?: () => void;
  /** Absent for the Docs reader. `lab-draw` is the reader lab's timed mount (`readerMountPlan`): Mermaid drawn on open,
   *  the lab's watchdog, no storage port. Only the reader lab passes it. */
  readonly profile?: ReaderMountProfile;
  /** Whose bar the frame has; absent, the frame's own. `host-bar` turns the frame's bar off (the take-up plan,
   *  refinement (g)). The lab passes none. */
  readonly chrome?: ReaderChrome;
  /** How far the document has been read, 0 to 1. Every Docs body passes it (D-8805): the bar's line on ccrc's bar, and reader
   *  mode's activity on either. Absent, the mount asks the frame for progress only on ccrc's bar, and nobody listens to it. */
  readonly onProgress?: (share: number) => void;
  /** The frame's reader-mode acts (`menu`, `exit`, `toggle`, `active`), as the library parsed them, for a Docs mount; giving it is
   *  what asks the frame to send them. The reader lab's mounts never pass it on. */
  readonly onReader?: (act: ReaderAct) => void;
  /** The reading this mount is made under (reader mode's turn); absent reads `off`. A mount made while reader mode is on is sent
   *  `setReading` with it before its `ready`. The reader lab's mounts ignore it. */
  readonly reading?: ReaderReading;
  /** The layout this mount carries (X2 P5.1); absent reads `default`. The reader lab's mounts ignore it. */
  readonly layout?: ReaderLayout;
  /** `history.ts#readerVersionSeed`'s answer for this body. Absent, the document's own `version` is cut to `{sha, draft}`
   *  as before. Passed on only when the mount's plan carries history (all three of this and the next two). */
  readonly version?: ReaderVersionSeed;
  /** The marks of the changes between the base commit `sha` and this body, or `null` for unavailable. */
  readonly changes?: (sha: string) => Promise<{
    ranges: readonly (readonly [number, number])[]; removedAfter?: readonly number[];
  } | null>;
  /** The frame's `version` operation: open the page at `sha` and/or filter its list to the day `only` names. */
  readonly openVersion?: (v: { sha?: string; only?: string }) => void;
  /** The comparison base this tab holds for the doc (`readerHistory.ts`'s body gives it), read at each library mount, or `null` for
   *  none (X2 P5.4). Passed on as the library's `changesBase` only when it is a full sha and the mount carries history
   *  (`policy.ts#readerSeedChangesBase`); the reader lab's mounts never pass it on. */
  readonly changesBase?: () => string | null;
}

export interface ReaderMountDeps {
  readonly mount?: typeof mountDocFrame;
  readonly store?: () => EnumerableStoragePort | null;
  /** The frame's texts for a layout (`assets.ts#loadReaderAssets`); called with the mount's layout, and again with each layout a
   *  `remount` asks for that was not loaded before. */
  readonly assets?: (layout: ReaderLayout) => Promise<FrameAssets>;
  readonly mermaid?: () => Promise<string>;
  readonly libraryContract?: () => number | 'none';
  readonly fonts?: () => Promise<{ sans: string; mono: string }>;
  /** Tests only: the E17 reading to plan with; absent, the recorded one (`READER_E17_MERMAID`). */
  readonly e17?: ReaderE17Reading;
}

export interface ReaderMount {
  readonly seed: { readonly hosted: true; readonly stamp: string } | { readonly hosted: false };
  follow(theme: 'light' | 'dark' | 'auto'): void;
  /** Idempotent. */
  destroy(): void;
  /** The frame's `prefs` operation: applied in place, with no remount. */
  setPrefs(p: ReaderThemePref): void;
  /** Runs one of the reader's tools, as a toggle, through the library's `DocFrame.command` (which focuses the frame first
   *  and does nothing before `ready`). Call it from a tap's own handler. Absent: this mount has no frame to command (the
   *  assets did not load). */
  command?(name: ReaderCommand): void;
  /** Opens the same document again at the anchor `id` (without `#`), for a link to this very page spelled with its file
   *  name (completion plan Task 13): a new mount of the same document with `initialHash: id`, so no body is read again, in the layout
   *  the live frame carries. A layout swap still loading is dropped (the anchor wins), except reader mode's own swap into `default`
   *  (`readerAnchorRidesSwap`, I-4b): that one is kept, and the anchor is the opening hash of the frame it mounts. Does nothing after
   *  `destroy`. Absent: this mount has no frame (the assets did not load). */
  openAt?(id: string): void;
  /** Closes the frame's full-screen figure, if one is open (a Back that pops its place), through the live frame's
   *  `closeOverlay()`. Does nothing after `destroy`, on a mount made without `onPlace` (the library throws for a host with
   *  none), or when the frame refuses. Absent: this mount has no frame (the assets did not load). */
  closeOverlay?(): void;
  /** Takes the frame to the place `id`, from the position token `from` an `onHash` entry gave (a Back that pops a jump's
   *  place), through the live frame's `goto()`. Does nothing, as `closeOverlay` does nothing. */
  goto?(id: string, from?: string): void;
  /** Takes the frame to the top of the document, as Back from a jump whose reader was at the top (no `from`): `goto(id,
   *  TOP_TOKEN)`. Does nothing, as `goto` does nothing. */
  gotoTop?(id: string): void;
  /** Sets reader mode's reading in place, with no remount: records it as the reading every later library mount of this mount
   *  (`openAt`'s) is sent, and calls the live frame's `setReading`, which the library queues before `ready` (the latest wins).
   *  Does nothing after `destroy`; a frame that refuses is warned about and ignored. Absent: this mount has no frame. */
  setReading?(mode: ReaderReading): void;
  /** The layout the live mount carries (X2 P5.1): the input's, then the one a `remount` last swapped in. It does not move while a
   *  remount's assets are still loading. Absent: this mount has no frame. */
  readonly layout?: ReaderLayout;
  /** Mounts the same rendered document again in `opts.layout` (X2 P5.1): no body is read, and the new frame has no opening hash, so the
   *  stored reading place wins. The layout's assets load first and the old frame stays meanwhile (texts already loaded swap at once);
   *  a request made while another is loading replaces it (the latest wins), and a `destroy` or an `openAt` meanwhile cancels it (but
   *  see `openAt`: reader mode's own swap into `default` keeps it, the anchor riding it). A request for the layout the live frame
   *  already carries mounts nothing: it drops any loading request, sets the reading in place and calls `opts.onKept` (the caller may
   *  hold the host for a swap it asked for, which no `ready` will now lift). `opts.reading`, when given, is recorded as the reading in
   *  force first; a `setReading` made while the texts load is recorded the same way. Either rides the swap, is sent to the new frame
   *  before its `ready`, as `openAt`'s is, and is never sent to the old frame while the swap is pending. `mountGen`, readiness and any
   *  held command are reset as `openAt` resets them. Texts that do not load keep the frame that was showing (the layout is not
   *  changed, a warning goes to the console, the recorded reading is sent to that frame in place) and call `opts.onKept`; nothing
   *  falls back, for a frame still stands. Does nothing after `destroy`. Absent: this mount has no frame. */
  remount?(opts: { layout: ReaderLayout; reading?: ReaderReading; onKept?: () => void }): void;
  /** Focuses the live frame's iframe (an already focused one is blurred first, so the focus lands anew). Does nothing after
   *  `destroy`. Absent: this mount has no frame. */
  focus?(): void;
}

/** The position token for "the top of the document". The library's host refuses an empty id, and its reader restores a
 *  token whose `line` is null by scrolling to `y`: the shape the library's own `anchor()` writes for a place with no block.
 *  Exported for the test that asserts the library still reads it (`isAnchorToken`): if the library changes, that test
 *  fails, not the console at run time. */
export const TOP_TOKEN = '{"line":null,"offset":0,"y":0}';

/** Whether an element outside the reader holds focus right now: `el`'s document has an active element that is connected
 *  and is neither the body, the document element, `el` nor anything inside `el`. The one fact the mount-focus decision
 *  (`policy.ts#readerMountFocusFor`) takes; nothing is decided here. */
function hostOwnsFocus(el: HTMLElement): boolean {
  const doc = el.ownerDocument;
  const active = doc.activeElement;
  return active !== null && active.isConnected && active !== doc.body && active !== doc.documentElement && !el.contains(active);
}

/** The page's storage as the library is handed it (I-3): every write of the reader's prefs key keeps the `layout` field stored at that
 *  moment (`withStoredLayoutKept`), because the frame writes its whole mount-time snapshot of the object back on any prefs change (a
 *  theme `follow`, an Aa width, font or size), the layout it was mounted in included. `layoutPref.ts` is the only writer of the field.
 *  Every other key, every read, a removal and the enumeration pass through unchanged. A read that throws leaves the write as it came
 *  (nothing is known to keep). The wrapping is the storage port's own (`lib/storage.ts#rewritingWrites`, the port's one owner, C7l);
 *  the rule it applies is the policy's. */
function layoutKeepingPort(port: EnumerableStoragePort): EnumerableStoragePort {
  return rewritingWrites(port, READER_PREFS_KEY, withStoredLayoutKept);
}

/** A mount that holds nothing (the assets did not load): both calls do nothing. */
const INERT: ReaderMount = { seed: { hosted: false }, follow() {}, destroy() {}, setPrefs() {} };

/** The link the frame reported, copied field by field into ccrc's own shape. */
function readerLinkOf(l: HostLink): ReaderLink {
  switch (l.kind) {
    case 'fragment':
      return { kind: 'fragment', id: l.id };
    case 'relative':
      return { kind: 'relative', path: l.path, fragment: l.fragment };
    case 'external':
      return { kind: 'external', url: l.url, scheme: l.scheme, host: l.host };
  }
}

/** The document with its version cut to `{sha, draft}` for a full commit, and with no version otherwise: the commit
 *  list and `only` are never passed (the W8a plan's refinement (k)). */
function withServedVersion(d: RenderInput): RenderInput {
  const { version, ...rest } = d;
  const sha = version?.sha;
  if (typeof sha !== 'string' || !isDocsCommit(sha)) return rest;
  return { ...rest, version: { sha, draft: version?.draft === true } };
}

/** The document with its version exactly the seed's four fields; the document's own `version` is dropped. */
function withSeed(d: RenderInput, v: ReaderVersionSeed): RenderInput {
  const { version: _own, ...rest } = d;
  return { ...rest, version: { sha: v.sha, draft: v.draft, commits: v.commits, only: v.only } };
}

/** Mounts the reader frame for one rendered document into `el`. Resolves once the library's mount returned (its
 *  `ready` and any fallback come later, through the callbacks). A rejected asset load calls `onFallback('assets')`
 *  and mounts nothing. */
export async function mountReader(el: HTMLElement, input: ReaderMountInput, deps: ReaderMountDeps = {}): Promise<ReaderMount> {
  const plan = readerMountPlan(input.profile, input.bytes, input.chrome ?? 'frame-bar', deps.e17 ?? READER_E17_MERMAID);
  const asks = readerMountAsks(input.profile, input.reading === undefined ? {} : { reading: input.reading });
  const contract = (deps.libraryContract ?? (() => frameLibrary.APPEARANCE_CONTRACT ?? 'none'))();
  const hosted = isHostedMount(plan, readerAppearanceSupported(contract), input.appearanceRoot !== undefined);
  // The layout the live library mount carries: the input's (the reader lab's mounts are always `default`), then each `remount`'s.
  let layout: ReaderLayout = input.profile === undefined ? input.layout ?? 'default' : 'default';
  const loadAssets = deps.assets ?? loadReaderAssets;
  // Start the base I/O first, then faces without yielding; contain either loader's immediate failure.
  let baseLoad: Promise<FrameAssets>;
  try { baseLoad = loadAssets(layout); }
  catch (error) { baseLoad = Promise.reject(error); }
  void baseLoad.catch(() => undefined);
  let faces: Promise<{ sans: string; mono: string } | undefined> | undefined;
  if (hosted) {
    try { faces = (deps.fonts ?? loadReaderFonts)().catch(() => undefined); }
    catch { faces = Promise.resolve(undefined); }
  }
  let assets: FrameAssets;
  // The texts of each layout loaded so far (a layout's own, without faces or Mermaid), so a return to one swaps at once.
  const loadedLayouts = new Map<ReaderLayout, FrameAssets>();
  try {
    const { fonts: _fonts, ...base } = await baseLoad;
    assets = base;
    loadedLayouts.set(layout, base);
  } catch {
    input.onFallback('assets');
    return INERT;
  }

  const watchdogMs = plan.watchdogMs;
  const loadMermaid = deps.mermaid ?? loadMermaidAsset;
  let document: RenderInput = plan.history && input.version !== undefined
    ? withSeed(input.document, input.version)
    : withServedVersion(input.document);
  // Drawn after `ready`, the library asks for the text itself (`loadMermaid`, below): nothing waits here. Drawn on request
  // or on open the text is inlined, so it is loaded first.
  if (plan.draw !== 'after-ready' && document.scan !== undefined && mermaidGate(document.scan.mermaid).inline) {
    // The wait ends at the frame's own watchdog: an import that never settles drops the scan exactly as a rejected one
    // does, and a chunk that arrives after that is ignored (the race has already answered). The timer's handle is a
    // local of this call, cleared the moment the wait settles either way.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('the Mermaid asset wait passed the watchdog')), watchdogMs);
      });
      assets = { ...assets, mermaid: await Promise.race([loadMermaid(), deadline]) };
    } catch {
      const { scan: _dropped, ...withoutScan } = document;
      document = withoutScan;
      if (plan.draw === 'auto') input.onMermaidDrop?.();
    } finally {
      clearTimeout(timer);
    }
  }

  if (faces !== undefined) {
    // The faces wait ends at the frame's own watchdog too, as the Mermaid wait above does: the library's fallback watchdog
    // starts only inside the mount, so a face load that never settled would leave the body mounting for ever. A late load
    // is ignored, and the mount goes on without faces exactly as after a failed one: the frame draws in the library's own
    // faces. The timer's handle is a local of this call, cleared the moment the wait settles either way.
    let facesTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const deadline = new Promise<undefined>((resolve) => {
        facesTimer = setTimeout(() => resolve(undefined), watchdogMs);
      });
      const fonts = await Promise.race([faces, deadline]);
      if (fonts !== undefined) assets = { ...assets, fonts };
    } finally {
      clearTimeout(facesTimer);
    }
  }

  const pageStore = plan.store ? (deps.store ?? enumerablePageStorage)() : null;
  const port = pageStore === null ? null : layoutKeepingPort(pageStore);
  const historyChanges = plan.history ? input.changes : undefined;
  const historyOpen = plan.history ? input.openVersion : undefined;
  // The theme the next library mount starts with: the input's, then the latest `setPrefs` (a fresh mount does not know
  // the old frame's prefs).
  let theme = input.prefs.theme;
  // Everything one library mount is handed except the document; `focus` is read at the call, so each mount decides it
  // anew. Called synchronously, right after the last await (or at `openAt`), so the read is as fresh as the mount.
  let seed: ReaderMount['seed'] = { hosted: false };
  let lastDrop: string | null = null;
  const readAppearance = (forMount = false) => {
    const reading = readHostAppearance(input.appearanceRoot!);
    const drop = reading.outcome.dropped;
    const key = drop === null ? null : JSON.stringify([drop.why, drop.token]);
    if (drop !== null && key !== lastDrop) console.warn(`ccrc-reader: ${drop.why} ${drop.token}`);
    lastDrop = key;
    if (forMount) seed = { hosted: true, stamp: reading.stamp };
    return reading.outcome.value;
  };
  const onPlace = input.onPlace;
  // The library drops a command sent before its frame's `ready` and queues nothing, so a Back decided in that window is held
  // here (the latest only) and sent at `ready`. `mountGen` names the live frame: a stale frame's ready changes nothing.
  type Held = { readonly what: string; readonly run: (f: ReturnType<typeof mountDocFrame>) => void };
  let mountGen = 0;
  let isReady = false;
  let held: Held | null = null;
  // The adapters one library mount is handed, for the `features` and the comparison base the policy decided for it.
  const adaptersFor = (features: ReaderFeatures | null, changesBaseNow: string | null): HostAdapters => ({
    assets,
    watchdogMs,
    ...(port === null ? {} : { store: port }),
    storePrefix: READER_STORE_PREFIX,
    ...(input.docKey === null ? {} : { docKey: input.docKey }),
    ...(hosted ? { appearance: readAppearance(true) } : { prefs: { theme } }),
    mermaidDraw: plan.draw,
    ...(plan.draw === 'after-ready' ? { loadMermaid } : {}),
    ...(historyChanges === undefined ? {} : { changes: (sha: string) => historyChanges(sha) }),
    ...(historyOpen === undefined ? {} : {
      openVersion: (v: { sha?: string; only?: string }) => historyOpen({
        ...(v.sha === undefined ? {} : { sha: v.sha }), ...(v.only === undefined ? {} : { only: v.only }),
      }),
    }),
    // The frame's bar is turned off only on ccrc's bar; progress is asked for by every production mount (D-8805), whose plan says so.
    // Every Docs mount seeds the reading-layer flags too (X2 P5.4); the reader lab's seeds none. `readerFeatures` decides, one object.
    ...(features === null ? {} : { features }),
    // The tab's comparison base for this doc, read now (each library mount reads it afresh), only a full sha and only with history.
    ...(changesBaseNow === null ? {} : { changesBase: changesBaseNow }),
    // A `default` mount names no layout, so its adapters are exactly what they were before layouts (X2 P5.1).
    ...(layout === 'default' ? {} : { layout }),
    // A `host-bar` mount always did; any other Docs mount does when its input listens (the reader's body always does now).
    ...(asks.progress && (plan.chrome === 'host-bar' || input.onProgress !== undefined)
      ? { onProgress: (share: number) => input.onProgress?.(share) } : {}),
    // The library sends `reader` acts only to a host that passed this, and parses the closed set itself: they go on as they came.
    ...(asks.reader && input.onReader !== undefined ? { onReader: (act: ReaderAct) => input.onReader?.(act) } : {}),
    title: input.title,
    focus: readerMountFocusFor(input.profile, hostOwnsFocus(el)),
    onLink: (l) => input.onLink(readerLinkOf(l)),
    // The library gives the second argument only to a host that passed `onPlace`; it goes on only when it came.
    onHash: (id, entry) => (entry === undefined
      ? input.onHash(id)
      : input.onHash(id, { push: entry.push, from: entry.from, inGrammar: frameLibrary.isFragmentId(id) })),
    ...(onPlace === undefined ? {} : { onPlace: (kind: PlaceKind) => onPlace(kind) }),
    copy: (text, check) => input.copy(text, check.hidden),
    onReady: readyOf(mountGen),
    onFallback: (r) => input.onFallback(r),
  });
  // Decided in the policy, read at each library mount: the flags (a fresh object each time) and the comparison base the tab holds.
  const adaptersNow = (): HostAdapters => adaptersFor(
    readerFeatures(input.profile, plan.chrome), readerSeedChangesBase(plan.history, input.changesBase?.() ?? null),
  );

  const mountFrame = deps.mount ?? mountDocFrame;
  let destroyed = false;
  const deliver = (h: Held): void => {
    try {
      h.run(frame);
    } catch (e) {
      console.warn(`ccrc-reader: the frame refused ${h.what}`, e);
    }
  };
  /** The adapter for frame number `gen`'s `ready`: it releases the held command, then tells the input. */
  const readyOf = (gen: number) => (): void => {
    if (gen === mountGen) {
      isReady = true;
      const h = held;
      held = null;
      if (h !== null && !destroyed) deliver(h);
    }
    input.onReady();
  };
  /** Sends `h` to the live frame, or holds it (replacing any held one) until the frame's `ready`. */
  const send = (h: Held): void => {
    if (destroyed || onPlace === undefined) return;
    if (!isReady) { held = h; return; }
    deliver(h);
  };
  // The reading the live mount is under (reader mode's turn, or `off`): the asks' for the first mount, then the latest
  // `setReading`. Every library mount is a new `DocFrame`, and the library replays a `setReading` only within one frame, so
  // each mount is sent this one right after `mountFrame` returns, before its `ready` (X6.76); `off` sends nothing, a fresh mount
  // being off. It is NOT the `held` mechanism above: the library itself queues a `setReading` made before `ready` (the latest
  // wins) and posts it at `ready`, unlike `command`, `goto` and `closeOverlay`, which it drops there, so holding it here would
  // be a second queue beside the library's and dropping it would lose the turn.
  let reading: ReaderReading = asks.reading;
  /** What the live frame was last sent: a fresh frame is `off`, then each send. A load that fails sends the live frame the reading
   *  recorded meanwhile only when it differs. */
  let frameReading: ReaderReading = 'off';
  const sendReading = (f: ReturnType<typeof mountDocFrame>, mode: ReaderReading): void => {
    frameReading = mode;
    try {
      f.setReading(mode);
    } catch (e) {
      console.warn('ccrc-reader: the frame refused setReading', e);
    }
  };
  /** A frame just mounted is off; it is sent the reading in force before its `ready` when that is not `off`. */
  const startReading = (f: ReturnType<typeof mountDocFrame>): void => {
    frameReading = 'off';
    if (reading !== 'off') sendReading(f, reading);
  };
  mountGen += 1;
  let frame = mountFrame(el, { document, adapters: adaptersNow() });
  startReading(frame);
  /** The remount request in force: each `remount` takes the next number, and a load that settles under an older one changes nothing. */
  let remountGen = 0;
  /** The layout whose texts a remount is loading, `null` for none: while it stands, a reading set is recorded and not sent to the old
   *  frame (it rides the swap), and an `openAt` drops the request (unless the anchor rides it, below). */
  let pendingLayout: ReaderLayout | null = null;
  /** The anchor an `openAt` left to ride the swap into `default` that is loading (`readerAnchorRidesSwap`), `null` for none: the swap
   *  that mounts takes it as its opening hash; a request that drops the swap, or a swap that fails, opens it in the live layout. It
   *  outlives a request that is replaced by a later one (the anchor wins), and ends the moment a frame is opened at it. */
  let pendingAnchor: string | null = null;
  /** Takes `base` as `want`'s texts (and `want` as the live layout): the layout's own texts, with the faces and the Mermaid text this
   *  mount already holds, neither of which depends on the layout. */
  const useLayoutTexts = (want: ReaderLayout, base: FrameAssets): void => {
    loadedLayouts.set(want, base);
    assets = {
      ...base,
      ...(assets.mermaid === undefined ? {} : { mermaid: assets.mermaid }),
      ...(assets.fonts === undefined ? {} : { fonts: assets.fonts }),
    };
    layout = want;
  };
  /** Replaces the live frame with a new one in the layout now live, opened at the anchor `hash` (`null`: no opening hash, so the stored
   *  place wins), sent the reading in force before its `ready`. Every library mount after the first goes through here. */
  const mountAgain = (hash: string | null): void => {
    frame.destroy();
    mountGen += 1;
    isReady = false;
    held = null;
    const next = mountFrame(el, { document: { ...document, initialHash: hash }, adapters: adaptersNow() });
    frame = next;
    // The library runs host code while it mounts (a focus or insertion handler, a fallback): one that destroyed this
    // mount then reached the frame before it, so the new frame goes too.
    if (destroyed) next.destroy();
    else startReading(next);
  };
  /** Swaps the live frame for a new one in `want`, with `base` its texts, at the anchor an `openAt` left riding it, if any (else no
   *  opening hash: the stored place wins). */
  const swapLayout = (want: ReaderLayout, base: FrameAssets): void => {
    if (destroyed) return;
    useLayoutTexts(want, base);
    const anchor = pendingAnchor;
    pendingAnchor = null;
    mountAgain(anchor);
  };
  /** The swap in flight is not going to mount (a request for the live layout dropped it, or its texts did not load): the frame that
   *  stands stays, in the layout it has. An anchor that was riding the swap opens there now; else the reading recorded meanwhile goes
   *  to the frame in place. */
  const keepFrame = (): void => {
    pendingLayout = null;
    const anchor = pendingAnchor;
    pendingAnchor = null;
    if (anchor !== null) mountAgain(anchor);
    else if (reading !== frameReading) sendReading(frame, reading);
  };
  return {
    get seed() { return seed; },
    get layout() { return layout; },
    remount(opts) {
      if (destroyed) return;
      if (opts.reading !== undefined) reading = opts.reading;
      remountGen += 1;
      const gen = remountGen;
      if (opts.layout === layout) {
        // The frame already carries it: a request still loading is dropped, and nothing is mounted again. The caller is told, as for a
        // frame that was kept: it may hold the host for the request it made, and no `ready` is coming to lift it (I-4a).
        keepFrame();
        opts.onKept?.();
        return;
      }
      const known = loadedLayouts.get(opts.layout);
      if (known !== undefined) {
        pendingLayout = null;
        swapLayout(opts.layout, known);
        return;
      }
      pendingLayout = opts.layout;
      let load: Promise<FrameAssets>;
      try { load = loadAssets(opts.layout); }
      catch (error) { load = Promise.reject(error); }
      load.then(({ fonts: _fonts, ...base }) => {
        if (destroyed || gen !== remountGen) return;
        pendingLayout = null;
        swapLayout(opts.layout, base);
      }, () => {
        if (destroyed || gen !== remountGen) return;
        // The frame that was showing stays, in the layout it has: nothing falls back.
        console.warn(`ccrc-reader: the ${opts.layout} layout did not load; the frame stays in ${layout}`);
        keepFrame();
        opts.onKept?.();
      });
    },
    follow(nextTheme) {
      if (destroyed) return;
      theme = nextTheme;
      if (hosted) frame.setAppearance(readAppearance());
      else frame.setPrefs({ theme: nextTheme });
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      frame.destroy();
    },
    setPrefs(p) {
      if (destroyed) return;
      theme = p.theme;
      frame.setPrefs({ theme: p.theme });
    },
    command(name) {
      if (destroyed) return;
      frame.command(name);
    },
    openAt(id) {
      if (destroyed) return;
      if (readerAnchorRidesSwap({ reading, pending: pendingLayout })) {
        // Reader mode's own swap into default is loading (I-4b): the anchor rides it, and the frame it mounts opens there, in default,
        // where a frame opened now in the layout the mount carries would have to be replaced at once.
        pendingAnchor = id;
        return;
      }
      // The anchor wins over a remount still loading: that request is dropped (a load that settles later changes nothing), and the
      // frame opened at the anchor is in the layout the live frame carries. (The request's texts are never in while it loads, so its
      // layout is never the one to open in.)
      remountGen += 1;
      pendingLayout = null;
      pendingAnchor = null;
      mountAgain(id);
    },
    setReading(mode) {
      if (destroyed) return;
      reading = mode;
      // While a remount's texts load the old frame is about to go: the reading is recorded and rides the swap.
      if (pendingLayout !== null) return;
      sendReading(frame, mode);
    },
    focus() {
      if (destroyed) return;
      // A second `focus()` on an element that is already the document's active element does nothing, and the frame's own
      // document may not hold focus then (Step 0, M-4, 2026-11-26): blur it first, so the focus lands anew.
      const iframe = el.querySelector('iframe');
      if (iframe === null) return;
      if (el.ownerDocument.activeElement === iframe) iframe.blur();
      iframe.focus();
    },
    closeOverlay() {
      // Before `ready` the frame is a fresh one with no overlay open, so there is nothing to close: the close is dropped,
      // never held, and so never replaces a held `goto`, which names a position the fresh frame does need.
      if (!isReady) return;
      send({ what: 'closeOverlay', run: (f) => f.closeOverlay() });
    },
    goto(id, from) {
      send({ what: 'goto', run: (f) => { if (from === undefined) f.goto(id); else f.goto(id, from); } });
    },
    gotoTop(id) {
      send({ what: 'goto', run: (f) => f.goto(id, TOP_TOKEN) });
    },
  };
}
