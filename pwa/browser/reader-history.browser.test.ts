// The reader's history in a real browser (native Docs reader, completion plan Task 12 part C; the rich-docs spec's G5, G6 and
// M8.22, and Task 11's pin on the library's `removedAfter: 0`). The unit and type suites prove the deciders (`reader/history.ts`,
// `reader/diff.ts`) and the lifecycle (`readerHistory.ts`) on their own; these rows prove what Chrome DOES with them: the
// production PWA, the production `ReaderFrame` and bridge, and the ACTUAL shared Markdown library's frame (its "Changes
// since…" menu, its marks, its stepper, its day banner), with only `/api/docs/*` answered from fixtures. No host callback is
// faked: every `changes` and `openVersion` here is the one the frame calls on ccrc's own code.
//
// The fixture is project `demo`, section `specs`, and made-up commits. `doc.md` has three commits newest first, C3 (the
// listing's commit), C2 and C1, each the first parent of the one before; C1's parent C0 is NOT an entry (the oldest day's
// baseline), and doc.md does not exist at C0, as a complete path log implies (its oldest entry is the commit that first
// touched the path), so the server answers `absent-path` there. The three days are far apart, so the menu's quick ranges
// are empty and its rows are the day rows, newest first.
// A document in the library's sense needs one title and three sections (`isDocument`), so every text here has them, or the
// frame builds no menu at all.
//
// How the rows read marks: `readMarks` reads every block the frame carries a `data-line` on and the classes the marking put on
// them, and `expectedMarks` derives from the REAL `readerDiff` what the library's rule should mark (the innermost blocks that
// meet a range; the innermost blocks that end on the last line at or before a removal's line, none for 0), so a row never
// hard-codes a line the diff decides. Waits are on DOM conditions, bounded; "nothing happened" is read after an event that
// proves the call finished (the trigger's `on` class leaving), never after a sleep.
//
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts
// browser/reader-history.browser.test.ts )`, through `ccrc test`.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Frame, type Page } from 'playwright-core';
import { REFINED, SKIN_STORAGE_KEY, THEME_STORAGE_KEY } from '@ccrc/ui';
import { DOC_SECTION_SLUGS, DOCS_RESPONSE_HEADERS, docsApi } from '../../shared/docs';
import { EMPTY_DOCS_SETTINGS } from '../../shared/docsTracker';
import { READER_FALLBACK_NOTE } from '../src/docs/reader/readerText';
import { readerDiff, type ReaderDiff } from '../src/docs/reader/diff';
import { READER_SEED_DATE_MAX_UNITS, READER_SEED_MAX_COMMITS, READER_SEED_SUBJECT_MAX_UNITS } from '../src/docs/reader/history';
import { READER_ONLY_STATE_KEY } from '../src/docs/readerHistory';
import { READER_STORE_PREFIX } from '../src/lib/readerLimits';
import { FP_1, SERVED, draftOf, entry, holder, treeOk, treeResponse } from '../test/docsFixtures';
import { openApp, serveDist, sharedDist, type DistServer, type OpenedApp } from './app';
import { resolveChrome } from './harness';

// ---- the fixture: one project, a few docs, made-up commits -------------------------------------------------------------------

const PROJECT = 'demo';
const SECTION = DOC_SECTION_SLUGS[0]!;
const COOKIE = { name: 'ccrc_session', value: 'demo-session' } as const;
const hash = (twoHex: string): string => twoHex.repeat(20);
const C0 = hash('d0');
const C1 = hash('d1');
const C2 = hash('d2');
const C3 = hash('d3'); // the listing's commit: every doc's newest entry
const O1 = hash('e1'); // other.md's older commit
const T2 = hash('f2'); // trim.md's older commit
const E2 = hash('f3'); // empty.md's older commit
const isoAt = (day: number): string => new Date(Date.UTC(2026, 0, 10 + day, 12)).toISOString();

/** A text from its blocks, one blank line between them. */
const text = (blocks: readonly string[]): string => blocks.join('\n\n') + '\n';
const LINK = 'See [the other doc](./other.md).';
const DOC_C1 = ['# Doc', LINK, '## Alpha', 'Alpha text, revised.', '## Beta', 'Beta text.', '## Gamma', 'Gamma text.', '## Delta', 'Delta text.'];
const DOC_C2 = ['# Doc', LINK, '## Alpha', 'Alpha text, revised.', '## Beta', 'Beta text, revised.', '## Gamma', '## Delta', 'Delta text.'];
const DOC_C3 = ['# Doc', LINK, '## Alpha', 'Alpha text, revised.', '## Beta', 'Beta text, revised.', '## Gamma', '## Delta', 'Delta text, revised.', 'Epilogue.'];

const OTHER_O1 = ['# Other', '## One', 'One text.', '## Two', 'Two text.', '## Three', 'Three text.'];
const OTHER_C3 = ['# Other', '## One', 'One text, revised.', '## Two', 'Two text.', '## Three', 'Three text.'];

/** trim.md: the base starts with lines the head no longer has (the diff's `removedAfter` is [0]) and the head gains a paragraph. */
const TRIM_CORE = ['# Trim', '## One', 'Kept one.', '## Two', 'Kept two.', '## Three', 'Kept three.'];
const TRIM_C3 = [...TRIM_CORE.slice(0, 5), 'New paragraph.', ...TRIM_CORE.slice(5)];
const TRIM_T2 = ['Stale one.', 'Stale two.', ...TRIM_CORE];

const MANY_C3 = ['# Many', '## One', 'One.', '## Two', 'Two.', '## Three', 'Three.'];

