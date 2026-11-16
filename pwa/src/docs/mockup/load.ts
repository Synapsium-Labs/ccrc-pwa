// The mockup's DOM extractor, reader adapter and loader (native Docs reader, completion plan Task 7, C1; base spec
// 2026-10-01 5.6.2 step 6, 5.6.3's element table, Budgets and Loader bullets as amended for D-8659 and D-8660). This
// file holds the DOM extractor and the reader adapter, which are ADAPTERS (ring L3): neither is a claim that DOM code is
// pure policy. The pure parts live beside it: the planner (`plan.ts`, L1) decides what each reference becomes, the CSS
// scan (`css.ts`, L1) finds a stylesheet's references, the policy and origins (`policy.ts`, `origins.ts`, L1) hold the
// limits and the CSP. This file decides nothing about admission: it reads exactly the pins the plan admitted, through
// the screen's own Docs loaders and per-screen queue (no HTTP client of its own), and folds what comes back into the
// plan's rows. It never relists, retries or replans (D-8660): a pin-movement word is just that row's `failed` word, and
// the one whole-view relist and replan is the viewer's, as a new attempt with a new context and a new budget.
//
//   extractMockupRefs   the parsed Document's references in DOM order (the table), plus what it cannot carry
//   mockupAssetReader   one pin through `loaders.raster` or `loaders.file`, a failure word kept whole
//   loadMockupAssets    the admitted pins read once each, two at a time, nested CSS fed to the planner in a fixed order
//   buildMockupSrcdoc   the page's bytes for the frame: CSP meta, click guard, doctype, the rewritten clone
import {
  DOCS_CLASS_CAP, contentClass, docsApi, resolveDocRef, type DocPin, type DocSectionSlug,
} from '../../../../shared/docs';
import type { DocsLoaders, DocsNotOk } from '../failures';
import { DOCS_PWA_FETCH_CONCURRENCY, type FetchQueue } from '../fetchQueue';
import { showBytes } from '../objectUrls';
import { refsFromTokens, rewriteCss, rewriteCssBytes, scanCss, scanCssBytesRefs } from './css';
import { extendMockupAssetPlan } from './plan';
import {
  MOCKUP_CLICK_GUARD, MOCKUP_MAX_CSS_DEPTH, MOCKUP_MAX_SRCDOC_CHARS, metaFor, mockupCsp, type MockupAssetKind,
} from './policy';
import type {
  HttpsOrigin, MockupAssetPlan, MockupAssetReader, MockupAssetResult, MockupAssetRow, MockupBase, MockupReadAnswer, MockupRef,
} from './ports';

// ---------------------------------------------------------------------------------------------------------------
// The DOM extractor
// ---------------------------------------------------------------------------------------------------------------
const HTML_NS = 'http://www.w3.org/1999/xhtml';
const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

/** What `extractMockupRefs` found. `refs` are in DOM order, then text order inside a style, with deterministic keys; the
 *  unsupported elements are the viewer's census (`{key, element}`), never references; `scriptTexts` is each inline
 *  script's text, for `scriptTextOrigins`; `dropped` lists the `srcset` candidates that failed to parse. `apply` writes a
 *  `data:` URL (or any value) at each named reference's own site in the Document the extraction read, and touches
 *  nothing else. */
export interface MockupExtract {
  readonly refs: readonly MockupRef[];
  readonly unsupported: readonly { readonly key: string; readonly element: string }[];
  readonly scriptTexts: readonly string[];
  readonly dropped: readonly { readonly element: string; readonly text: string }[];
  apply(replacements: ReadonlyMap<string, string>): void;
}

const isAsciiSpace = (c: number): boolean => c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d || c === 0x0c;

interface SrcsetCandidate { readonly start: number; readonly end: number; readonly url: string }

/** The candidates of a `srcset` value (the HTML parsing rules, in one pass): each URL is a run of non-space characters
 *  (a comma inside it stays), trailing commas are stripped, and the descriptors after it run to the next comma outside
 *  parentheses. A candidate whose descriptors are not a width, a density or a height is dropped and listed. */
