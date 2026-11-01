// The reader's one adapter over the shared Markdown library's host mount (native Docs reader, W8a Task 7; the
// 2026-10-31 reader-frame spec's M8.1, M8.15, M8.20 and section 4.4, refinements (b), (c) and (k)). Ring L3: it is
// the one file that imports the library's host entry. What it hands the library is the whole of ccrc's control over
// the frame, so the adapter set is exactly fourteen keys: `assets`, `watchdogMs`, `store`, `storePrefix`, `docKey`,
// `prefs`, `mermaidDraw`, `title`, `focus` and the five callbacks. It never passes `changes`, `openVersion`,
// `features` or `mermaidGate`, so the frame offers no change marks, version list or feature switch, and the Mermaid
// gate runs at the library's own caps.
//
// It decides nothing a policy file decides: the watchdog, the doc key and the prefs arrive already measured. It
// does three things of its own. It unwraps the library's callback shapes into ccrc's (the copy check's `hidden`
// list, the host link's fields). It keeps the version to what a full commit names (refinement (k)). And it loads the
// Mermaid text only for a document the library's gate lets in; a Mermaid chunk that does not load drops the scan,
// so the figures show their source and the page still mounts (refinement (c)).
//
// `mountReader` never remounts: the library's `update` is not called, and a theme change is the library's `setPrefs`.
import {
  mermaidGate, type FrameAssets, type RenderInput,
} from '@synapsium-labs/docserver/frame';
import {
  mountDocFrame, type FallbackReason, type HiddenChar, type HostAdapters, type HostLink,
} from '@synapsium-labs/docserver/host';
import { READER_STORE_PREFIX } from '../../lib/readerLimits';
import { enumerablePageStorage, type EnumerableStoragePort } from '../../lib/storage';
import { readerWatchdogMs, type ReaderLink } from './policy';
import { loadMermaidAsset, loadReaderAssets } from './assets';

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
}

export interface ReaderMountDeps {
  readonly mount?: typeof mountDocFrame;
  readonly store?: () => EnumerableStoragePort | null;
  readonly assets?: () => Promise<FrameAssets>;
  readonly mermaid?: () => Promise<string>;
}

export interface ReaderMount {
  /** Idempotent. */
  destroy(): void;
  /** The frame's `prefs` operation: applied in place, with no remount. */
  setPrefs(p: ReaderThemePref): void;
}

/** A mount that holds nothing (the assets did not load): both calls do nothing. */
const INERT: ReaderMount = { destroy() {}, setPrefs() {} };

/** A full commit: 40 lower-case hex digits (SHA-1) or 64 (SHA-256), the shape the library's frame accepts. */
const FULL_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

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
 *  list and `only` are never passed (refinement (k)). */
function withServedVersion(d: RenderInput): RenderInput {
  const { version, ...rest } = d;
  const sha = version?.sha;
  if (typeof sha !== 'string' || !FULL_SHA.test(sha)) return rest;
  return { ...rest, version: { sha, draft: version?.draft === true } };
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

  let document = withServedVersion(input.document);
  if (document.scan !== undefined && mermaidGate(document.scan.mermaid).inline) {
    try {
      assets = { ...assets, mermaid: await (deps.mermaid ?? loadMermaidAsset)() };
    } catch {
      const { scan: _dropped, ...withoutScan } = document;
      document = withoutScan;
    }
  }

  const port = (deps.store ?? enumerablePageStorage)();
  const adapters: HostAdapters = {
    assets,
    watchdogMs: readerWatchdogMs(input.bytes),
    ...(port === null ? {} : { store: port }),
    storePrefix: READER_STORE_PREFIX,
    ...(input.docKey === null ? {} : { docKey: input.docKey }),
    prefs: { theme: input.prefs.theme },
    mermaidDraw: 'on-request',
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
  };
}
