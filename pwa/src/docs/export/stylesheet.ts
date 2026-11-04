// Export's stylesheet (spec 2026-10-01 4.14 "Export's stylesheet", 4.17 "Stylesheet and theme"; native Docs reader W5,
// Export; refinements (b), (c), (d)). Derived, never typed twice: @ccrc/ui's tokens (every palette block, so the
// exporter's palette applies in the file) and its prose rules (the Markdown body, code blocks, tables and the hljs
// colours, which left chat.css for @ccrc/ui), then the export's own chrome. Each is read as text at build time through
// Vite's `?raw` (vite.config.ts lets `.css?raw` through under vitest too, and so does vitest.browser.config.ts's own
// `css.include`, without which the browser leg would read each sheet as an empty string; the reads of @ccrc/ui's two
// sheets also rely on the `server.fs.allow` entry for `../ui` in both configs), less its comments and its
// `@font-face` blocks: a face names a font file by `url()`, which the export's CSP refuses and M4.EX2 forbids, so the token stacks
// fall back to system faces. `EXPORT_CSS` holds no `</style`, no `@import` and no `url(` (docs-export.test.tsx).
//
// Ring L1: pure; three build-time texts.
import tokensCss from '@ccrc/ui/styles/tokens.css?raw';
import proseCss from '@ccrc/ui/styles/prose.css?raw';
import exportCss from './export.css?raw';

/** One stylesheet's text as the export carries it: its comments and its `@font-face` blocks removed, trimmed. */
export function exportStylesheetPart(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@font-face\s*\{[^}]*\}/g, '').trim();
}

/** The one `<style>` text of every export: tokens, prose, the export's chrome, in that order. */
export const EXPORT_CSS = [tokensCss, proseCss, exportCss].map(exportStylesheetPart).join('\n');