function parseSrcset(text: string): { candidates: SrcsetCandidate[]; dropped: string[] } {
  const candidates: SrcsetCandidate[] = [];
  const dropped: string[] = [];
  const n = text.length;
  let i = 0;
  for (;;) {
    while (i < n && (isAsciiSpace(text.charCodeAt(i)) || text.charCodeAt(i) === 0x2c)) i += 1;
    if (i >= n) break;
    const start = i;
    while (i < n && !isAsciiSpace(text.charCodeAt(i))) i += 1;
    let end = i;
    if (text.charCodeAt(end - 1) === 0x2c) {
      while (end > start && text.charCodeAt(end - 1) === 0x2c) end -= 1;
      if (end > start) candidates.push({ start, end, url: text.slice(start, end) });
      continue;
    }
    let depth = 0;
    let j = i;
    while (j < n) {
      const c = text.charCodeAt(j);
      if (c === 0x28) depth += 1;
      else if (c === 0x29) depth -= 1;
      else if (c === 0x2c && depth <= 0) break;
      j += 1;
    }
    const descriptors = text.slice(i, j).trim();
    if (descriptors === '' || /^\d+(?:\.\d+)?[xwh](?:\s+\d+(?:\.\d+)?[xwh])?$/.test(descriptors)) {
      candidates.push({ start, end, url: text.slice(start, end) });
    } else {
      dropped.push(text.slice(start, j).trim());
    }
    i = j;
  }
  return { candidates, dropped };
}

/** The page's references in DOM order (base 5.6.3's element table), without adopting a node into the live document: it
 *  only reads `doc`, and `apply` writes only into that same `doc`. Keys are `r<n>` in discovery order, so the same page
 *  gives the same keys, a clone of it too. `a` and `area` are never references. */
