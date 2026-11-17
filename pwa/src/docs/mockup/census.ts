// The mockup viewer's decisions (native Docs reader, completion plan Task 8, C2, review I2; base spec 2026-10-01 5.6.4's
// offer, 5.6.5's scripts, 5.6.6 and 5.6.7). Ring L1 policy: pure functions over rows, a parsed Document, a hostname and a
// route builder, with no React, no fetch, no timer and no DOM global of their own (a function may read the `Document` it is
// handed). `MockupView.tsx` (L4) only calls them and draws their answers, so the decisions are testable without a render:
//   - `pageHasScripts`: whether a script run would change the page (the Run scripts control and the "scripts off" badge);
//   - `originsOf`: which external origins Load external offers and which it refuses (the console's own host among them);
//   - `censusOf`, `censusCounts`, `hasConservativeAdmission`, `draftPinsOf`: one row per reference with its sentence, the
//     fold's two totals, the conservative-admission note and the draft count the screen's banner takes;
//   - `linksOf`: where each `a[href]` and `area[href]` of the page goes;
//   - `censusRefText`: a reference as shown (cut at `MOCKUP_CENSUS_REF_UNITS`, every non-ASCII character as `U+XXXX`);
//   - `capRows`: the rows a fold or an Export list of the assets left out draws (at most `MOCKUP_CENSUS_ROW_CAP`) and how
//     many more it does not list.
// The route of an in-app target is the caller's (`routeOf`): `docsLocation` stays the one builder of a Docs page location.
import { docsApi, resolveDocRef, type DocSectionSlug } from '../../../../shared/docs';
import { fillSentence, kib, MOCKUP_TEXT, MOCKUP_VERDICT_SENTENCE, mockupVerdictSentence } from '../docsText';
import type { MockupExtract } from './load';
import { parseMockupOrigin } from './origins';
import { MOCKUP_CENSUS_REF_UNITS, MOCKUP_CENSUS_ROW_CAP } from './policy';
import type { HttpsOrigin, MockupAssetRow } from './ports';

/** A reference as the census and the links list show it (base 5.6.7): cut at `MOCKUP_CENSUS_REF_UNITS` code units with
 *  "…", and every character outside printable ASCII as `U+XXXX`, so an author's text can neither run long nor pass for
 *  another character. */