interface LogCommit { readonly sha: string; readonly parent: string | null; readonly date: string; readonly subject: string }
interface FixtureDoc {
  /** Newest first. `commit`s past the end of the array are not entries. */
  readonly log: readonly (LogCommit | unknown)[];
  /** The text at each commit the fixture serves. */
  readonly texts: Readonly<Record<string, string>>;
  /** The commits the repository has where this path does not exist yet, which the server answers with `absent-path`. */
  readonly absentAt?: readonly string[];
}

const commit = (sha: string, parent: string | null, day: number, subject: string): LogCommit => ({ sha, parent, date: isoAt(day), subject });

/** A date of exactly `READER_SEED_DATE_MAX_UNITS` units that the frame can still read: an ISO time with a long fraction. */
const longDate = (day: number): string => {
  const head = new Date(Date.UTC(2026, 0, 1 + day, 12)).toISOString().slice(0, 19);
  return `${head}.${'0'.repeat(READER_SEED_DATE_MAX_UNITS - head.length - 2)}Z`;
};
const manySha = (i: number): string => (i === 0 ? C3 : 'b'.repeat(8) + i.toString(16).padStart(32, '0'));
const manyLog = (): unknown[] => {
  const out: unknown[] = [];
  for (let i = 0; i < READER_SEED_MAX_COMMITS; i += 1) {
    const subject = `Change ${i} `.padEnd(READER_SEED_SUBJECT_MAX_UNITS, 'w');
    out.push({ sha: manySha(i), parent: manySha(i + 1), date: longDate(READER_SEED_MAX_COMMITS - i), author: 'Author', subject });
  }
  // One past the cap, and malformed: the seed never reads it.
  out.push({ sha: 'not-a-hash' });
  return out;
};

const DOCS: Readonly<Record<string, FixtureDoc>> = {
  'doc.md': {
    log: [commit(C3, C2, 3, 'Epilogue'), commit(C2, C1, 2, 'Beta and Gamma'), commit(C1, C0, 1, 'Alpha')],
    texts: { [C1]: text(DOC_C1), [C2]: text(DOC_C2), [C3]: text(DOC_C3) },
    absentAt: [C0],
  },
  'other.md': {
    log: [commit(C3, O1, 3, 'Revise one'), commit(O1, null, 1, 'Start')],
    texts: { [O1]: text(OTHER_O1), [C3]: text(OTHER_C3) },
  },
  'trim.md': {
    log: [commit(C3, T2, 3, 'Trim'), commit(T2, null, 1, 'Start')],
    texts: { [T2]: text(TRIM_T2), [C3]: text(TRIM_C3) },
  },
  'empty.md': {
    log: [commit(C3, E2, 3, 'Empty it'), commit(E2, null, 1, 'Start')],
    texts: { [E2]: 'Gone.\n', [C3]: '' },
  },
  'many.md': { log: manyLog(), texts: { [C3]: text(MANY_C3) } },
};

const blobOf = (p: string): string => Buffer.from(p).toString('hex').padEnd(40, '0').slice(0, 40);
const enc = (s: string): Buffer => Buffer.from(s, 'utf8');

// ---- the browser, the built app --------------------------------------------------------------------------------------------

let browser: Browser;
let server: DistServer;

