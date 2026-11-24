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
import type { FrameAssets } from '@synapsium-labs/pinax-lib/frame';

/** The four texts every mount needs: the guard, the bootstrap, the enhancer and the frame stylesheet. A rejected
 *  import (a chunk that did not load) rejects this promise whole; the caller falls back. */
export async function loadReaderAssets(): Promise<FrameAssets> {
  const [guard, bootstrap, enhance, css] = await Promise.all([
    import('@synapsium-labs/pinax-lib/assets/frame/guard.js?raw'),
    import('@synapsium-labs/pinax-lib/assets/frame/bootstrap.js?raw'),
    import('@synapsium-labs/pinax-lib/assets/frame/enhance.js?raw'),
    import('@synapsium-labs/pinax-lib/assets/frame/reader.css?raw'),
  ]);
  return { guard: guard.default, bootstrap: bootstrap.default, enhance: enhance.default, css: css.default };
}

/** The Mermaid script's text, for a document whose gate lets it in. Rejects when the chunk does not load. */
export async function loadMermaidAsset(): Promise<string> {
  return (await import('@synapsium-labs/pinax-lib/assets/mermaid/mermaid.frame.js?raw')).default;
}