export function censusRefText(raw: string): string {
  const cut = raw.length > MOCKUP_CENSUS_REF_UNITS ? raw.slice(0, MOCKUP_CENSUS_REF_UNITS) : raw;
  let out = '';
  for (const ch of cut) {
    const cp = ch.codePointAt(0) ?? 0;
    out += cp >= 0x20 && cp <= 0x7e ? ch : `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
  }
  return raw.length > MOCKUP_CENSUS_REF_UNITS ? `${out}…` : out;
}

/** Whether the parsed page has anything a script run would change (base 5.6.5): a `script` element, an `on*` attribute, a
 *  `javascript:` URL in `href`, `src`, `action` or `formaction`, or a `meta http-equiv=refresh`. */
export function pageHasScripts(doc: Document): boolean {
  if (doc.querySelector('script') !== null) return true;
  for (const el of doc.querySelectorAll('*')) {
    if (el.localName === 'meta' && (el.getAttribute('http-equiv') ?? '').trim().toLowerCase() === 'refresh') return true;
    for (const a of el.attributes) {
      const name = a.localName.toLowerCase();
      if (name.startsWith('on')) return true;
      if (name === 'href' || name === 'src' || name === 'action' || name === 'formaction') {
        // A browser drops tab, LF and CR anywhere in a URL and trims C0 controls and space at its ends.
        if (/^[\u0000- ]*javascript:/i.test(a.value.replace(/[\t\n\r]/g, ''))) return true;
      }
    }
  }
  return false;
}

/** The origins Load external lists: each distinct origin of an `external` row and of the script-text census that
 *  `parseMockupOrigin` accepts for this host, `src` origins first (plan order), then the rest in script order. A refused
 *  origin (this console's own host, an IP literal, `localhost`, anything not a plain https origin) is in `refused`. */
export interface Origins {
  readonly offered: readonly { readonly origin: HttpsOrigin; readonly scriptText: boolean }[];
  readonly refused: ReadonlySet<string>;
}

export function originsOf(rows: readonly MockupAssetRow[], scriptOrigins: readonly string[], host: string): Origins {
  const offered: { origin: HttpsOrigin; scriptText: boolean }[] = [];
  const refused = new Set<string>();
  const take = (raw: string, scriptText: boolean): void => {
    const o = parseMockupOrigin(raw, host);
    if (o === null) {
      refused.add(raw);
      return;
    }
    if (!offered.some((x) => x.origin === o)) offered.push({ origin: o, scriptText });
  };
  for (const row of rows) if (row.verdict.v === 'external') take(row.verdict.origin, false);
  for (const o of scriptOrigins) take(o, true);
  return { offered, refused };
}

/** One census row, ready to draw. `state` is what the fold's totals count; `href` is the in-app route of an in-section doc
 *  target (never of a missing one). */
export interface CensusRow {
  readonly key: string;
  readonly ref: string;
  readonly target: string | null;
  readonly href: string | null;
  readonly sentence: string;
  readonly hint: boolean;
  readonly size: string | null;
  readonly draft: boolean;
  readonly scriptText: boolean;
  readonly state: 'loaded' | 'kept' | 'not-loaded';
}

/** The in-app route of a doc target of the page's own project and ref: the caller's, so `docsLocation` stays the one builder. */
export type RouteOf = (section: DocSectionSlug, path: string) => string;

/** One row per reference, in this order: the plan's rows, the unsupported elements, the dropped `srcset` candidates, the
 *  origins named in script text. */
export function censusOf(
  rows: readonly MockupAssetRow[], extract: MockupExtract, scriptOrigins: readonly string[], origins: Origins, routeOf: RouteOf,
): CensusRow[] {
  const out: CensusRow[] = [];
  for (const row of rows) {
    const v = row.verdict;
    let target: string | null = null;
    let doc: { section: DocSectionSlug; path: string } | null = null;
    if (v.v === 'inline') {
      doc = { section: v.pin.section, path: v.pin.path };
    } else if (v.v === 'external') {
      target = v.origin;
    } else {
      const slash = row.ref.basePath.indexOf('/');
      const r = resolveDocRef({ section: row.ref.basePath.slice(0, slash) as DocSectionSlug, path: row.ref.basePath.slice(slash + 1) }, row.ref.raw);
      if (r.kind === 'doc') doc = { section: r.section, path: r.path };
      else if (r.kind === 'repo') target = r.repoPath;
    }
    if (doc !== null) target = `${doc.section}/${doc.path}`;
    const offered = v.v === 'external' && origins.offered.some((o) => o.origin === v.origin);
    const size = row.size === null ? null
      : row.size.kind === 'listed' ? kib(row.size.bytes) : fillSentence(MOCKUP_TEXT.upTo, { size: kib(row.size.bytes) });
    out.push({
      key: row.ref.key, ref: censusRefText(row.ref.raw), target,
      href: doc !== null && v.v !== 'missing' ? routeOf(doc.section, doc.path) : null,
      sentence: mockupVerdictSentence(v, offered), hint: offered, size,
      draft: v.v === 'inline' && v.draft, scriptText: false,
      state: v.v === 'inline' ? 'loaded' : v.v === 'kept' ? 'kept' : 'not-loaded',
    });
  }
  for (const u of extract.unsupported) {
    out.push({
      key: u.key, ref: censusRefText(`<${u.element}>`), target: null, href: null,
      sentence: MOCKUP_VERDICT_SENTENCE.unsupported.element, hint: false, size: null, draft: false,
      scriptText: false, state: 'not-loaded',
    });
  }
  extract.dropped.forEach((d, i) => {
    out.push({
      key: `d${i}`, ref: censusRefText(d.text), target: null, href: null, sentence: MOCKUP_VERDICT_SENTENCE.dropped,
      hint: false, size: null, draft: false, scriptText: false, state: 'not-loaded',
    });
  });
  scriptOrigins.forEach((o, i) => {
    const offered = origins.offered.some((x) => x.origin === o);
    out.push({
      key: `s${i}`, ref: censusRefText(o), target: o, href: null,
      sentence: offered ? MOCKUP_VERDICT_SENTENCE.external : MOCKUP_VERDICT_SENTENCE.refusedOrigin, hint: offered, size: null,
      draft: false, scriptText: true, state: 'not-loaded',
    });
  });
  return out;
}

/** The fold summary's two totals: the rows loaded into the page, and the rows neither loaded nor kept as written. */
export function censusCounts(rows: readonly CensusRow[]): { readonly loaded: number; readonly notLoaded: number } {
  return {
    loaded: rows.filter((r) => r.state === 'loaded').length,
    notLoaded: rows.filter((r) => r.state === 'not-loaded').length,
  };
}

/** Whether the conservative-admission note shows (base 5.6.3, D-8659): some reservation is the class cap AND some row was
 *  kept out for lack of room, so the cap's room may have crowded it out. */
export function hasConservativeAdmission(rows: readonly MockupAssetRow[]): boolean {
  return rows.some((r) => r.size !== null && r.size.kind === 'class-cap')
    && rows.some((r) => r.verdict.v === 'skipped' && r.verdict.why === 'over-budget');
}

/** The distinct draft pins the build inlined (by their API URL), which the screen's banner counts. */
export function draftPinsOf(rows: readonly MockupAssetRow[], project: string): number {
  const pins = new Set<string>();
  for (const row of rows) if (row.verdict.v === 'inline' && row.verdict.draft) pins.add(docsApi.file(project, row.verdict.pin));
  return pins.size;
}

/** The rows a capped list draws (an on-screen fold, and the Export sheet's and the saved file's list of the assets left
 *  out, D-8712): at most `MOCKUP_CENSUS_ROW_CAP`, the first ones in order, and how many more it does not list. Totals (a
 *  fold's summary) are counted over the whole list, never over `shown`. */
export function capRows<T>(rows: readonly T[]): { readonly shown: readonly T[]; readonly more: number } {
  if (rows.length <= MOCKUP_CENSUS_ROW_CAP) return { shown: rows, more: 0 };
  return { shown: rows.slice(0, MOCKUP_CENSUS_ROW_CAP), more: rows.length - MOCKUP_CENSUS_ROW_CAP };
}

/** One link of the page for the links list: where the pure resolver says it goes. */
export type PageLink =
  | { readonly kind: 'doc'; readonly text: string; readonly href: string }
  | { readonly kind: 'external'; readonly text: string; readonly url: string }
  | { readonly kind: 'text'; readonly text: string };

/** Each `a[href]` and `area[href]` of the page, in document order: a doc of the console (other than this page itself) is an
 *  in-app route, an http(s) URL is external, and anything else (a fragment, `mailto:`, a repo file, a malformed one, the page
 *  itself) is text. `page` is the leaf the references resolve from. */
export function linksOf(doc: Document, page: { readonly section: DocSectionSlug; readonly path: string }, routeOf: RouteOf): PageLink[] {
  const out: PageLink[] = [];
  for (const el of doc.querySelectorAll('a[href], area[href]')) {
    const raw = el.getAttribute('href') ?? '';
    const text = censusRefText(raw);
    const r = resolveDocRef({ section: page.section, path: page.path }, raw);
    if (r.kind === 'doc' && !(r.section === page.section && r.path === page.path)) {
      out.push({ kind: 'doc', text, href: routeOf(r.section, r.path) });
    } else if (r.kind === 'external' && (r.scheme === 'http' || r.scheme === 'https')) {
      out.push({ kind: 'external', text, url: r.url });
    } else {
      out.push({ kind: 'text', text });
    }
  }
  return out;
}
