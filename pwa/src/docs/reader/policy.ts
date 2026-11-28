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
import {
  READER_COPY_WRITE_MAX_BYTES, READER_DOC_KEY_MAX_UNITS, READER_LAB_DRAW_WATCHDOG_MS, READER_STORE_PREFIX,
} from '../../lib/readerLimits';
import { docLinkTarget } from '../docLinkTarget';
import type { DocLinkContextValue } from '../DocLink';
import { READER_LAYOUTS, docsVariantLayout, type DocSectionSlug, type ReaderLayout } from '../../../../shared/docs';
import type { ReaderHiddenChar } from './readerText';
import type { ReaderReading } from './readerMode';

/** The reader's layouts (X2 P5.1, D-8762): defined once, in `shared/docs.ts` (the page grammar's `?variant=` map names them too), and
 *  re-exported here so the mount's callers keep naming them from the policy. */
export { READER_LAYOUTS };
export type { ReaderLayout };

/** The layout a standalone `?variant=` name means (`AB`, `A`, `B`, `C`, `classic`; X2 P5.1), or `default` for anything else, `null`
 *  included. Reads the one map in `shared/docs.ts` (`docsVariantLayout`). */
export function layoutFromVariant(v: string | null): ReaderLayout {
  return v === null ? 'default' : docsVariantLayout(v) ?? 'default';
}

/** Whether `v` is a layout NAME (`default`, `classic`, `editorial`, `review`, `guided`), as the library's `prefs` object stores one:
 *  not a standalone `?variant=` name. */
function isReaderLayout(v: unknown): v is ReaderLayout {
  return typeof v === 'string' && (READER_LAYOUTS as readonly string[]).includes(v);
}

/** The prefs object the library keeps under the reader's `pref:prefs` key, as text parsed to a plain object, or `null` when the text is
 *  absent, does not parse, or is not a plain object. */
function prefsObject(raw: string | null): Record<string, unknown> | null {
  if (raw === null) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The device's layout from the stored prefs text (`ccrc:reader:v1:pref:prefs`, the library's own JSON object): its `layout` field when
 *  that is one of the five layout names, else `default` (absent, unparsable, not an object, or a name no build knows). */
export function readerLayoutOfPref(raw: string | null): ReaderLayout {
  const layout = prefsObject(raw)?.['layout'];
  return isReaderLayout(layout) ? layout : 'default';
}

/** The prefs text with `layout` set and every other field exactly as it was (the library owns the rest and keeps fields it does not
 *  know); unparsable or non-object text becomes `{"layout": …}` alone. */
export function withLayoutInPref(raw: string | null, layout: ReaderLayout): string {
  return JSON.stringify({ ...(prefsObject(raw) ?? {}), layout });
}

/** The storage key of the library's reader prefs object (`pref:prefs` under the reader's prefix): where the `layout` field lives, and
 *  the one key whose writes by the frame the storage port rewrites (`withStoredLayoutKept`). */
export const READER_PREFS_KEY = `${READER_STORE_PREFIX}pref:prefs`;

/** The prefs text a frame writes (`value`, its whole snapshot of the object) with the `layout` field as it stands in storage (`stored`,
 *  the text under the same key now), so the frame is never a writer of the field (`layoutPref.ts` is the only one, I1, I-3): the stored
 *  field is copied as it is, whatever its value; with none stored (absent, no field, not an object) the write carries none. Every other
 *  field of the write is kept as it came, in its order. A `value` that is no JSON object is nobody's prefs and is returned as it is,
 *  and so is one with no `layout` where none is stored. */
export function withStoredLayoutKept(value: string, stored: string | null): string {
  const next = prefsObject(value);
  if (next === null) return value;
  const kept = prefsObject(stored);
  if (kept !== null && 'layout' in kept) return JSON.stringify({ ...next, layout: kept['layout'] });
  if (!('layout' in next)) return value;
  const { layout: _dropped, ...rest } = next;
  return JSON.stringify(rest);
}