beforeAll(async () => {
  const executablePath = resolveChrome(); // throws on a box with no Chrome: red, never skipped
  const dist = sharedDist();
  server = await serveDist(dist);
  browser = await chromium.launch({ executablePath, headless: true });
}, 240_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

const sessions: OpenedApp[] = [];
afterEach(async () => {
  for (const s of sessions.splice(0)) await s.ctx.close();
});

// ---- one session: the app, the docs routes, what they saw ------------------------------------------------------------------

interface ApiHit { readonly verb: string; readonly q: Readonly<Record<string, string>> }

/** A read the fixture keeps unanswered until `release`, and settles `done` once it has answered (or the page dropped it). */
interface Hold { readonly release: () => void; readonly done: Promise<void> }

interface Session {
  readonly app: OpenedApp;
  readonly page: Page;
  readonly hits: ApiHit[];
  readonly logs: string[];
  /** `docPath@commit` of file reads that fail with a 404. */
  readonly failing: Set<string>;
  /** `docPath@commit` of file reads held. */
  readonly holds: Map<string, { readonly gate: Promise<void>; settle: () => void }>;
  hold(key: string): Hold;
  goto(path: string): Promise<void>;
}

interface SessionOptions {
  /** The doc.md entry is a draft overlay of its committed file (the page is opened with `?ref=`). */
  readonly draft?: boolean;
  /** An init script that makes `window.localStorage` throw on every access, after the app's own skin write. */
  readonly blockStorage?: boolean;
}

const JSON_TYPE = 'application/json; charset=utf-8';

async function openSession(opts: SessionOptions = {}): Promise<Session> {
  const app = await openApp(browser, { width: 1280, skin: REFINED, theme: 'light' }, { api: {}, fleetFrames: [] });
  sessions.push(app);
  const { ctx, page } = app;
  await ctx.addCookies([{ ...COOKIE, url: server.origin }]);
  if (opts.blockStorage === true) {
    await ctx.addInitScript(`(() => {
      const deny = () => { throw new DOMException('storage is blocked', 'SecurityError'); };
      Object.defineProperty(window, 'localStorage', { configurable: true, get: deny });
    })();`);
  }
  const hits: ApiHit[] = [];
  const logs: string[] = [];
  const failing = new Set<string>();
  const holds = new Map<string, { gate: Promise<void>; settle: () => void }>();
  const dones = new Map<string, () => void>();
  page.on('console', (m) => { logs.push(`${m.type()} ${m.text()}`); });
  const json = { ...DOCS_RESPONSE_HEADERS, 'content-type': JSON_TYPE };
  const fail = (failure: string, status = 404): { status: number; headers: Record<string, string>; body: Buffer } =>
    ({ status, headers: { 'content-type': JSON_TYPE }, body: enc(JSON.stringify({ ok: false, failure })) });
  await ctx.route((u) => u.pathname.startsWith('/api/docs/'), async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const q = Object.fromEntries(url.searchParams);
    const verb = url.pathname.split('/').pop() ?? '';
    hits.push({ verb, q });
    const doc = DOCS[q['path'] ?? ''];
    let answer: { status: number; headers: Record<string, string>; body: Buffer };
    if (url.pathname === docsApi.settings()) {
      answer = { status: 200, headers: json, body: enc(JSON.stringify({ ok: true, settings: EMPTY_DOCS_SETTINGS })) };
    } else if (verb === 'tree') {
      const entries = Object.entries(DOCS).map(([p, d]) => entry(SECTION, p, {
        committed: { kind: 'file', blob: blobOf(p), size: Buffer.byteLength(d.texts[C3] ?? '') },
        ...(opts.draft === true && p === 'doc.md' ? { draft: draftOf('modified') } : {}),
      }));
      const tree = treeOk({ commit: C3, entries, drafts: opts.draft === true ? holder(C3) : { state: 'none', branch: 'main', skipped: [] } });
      answer = { status: 200, headers: json, body: enc(JSON.stringify(treeResponse(tree))) };
    } else if (verb === 'history') {
      if (doc === undefined) answer = fail('not-a-file');
      else {
        const at = doc.log.findIndex((e) => (e as { sha?: string }).sha === q['commit']);
        const entries = doc.log.slice(at < 0 ? 0 : at).map((e) => ({ author: 'Author', ...(e as object) }));
        const log = { v: 1, verb: 'docs-log', ok: true, elapsedMs: 1, commit: q['commit'], section: q['section'], path: q['path'], entries, truncated: false };
        answer = { status: 200, headers: json, body: enc(JSON.stringify({ ok: true, log })) };
      }
    } else if (verb === 'file' && doc !== undefined) {
      const key = `${q['path']}@${q['commit'] ?? 'draft'}`;
      const held = holds.get(key);
      if (held !== undefined) await held.gate;
      const isDraft = q['fp'] !== undefined;
      const body = isDraft ? doc.texts[C3] : doc.texts[q['commit'] ?? ''];
      if (failing.has(key)) answer = fail('not-a-file');
      else if (body === undefined) answer = fail(doc.absentAt?.includes(q['commit'] ?? '') === true ? 'absent-path' : 'unknown-commit');
      else {
        const common = { v: 1, verb: 'docs-show', ok: true, elapsedMs: 3, section: SECTION, path: q['path'], size: Buffer.byteLength(body), encoding: 'utf8', text: body };
        const show = isDraft
          ? { ...common, source: 'draft', sha256: FP_1, worktree: '/repo/demo', branch: 'main', head: C3, fp: FP_1 }
          : { ...common, source: 'committed', sha256: blobOf(key).padEnd(64, '0'), commit: q['commit'], blob: blobOf(q['path'] ?? ''), onRef: 'contains' };
        answer = { status: 200, headers: json, body: enc(JSON.stringify({ ok: true, contentClass: 'markdown', from: 'ccd', show })) };
      }
      try {
        await route.fulfill(answer);
      } catch {
        // The page dropped the request (its body ended): nothing to answer.
      }
      dones.get(key)?.();
      return;
    } else {
      answer = fail('not-a-file');
    }
    await route.fulfill(answer);
  });
  const session: Session = {
    app, page, hits, logs, failing, holds,
    hold(key) {
      let release = (): void => undefined;
      const gate = new Promise<void>((r) => { release = r; });
      const done = new Promise<void>((r) => { dones.set(key, r); });
      holds.set(key, { gate, settle: release });
      return { release, done };
    },
    goto: async (p) => { await page.goto(server.origin + p, { waitUntil: 'load' }); },
  };
  return session;
}

const leaf = (name: string, query = ''): string => `/docs/${PROJECT}/${SECTION}/${name}${query}`;
const verbHits = (s: Session, verb: string, from = 0): ApiHit[] => s.hits.slice(from).filter((h) => h.verb === verb);

type Outcome = 'ready' | 'fallback' | 'timeout';

/** Waits for the reader to be up (a frame, and the "formatting" line gone) or to have fallen back to the plain view. */
async function settle(page: Page, ms = 90_000): Promise<Outcome> {
  try {
    const h = await page.waitForFunction((note) => {
      if ([...document.querySelectorAll('.doc-plain-note')].some((n) => n.textContent === note)) return 'fallback';
      return document.querySelector('.docs-reader iframe') && !document.querySelector('.doc-formatting') ? 'ready' : null;
    }, READER_FALLBACK_NOTE, { timeout: ms, polling: 100 });
    return (await h.jsonValue()) as Outcome;
  } catch {
    return 'timeout';
  }
}

async function readerFrame(page: Page): Promise<Frame> {
  const h = await page.locator('.docs-reader iframe').elementHandle({ timeout: 30_000 });
  const f = await h?.contentFrame();
  if (f === null || f === undefined) throw new Error('the reader iframe has no content frame');
  return f;
}

/** The reader's current frame once `selector` is in it. A move replaces the iframe, so a frame that was detached while
 *  waiting is looked up again, until the deadline. */
async function frameWith(page: Page, selector: string, ms = 60_000): Promise<Frame> {
  const deadline = Date.now() + ms;
  for (;;) {
    try {
      const f = await readerFrame(page);
      await f.waitForSelector(selector, { timeout: 3_000 });
      return f;
    } catch (e) {
      if (Date.now() > deadline) throw new Error(`no reader frame holding ${selector} in ${String(ms)} ms: ${String(e)}`);
    }
  }
}

/** The page opened and its frame up with the "Changes since…" trigger in it. */
async function openDoc(s: Session, name: string, query = ''): Promise<Frame> {
  await s.goto(leaf(name, query));
  expect(await settle(s.page), `${name} reader is up`).toBe('ready');
  return frameWith(s.page, 'button.chg-trig');
}

