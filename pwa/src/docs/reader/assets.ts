// The shared Markdown library's frame assets as inert strings (native Docs reader, W8a Task 7; the 2026-10-31
// reader-frame spec's M8.2 and M8.12, refinement (b)). Ring L3 adapter: it reads texts and runs nothing. The library's
// host mount takes the exact texts of the shipped frame files from its caller and never fetches them; the build
// bundles each one as a string through Vite's `?raw`, and the mount verifies every text against the library's own
// manifest before it inlines anything.
//
// Each specifier is written once, as the literal argument of its own `import()` (the docs-parity guard admits the
// `/assets/…?raw` form only there), so each asset is its own chunk: the stylesheet and the four scripts load together,
// and the Mermaid text, by far the largest, only when a document's gate asks for it. The stylesheet is the frame's
// built copy (`frame/reader.css`, the fonts inlined as `data:`), never the source `reader.css`, whose hash differs and
// which the frame's asset check refuses.
import type { FrameAssets } from '@synapsium-labs/docserver/frame';

/** The four texts every mount needs: the guard, the bootstrap, the enhancer and the frame stylesheet. A rejected
 *  import (a chunk that did not load) rejects this promise whole; the caller falls back. */
export async function loadReaderAssets(): Promise<FrameAssets> {
  const [guard, bootstrap, enhance, css] = await Promise.all([
    import('@synapsium-labs/docserver/assets/frame/guard.js?raw'),
    import('@synapsium-labs/docserver/assets/frame/bootstrap.js?raw'),
    import('@synapsium-labs/docserver/assets/frame/enhance.js?raw'),
    import('@synapsium-labs/docserver/assets/frame/reader.css?raw'),
  ]);
  return { guard: guard.default, bootstrap: bootstrap.default, enhance: enhance.default, css: css.default };
}

/** The Mermaid script's text, for a document whose gate lets it in. Rejects when the chunk does not load. */
export async function loadMermaidAsset(): Promise<string> {
  return (await import('@synapsium-labs/docserver/assets/mermaid/mermaid.frame.js?raw')).default;
}