/** The layout a mount is made in: reader mode on for this document means `default` whatever the device, the visit or the page says
 *  (reader mode reads in the default layout, D-8975; this is X6.68's layout half); else the layout this page's reader chose from the
 *  Layout row (`chosen`, `null` for none), else the visit's (`?variant=`) when it names one, else the device's. */
export function readerMountLayout(
  i: { pref: ReaderLayout; visit: ReaderLayout | null; chosen: ReaderLayout | null; readingOn: boolean },
): ReaderLayout {
  if (i.readingOn) return 'default';
  return i.chosen ?? i.visit ?? i.pref;
}

/** A link as the host's classifier of the frame's href yields it (mirrors the library's host-link shape; nothing is
 *  imported from it). The frame's content is untrusted: `external` is re-derived from its `url` before it is used. */
export type ReaderLink =
  | { kind: 'fragment'; id: string }
  | { kind: 'relative'; path: string; fragment: string | null }
  | { kind: 'external'; url: string; scheme: 'http' | 'https' | 'mailto'; host: string };

/** What the host does with a link. `in-app`: navigate to a Docs page (`fragment` is the link's, for the visit to
 *  scroll to once that page renders). `hash`: move to an anchor in this page; `reopen` says whether the frame must be mounted
 *  again at that anchor: false for a `fragment` link (the frame scrolls to an anchor it finds by itself, and reports to the
 *  host only an `#id` it did not find), true for a `relative` link to this very page with a fragment (`this.md#sec`, which
 *  the frame sends to the host as a navigate and does not scroll). `sheet`: ask before opening a URL
 *  (`foreign`: its host is not the console's own). `inert`: nothing. */
export type ReaderRoute =
  | { kind: 'in-app'; href: string; fragment: string | null }
  | { kind: 'hash'; id: string; reopen: boolean }
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
 *  inert exactly as in the plain view; an external or GitHub resolution is a sheet. A `fragment` link is a `hash` with
 *  `reopen: false`; a `relative` link that `docLinkTarget` resolves to this very page with a fragment is a `hash` with
 *  `reopen: true`. */