// ---- the frame's marks, and what the real diff says they should be -------------------------------------------------------

interface Block { readonly line: string; readonly parent: number }
interface FrameMarks {
  readonly blocks: readonly Block[];
  /** Indices into `blocks`. */
  readonly chg: readonly number[];
  readonly del: readonly number[];
  readonly navHidden: boolean;
  readonly what: string;
  readonly count: string;
}

const readMarks = (f: Frame): Promise<FrameMarks> => f.evaluate(() => {
  const els = [...document.querySelectorAll('[data-line]')].filter((e) => !e.hasAttribute('hidden'));
  const at = new Map<Element, number>();
  els.forEach((e, i) => at.set(e, i));
  const blocks = els.map((e) => {
    let p = e.parentElement;
    let parent = -1;
    while (p !== null) {
      const k = at.get(p);
      if (k !== undefined) { parent = k; break; }
      p = p.parentElement;
    }
    return { line: e.getAttribute('data-line') ?? '', parent };
  });
  const nav = document.querySelector('.chg-nav');
  return {
    blocks,
    chg: els.flatMap((e, i) => (e.classList.contains('chg') ? [i] : [])),
    del: els.flatMap((e, i) => (e.classList.contains('chg-del') ? [i] : [])),
    navHidden: nav === null || nav.hasAttribute('hidden'),
    what: nav?.querySelector('.what')?.textContent ?? '',
    count: nav?.querySelector('.cn')?.textContent ?? '',
  };
});

function lineSpan(line: string): [number, number] {
  const m = /^(\d+)(?:-(\d+))?$/.exec(line);
  if (m === null) throw new Error(`data-line ${line} is not a line or a span`);
  return [Number(m[1]), Number(m[2] ?? m[1])];
}

interface Expected { readonly chg: number[]; readonly del: number[]; readonly stops: number }

/** What the library's rule marks for `d` on `blocks` (the frame's `changes.ts`): the innermost blocks meeting each range; for each
 *  removal's line k the innermost blocks that end on the last line any block ends on at or before k (none for k 0); and the
 *  stepper's places, a range's blocks joined to the first place holding one of them, each removal's blocks a place of their own. */
function expectedMarks(blocks: readonly Block[], d: Extract<ReaderDiff, { kind: 'available' }>): Expected {
  const span = blocks.map((b) => lineSpan(b.line));
  const last = span.reduce((m, [, b]) => Math.max(m, b), 0);
  const clamp = (v: number): number => Math.min(v, last + 1);
  const inner = (hits: number[]): number[] => {
    const cover = new Set<number>();
    for (const h of hits) for (let p = blocks[h]!.parent; p >= 0 && !cover.has(p); p = blocks[p]!.parent) cover.add(p);
    return hits.filter((h) => !cover.has(h)).sort((x, y) => x - y);
  };
  const changed = new Set<number>();
  const stops: number[][] = [];
  const stopOf = new Map<number, number>();
  for (const [x0, y0] of d.ranges) {
    const [x, y] = [clamp(x0), clamp(y0)];
    const ns = inner(span.flatMap(([a, b], i) => (a <= y && b >= x ? [i] : [])));
    if (ns.length === 0) continue;
    let j = -1;
    for (const i of ns) {
      changed.add(i);
      const s = stopOf.get(i);
      if (s !== undefined && (j < 0 || s < j)) j = s;
    }
    if (j < 0) { j = stops.length; stops.push([]); }
    for (const i of ns) { stops[j]!.push(i); stopOf.set(i, j); }
  }
  const removed = new Set<number>();
  for (const k0 of d.removedAfter) {
    const k = clamp(k0);
    const ends = span.map(([, b]) => b).filter((b) => b <= k);
    if (ends.length === 0) continue;
    const end = Math.max(...ends);
    for (const i of inner(span.flatMap(([, b], i) => (b === end ? [i] : [])))) {
      removed.add(i);
      if (stopOf.has(i)) continue;
      stopOf.set(i, stops.length);
      stops.push([i]);
    }
  }
  return { chg: [...changed].sort((a, b) => a - b), del: [...removed].sort((a, b) => a - b), stops: stops.length };
}

const diffOf = (before: string, after: string): Extract<ReaderDiff, { kind: 'available' }> => {
  const d = readerDiff(before, after);
  if (d.kind !== 'available') throw new Error(`the fixture diff is refused (${d.why})`);
  return d;
};
const T = (name: string, c: string): string => DOCS[name]!.texts[c]!;

/** The frame's marks equal what the real diff names, and the stepper counts its places. `jumped`: a pick from the menu
 *  steps to the first place ("1 of n"); the day view shows its changes without a step ("n changes"). */
async function expectMarked(f: Frame, d: Extract<ReaderDiff, { kind: 'available' }>, jumped: boolean, why: string): Promise<FrameMarks> {
  const want = expectedMarks((await readMarks(f)).blocks, d);
  expect(want.chg.length + want.del.length, `${why}: the fixture marks something`).toBeGreaterThan(0);
  const m = await readMarks(f);
  expect({ chg: [...m.chg], del: [...m.del] }, `${why}: the blocks marked`).toEqual({ chg: want.chg, del: want.del });
  expect(m.navHidden, `${why}: the stepper is shown`).toBe(false);
  const n = want.stops;
  expect(m.count, `${why}: the stepper's count`).toBe(jumped ? `1 of ${String(n)}` : `${String(n)} change${n === 1 ? '' : 's'}`);
  return m;
}

const hasMarks = (f: Frame): Promise<unknown> => f.waitForFunction(() => document.querySelector('[data-line].chg, [data-line].chg-del') !== null, undefined, { timeout: 30_000 });

