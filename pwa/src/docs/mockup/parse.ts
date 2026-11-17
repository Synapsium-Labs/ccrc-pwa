// The mockup's one HTML parse (native Docs reader, completion plan Task 5, C1; base spec 2026-10-01 5.6.2 step 4, rows
// M5.16's DOMParser bullet, M5.22 and M5.B8). Ring L3: an adapter over the browser's parser, which decides nothing: the
// pre-scan (`prescan.ts`, L1) decides whether the text may be parsed, and this file only calls it first. The native
// parse cannot be aborted (E13), so a refusal returns BEFORE any parser is constructed. This file holds the only
// constructor and the only parse call in `pwa/src`, and `test/docs-scans.test.ts`'s clause C1 pins both. The global is
// read when the function runs, never captured at import, so a test can stand a counting parser in its place. The parse
// is inert: no script runs and nothing loads (E12), and the nodes are read and re-serialised, never adopted into the
// live document.
import { prescanMockup, type MockupPrescan } from './prescan';

/** The mockup text parsed, or the pre-scan's refusal with no parser ever constructed. */
export function parseMockup(text: string): { ok: true; doc: Document; prescan: MockupPrescan } | { ok: false; prescan: MockupPrescan } {
  const prescan = prescanMockup(text);
  if (!prescan.ok) return { ok: false, prescan };
  return { ok: true, doc: new DOMParser().parseFromString(text, 'text/html'), prescan };
}