export function routeReaderLink(ctx: DocLinkContextValue, link: ReaderLink, ownHost: string): ReaderRoute {
  switch (link.kind) {
    case 'fragment':
      return { kind: 'hash', id: link.id, reopen: false };
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
          return { kind: 'hash', id: target.fragment, reopen: true };
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
 *  Mermaid: `ready` waits for it neither on request (the W8a plan's refinement (c)) nor after `ready` (the library 1.1
 *  take-up plan, refinement (c)). */
export function readerWatchdogMs(bytes: number): number {
  return DOCS_PARSE_BUDGET_MS(bytes);
}

/** Who mounts (the reader lab plan, refinement (k)): no profile is the Docs reader; `lab-draw` is the reader lab's timed
 *  mount, and only the lab passes it. */
export type ReaderMountProfile = 'lab-draw';

/** What the reader lab's E17 `mermaid` line read (the take-up plan, refinement (b)), in the lab's own words for that
 *  line's three outcomes. Mirrors the lab's verdicts; nothing is imported from the lab. */
export type ReaderE17Reading = 'holds' | 'does-not-hold' | 'not-measured';

/** The reading this build's draw was decided on (the take-up plan, refinement (b)): every block the operator sent reads
 *  `holds` on its `mermaid` line, or one reads `does not hold`, or none was measured. Two blocks arrived (2026-11-06),
 *  both from the reader lab's `auto` mode on library build 0079625cc30a, and both are kept:
 *  block 1: "reader-lab 1 · Blink 156 · Android · 8 cores · worker yes · frame sandbox yes · csp attribute yes · library 0079625cc30a"
 *  and "mermaid            does not hold (longest gap 217 ms, all six together; worst single: figure 4, 150 ms)";
 *  block 2: "reader-lab 1 · Blink 156 · Android · 8 cores · worker yes · frame sandbox yes · csp attribute yes · library 0079625cc30a"
 *  and "mermaid            holds (ready; longest gap 192 ms, all six together; worst single: figure 5, 150 ms)".
 *  The failing block decides: a block that holds never replaces one that does not, and neither is averaged away. A new
 *  reading is an edit here, its pin in reader-policy.test.ts, and the rich-docs spec's E17 row. */
export const READER_E17_MERMAID: ReaderE17Reading = 'does-not-hold';

/** The Docs reader's draw for an E17 reading: on open, after `ready`, only when the line holds; otherwise on request, as
 *  W8a shipped it (the rich-docs spec's `reader-mermaid-on-tap`). */
export function docsDrawFor(e17: ReaderE17Reading): 'after-ready' | 'on-request' {
  return e17 === 'holds' ? 'after-ready' : 'on-request';
}

/** Whose bar a mount has (the take-up plan, refinement (g)): `frame-bar`, the reader frame's own; `host-bar`, ccrc's, with
 *  the frame's bar off, its top space trimmed and its progress reported. */
export type ReaderChrome = 'frame-bar' | 'host-bar';

/** A mount asks for ccrc's bar only at the compact width, read as the mount starts (refinement (f)). */
export function readerChromeFor(compactWidth: boolean): ReaderChrome {
  return compactWidth ? 'host-bar' : 'frame-bar';
}

/** How one mount draws, waits, stores, and whose bar it has. */
export interface ReaderMountPlan {
  readonly draw: 'auto' | 'on-request' | 'after-ready';
  readonly watchdogMs: number;
  /** Whether the mount is handed the reader's storage port. */
  readonly store: boolean;
  readonly chrome: ReaderChrome;
  /** Whether the mount carries the doc's history: the version seed's commits and day filter, and the `changes` and
   *  `openVersion` adapters (completion plan Task 12). The reader lab's mounts never do. */
  readonly history: boolean;
  readonly appearance: boolean;
}

/** What a mount asks of the frame for reader mode (X6 XR1.4 with XR2.1), beside its plan: kept apart from `ReaderMountPlan`, whose
 *  shape the existing pins hold whole. */
export interface ReaderMountAsks {
  /** Whether the mount asks the frame for `progress` (rich-docs §4.4, D-8805): every production mount, never the reader lab's.
   *  Asked on either bar: the frame's bar stays on a `frame-bar` mount, and ccrc's own bar and reader mode's activity read the share. */
  readonly progress: boolean;
  /** Whether the mount asks the frame for its `reader` acts (`onReader`, reader mode LX6.1): a Docs mount only. */
  readonly reader: boolean;
  /** The reading (reader mode's turn, or `off`) a mount made under is sent before its `ready`: each of ccrc's mounts is a new
   *  `DocFrame`, and the library replays a `setReading` only within one. `off` sends nothing: a fresh mount is off. */
  readonly reading: ReaderReading;
}

/** Reader mode's reading as the library's `setReading` takes it: screen pages, a plain scroll, or reader mode off. Mirrors
 *  the library's `ReadingMode`; nothing is imported from it. Defined once, in `readerMode.ts` (L1, where the turn lives);
 *  re-exported here so the mount's callers keep naming it from the policy. */
export type { ReaderReading };

/** The acts of the frame's `reader` op, as the library parses them (a closed set): the top band's `menu`, `exit`, `toggle`, and
 *  `active` (a sideways scroll or a figure's pan or zoom). Mirrors the library's `ReaderAct`; nothing is imported from it. */
export type ReaderAct = 'menu' | 'exit' | 'toggle' | 'active';

/** What a mount is made under, beyond who mounts: reader mode's state. Absent fields read `off`. */
export interface ReaderMountState {
  readonly reading?: ReaderReading;
}

/** The one decision: the Docs reader draws as the E17 reading says (`docsDrawFor`), waits `readerWatchdogMs(bytes)`, keeps
 *  reader state, carries the doc's history and has the bar it asked for; the reader lab's `lab-draw` draws on open in the library's `auto` mode
 *  (where `ready` waits for the figures, so the lab's gap window still times the draw: refinement (d)), waits
 *  READER_LAB_DRAW_WATCHDOG_MS, keeps nothing, carries no history and has the frame's own bar, whatever the reading and the bar asked for. */
export function readerMountPlan(
  profile: ReaderMountProfile | undefined, bytes: number, chrome: ReaderChrome, e17: ReaderE17Reading,
): ReaderMountPlan {
  return profile === 'lab-draw'
    ? { draw: 'auto', watchdogMs: READER_LAB_DRAW_WATCHDOG_MS, store: false, chrome: 'frame-bar', history: false, appearance: false }
    : { draw: docsDrawFor(e17), watchdogMs: readerWatchdogMs(bytes), store: true, chrome, history: true, appearance: true };
}

/** Reader mode's asks of one mount (`readerMountPlan` takes reader mode's state through this, X6 XR1.4): a Docs mount asks for
 *  progress on either bar and for the frame's reader acts, and is sent the reading it is made under (`state.reading`, absent
 *  `off`); the reader lab's `lab-draw` asks for none of them and is sent no reading, whatever the state says. */
export function readerMountAsks(profile: ReaderMountProfile | undefined, state: ReaderMountState = {}): ReaderMountAsks {
  return profile === 'lab-draw'
    ? { progress: false, reader: false, reading: 'off' }
    : { progress: true, reader: true, reading: state.reading ?? 'off' };
}

/** Hosted only when the contract, the mount plan and the caller all permit it. */
export function isHostedMount(plan: ReaderMountPlan, supported: boolean, hasRoot: boolean): boolean {
  return supported && plan.appearance && hasRoot;
}

/** Whether the library's mount focuses the frame as it inserts it (the completion plan's D-8729). The Docs reader yields
 *  to a host element that owns focus: it focuses the frame only when `hostOwnsFocus` is false, where `hostOwnsFocus` is
 *  the bridge's reading, taken as the mount starts, that a connected element outside the reader holds focus. The reader
 *  lab's `lab-draw` mount keeps its unconditional focus, whoever owns it. Explicit reader commands are not decided here:
 *  they focus the frame themselves. */
export function readerMountFocusFor(profile: ReaderMountProfile | undefined, hostOwnsFocus: boolean): boolean {
  return profile === 'lab-draw' ? true : !hostOwnsFocus;
}

/** The reader's tools a host may run without the frame's bar: the library's `DocFrame.command` names, held equal by
 *  reader-commands.test-d.ts (the quick jump, the reading settings, the contents drawer and a plan's Outline). */
export type ReaderCommand = 'jump' | 'settings' | 'contents' | 'outline';

const ONE_BAR_TOOLS: readonly ReaderCommand[] = ['jump', 'contents'];
const ONE_BAR_PLAN_TOOLS: readonly ReaderCommand[] = ['jump', 'contents', 'outline'];

/** The tools the one bar draws, in the frame's own bar's order (refinement (j)): the quick jump and the contents, and a
 *  plan's Outline on a plans leaf. The reading settings stay the frame's own button (question Q2). */
export function oneBarTools(section: DocSectionSlug): readonly ReaderCommand[] {
  return section === 'plans' ? ONE_BAR_PLAN_TOOLS : ONE_BAR_TOOLS;
}

/** The one bar's title (refinement (h)): the document's first level-1 heading as the library's render read it (the
 *  frame's own title), else the file name ccrc already shows. */
export function readerBarTitle(metaTitle: string | null, fileName: string): string {
  return metaTitle !== null && metaTitle.trim() !== '' ? metaTitle : fileName;
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