async function openMenu(f: Frame): Promise<void> {
  await f.locator('button.chg-trig').click();
  await f.locator('div.chg-menu').waitFor({ state: 'visible', timeout: 10_000 });
}
/** Picks the n-th day row's "Since …" item (newest day first). */
async function chooseDay(f: Frame, n: number): Promise<void> {
  await openMenu(f);
  await f.locator('.cm-days button.cm-item').nth(n).click();
}
/** Picks the n-th day row's "Only this day". */
async function chooseOnly(f: Frame, n: number): Promise<void> {
  await openMenu(f);
  await f.locator('.cm-days button.cm-only').nth(n).click();
}
/** After a pick whose answer is unavailable (or late): the trigger's `on` mark is set while the call is out and goes when it ends. */
const callEnded = (f: Frame): Promise<unknown> => f.waitForFunction(() => document.querySelector('button.chg-trig.on') === null, undefined, { timeout: 30_000 });
const polled = async (what: string, ok: () => boolean, ms = 30_000): Promise<void> => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => { setTimeout(r, 50); });
  }
};

const frameErrors = (s: Session): string[] => s.logs.filter((l) => l.startsWith('error '));
const storeOf = (page: Page): Promise<Record<string, string>> => page.evaluate(() => {
  const out: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i += 1) {
    const k = localStorage.key(i);
    if (k !== null) out[k] = localStorage.getItem(k) ?? '';
  }
  return out;
});
const pageState = (page: Page): Promise<unknown> => page.evaluate(() => history.state as unknown);
const stateHasOnly = (page: Page, only: string | null): Promise<unknown> => page.waitForFunction(([key, want]) => {
  const st = history.state as Record<string, unknown> | null;
  return want === null ? (st === null || st[key as string] === undefined) : st !== null && st[key as string] === want;
}, [READER_ONLY_STATE_KEY, only] as const, { timeout: 30_000 });

// ---- the rows ----------------------------------------------------------------------------------------------------------------

