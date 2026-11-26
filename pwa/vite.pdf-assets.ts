// The PDF frame's binary assets (X2 P3, spec 2026-11-18 section 4.4, "What goes in"): pdf.js's packed CMaps (`.bcmap`) and
// its Type 1 standard fonts (`.pfb`), which `src/docs/pdf/pdfAssets.ts` imports with `?inline` so they ride inside the frame's
// page as base64 and the frame fetches nothing. Vite inlines with `?inline` only a file it knows as an asset, and it does
// not know these two extensions (`.ttf` it does), so both configs that load that module (vite.config.ts, and
// vitest.browser.config.ts for the browser rows that build the frame from it) add them through this one list. Scoped to
// the package's own two folders, so no other file of either kind becomes an asset.
export const PDF_ASSETS_INCLUDE: readonly string[] = [
  '**/node_modules/pdfjs-dist/cmaps/*.bcmap',
  '**/node_modules/pdfjs-dist/standard_fonts/*.pfb',
];
