// The reader frame's decisions (native Docs reader, W8a Task 5; the rich-docs spec's (amended 2026-10-31) M8.7, M8.11, M8.19,
// A15/G7 and section 4.4's `navigate`, `copy` and `hash` rows; the W8a plan's refinements (h), (l) and (n)). Ring L1 policy: pure
// deciders over plain values, no I/O, no timer, no DOM, and no runtime import of a `.tsx` (the `import type` from `../DocLink` is erased), a store, `lib/api.ts` or the
// shared Markdown library (`ReaderLink` mirrors the library's host-link shape instead of importing it). Delivery
// (`ReaderFrame.tsx`) asks these and acts on the answer: it decides nothing.
//
// A `relative` link goes through `docLinkTarget`, the one decision for a Markdown link on a Docs page, so the reader
// cannot route a link the plain view would refuse; an `external` link is re-derived from its URL (the scheme and host
// the classifier reported are not trusted), except the host of a `mailto`, which has no hostname to re-derive and keeps
// the host the classifier reported (empty when the first address names none; the sheet words that case without a host).
// Each `null` here has one meaning, stated at the function.
import { DOCS_PARSE_BUDGET_MS } from '../../lib/markdownLimits';
import { utf8ByteLength } from '../../lib/markdownGuard';
import { READER_COPY_WRITE_MAX_BYTES, READER_DOC_KEY_MAX_UNITS } from '../../lib/readerLimits';
import { docLinkTarget } from '../docsLinks';
import type { DocLinkContextValue } from '../DocLink';
import type { ReaderHiddenChar } from './readerText';

/** A link as the host's classifier of the frame's href yields it (mirrors the library's host-link shape; nothing is
 *  imported from it). The frame's content is untrusted: `external` is re-derived from its `url` before it is used. */
export type ReaderLink =
  | { kind: 'fragment'; id: string }
  | { kind: 'relative'; path: string; fragment: string | null }
  | { kind: 'external'; url: string; scheme: 'http' | 'https' | 'mailto'; host: string };

/** What the host does with a link. `in-app`: navigate to a Docs page (`fragment` is the link's, for the visit to
 *  scroll to once that page renders). `hash`: move to an anchor in this page. `sheet`: ask before opening a URL
 *  (`foreign`: its host is not the console's own). `inert`: nothing. */
export type ReaderRoute =
  | { kind: 'in-app'; href: string; fragment: string | null }
  | { kind: 'hash'; id: string }
  | { kind: 'sheet'; url: string; scheme: string; host: string; foreign: boolean }
  | { kind: 'inert' };

/** The only schemes a sheet may offer to open. */
const SHEET_SCHEMES: readonly string[] = ['http', 'https', 'mailto'];

/** The sheet for a URL, or `inert` when `scheme` is not http, https or mailto. A host is foreign when it is not
 *  exactly the console's own, both lower-cased (the W8a plan's refinement (h): `pwa/src` has no public-suffix data, so the stricter
 *  exact comparison stands in for "registrable name"). `hostRaw` and `ownHostRaw` are hostnames, with no port. */
function sheetFor(url: string, scheme: string, hostRaw: string, ownHostRaw: string): ReaderRoute {
  if (!SHEET_SCHEMES.includes(scheme)) return { kind: 'inert' };
  const host = hostRaw.toLowerCase();
  const ownHost = ownHostRaw.toLowerCase();
  return { kind: 'sheet', url, scheme, host, foreign: host !== ownHost };
}

/** The route of one link reported by the frame. A `relative` link is rebuilt as its path plus `#fragment` and goes
 *  through `docLinkTarget`, so a root-relative link, a climb above the repository and every refused spelling are
 *  inert exactly as in the plain view; an external or GitHub resolution is a sheet. */
export function routeReaderLink(ctx: DocLinkContextValue, link: ReaderLink, ownHost: string): ReaderRoute {
  switch (link.kind) {
    case 'fragment':
      return { kind: 'hash', id: link.id };
    case 'external': {
      // Re-derive from the URL: a parse failure or a protocol outside the allowlist is inert. http(s) takes the
      // parse's hostname (no port, the shape of `ownHost`); mailto keeps the link's host, because its hostname is ''.
      let u: URL;
      try {
        u = new URL(link.url);
      } catch {
        return { kind: 'inert' };
      }
      const scheme = u.protocol.slice(0, -1);
      return sheetFor(link.url, scheme, scheme === 'mailto' ? link.host : u.hostname, ownHost);
    }
    case 'relative': {
      const target = docLinkTarget(ctx, link.fragment === null ? link.path : `${link.path}#${link.fragment}`);
      switch (target.kind) {
        case 'in-app':
          return { kind: 'in-app', href: target.href, fragment: target.fragment };
        case 'fragment':
          return { kind: 'hash', id: target.fragment };
        case 'inert':
          return { kind: 'inert' };
        case 'external':
        case 'github': {
          let u: URL;
          try {
            u = new URL(target.href);
          } catch {
            return { kind: 'inert' };
          }
          return sheetFor(target.href, u.protocol.slice(0, -1), u.hostname, ownHost);
        }
      }
    }
  }
}