describe('Task 12 reader history in Chrome, with the actual library', () => {
  it('menu and marks: the history is read once at the opened pin, and a day comparison marks the diff\'s changes and removals and counts them', async () => {
    const s = await openSession();
    const f = await openDoc(s, 'doc.md');
    const logs = verbHits(s, 'history');
    expect(logs.length, 'one history request').toBe(1);
    expect(logs[0]?.q, 'it names the opened pin\'s commit, section and path').toEqual({ commit: C3, section: SECTION, path: 'doc.md' });
    expect(await f.locator('button.chg-trig').count(), 'the trigger is in the frame').toBe(1);
    expect(await f.locator('div.chg-menu').isHidden(), 'the menu is closed').toBe(true);
    expect((await readMarks(f)).chg, 'nothing is marked before a pick').toEqual([]);

    const d = diffOf(T('doc.md', C1), T('doc.md', C3));
    expect(d.ranges.length, 'the fixture diff has changes').toBeGreaterThan(0);
    expect(d.removedAfter.length, 'and removals').toBeGreaterThan(0);
    const from = s.hits.length;
    await chooseDay(f, 1); // day 2: the base is C1
    await hasMarks(f);
    const reads = verbHits(s, 'file', from);
    expect(new Set(reads.map((h) => h.q['commit'])), 'the head pin and the base, both committed').toEqual(new Set([C3, C1]));
    for (const h of reads) {
      expect(Object.keys(h.q).sort(), 'a committed read: commit, servedRef, section, path').toEqual(['commit', 'path', 'section', 'servedRef']);
      expect(h.q['servedRef']).toBe(SERVED);
      expect(h.q['path']).toBe('doc.md');
    }
    expect(verbHits(s, 'history', from), 'no second history read').toEqual([]);
    const m = await expectMarked(f, d, true, 'since day 2');
    expect(m.what, 'the stepper names the pick').toMatch(/^Since /);
    expect(await settle(s.page), 'the page did not fall back').toBe('ready');
    expect(frameErrors(s), 'no console error').toEqual([]);
    expect(s.app.errors, 'no page error').toEqual([]);

    // A second pick replaces the first one's marks.
    const d2 = diffOf(T('doc.md', C2), T('doc.md', C3));
    await chooseDay(f, 0);
    await f.waitForFunction((n) => document.querySelectorAll('[data-line].chg, [data-line].chg-del').length === n, expectedMarks(m.blocks, d2).chg.length + expectedMarks(m.blocks, d2).del.length, { timeout: 30_000 });
    await expectMarked(f, d2, true, 'since day 3');
  }, 120_000);

  it('the oldest day: a document that did not exist at the day\'s base marks every line as new, with no removal', async () => {
    const s = await openSession();
    const f = await openDoc(s, 'doc.md');
    const head = T('doc.md', C3);
    const d = diffOf('', head);
    const lines = head.split('\n').length - 1;
    expect(d.ranges, 'the whole head is one range').toEqual([[1, lines]]);
    expect(d.removedAfter, 'and nothing is removed').toEqual([]);
    const from = s.hits.length;
    await chooseDay(f, 2); // day 1: the base is C1's parent C0, where the path does not exist
    await hasMarks(f);
    const reads = verbHits(s, 'file', from);
    expect(new Set(reads.map((h) => h.q['commit'])), 'the head pin and the base, both committed').toEqual(new Set([C3, C0]));
    const m = await expectMarked(f, d, true, 'since day 1');
    const parents = new Set(m.blocks.map((b) => b.parent));
    const innermost = m.blocks.flatMap((_, i) => (parents.has(i) ? [] : [i]));
    expect(m.chg, 'every innermost block is marked as changed').toEqual(innermost);
    expect(m.del, 'and none as a removal').toEqual([]);
    expect(await settle(s.page), 'the page did not fall back').toBe('ready');
    // The base read's 404 is the server's own answer for an absent path: the browser reports it as a failed resource load.
    expect(frameErrors(s).filter((l) => !/Failed to load resource/.test(l)), 'no console error').toEqual([]);
    expect(s.app.errors, 'no page error').toEqual([]);
  }, 120_000);

  it('removedAfter 0 (Task 11\'s pin): the frame accepts a removal before the first line, marks no block for it, and marks the other changes', async () => {
    const s = await openSession();
    const f = await openDoc(s, 'trim.md');
    const d = diffOf(T('trim.md', T2), T('trim.md', C3));
    expect(d.removedAfter, 'the fixture\'s diff removes lines before the first one').toEqual([0]);
    expect(d.ranges.length, 'and adds a paragraph').toBeGreaterThan(0);
    await chooseDay(f, 0);
    await hasMarks(f);
    const m = await expectMarked(f, d, true, 'trim.md since its base');
    expect(m.del, 'no block is marked for the removal at 0').toEqual([]);
    expect(m.chg.length, 'the new paragraph is marked').toBe(1);
    expect(await settle(s.page), 'no fallback').toBe('ready');
    expect(frameErrors(s), 'no console error').toEqual([]);
    expect(s.app.errors, 'no page error').toEqual([]);
  }, 120_000);

  it('an empty head document (ranges [], removedAfter [0]): the page mounts ready with its history read, and the frame, for a non-document, offers no comparison', async () => {
    // The shared library builds its "Changes since…" menu only for a document (a title and three sections); an empty page
    // is none, so the frame cannot be asked for a comparison here. What is measured: the real diff's answer for the
    // pair, the page's mount with the empty head, and the history read.
    const d = diffOf(T('empty.md', E2), T('empty.md', C3));
    expect(d, 'the diff of an empty after document').toEqual({ kind: 'available', ranges: [], removedAfter: [0] });
    const s = await openSession();
    await s.goto(leaf('empty.md'));
    expect(await settle(s.page), 'the empty page mounts ready').toBe('ready');
    const f = await readerFrame(s.page);
    await f.waitForSelector('body', { timeout: 10_000 });
    expect(verbHits(s, 'history').length, 'its history is read once').toBe(1);
    expect(await f.locator('button.chg-trig').count(), 'a non-document has no comparison trigger').toBe(0);
    expect(await settle(s.page)).toBe('ready');
    expect(frameErrors(s), 'no console error').toEqual([]);
    expect(s.app.errors, 'no page error').toEqual([]);
  }, 120_000);

  it('unavailable: a comparison whose base read fails marks nothing, does not fall back, and the next good comparison marks', async () => {
    const s = await openSession();
    const f = await openDoc(s, 'doc.md');
    s.failing.add(`doc.md@${C1}`);
    const from = s.hits.length;
    await chooseDay(f, 1); // day 2: the base is C1, which fails
    await polled('the base read', () => verbHits(s, 'file', from).some((h) => h.q['commit'] === C1));
    await callEnded(f); // the call ended with no change set: the trigger's `on` mark left
    const m = await readMarks(f);
    expect({ chg: m.chg, del: m.del }, 'nothing is marked').toEqual({ chg: [], del: [] });
    expect(m.navHidden, 'the stepper stays hidden').toBe(true);
    expect(await settle(s.page), 'the page did not fall back').toBe('ready');
    expect(s.app.errors, 'no page error').toEqual([]);
    // The frame keeps working: day 3's base is C2, which answers.
    await chooseDay(f, 0);
    await hasMarks(f);
    await expectMarked(f, diffOf(T('doc.md', C2), T('doc.md', C3)), true, 'since day 3 after a failed pick');
    expect(await settle(s.page)).toBe('ready');
  }, 120_000);

  it('draft: a draft view has no comparison trigger, reads no history, and reads only its own body', async () => {
    const s = await openSession({ draft: true });
    await s.goto(leaf('doc.md', '?ref=main'));
    expect(await settle(s.page), 'the draft page mounts ready').toBe('ready');
    const f = await readerFrame(s.page);
    await f.waitForSelector('[data-line]', { timeout: 30_000 });
    const reads = verbHits(s, 'file');
    expect(reads.length, 'one file read: the body\'s own').toBe(1);
    expect(reads[0]?.q['fp'], 'and it is the draft pin\'s').toBe(FP_1);
    expect(reads[0]?.q['commit'], 'not a committed one').toBeUndefined();
    expect(verbHits(s, 'history'), 'no history read').toEqual([]);
    expect(await f.locator('button.chg-trig').count(), 'no trigger in the frame').toBe(0);
    expect(await f.locator('div.chg-menu').count(), 'no menu').toBe(0);
    expect(frameErrors(s), 'no console error').toEqual([]);
  }, 120_000);

  /** Opens doc.md at `?ref=main`, chooses "Only this day" for day 2, and waits for the day view. */
  async function onlyDay2(): Promise<{ s: Session; urls: string[] }> {
    const s = await openSession();
    const urls: string[] = [];
    s.page.on('framenavigated', (fr) => { if (fr === s.page.mainFrame()) urls.push(fr.url()); });
    const f = await openDoc(s, 'doc.md', '?ref=main');
    await chooseOnly(f, 1);
    await frameWith(s.page, '.ver-banner');
    await stateHasOnly(s.page, C1);
    urls.push(s.page.url());
    return { s, urls };
  }
  const dayDiff = diffOf(T('doc.md', C1), T('doc.md', C2));

  it('Only this day, Back to the latest, ref kept: the URL names the commit and the ref and never the filter, which is in history.state', async () => {
    const { s, urls } = await onlyDay2();
    const url = new URL(s.page.url());
    expect(url.pathname).toBe(leaf('doc.md'));
    expect(url.searchParams.get('at'), 'the page is at day 2\'s commit').toBe(C2);
    expect(url.searchParams.get('ref'), 'the ref is kept').toBe('main');
    expect(s.page.url().toLowerCase(), 'the filter is not in the URL').not.toContain('only');
    expect(await pageState(s.page), 'the filter is in this entry\'s state').toMatchObject({ [READER_ONLY_STATE_KEY]: C1 });
    // The day view: the banner, no menu, and that day's changes (head C2, base C1).
    const f = await frameWith(s.page, '.ver-banner');
    expect(await f.locator('button.ver-back').textContent(), 'the banner offers the way back').toBe('Back to the latest');
    await f.waitForFunction(() => !document.querySelector('.ver-show')?.hasAttribute('hidden'), undefined, { timeout: 30_000 });
    await hasMarks(f);
    const m = await expectMarked(f, dayDiff, false, 'the day view');
    expect(m.what, 'the stepper names the day view').toBe('Only that day');
    expect(await f.locator('button.chg-trig').count(), 'the day view has no menu').toBe(0);
    // The history was read at the day page's pin, and the file reads were C2 (head) and C1 (base).
    expect(verbHits(s, 'history').at(-1)?.q['commit'], 'history is read at the day page\'s commit').toBe(C2);

    await f.locator('button.ver-back').click();
    const latest = await frameWith(s.page, 'button.chg-trig');
    const back = new URL(s.page.url());
    urls.push(s.page.url());
    expect(back.pathname).toBe(leaf('doc.md'));
    expect(back.searchParams.get('at'), 'back at the latest: no `at`').toBeNull();
    expect(back.searchParams.get('ref'), 'the ref is kept').toBe('main');
    expect(await latest.locator('.ver-banner').count(), 'no banner').toBe(0);
    expect(urls.filter((u) => u.toLowerCase().includes('only')), 'no URL of the visit carried the filter').toEqual([]);
    expect(s.app.errors).toEqual([]);
  }, 120_000);

  it('Back and Forward, and reload: each entry reads its own filter from history.state, and the URL never carries it', async () => {
    const { s, urls } = await onlyDay2();
    const note = (): void => { urls.push(s.page.url()); };
    await s.page.goBack();
    const latest = await frameWith(s.page, 'button.chg-trig');
    note();
    expect(await latest.locator('.ver-banner').count(), 'Back is the latest: no banner').toBe(0);
    expect(new URL(s.page.url()).searchParams.get('at'), 'no `at`').toBeNull();
    expect(new URL(s.page.url()).searchParams.get('ref'), 'ref kept').toBe('main');
    expect((await readMarks(latest)).chg, 'no marks on the latest page').toEqual([]);

    await s.page.goForward();
    const day = await frameWith(s.page, '.ver-banner');
    note();
    expect(new URL(s.page.url()).searchParams.get('at'), 'Forward is the day page').toBe(C2);
    await hasMarks(day);
    await expectMarked(day, dayDiff, false, 'Forward');
    await stateHasOnly(s.page, C1);
    expect(await pageState(s.page), 'the entry\'s own state holds the filter').toMatchObject({ [READER_ONLY_STATE_KEY]: C1 });

    await s.page.reload({ waitUntil: 'load' });
    const again = await frameWith(s.page, '.ver-banner');
    note();
    await hasMarks(again);
    await expectMarked(again, dayDiff, false, 'after a reload');
    expect(await pageState(s.page), 'a reload keeps the entry\'s state').toMatchObject({ [READER_ONLY_STATE_KEY]: C1 });
    expect(new URL(s.page.url()).searchParams.get('at')).toBe(C2);
    expect(urls.filter((u) => u.toLowerCase().includes('only')), 'no step carried the filter in its URL').toEqual([]);
    expect(frameErrors(s).filter((l) => !/Failed to load resource/.test(l)), 'no console error').toEqual([]);
    expect(s.app.errors).toEqual([]);
  }, 120_000);

  it('last visit and prefs across visits: the visit and the pref are stored under the reader prefix, the visit is the doc\'s own, and the notice measures it against the latest', async () => {
    const s = await openSession();
    // First visit: the version at C2. It records the visit; a width pref is set in it.
    await s.goto(leaf('doc.md', `?at=${C2}`));
    expect(await settle(s.page), 'the version page is up').toBe('ready');
    const first = await frameWith(s.page, '.chg-trig');
    await first.locator('.aa-btn').click();
    await first.locator('input[data-pref="width"][value="wide"]').check();
    await s.page.waitForFunction((p) => {
      const keys = Object.keys(localStorage).filter((k) => k.startsWith(p));
      return keys.some((k) => k.includes('seen')) && keys.some((k) => (localStorage.getItem(k) ?? '').includes('wide'));
    }, READER_STORE_PREFIX, { timeout: 30_000 });
    const seenAfterFirst = Object.entries(await storeOf(s.page)).filter(([k]) => k.includes('seen'));
    expect(seenAfterFirst.length, 'one visit was recorded').toBe(1);
    expect(JSON.parse(seenAfterFirst[0]![1]), 'it is the version\'s commit').toMatchObject({ sha: C2 });

    // Second visit: the latest. The notice says what changed since C2.
    const from = s.hits.length;
    await s.goto(leaf('doc.md'));
    expect(await settle(s.page), 'the latest page is up').toBe('ready');
    const f = await frameWith(s.page, '.rs-notice');
    const d = diffOf(T('doc.md', C2), T('doc.md', C3));
    const places = expectedMarks((await readMarks(f)).blocks, d).stops;
    expect(places, 'the fixture has changes since C2').toBeGreaterThan(0);
    const noticeText = (await f.locator('.rs-notice').textContent()) ?? '';
    expect(noticeText, 'the notice').toContain('Changed since your last visit');
    expect(noticeText, 'it counts the places the diff of C2 against C3 marks').toContain(` ${String(places)} place${places === 1 ? '' : 's'} `);
    expect(new Set(verbHits(s, 'file', from).map((h) => h.q['commit'])), 'the comparison it measures reads C2 and C3').toEqual(new Set([C2, C3]));
    await f.locator('.rs-notice button', { hasText: 'Show' }).click();
    await hasMarks(f);
    const m = await expectMarked(f, d, true, 'since the last visit');
    expect(m.what, 'the stepper names it').toBe('Since your last visit');
    // The menu offers it too.
    await openMenu(f);
    expect(await f.locator('button.cm-item[data-key="visit"]').count(), 'the menu has "Since your last visit"').toBe(1);

    // The pref set in the first visit is applied in the second.
    expect(await f.locator('input[data-pref="width"][value="wide"]').isChecked(), 'the pref survived the visit').toBe(true);

    // Every reader key sits under the prefix; no other key is a reader's.
    const keys = Object.keys(await storeOf(s.page));
    const readerKeys = keys.filter((k) => k.startsWith(READER_STORE_PREFIX));
    expect(readerKeys.some((k) => k.includes('seen')), 'the visit is stored under the prefix').toBe(true);
    expect(readerKeys.some((k) => k === `${READER_STORE_PREFIX}pref:prefs`), 'the pref is stored under the prefix').toBe(true);
    expect(keys.filter((k) => !k.startsWith(READER_STORE_PREFIX) && k !== SKIN_STORAGE_KEY && k !== THEME_STORAGE_KEY && /seen|reader/i.test(k)),
      'no reader key outside the prefix').toEqual([]);

    // Another doc has no visit of its own: no notice.
    const other = await openDoc(s, 'other.md');
    await other.waitForSelector('[data-line]', { timeout: 30_000 });
    expect(await other.locator('.rs-notice').count(), 'another doc shows no notice').toBe(0);
    expect(Object.keys(await storeOf(s.page)).filter((k) => k.startsWith(READER_STORE_PREFIX) && k.includes('seen')).length,
      'a visit of its own now exists, a second key').toBe(2);
    expect(frameErrors(s), 'no console error').toEqual([]);
  }, 120_000);

  it('blocked storage keeps reading usable: the reader mounts, the menu opens and a comparison marks', async () => {
    const s = await openSession({ blockStorage: true });
    expect(await s.page.evaluate(() => { try { return localStorage.length; } catch (e) { return (e as Error).name; } }), 'the page\'s storage is blocked').toBe('SecurityError');
    const f = await openDoc(s, 'doc.md');
    await chooseDay(f, 0);
    await hasMarks(f);
    await expectMarked(f, diffOf(T('doc.md', C2), T('doc.md', C3)), true, 'with storage blocked');
    expect(await settle(s.page), 'no fallback').toBe('ready');
    expect(s.app.errors, 'no page error').toEqual([]);
  }, 120_000);

  it('a late read after teardown: a comparison answered after its body ended marks nothing, and the next page\'s reader is unaffected', async () => {
    const s = await openSession();
    const f = await openDoc(s, 'doc.md');
    const held = s.hold(`doc.md@${C1}`);
    const from = s.hits.length;
    await chooseDay(f, 1); // day 2: the base C1 is held
    await polled('the held base read', () => verbHits(s, 'file', from).some((h) => h.q['commit'] === C1));
    expect(await s.page.locator('.docs-reader iframe').count()).toBe(1);
    // Navigate the console to another doc, in the app: the body ends.
    await f.getByRole('link', { name: 'the other doc' }).click();
    await s.page.waitForFunction(() => location.pathname.endsWith('/other.md'), undefined, { timeout: 30_000 });
    const g = await frameWith(s.page, 'button.chg-trig');
    expect(await s.page.locator('.docs-reader iframe').count(), 'the old body\'s frame is gone').toBe(1);
    held.release();
    await held.done;
    // The new page's own comparison: its marks and no one else's.
    await chooseDay(g, 0);
    await hasMarks(g);
    await expectMarked(g, diffOf(T('other.md', O1), T('other.md', C3)), true, 'the next page\'s own comparison');
    for (const fr of s.page.frames()) {
      if (fr === s.page.mainFrame() || fr === g) continue;
      expect(await fr.locator('[data-line].chg, [data-line].chg-del').count(), 'no mark in any other frame').toBe(0);
    }
    expect(await settle(s.page), 'the new page is still ready').toBe('ready');
    expect(s.app.errors, 'no page error').toEqual([]);
    expect(frameErrors(s), 'no console error').toEqual([]);
  }, 120_000);

  it('the seed at its limits: 100 entries with 200-unit subjects and 64-unit dates mount ready with the menu, and an entry past the cap is never read', async () => {
    // The fixture's dates are real times (the menu groups by day) and the sizes are the library's own limits, which ccrc
    // cuts to: a seed the frame's validator refused would fall back to the plain view.
    const log = DOCS['many.md']!.log as { subject?: string; date?: string }[];
    expect(log.slice(0, READER_SEED_MAX_COMMITS).every((e) => e.subject?.length === READER_SEED_SUBJECT_MAX_UNITS && e.date?.length === READER_SEED_DATE_MAX_UNITS)).toBe(true);
    expect(log.length, 'one entry past the cap').toBe(READER_SEED_MAX_COMMITS + 1);
    const s = await openSession();
    const f = await openDoc(s, 'many.md');
    expect(verbHits(s, 'history').length, 'one history read').toBe(1);
    await openMenu(f);
    expect(await f.locator('.cm-days button.cm-item').count(), 'a row per day: the 100 entries').toBe(READER_SEED_MAX_COMMITS);
    expect(await settle(s.page), 'no fallback').toBe('ready');
    expect(frameErrors(s), 'no console error').toEqual([]);
    expect(s.app.errors, 'no page error').toEqual([]);
  }, 120_000);
});
