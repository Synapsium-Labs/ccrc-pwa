// The settled outcome (spec 2026-10-01 4.10 "The settled outcome", 4.17; native Docs reader W5, Export; refinements (a),
// (h)): what a leaf's body shows, published for the leaf's Export. Each body publishes what it shows, in an effect, and
// withdraws it (`null`) in that effect's cleanup:
//   - `tree`: `DocMarkdown`'s parsed tree, as `DocTree` drew it: the text it answers, the detached tree and its URL map
//     (Export renders these very objects and never runs `detachUrls` again), and the page's link context;
//   - `plain`: a body shown as plain text, with its note (`DocPlain`: an outcome Docs did not format, Show as text, bytes
//     that are not UTF-8, the doc-body boundary's fallback, the reader's timeout);
//   - `gate`: the render gate, waiting for Format anyway or Show as text;
//   - `text`: a text leaf's text and the grammar its extension matched, or `null` (`TextBody`);
//   - `reader`: the reader frame shows the leaf (refinement (a));
//   - `mockup`: the mockup viewer's attempt, from the moment it has a plan: the page text it parsed, its inert Document
//     (Export CLONES it and never parses again) and the attempt's plan with a promise of what its load came to
//     (completion plan Task 9). The viewer publishes `plain` for a page the pre-scan refuses and `gate` for the render
//     gate, and nothing while it parses or plans.
// "Formatting…" publishes nothing. A leaf mounts one body at a time, and React runs the leaving body's cleanup before the
// next body's effect, so one holder (`DocsScreen`'s) always ends on the body on screen. The page's highlight store
// travels apart, through W5h-a's `HighlighterContext` `publish` slot; `DocsScreen` holds both and `DocsHead#exportStateFor`
// composes them (refinement (h)).
//
// Ring L4 (a hook).
import { createContext, useContext, useEffect } from 'react';
import type { Element as HastElement, Root as HastRoot } from 'hast';
import type { DocLinkContextValue } from './DocLink';
import type { DetachedUrls } from './docsLinks';
import type { MockupAssetPlan, MockupAssetResult } from './mockup/ports';

/** What a mockup attempt's load came to: `loaded`, with its result, or `ended`: the attempt was aborted or its load
 *  failed, so no asset bytes will come (never an overloaded null). */
export type MockupLoadEnd = { readonly s: 'loaded'; readonly result: MockupAssetResult } | { readonly s: 'ended' };

/** One attempt's assets for Export: its plan (known at once), the promise of its load's end, which never rejects, and
 *  `now`, its load as it stands (`MockupLoad.now`, `mockup/load.ts`): what has loaded kept, every admitted row still
 *  loading `failed` with the word given. Export reads `now` when its wait runs out, so a slow asset costs only itself
 *  (base decision 3, section 4.17; review 2361 F2). */
export interface MockupExportAssets {
  readonly plan: MockupAssetPlan;
  readonly settled: Promise<MockupLoadEnd>;
  readonly now: (failure: string) => MockupAssetResult;
}

export type ExportBody =
  | { readonly kind: 'reader' }
  | { readonly kind: 'gate' }
  | {
    readonly kind: 'tree'; readonly text: string; readonly tree: HastRoot;
    readonly urls: WeakMap<HastElement, DetachedUrls>; readonly link: Omit<DocLinkContextValue, 'urls'>;
  }
  | { readonly kind: 'plain'; readonly text: string; readonly note: string }
  | { readonly kind: 'text'; readonly text: string; readonly lang: string | null }
  | { readonly kind: 'mockup'; readonly text: string; readonly doc: Document; readonly assets: MockupExportAssets };

export const READER_BODY: ExportBody = Object.freeze({ kind: 'reader' } as const);
export const GATE_BODY: ExportBody = Object.freeze({ kind: 'gate' } as const);

/** Where a body publishes. `null`, the default, has one meaning: nothing listens (a body outside the Docs screen). */
export const ExportBodyContext = createContext<((body: ExportBody | null) => void) | null>(null);

/** Publishes `body` while it stands and the component is mounted; `null` publishes nothing. The caller memoises `body`. */
export function usePublishExportBody(body: ExportBody | null): void {
  const publish = useContext(ExportBodyContext);
  useEffect(() => {
    if (publish === null || body === null) return undefined;
    publish(body);
    return () => publish(null);
  }, [publish, body]);
}
