// The highlight worker's job (native Docs reader, W5h-a Task 3; base spec 2026-10-01 section 4.10 "The job and its
// outcome", "The worker-side cache" and "The line retry"). `createHighlightAnswerer` answers one job, one block. It
// drops a message with no finite numeric `id`; answers `unregistered` for a language the instance does not know;
// else highlights the block whole with the call `CodeBlock` made before W5h (`highlight(code, {language,
// ignoreIllegals: true}).value`), or, for `mode: 'line'` on a block longer than HIGHLIGHT_LINE_RETRY_UNITS, line by
// line under the shared Markdown library's C24 rule (each line on its own, joined by its own breaks as written; one
// line longer than the unit answers `line-too-long`); refuses HTML longer than MD_HIGHLIGHT_MAX_HTML_CHARS as
// `too-large` before it is posted; and keeps what it computed in a bounded LRU keyed on mode, language and code
// (desktop polish C7's `createLru`, at its bounds: the W5h-a plan's refinement (c)), so a chat stream highlights
// only the block that grows. A throw anywhere answers `threw` and the thrown name; a `post` that throws (a structured
// clone's `DataCloneError`) is answered once more with `threw`, and a throw from that second post is swallowed, so
// the runner's deadline answers the job.
//
// Ring L1, worker side: no I/O. Imports `highlightGrammars.ts`, `highlightCache.ts`, `markdownLimits.ts` and types
// from `highlightProtocol.ts` (`markdown-purity.test.ts`'s M4.H3 describe holds the closure).
import { createLru, type Lru } from './highlightCache';
import { HLJS, type HighlightApi } from './highlightGrammars';
import type { HighlightReply, HighlightResult } from './highlightProtocol';
import {
  HIGHLIGHT_CACHE_MAX_CHARS, HIGHLIGHT_CACHE_MAX_ENTRIES, HIGHLIGHT_LINE_RETRY_UNITS, MD_HIGHLIGHT_MAX_HTML_CHARS,
} from './markdownLimits';

/** What an answer needs of highlight.js: `getLanguage` and `highlight`. A test hands in a fake. */
export type HighlightInstance = Pick<HighlightApi, 'getLanguage' | 'highlight'>;

/** The name of whatever was thrown: `name` for an error (a `DOMException` included), else its `typeof`. A copy of
 *  `markdownParse.ts#errorName` and `readerRenderJob.ts#errorName`, on purpose: importing either would pull the
 *  parse worker's modules (unified, the shared Markdown library) into this worker's closure, which M4.H3 holds to
 *  first-party highlight files, and `markdownParse.ts` is held byte-identical. */
function errorName(e: unknown): string {
  if (typeof e === 'object' && e !== null && 'name' in e && typeof e.name === 'string') return e.name;
  return typeof e;
}

/** `code` as lines and the breaks between them, each break as written (`\r\n`, `\r` or `\n`). One pass. */
function linesOf(code: string): { readonly lines: string[]; readonly breaks: string[] } {
  const lines: string[] = [];
  const breaks: string[] = [];
  let start = 0;
  for (let i = 0; i < code.length; i += 1) {
    const c = code.charCodeAt(i);
    if (c !== 0x0a && c !== 0x0d) continue;
    lines.push(code.slice(start, i));
    const crlf = c === 0x0d && code.charCodeAt(i + 1) === 0x0a;
    breaks.push(crlf ? '\r\n' : code.charAt(i));
    if (crlf) i += 1;
    start = i + 1;
  }
  lines.push(code.slice(start));
  return { lines, breaks };
}

/** An answerer over `h` that keeps its HTML in `cache`. The worker makes one over `HLJS` and a cache at the limits'
 *  bounds; a test hands in a fake instance or a smaller cache. */
export function createHighlightAnswerer(
  h: HighlightInstance = HLJS,
  cache: Lru<string> = createLru<string>(HIGHLIGHT_CACHE_MAX_ENTRIES, HIGHLIGHT_CACHE_MAX_CHARS, (html) => html.length),
): (data: unknown, post: (reply: HighlightReply) => void) => void {
  const colour = (lang: string, code: string): string => h.highlight(code, { language: lang, ignoreIllegals: true }).value;
  const answer = (lang: unknown, code: unknown, mode: unknown): HighlightResult => {
    if (typeof lang !== 'string' || typeof code !== 'string') throw new TypeError('a highlight job needs a string lang and code');
    if (lang === '' || h.getLanguage(lang) === undefined) return { kind: 'unregistered' };
    const lineMode = mode === 'line' && code.length > HIGHLIGHT_LINE_RETRY_UNITS;
    const key = `${lineMode ? 'line' : 'block'}\u0000${lang}\u0000${code}`;
    let html = cache.get(key);
    if (html === undefined) {
      if (lineMode) {
        const { lines, breaks } = linesOf(code);
        const longest = lines.reduce((m, l) => Math.max(m, l.length), 0);
        if (longest > HIGHLIGHT_LINE_RETRY_UNITS) return { kind: 'line-too-long', chars: longest };
        html = lines.map((l, i) => colour(lang, l) + (breaks[i] ?? '')).join('');
      } else {
        html = colour(lang, code);
      }
      cache.set(key, html);
    }
    if (html.length > MD_HIGHLIGHT_MAX_HTML_CHARS) return { kind: 'too-large', htmlChars: html.length };
    return { kind: 'html', html, mode: lineMode ? 'line' : 'block' };
  };
  return (data, post) => {
    const d = data as { readonly id?: unknown; readonly lang?: unknown; readonly code?: unknown; readonly mode?: unknown } | null;
    if (typeof d !== 'object' || d === null || typeof d.id !== 'number' || !Number.isFinite(d.id)) return;
    const id = d.id;
    let result: HighlightResult;
    try {
      result = answer(d.lang, d.code, d.mode);
    } catch (e) {
      result = { kind: 'threw', error: errorName(e) };
    }
    try {
      post({ id, result });
    } catch (e) {
      try {
        post({ id, result: { kind: 'threw', error: errorName(e) } });
      } catch {
        // The second post failed too: the runner's deadline answers the job.
      }
    }
  };
}
