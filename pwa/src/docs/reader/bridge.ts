// The reader's one adapter over the shared Markdown library's host mount (native Docs reader, W8a Task 7; the
// rich-docs spec's (amended 2026-10-31) M8.1, M8.15, M8.20 and section 4.4, the W8a plan's refinements (b), (c) and (k)). Ring L3: it is
// the one file that imports the library's host entry. What it hands the library is the whole of ccrc's control over
// the frame: W8a's fourteen keys (`assets`, `watchdogMs`, `store`, `storePrefix`, `docKey`, `prefs`, `mermaidDraw`,
// `title`, `focus` and the five callbacks), and since the library 1.1 take-up `loadMermaid` for a mount drawn after
// `ready`, and `features` (the frame's bar off, its top space trimmed) with `onProgress` for a mount on ccrc's bar (the
// take-up plan, refinements (c) and (g)). A Docs mount with history (`policy.ts#readerMountPlan`'s `history`) also
// passes `changes` and `openVersion` and the version seed (completion plan Task 12), when the input has them; the reader
// lab's mounts never do. It never passes `mermaidGate`, so the Mermaid gate runs at the library's own caps.
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
// `mountReader` never remounts: the library's `update` is not called, and a theme change is the library's `setPrefs`.
// The watchdog, the draw mode, whether a storage port is handed over, whether the history is carried and whose bar the
// frame has are
// `policy.ts#readerMountPlan`'s, by the input's `profile` (none for the Docs reader, `lab-draw` for the reader lab's
// timed mounts: the reader lab plan, refinement (k)), its `chrome`, and the recorded E17 reading.
import {
  mermaidGate, type FrameAssets, type RenderInput,
} from '@synapsium-labs/docserver/frame';
import {
  mountDocFrame, type FallbackReason, type HiddenChar, type HostAdapters, type HostLink,
} from '@synapsium-labs/docserver/host';
import { isDocsCommit } from '../../../../shared/docs';
import { READER_STORE_PREFIX } from '../../lib/readerLimits';
import { enumerablePageStorage, type EnumerableStoragePort } from '../../lib/storage';
import {
  READER_E17_MERMAID, readerMountPlan,
  type ReaderChrome, type ReaderCommand, type ReaderE17Reading, type ReaderLink, type ReaderMountProfile,
} from './policy';
import { loadMermaidAsset, loadReaderAssets } from './assets';
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
  readonly onLink: (l: ReaderLink) => void;
  readonly onHash: (id: string) => void;
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
  /** How far the document has been read, 0 to 1, for a mount on ccrc's bar; absent, nobody listens. */
  readonly onProgress?: (share: number) => void;
  /** `history.ts#readerVersionSeed`'s answer for this body. Absent, the document's own `version` is cut to `{sha, draft}`
   *  as before. Passed on only when the mount's plan carries history (all three of this and the next two). */
  readonly version?: ReaderVersionSeed;
  /** The marks of the changes between the base commit `sha` and this body, or `null` for unavailable. */
  readonly changes?: (sha: string) => Promise<{
    ranges: readonly (readonly [number, number])[]; removedAfter?: readonly number[];
  } | null>;
  /** The frame's `version` operation: open the page at `sha` and/or filter its list to the day `only` names. */
  readonly openVersion?: (v: { sha?: string; only?: string }) => void;
}

export interface ReaderMountDeps {
  readonly mount?: typeof mountDocFrame;
  readonly store?: () => EnumerableStoragePort | null;
  readonly assets?: () => Promise<FrameAssets>;
  readonly mermaid?: () => Promise<string>;
  /** Tests only: the E17 reading to plan with; absent, the recorded one (`READER_E17_MERMAID`). */
  readonly e17?: ReaderE17Reading;
}

export interface ReaderMount {
  /** Idempotent. */
  destroy(): void;
  /** The frame's `prefs` operation: applied in place, with no remount. */
  setPrefs(p: ReaderThemePref): void;
  /** Runs one of the reader's tools, as a toggle, through the library's `DocFrame.command` (which focuses the frame first
   *  and does nothing before `ready`). Call it from a tap's own handler. Absent: this mount has no frame to command (the
   *  assets did not load). */
  command?(name: ReaderCommand): void;
}

/** A mount that holds nothing (the assets did not load): both calls do nothing. */
const INERT: ReaderMount = { destroy() {}, setPrefs() {} };

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
  let assets: FrameAssets;
  try {
    assets = await (deps.assets ?? loadReaderAssets)();
  } catch {
    input.onFallback('assets');
    return INERT;
  }

  const plan = readerMountPlan(input.profile, input.bytes, input.chrome ?? 'frame-bar', deps.e17 ?? READER_E17_MERMAID);
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

  const port = plan.store ? (deps.store ?? enumerablePageStorage)() : null;
  const historyChanges = plan.history ? input.changes : undefined;
  const historyOpen = plan.history ? input.openVersion : undefined;
  const adapters: HostAdapters = {
    assets,
    watchdogMs,
    ...(port === null ? {} : { store: port }),
    storePrefix: READER_STORE_PREFIX,
    ...(input.docKey === null ? {} : { docKey: input.docKey }),
    prefs: { theme: input.prefs.theme },
    mermaidDraw: plan.draw,
    ...(plan.draw === 'after-ready' ? { loadMermaid } : {}),
    ...(historyChanges === undefined ? {} : { changes: (sha: string) => historyChanges(sha) }),
    ...(historyOpen === undefined ? {} : {
      openVersion: (v: { sha?: string; only?: string }) => historyOpen({
        ...(v.sha === undefined ? {} : { sha: v.sha }), ...(v.only === undefined ? {} : { only: v.only }),
      }),
    }),
    ...(plan.chrome === 'host-bar'
      ? { features: { chrome: { bar: false, topSpace: false } }, onProgress: (share: number) => input.onProgress?.(share) }
      : {}),
    title: input.title,
    focus: true,
    onLink: (l) => input.onLink(readerLinkOf(l)),
    onHash: (id) => input.onHash(id),
    copy: (text, check) => input.copy(text, check.hidden),
    onReady: () => input.onReady(),
    onFallback: (r) => input.onFallback(r),
  };

  const frame = (deps.mount ?? mountDocFrame)(el, { document, adapters });
  let destroyed = false;
  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      frame.destroy();
    },
    setPrefs(p) {
      if (destroyed) return;
      frame.setPrefs({ theme: p.theme });
    },
    command(name) {
      if (destroyed) return;
      frame.command(name);
    },
  };
}