export function extractMockupRefs(doc: Document, page: MockupBase): MockupExtract {
  const refs: MockupRef[] = [];
  const unsupported: { key: string; element: string }[] = [];
  const scriptTexts: string[] = [];
  const dropped: { element: string; text: string }[] = [];
  const writers: Array<(r: ReadonlyMap<string, string>) => void> = [];
  let seq = 0;
  const add = (raw: string, kind: MockupAssetKind): string => {
    const key = `r${seq}`;
    seq += 1;
    refs.push({ key, raw, basePath: page, kind, depth: 0 });
    return key;
  };
  const refuse = (element: string): void => {
    unsupported.push({ key: `u${unsupported.length}`, element });
  };
  /** A whole attribute is the reference. */
  const attrRef = (attr: Attr | null, kind: MockupAssetKind): void => {
    if (attr === null) return;
    const key = add(attr.value, kind);
    writers.push((r) => {
      const v = r.get(key);
      if (v !== undefined) attr.value = v;
    });
  };
  const srcsetRefs = (attr: Attr | null, label: string): void => {
    if (attr === null) return;
    const original = attr.value;
    const { candidates, dropped: bad } = parseSrcset(original);
    for (const text of bad) dropped.push({ element: label, text });
    const keys = candidates.map((c) => add(c.url, 'image'));
    writers.push((r) => {
      let out = '';
      let at = 0;
      let changed = false;
      candidates.forEach((c, i) => {
        const v = r.get(keys[i]!);
        if (v === undefined) return;
        out += original.slice(at, c.start) + v;
        at = c.end;
        changed = true;
      });
      if (changed) attr.value = out + original.slice(at);
    });
  };
  /** CSS text (a style element's, or a style attribute's) is scanned at depth 0 relative to the page. */
  const cssText = (text: string, write: (v: string) => void): void => {
    const tokens = scanCss(text);
    if (tokens.length === 0) return;
    const keys: string[] = [];
    const made = refsFromTokens(tokens, page, 0, () => {
      const key = `r${seq}`;
      seq += 1;
      keys.push(key);
      return key;
    });
    refs.push(...made);
    writers.push((r) => {
      const out = rewriteCss(text, tokens, (i) => r.get(keys[i]!) ?? null);
      if (out !== text) write(out);
    });
  };

  for (const el of doc.querySelectorAll('*')) {
    const name = el.localName;
    if (el.namespaceURI === SVG_NS) {
      if (name === 'image' || name === 'feImage') {
        attrRef(el.getAttributeNode('href'), 'image');
        attrRef(el.getAttributeNodeNS(XLINK_NS, 'href'), 'image');
      } else if (name === 'style') {
        cssText(el.textContent ?? '', (v) => { el.textContent = v; });
      } else if (name === 'script') {
        scriptTexts.push(el.textContent ?? '');
      }
    } else if (el.namespaceURI === HTML_NS) {
      const attr = (n: string): Attr | null => el.getAttributeNode(n);
      switch (name) {
        case 'img':
          attrRef(attr('src'), 'image');
          srcsetRefs(attr('srcset'), 'img[srcset]');
          break;
        case 'source':
          if (el.parentElement?.localName === 'picture') srcsetRefs(attr('srcset'), 'source[srcset]');
          else if (attr('src') !== null) refuse('source[src]');
          break;
        case 'video':
          attrRef(attr('poster'), 'image');
          if (attr('src') !== null) refuse('video[src]');
          break;
        case 'audio':
        case 'track':
          if (attr('src') !== null) refuse(`${name}[src]`);
          break;
        case 'input':
          if ((attr('type')?.value ?? '').trim().toLowerCase() === 'image') attrRef(attr('src'), 'image');
          break;
        case 'link': {
          const rel = (attr('rel')?.value ?? '').toLowerCase().split(/[\t\n\f\r ]+/);
          if (rel.includes('stylesheet')) attrRef(attr('href'), 'css');
          else refuse('link');
          break;
        }
        case 'script': {
          const type = (attr('type')?.value ?? '').trim().toLowerCase();
          if (type === 'importmap') refuse('script[type=importmap]');
          else if (attr('src') !== null) attrRef(attr('src'), type === 'module' ? 'module' : 'script');
          else scriptTexts.push(el.textContent ?? '');
          break;
        }
        case 'style':
          cssText(el.textContent ?? '', (v) => { el.textContent = v; });
          break;
        case 'iframe':
        case 'frame':
        case 'object':
        case 'embed':
        case 'base':
          refuse(name);
          break;
        case 'form':
          if (attr('action') !== null) refuse('form[action]');
          break;
        case 'meta':
          if ((attr('http-equiv')?.value ?? '').trim().toLowerCase() === 'refresh') refuse('meta[http-equiv=refresh]');
          break;
        default:
          break;
      }
    }
    const style = el.getAttributeNode('style');
    if (style !== null) cssText(style.value, (v) => { style.value = v; });
  }
  return {
    refs, unsupported, scriptTexts, dropped,
    apply(replacements) {
      for (const write of writers) write(replacements);
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The reader adapter
// ---------------------------------------------------------------------------------------------------------------
/** A not-ok answer as the failure word the Docs loaders gave: a docs failure body's `failure`, else the client slot's
 *  word (`auth` for a 401, `unreachable`, `no-docs-route`, `unexpected-response`). Whole: never folded into `missing`. */
const failureWord = (a: DocsNotOk): string => (a.s === 'failed' ? a.body.failure : a.s);

/** The loader's port over the existing Docs loaders and the screen's queue. A raster path reads through
 *  `loaders.raster`, every other through `loaders.file` with `showBytes`; each read is one queued job and one loader
 *  call, with the queue's own signal. It never relists, retries or replans, and holds no admission policy. */
export function mockupAssetReader(
  project: string, loaders: Pick<DocsLoaders, 'file' | 'raster'>, queue: FetchQueue,
): MockupAssetReader {
  return {
    read: (pin, signal) => queue.run(async (jobSignal): Promise<MockupReadAnswer> => {
      if (contentClass(pin.path) === 'raster') {
        const a = await loaders.raster(project, pin, jobSignal);
        return a.s === 'ok' ? { kind: 'ok', bytes: a.value.bytes } : { kind: 'failed', failure: failureWord(a) };
      }
      const a = await loaders.file(project, pin, jobSignal);
      if (a.s !== 'ok') return { kind: 'failed', failure: failureWord(a) };
      const bytes = showBytes(a.value.show);
      return bytes === null ? { kind: 'failed', failure: 'malformed-answer' } : { kind: 'ok', bytes };
    }, signal),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The loader
// ---------------------------------------------------------------------------------------------------------------
/** The identity of the file a reference reads: its resolved `<section>/<path>`. Within one attempt's context a path has
 *  exactly one pin, so this is the planner's own dedupe identity without asking the pin rule again. An admitted row's
 *  reference always resolves to a docs file. */
function unitKeyOf(ref: MockupRef): string {
  const slash = ref.basePath.indexOf('/');
  const r = resolveDocRef({ section: ref.basePath.slice(0, slash) as DocSectionSlug, path: ref.basePath.slice(slash + 1) }, ref.raw);
  if (r.kind !== 'doc') throw new Error(`mockup loader: '${ref.raw}' is not a docs file`);
  return `${r.section}/${r.path}`;
}

/** One admitted pin, read once: `limit` is the most bytes its reply may hold (its reservation, and never past its
 *  class cap). */
interface Unit {
  readonly key: string;
  readonly pin: DocPin;
  readonly ref: MockupRef;
  readonly kind: MockupAssetKind;
  readonly mime: string;
  readonly limit: number;
  done: boolean;
}

/** Reads each admitted unique pin of `plan` once, at most `DOCS_PWA_FETCH_CONCURRENCY` in flight, in row order, and
 *  returns the plan with its failures kept as rows. A completed stylesheet's references (the real `scanCssRefs`) are
 *  fed to `extendMockupAssetPlan` in DETERMINISTIC order: parents in row order, each parent's references in token
 *  order, a parent that completes early held until every earlier parent has been fed, never in reply-completion order.
 *  Newly admitted rows are read in turn. Reservations never shrink: a smaller reply, a failed read and a duplicate
 *  return nothing to the budget. A reply longer than its limit is `failed` `size-mismatch` and never in `assets`;
 *  `actualBytes` adds every completed unique reply, a refused overflow included. A duplicate pin (root and CSS, failed
 *  or not) is read once. On `signal` abort it starts no further read and rejects with the signal's reason. It never
 *  relists, retries or replans (D-8660): a moved or unknown-commit word is just that row's failure. */
export function loadMockupAssets(plan: MockupAssetPlan, reader: MockupAssetReader, signal: AbortSignal): Promise<MockupAssetResult> {
  if (signal.aborted) return Promise.reject(signal.reason);
  const project = plan.context.project;
  let current = plan;
  const units: Unit[] = [];
  const byKey = new Map<string, Unit>();
  const cssUnits: Unit[] = [];
  const sheets = new Map<Unit, Uint8Array<ArrayBuffer>>();
  const assets = new Map<string, { mime: string; bytes: Uint8Array<ArrayBuffer> }>();
  const failed = new Map<string, string>();
  let actualBytes = 0;
  let seen = 0;

  /** New units from the rows added since the last look: the first admitted row of each file defines it. */
  const absorb = (): void => {
    for (; seen < current.rows.length; seen += 1) {
      const row = current.rows[seen]!;
      if (row.verdict.v !== 'inline' || row.size === null) continue;
      const key = unitKeyOf(row.ref);
      if (byKey.has(key)) continue;
      const unit: Unit = {
        key, pin: row.verdict.pin, ref: row.ref, kind: row.verdict.kind, mime: row.verdict.mime,
        limit: Math.min(row.size.bytes, DOCS_CLASS_CAP[contentClass(row.verdict.pin.path)]), done: false,
      };
      byKey.set(key, unit);
      units.push(unit);
      if (unit.kind === 'css') cssUnits.push(unit);
    }
  };
  try {
    absorb();
  } catch (err) {
    return Promise.reject(err);
  }

  return new Promise<MockupAssetResult>((resolve, reject) => {
    let next = 0;
    let inflight = 0;
    let cursor = 0;
    let over = false;
    const onAbort = (): void => stop(signal.reason);
    const stop = (err: unknown): void => {
      if (over) return;
      over = true;
      signal.removeEventListener('abort', onAbort);
      reject(err);
    };
    signal.addEventListener('abort', onAbort, { once: true });

    /** Feeds each completed stylesheet's references to the plan, in parent row order. */
    const feed = (): void => {
      while (cursor < cssUnits.length && cssUnits[cursor]!.done) {
        const bytes = sheets.get(cssUnits[cursor]!);
        const parent = cssUnits[cursor]!;
        cursor += 1;
        if (bytes === undefined) continue;
        const { refs } = scanCssBytesRefs(bytes, parent.ref);
        if (refs.length === 0) continue;
        current = extendMockupAssetPlan(current, refs);
        absorb();
      }
    };

    const settle = (unit: Unit, answer: MockupReadAnswer): void => {
      unit.done = true;
      if (answer.kind === 'failed') {
        failed.set(unit.key, answer.failure);
        return;
      }
      actualBytes += answer.bytes.byteLength;
      if (answer.bytes.byteLength > unit.limit) {
        failed.set(unit.key, 'size-mismatch');
        return;
      }
      assets.set(docsApi.file(project, unit.pin), { mime: unit.mime, bytes: answer.bytes });
      if (unit.kind === 'css') sheets.set(unit, answer.bytes);
    };

    const finish = (): void => {
      const rows: MockupAssetRow[] = current.rows.map((row) => {
        if (row.verdict.v !== 'inline' || row.size === null) return row;
        const failure = failed.get(unitKeyOf(row.ref));
        return failure === undefined ? row : { ...row, verdict: { v: 'failed', failure } };
      });
      over = true;
      signal.removeEventListener('abort', onAbort);
      resolve({ plan: { ...current, rows }, actualBytes, assets });
    };

    const start = (unit: Unit): void => {
      inflight += 1;
      let pending: Promise<MockupReadAnswer>;
      try {
        pending = reader.read(unit.pin, signal);
      } catch (err) {
        inflight -= 1;
        stop(err);
        return;
      }
      pending.then((answer) => {
        inflight -= 1;
        if (over) return;
        settle(unit, answer);
        pump();
      }, (err: unknown) => {
        inflight -= 1;
        stop(err);
      });
    };

    const pump = (): void => {
      if (over) return;
      try {
        feed();
        while (!over && !signal.aborted && inflight < DOCS_PWA_FETCH_CONCURRENCY && next < units.length) {
          start(units[next]!);
          next += 1;
        }
        if (!over && inflight === 0 && next >= units.length && cursor >= cssUnits.length) finish();
      } catch (err) {
        stop(err);
      }
    };
    pump();
  });
}

// ---------------------------------------------------------------------------------------------------------------
// The srcdoc build
// ---------------------------------------------------------------------------------------------------------------
/** Bytes as base64, in chunks small enough to spread into `String.fromCharCode` (`DocImage` keeps its own private copy
 *  of this loop; it is not exported from there). */
function base64Of(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** What the build answers: the page, with the plan as the output cap and the depth limit left it, or a refusal when the page alone is over the
 *  cap. `plan` is `assets.plan` with the same context object and `reservedBytes`; a use the cap kept out has its verdict
 *  replaced by `skipped:'over-budget'` with its size basis kept (it was admitted). On a refusal there is no page at all:
 *  `chars` is the length the page has with every reference as written, `cap` is `MOCKUP_MAX_SRCDOC_CHARS`, and every
 *  loaded use is skipped (D-8662).
 *
 *  THE RULE, once: after the build every loaded row agrees with the page. `inline` means its `data:` URL is in the page at
 *  least once. `skipped:'over-budget'` means the cut kept it out. `unsupported:'css-depth'` means no use within
 *  `MOCKUP_MAX_CSS_DEPTH` reached it (a file first met shallow and also deep: the deep reference stays as written). The
 *  cut's word is applied first; the depth word goes to the rows the cut did not touch. Each keeps its size basis. */
export type MockupBuild =
  | { readonly ok: true; readonly page: string; readonly plan: MockupAssetPlan }
  | { readonly ok: false; readonly why: 'too-large'; readonly chars: number; readonly cap: number; readonly plan: MockupAssetPlan };

/** A row whose verdict is `inline`. */
type InlineRow = MockupAssetRow & { readonly verdict: Extract<MockupAssetRow['verdict'], { v: 'inline' }> };

/** `plan` with each loaded row whose key is in `skipped` turned to `skipped:'over-budget'` and each whose key is in
 *  `tooDeep` turned to `unsupported:'css-depth'`, a size basis kept in both (the row was admitted); the context and
 *  `reservedBytes` are the plan's own. */
function withVerdicts(plan: MockupAssetPlan, skipped: ReadonlySet<string>, tooDeep: ReadonlySet<string>): MockupAssetPlan {
  const rows = plan.rows.map((row): MockupAssetRow => {
    if (row.verdict.v !== 'inline') return row;
    if (skipped.has(row.ref.key)) return { ...row, verdict: { v: 'skipped', why: 'over-budget' } };
    return tooDeep.has(row.ref.key) ? { ...row, verdict: { v: 'unsupported', why: 'css-depth' } } : row;
  });
  return { ...plan, rows };
}

/** The page's bytes for the frame (base 5.6.2 step 6): `metaFor(csp)`, then the click guard, then the doctype, then
 *  the document's own markup. It clones `doc` (never mutated), re-runs the extractor on the clone to find each
 *  reference's site by key, replaces each inline asset's reference with `data:<table MIME>;base64,...`, and leaves
 *  every other reference untouched: the CSP is the wall. The MIME is the row's, from the extension table, never a
 *  response's. The bytes do not depend on `scripted`: the sandbox carries the mode (base 5.6.5), so the parameter is
 *  read nowhere.
 *
 *  Three bounds hold the output. (1) NESTING: a stylesheet used at depth d inlines its own references only while
 *  d + 1 <= `MOCKUP_MAX_CSS_DEPTH`, d being the depth of THIS use down the chain from the page (not the depth the planner
 *  first met the file at), and a result built with every reference inlined is remembered by (file, depth). (2) THE CAP:
 *  the final string is never longer than `MOCKUP_MAX_SRCDOC_CHARS`, whatever grew it (repeated uses, nested re-encoding,
 *  attribute escaping). The page with nothing inlined is the starting length; uses are decided depth-first in document
 *  order, then each stylesheet's token order; a use costs the length of its `data:` URL less the reference text it
 *  replaces (never less than the true growth, because serialization only escapes more); a stylesheet's children are
 *  decided first, inside its own text, then the stylesheet's own URL (which already holds them) is decided as one use, so
 *  a child is never counted twice; THE CUT: uses are inlined while the output fits, and at the FIRST use that does not
 *  fit, that use and EVERY later use stay as written and their rows are `skipped:'over-budget'` (a stylesheet's
 *  references with it, unless an earlier use inlined them); nothing after the cut is tried, a smaller use included, and
 *  exactly the cap is admitted. A stylesheet is decided after its references, so one cut inside it cuts it too. Its
 *  cheapest possible URL is checked before any build, and its built URL is remembered by (file, depth). (3) A page that is over the cap with nothing inlined is refused, typed, with no page. */
export function buildMockupSrcdoc(
  doc: Document, assets: MockupAssetResult, extra: readonly HttpsOrigin[], scripted: boolean,
): MockupBuild {
  void scripted;
  const cap = MOCKUP_MAX_SRCDOC_CHARS;
  const head = metaFor(mockupCsp(extra)) + MOCKUP_CLICK_GUARD + '<!doctype html>';
  const { plan } = assets;
  const { section, path } = plan.context.pin;
  const clone = doc.cloneNode(true) as Document;
  const extract = extractMockupRefs(clone, `${section}/${path}`);
  const body = clone.documentElement.outerHTML;

  const rowByKey = new Map<string, MockupAssetRow>(plan.rows.map((r) => [r.ref.key, r]));
  const first = new Map<string, MockupAssetRow>();
  for (const row of plan.rows) {
    if (row.verdict.v !== 'inline' || row.size === null) continue;
    const key = unitKeyOf(row.ref);
    if (!first.has(key)) first.set(key, row);
  }
  const assetOf = (fileKey: string): { row: InlineRow; bytes: Uint8Array<ArrayBuffer> } | null => {
    const row = first.get(fileKey);
    if (row === undefined || row.verdict.v !== 'inline') return null;
    const asset = assets.assets.get(docsApi.file(plan.context.project, row.verdict.pin));
    return asset === undefined ? null : { row: row as InlineRow, bytes: asset.bytes };
  };

  // The page alone, every reference as written, against the cap: over it nothing can be built.
  const baseChars = head.length + body.length;
  if (baseChars > cap) {
    const loaded = new Set<string>();
    for (const row of plan.rows) if (row.verdict.v === 'inline' && assetOf(unitKeyOf(row.ref)) !== null) loaded.add(row.ref.key);
    return { ok: false, why: 'too-large', chars: baseChars, cap, plan: withVerdicts(plan, loaded, new Set()) };
  }

  let total = baseChars;
  let cut = false; // the first use that does not fit sets this: from then on nothing is inlined
  const log: string[] = []; // keys of the uses admitted, cut back when an enclosing stylesheet does not fit
  const skipped = new Set<string>();
  const plain = new Map<string, string>(); // a non-stylesheet file's data URL
  const full = new Map<string, string>(); // (file, depth) -> a stylesheet's URL, built with every reference inlined
  const below = new Map<string, string[]>(); // (file, depth) -> the keys of every reference under a stylesheet used there

  const urlLength = (mime: string, byteLength: number): number => `data:${mime};base64,`.length + 4 * Math.ceil(byteLength / 3);
  const dataUrl = (mime: string, bytes: Uint8Array): string => `data:${mime};base64,${base64Of(bytes)}`;
  const childRow = (r: MockupRef): MockupAssetRow | undefined => {
    const row = rowByKey.get(r.key);
    return row !== undefined && row.verdict.v === 'inline' && assetOf(unitKeyOf(row.ref)) !== null ? row : undefined;
  };
  /** The keys of every loaded reference below a stylesheet used at `depth`, to the depth the build nests to. */
  const keysBelow = (fileKey: string, depth: number): string[] => {
    const at = `${fileKey}@${depth}`;
    const known = below.get(at);
    if (known !== undefined) return known;
    const out: string[] = [];
    below.set(at, out);
    const loaded = assetOf(fileKey);
    if (loaded !== null && loaded.row.verdict.kind === 'css' && depth + 1 <= MOCKUP_MAX_CSS_DEPTH) {
      for (const ref of scanCssBytesRefs(loaded.bytes, loaded.row.ref).refs) {
        const child = childRow(ref);
        if (child !== undefined) out.push(child.ref.key, ...keysBelow(unitKeyOf(child.ref), depth + 1));
      }
    }
    return out;
  };
  /** THE CUT: this use does not fit, so it and every later use stay as written (a stylesheet's references with it). */
  const refuse = (key: string, fileKey: string, depth: number): null => {
    cut = true;
    skipped.add(key);
    for (const k of keysBelow(fileKey, depth)) skipped.add(k);
    return null;
  };

  /** One use of a file at nesting depth `depth`, replacing `refLen` characters: its `data:` URL, or null (as written). */
  const use = (row: MockupAssetRow, depth: number, refLen: number): string | null => {
    if (row.verdict.v !== 'inline') return null;
    const fileKey = unitKeyOf(row.ref);
    const loaded = assetOf(fileKey);
    if (loaded === null) return null;
    const key = row.ref.key;
    const { row: canon, bytes } = loaded;
    if (cut) return refuse(key, fileKey, depth);
    const admit = (url: string): string | null => {
      const cost = url.length - refLen;
      if (total + cost > cap) return refuse(key, fileKey, depth);
      total += cost;
      log.push(key);
      return url;
    };
    if (canon.verdict.kind !== 'css') {
      const url = plain.get(fileKey) ?? dataUrl(canon.verdict.mime, bytes);
      plain.set(fileKey, url);
      return admit(url);
    }
    const at = `${fileKey}@${depth}`;
    const known = full.get(at);
    if (known !== undefined) return admit(known);
    const nested = depth + 1 <= MOCKUP_MAX_CSS_DEPTH ? scanCssBytesRefs(bytes, canon.ref) : null;
    // The cheapest this sheet's URL can be: its own bytes, less every reference that could be replaced (a data URL may be
    // shorter than a long spelling of the reference), base64-encoded. If even that does not fit, it is the cut, with no build.
    let least = bytes.length;
    if (nested !== null) nested.tokens.forEach((t, i) => { if (childRow(nested.refs[i]!) !== undefined) least -= t.end - t.start; });
    if (total + urlLength(canon.verdict.mime, least) - refLen > cap) return refuse(key, fileKey, depth);
    const before = total;
    const logStart = log.length;
    let sheet = bytes;
    if (nested !== null) {
      // The references are decided first, inside this stylesheet's own text, each against what is left (their charges
      // are tentative: the sheet's own URL already holds them and is the one charge).
      const urls = nested.tokens.map((t, i): string | null => {
        const child = rowByKey.get(nested.refs[i]!.key);
        return child === undefined ? null : use(child, depth + 1, t.end - t.start);
      });
      sheet = rewriteCssBytes(bytes, nested.tokens, (i) => urls[i] ?? null);
    }
    // After the cut nothing is inlined, a stylesheet whose reference was cut included.
    const url = dataUrl(canon.verdict.mime, sheet);
    if (cut || before + url.length - refLen > cap) {
      log.length = logStart; // its references are no longer inlined (`refuse` skips every key below it)
      return refuse(key, fileKey, depth);
    }
    total = before + url.length - refLen;
    log.push(key);
    full.set(at, url);
    return url;
  };

  const replacements = new Map<string, string>();
  for (const ref of extract.refs) {
    const row = rowByKey.get(ref.key);
    if (row === undefined) continue;
    const url = use(row, 0, ref.raw.length);
    if (url !== null) replacements.set(ref.key, url);
  }
  extract.apply(replacements);
  // Every loaded row now agrees with the page. The cut's word first: a row it kept out is `skipped`. Then the depth word for
  // each row the cut did not touch and no use reached: it is in no `data:` URL of the page.
  const inlined = new Set(log);
  const cutKeys = new Set([...skipped].filter((k) => !inlined.has(k)));
  const tooDeep = new Set<string>();
  for (const row of plan.rows) {
    const k = row.ref.key;
    if (row.verdict.v === 'inline' && !inlined.has(k) && !cutKeys.has(k) && assetOf(unitKeyOf(row.ref)) !== null) tooDeep.add(k);
  }
  return { ok: true, page: head + clone.documentElement.outerHTML, plan: withVerdicts(plan, cutKeys, tooDeep) };
}
