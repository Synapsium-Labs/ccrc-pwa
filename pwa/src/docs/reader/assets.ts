// The shared Markdown library's frame assets as inert strings (native Docs reader, W8a Task 7; the rich-docs spec's
// (amended 2026-10-31) M8.2 and M8.12, the W8a plan's refinement (b)). Ring L3 adapter: it reads texts and runs nothing. The library's
// host mount takes the exact texts of the shipped frame files from its caller and never fetches them; the build
// bundles each one as a string through Vite's `?raw`, and the mount verifies every text against the library's own
// manifest before it inlines anything.
//
// Each specifier is written once, as the literal argument of its own `import()` (the docs-parity guard, M7.9, admits the
// `/assets/…?raw` form at an import position, after `from` or `import(`, in any file under `pwa/src`), so each asset is
// its own chunk: the stylesheet and the four scripts load together,
// and the Mermaid text, by far the largest, only when a document's gate asks for it. The stylesheet is the frame's
// built copy (`frame/reader.css`, the fonts inlined as `data:`), never the source `reader.css`, whose hash differs and
// which the frame's asset check refuses.
//
// The layouts (X2 P5.1, D-8762): the frame carries one layout, and the library ships each non-default layout as its own enhance
// bundle (`frame/enhance-<name>.js`) and its own stylesheet (`frame/layout-<name>.css`) beside the three texts every layout shares
// (the guard, the bootstrap, `reader.css`). Each layout's two texts load only when that layout is asked for (their own chunks), and the
// default layout's load is exactly what it was before layouts.
import type { FrameAssets } from '@synapsium-labs/pinax-lib/frame';
import type { ReaderLayout } from '../../../../shared/docs';

type RawText = Promise<{ readonly default: string }>;

/** Each layout's enhance bundle: one literal `import()` per specifier (the docs-parity guard's form). */
const ENHANCE: Readonly<Record<ReaderLayout, () => RawText>> = {
  default: () => import('@synapsium-labs/pinax-lib/assets/frame/enhance.js?raw'),
  classic: () => import('@synapsium-labs/pinax-lib/assets/frame/enhance-classic.js?raw'),
  editorial: () => import('@synapsium-labs/pinax-lib/assets/frame/enhance-editorial.js?raw'),
  review: () => import('@synapsium-labs/pinax-lib/assets/frame/enhance-review.js?raw'),
  guided: () => import('@synapsium-labs/pinax-lib/assets/frame/enhance-guided.js?raw'),
};

/** Each non-default layout's own stylesheet (`default` has none: its rules are `reader.css`, which every layout inlines). */
const LAYOUT_CSS: Readonly<Record<Exclude<ReaderLayout, 'default'>, () => RawText>> = {
  classic: () => import('@synapsium-labs/pinax-lib/assets/frame/layout-classic.css?raw'),
  editorial: () => import('@synapsium-labs/pinax-lib/assets/frame/layout-editorial.css?raw'),
  review: () => import('@synapsium-labs/pinax-lib/assets/frame/layout-review.css?raw'),
  guided: () => import('@synapsium-labs/pinax-lib/assets/frame/layout-guided.css?raw'),
};

/** The texts a mount in `layout` needs: the guard, the bootstrap, the layout's enhancer and the frame stylesheet, and for a layout
 *  other than `default` its own stylesheet as `layoutCss`. A rejected import (a chunk that did not load) rejects this promise whole;
 *  the caller falls back. `default`, the default argument, answers exactly the four texts it always did. */
export async function loadReaderAssets(layout: ReaderLayout = 'default'): Promise<FrameAssets> {
  const [guard, bootstrap, enhance, css, own] = await Promise.all([
    import('@synapsium-labs/pinax-lib/assets/frame/guard.js?raw'),
    import('@synapsium-labs/pinax-lib/assets/frame/bootstrap.js?raw'),
    ENHANCE[layout](),
    import('@synapsium-labs/pinax-lib/assets/frame/reader.css?raw'),
    layout === 'default' ? Promise.resolve(null) : LAYOUT_CSS[layout](),
  ]);
  const base = { guard: guard.default, bootstrap: bootstrap.default, enhance: enhance.default, css: css.default };
  return own === null ? base : { ...base, layoutCss: own.default };
}

/** The design system's own faces, as base64 without their data-URL prefixes. */
export async function loadReaderFonts(): Promise<{ readonly sans: string; readonly mono: string }> {
  const [sans, mono] = await Promise.all([
    import('@/fonts/Geist-Variable.woff2?inline'),
    import('@/fonts/GeistMono-Variable.woff2?inline'),
  ]);
  return { sans: sans.default.slice(sans.default.indexOf(',') + 1), mono: mono.default.slice(mono.default.indexOf(',') + 1) };
}

/** The Mermaid script's text, for a document whose gate lets it in. Rejects when the chunk does not load. */
export async function loadMermaidAsset(): Promise<string> {
  return (await import('@synapsium-labs/pinax-lib/assets/mermaid/mermaid.frame.js?raw')).default;
}