/** What the host does with a copy request. `write`: put `text` on the clipboard. `sheet`: ask first, naming each
 *  hidden character (`hidden` is the list the host's own scan of the copy text produced). */
export type CopyDecision =
  | { kind: 'write'; text: string }
  | { kind: 'sheet'; text: string; hidden: readonly ReaderHiddenChar[] };

/** Write only text with no hidden character and at most `READER_COPY_WRITE_MAX_BYTES` UTF-8 bytes; anything else asks. */
export function copyDecision(text: string, hidden: readonly ReaderHiddenChar[]): CopyDecision {
  if (hidden.length === 0 && utf8ByteLength(text) <= READER_COPY_WRITE_MAX_BYTES) return { kind: 'write', text };
  return { kind: 'sheet', text, hidden };
}

/** The key of a document's per-doc state: `project:section:path`. `null` has one meaning, "no per-doc state for this
 *  doc": the key is over 1024 code units or holds a control character (C0, DEL or C1). */
export function readerDocKey(project: string, section: string, path: string): string | null {
  const key = `${project}:${section}:${path}`;
  if (key.length > READER_DOC_KEY_MAX_UNITS) return null;
  for (let i = 0; i < key.length; i += 1) {
    const c = key.charCodeAt(i);
    if (c <= 0x1f || (c >= 0x7f && c <= 0x9f)) return null;
  }
  return key;
}

/** A palette as the reader reads it: the console's theme id and which way it reads. (Mirrors the design system's
 *  theme row; nothing is imported from it, the caller hands the rows in.) */
export interface ReaderPalette {
  readonly id: string;
  readonly mode: 'light' | 'dark';
}

/** The frame's theme preference for the console's theme choice: a palette in `palettes` gives its own mode, so a pinned
 *  dark palette reads dark; `system`, and an id no palette has, follow the device. */
export function readerPrefsOf(
  themeChoice: string, palettes: readonly ReaderPalette[],
): { theme: 'light' | 'dark' | 'auto' } {
  if (themeChoice === 'system') return { theme: 'auto' };
  const palette = palettes.find((x) => x.id === themeChoice);
  return palette === undefined ? { theme: 'auto' } : { theme: palette.mode };
}

/** The frame's start watchdog for a document of `bytes` UTF-8 bytes: the Docs parse budget, with no allowance for
 *  Mermaid (the W8a plan's refinement (c): `ready` does not wait for it in on-request mode). */
export function readerWatchdogMs(bytes: number): number {
  return DOCS_PARSE_BUDGET_MS(bytes);
}

/** Where one body (one `bodyKey`) is. `fallback` and `plain` are terminal for the key: the body stays there until its
 *  key changes, so there is no remount loop (M8.11). `reason` and `why` go to the console, never to the page.
 *  `budgetMs` on `plain` is present exactly when the render timed out: the plain text with the timeout note, no second
 *  parse. Absent, the plain view formats the body itself. */
export type ReaderBodyState =
  | { s: 'rendering' }
  | { s: 'mounting' }
  | { s: 'ready' }
  | { s: 'fallback'; reason: string }
  | { s: 'plain'; why: string; budgetMs?: number };

/** What happens to a body: `mount` (the render answered and the frame is being mounted), `ready` (the frame said so),
 *  `fallback` (the frame or its start failed) and `plain` (the plain view was chosen, which is decided before a
 *  mount, so only from `rendering`). */
export type ReaderBodyEvent =
  | { e: 'mount' }
  | { e: 'ready' }
  | { e: 'fallback'; reason: string }
  | { e: 'plain'; why: string; budgetMs?: number };

/** The next state of a body. A terminal state answers itself (the same object); `ready` is only reached from
 *  `mounting`, `plain` only from `rendering`, and a failure from any live state is a fallback. */
export function readerBodyReducer(state: ReaderBodyState, ev: ReaderBodyEvent): ReaderBodyState {
  if (state.s === 'fallback' || state.s === 'plain') return state;
  switch (ev.e) {
    case 'fallback':
      return { s: 'fallback', reason: ev.reason };
    case 'plain':
      if (state.s !== 'rendering') return state;
      return ev.budgetMs === undefined ? { s: 'plain', why: ev.why } : { s: 'plain', why: ev.why, budgetMs: ev.budgetMs };
    case 'mount':
      return state.s === 'rendering' ? { s: 'mounting' } : state;
    case 'ready':
      return state.s === 'mounting' ? { s: 'ready' } : state;
  }
}
