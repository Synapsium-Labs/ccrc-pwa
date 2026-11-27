// The five hierarchy items' controls (Linear hierarchy design §11.3 and §11.4, D-8184, plan Task 5.4), in a real Chrome over the
// production build, at 360, 390, 1280, 1470 and 1920 in both skins and both themes. `test/linear-item-controls.test.tsx` holds the
// bodies each act sends in jsdom; this file holds what only an engine can say, for each of the five items opened from Waiting on you:
//   * the item's controls are drawn (the map's Approve and Return, the report's Put back and Done, the drift's two, Check again,
//     and the owner's select with Name), and every control sits whole inside the viewport;
//   * nothing scrolls sideways, and no text is cut short or clipped, with a long why, a long project name and a long note;
//   * at 360 and 390 the map's act bar is stuck at the item's foot (`data-sticky`'s rule); at 900 and over it is not.
// Three more things, measured where they matter: the act bar clears the phone bar in the REAL shell (a map item's page, scrolled),
// the Waiting list's rows carry only the light acts (a drift row draws Hand and Keep, a map row none), and the stuck bar of the
// 200-issue body clears a phone bar stand-in drawn with the shell's own classes (the body cannot reach the real shell yet).
// The map and report BODY (200 issues, the width table, a structure section of a few programmes, D-8186) is drawn by the item's
// route from `GET /api/migrations/:id`; the controls cases below answer that read with nothing, so those items draw as they did, and
// the real-app describe serves it. The second describe renders the REAL `ItemView` to static markup on the node
// side (`renderToStaticMarkup`, with `matchMedia` answering for the view's width) and loads it as a page of the SAME shared
// build: its built stylesheets, `data-skin` and `data-theme` on `<html>` as `applySkin` and `applyTheme` set them. Layout,
// `position: sticky` and `<details>` are CSS, so no script bundle is needed.
//
// The app answers from a fixture (`browser/app.ts`): no server, no ccd. Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium
// binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/linear-items.browser.test.ts )`.
// `CCRC_SHOTS=<a directory>` keeps one picture per view.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import type { MapEntry, MigrationStructure } from '../../shared/plan';
import { MAP_CLASSES } from '../../shared/plan';
import { ItemView } from '../src/ledgers/ItemView';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type AppView, type DistServer } from './app';

const THEMES = [PHOSPHOR, 'light'];
const SKINS = [REFINED, INSTRUMENT];
const WIDTHS = [360, 390, 1280, 1470, 1920];
const named = (v: AppView): string => `${v.skin}, ${v.theme}, ${v.width}px`;
const LONG = 'a-deliberately-long-name-without-a-break-that-has-to-wrap-on-a-phone-screen-and-keeps-going-so-that-nothing-fits-on-one-line';

const NOW = Date.now();
const MIN = 60_000;
const item = (id: number, action: object, over: object = {}): object => ({
  id, program: 'prog-a', runId: null, kind: 'do', title: `Item ${id} ${LONG}`,
  why: `Why this is needed, in a plain sentence that may run long enough to wrap on a phone, naming ${LONG}.`,
  how: ['Open the item.', `Read ${LONG}.`], options: null, neededBy: 'soon', soonLabel: null, state: 'open', stale: false,
  raisedAt: NOW - 20 * MIN, tickedAt: null, closedAt: null, answer: null, note: null, secretSlot: null, secretSet: null,
  history: [{ at: NOW - 20 * MIN, act: 'raise', note: null }], action, ...over,
});
const ITEMS: { id: number; verb: string; look: string[] }[] = [
  { id: 1, verb: 'linear-map', look: ['Approve', 'Return'] },
  { id: 2, verb: 'linear-report', look: ['Put back', 'Done'] },
  { id: 3, verb: 'linear-drift', look: ['Hand to a coordinator', 'Keep the plan'] },
  { id: 4, verb: 'linear-initiatives', look: ['Check again'] },
  { id: 5, verb: 'linear-owner', look: ['Name'] },
];
const ACTIONS: Record<string, object> = {
  'linear-map': { verb: 'linear-map', migrationId: 3 }, 'linear-report': { verb: 'linear-report', migrationId: 3 },
  'linear-drift': { verb: 'linear-drift', bindingId: 8 }, 'linear-initiatives': { verb: 'linear-initiatives', workspaceId: 'AAA' },
  'linear-owner': { verb: 'linear-owner', project: LONG },
};
const WAITING = { items: ITEMS.map((i) => item(i.id, ACTIONS[i.verb]!)), cleared: [], goals: [] };
const FIXTURE: AppFixture = {
  api: {
    '/api/accounts': { accounts: [], projected: null, roster: [{ id: 'lane-a', label: 'lane-a', hue: 'cyan', homeAble: true, hidden: false }] },
    '/api/runs': [], '/api/claims': [], '/api/waiting': { ok: true, waiting: WAITING },
    '/api/hierarchy': { ok: true, projects: [], coordinators: [{ id: 'coord-a', live: true }, { id: `coord-${LONG}`, live: true }] },
  },
  fleetFrames: [{ type: 'fleet', sessions: [] }, { type: 'runs', runs: [] }, { type: 'waiting', waiting: WAITING }],
};

let dist: string | undefined;
let server: DistServer | undefined;
let browser: Browser | undefined;

beforeAll(async () => {
  const executablePath = resolveChrome(); // throws on a box with no Chrome: red, never skipped
  dist = sharedDist();
  server = await serveDist(dist);
  browser = await chromium.launch({ executablePath, headless: true });
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

const VIEWS: AppView[] = SKINS.flatMap((skin) => THEMES.flatMap((theme) => WIDTHS.map((width) => ({ skin, theme, width }))));

describe('the hierarchy items\' controls', () => {
  for (const it_ of ITEMS) {
    for (const v of VIEWS) {
      it(`${it_.verb}: whole, contained and in view at ${named(v)}`, async () => {
        const opened = await openApp(browser!, v, FIXTURE);
        try {
          await opened.page.goto(`${server!.origin}/waiting/${it_.id}`);
          await opened.page.waitForSelector(`.wi [data-linear="${it_.verb}"]`, { timeout: 20_000 });
          await opened.page.evaluate(async () => { await document.fonts.ready; });
          await opened.page.waitForTimeout(250);
          const m = await opened.page.evaluate((labels) => {
            const group = document.querySelector('.wi [data-linear]') as HTMLElement;
            const buttons = [...group.querySelectorAll('button')];
            const box = (e: Element) => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width }; };
            const root = document.querySelector('.wi') as HTMLElement;
            return {
              viewport: window.innerWidth, pageScroll: document.documentElement.scrollWidth, pageClient: document.documentElement.clientWidth,
              labels: labels.map((l) => buttons.some((b) => b.textContent?.trim() === l)),
              buttons: buttons.map((b) => box(b)),
              sticky: getComputedStyle(document.querySelector('.wi .wi-act') as Element).position,
              ellipsis: [...root.querySelectorAll('*')].filter((e) => getComputedStyle(e).textOverflow === 'ellipsis').map((e) => e.tagName.toLowerCase()),
              clipped: [...root.querySelectorAll('*')].filter((e) => e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0)
                .map((e) => e.tagName.toLowerCase() + '.' + (e.getAttribute('class') ?? '')),
              select: group.querySelector('select') === null ? null : box(group.querySelector('select')!),
            };
          }, it_.look);
          const at = `${it_.verb} at ${named(v)}`;
          expect(m.labels, `${at}: a control is missing`).toEqual(it_.look.map(() => true));
          expect(m.pageScroll, `${at}: the page scrolls sideways`).toBeLessThanOrEqual(m.pageClient);
          expect(m.ellipsis, `${at}: text is cut short with an ellipsis`).toEqual([]);
          expect(m.clipped, `${at}: an element is wider than its box`).toEqual([]);
          for (const b of [...m.buttons, ...(m.select === null ? [] : [m.select])]) {
            expect(b.left, `${at}: a control starts left of the viewport`).toBeGreaterThanOrEqual(0);
            expect(b.right, `${at}: a control runs past the viewport`).toBeLessThanOrEqual(m.viewport + 0.5);
          }
          // No body handed, so no sticky bar: the page draws as it did.
          expect(m.sticky, `${at}: the act panel is stuck with no body`).not.toBe('sticky');
          const shots = process.env['CCRC_SHOTS'];
          if (shots !== undefined && shots !== '') await opened.page.screenshot({ path: path.join(shots, `linear-${it_.verb}-${v.skin}-${v.theme}-${v.width}.png`), fullPage: true });
        } finally {
          await opened.ctx.close();
        }
      }, 60_000);
    }
  }
});

// ---- The body: a constructed 200-issue map and a report, as static markup of the real ItemView, in the shared build's CSS.

const ENTRIES: MapEntry[] = Array.from({ length: 200 }, (_, i) => ({
  issue: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
  identifier: i % 10 === 0 ? `KEY-${i}-${LONG}` : `KEY-${i + 100}`,
  class: MAP_CLASSES[i % MAP_CLASSES.length]!,
  target: i % 3 === 0 ? { programme: `prog-${LONG}`, epic: `epic-${LONG}`, checkpoint: `cp-${i}` } : { programme: 'prog-a', ticketKey: `KEY-${i}` },
}));
const COUNTS = { created: 20, moved: 120, closed: 30, left: 10, skipped: 20 };
/** A few programmes, with long names and one with none to show (D-8186): the map's structure section. */
const STRUCTURE: MigrationStructure[] = [
  { programme: 'prog-a', title: `Programme ${LONG}`, backlog: false, declared: true,
    epics: [{ key: 'e-1', title: `Epic ${LONG}`, checkpoints: [{ key: 'c-1', title: `Checkpoint ${LONG}` }, { key: 'c-2', title: 'Second checkpoint' }] }, { key: 'e-2', title: 'Second epic', checkpoints: [] }] },
  { programme: `prog-${LONG}`, title: null, backlog: true, declared: false, epics: [{ key: 'e-3', title: 'Third epic', checkpoints: [{ key: 'c-3', title: 'Third checkpoint' }] }] },
  { programme: 'prog-c', title: 'Programme C', backlog: false, declared: false, epics: [] },
];
const REPORT = { skipped: ['KEY-5', `KEY-6-${LONG}`], waiting: ['KEY-7'], movedSince: ['KEY-8'], milestonesLeft: [`Milestone ${LONG}`] };

/** The real ItemView for a map or report item with a body, drawn at `width` (the one fact `MigrationBody` asks the engine). */
function pageOf(verb: 'linear-map' | 'linear-report', width: number): string {
  const g = globalThis as { matchMedia?: unknown };
  const before = g.matchMedia;
  g.matchMedia = (q: string) => ({ matches: width >= 1280 && q.includes('1280'), addEventListener() {}, removeEventListener() {} });
  try {
    const action = ACTIONS[verb] as never;
    return renderToStaticMarkup(createElement(ItemView, {
      item: item(1, action, { title: `Map ${LONG}` }) as never, onTick: async () => {}, onDismiss: async () => {},
      programmeLive: true, now: NOW, migration: { counts: COUNTS, entries: ENTRIES, structure: STRUCTURE, report: REPORT },
    }));
  } finally { g.matchMedia = before; }
}

/** A built tree as the sheet helper reads it: a file's text by its root-relative name (`index.html`, `assets/x.js`), the root's
 *  pages and the names under `assets/`. The real build is `treeAt`; the helper's own cases build small ones in memory. */
type BuiltTree = { read: (file: string) => string; pages: string[]; assets: string[] };
function treeAt(root: string): BuiltTree {
  return {
    read: (file) => readFileSync(path.join(root, file), 'utf8'),
    pages: readdirSync(root).filter((f) => f.endsWith('.html')),
    assets: readdirSync(path.join(root, 'assets')),
  };
}

/** The sheets one built page links, in its own order, whichever of `rel` and `href` comes first. */
function linkedSheets(html: string): string[] {
  return [...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)].map((m) => m[1]!)
    .concat([...html.matchAll(/<link[^>]*href="([^"]+\.css)"[^>]*rel="stylesheet"/g)].map((m) => m[1]!));
}

/** The reference forms `reached` reads, for the throw's message. */
const REFERENCE_FORMS = 'page links and scripts as /assets/…, chunk imports as ./…, and preload lists and worker URLs as assets/…, '
  + 'each in double quotes, single quotes, backticks or parentheses';

/** Every file under `assets/` one page loads, as `/assets/<name>`: what the page names, then what each script it reaches names,
 *  read from the build's own text. A page names its sheets and its entry script as `/assets/…`; a chunk names a chunk it imports
 *  as `./…` (beside it), the files of a dynamic import, sheets among them, as `assets/…` (Vite's preload list), and a worker
 *  as `/assets/…`. The build writes them in double quotes, and some as template literals in backticks (a dynamic import of a
 *  chunk, a worker's URL); a name in any other form is not read, which `shellSheets` turns into a throw. A name that is no file
 *  under `assets/` is not followed, so a string that merely looks like one costs nothing. */
function reached(tree: BuiltTree, page: string): Set<string> {
  const files = new Set(tree.assets);
  const named = (text: string): string[] =>
    [...text.matchAll(/["'`(](?:\/?assets\/|\.\/)([\w.-]+\.(?:css|js))["'`)]/g)].map((m) => m[1]!);
  const seen = new Set<string>();
  const queue = named(tree.read(page)).filter((f) => files.has(f));
  for (let f = queue.shift(); f !== undefined; f = queue.shift()) {
    if (seen.has(f)) continue;
    seen.add(f);
    if (f.endsWith('.js')) queue.push(...named(tree.read(`assets/${f}`)).filter((g) => files.has(g)));
  }
  return new Set([...seen].map((f) => `/assets/${f}`));
}

/** The SHELL's stylesheets from the shared build: the index's own links first, then every other sheet under `assets/` that the
 *  shell's chunks load later, in the folder's order. A sheet that only ANOTHER entry page loads (any other `*.html` at the
 *  build's root, today `review.html`, the Docs reader's review page) is that page's own and never the shell's: applied here,
 *  its document-level rules restyle the shell. The shell's set is read from its own chunks (`reached`), not from what the
 *  other pages link, so a sheet another page links that a lazily loaded shell chunk also imports stays in. The build writes
 *  no manifest (`vite.config.ts` sets none), so the chunks' text is the record. A script or sheet under `assets/` that no
 *  page's walk reaches throws: the build names a file in a form `reached` does not read, and a file it cannot follow could
 *  hold a sheet the shell loads, which, dropped quietly, would leave the shell unstyled where it loads. */
function shellSheets(tree: BuiltTree): string[] {
  const linked = linkedSheets(tree.read('index.html'));
  const all = tree.assets.filter((f) => f.endsWith('.css')).map((f) => `/assets/${f}`);
  const shell = reached(tree, 'index.html');
  const byPages = tree.pages.map((p) => reached(tree, p));
  const unreached = tree.assets.filter((f) => /\.(?:css|js)$/.test(f)).map((f) => `/assets/${f}`)
    .filter((h) => !byPages.some((r) => r.has(h)));
  if (unreached.length > 0) {
    throw new Error(`reached() follows no page to ${unreached.join(', ')}: each is a file under assets/, but no page's walk `
      + `(${tree.pages.join(', ')}) reaches it. The walk reads ${REFERENCE_FORMS}; the build names these another way.`);
  }
  return [...new Set([...linked, ...all])].filter((h) => shell.has(h));
}
const stylesheets = (root: string): string[] => shellSheets(treeAt(root));

/** A stand-in for the shell's phone bar, in the shell's own classes (shell.css: fixed at the foot, `:root:has(.shell-phone-nav)`
 *  publishes `--phone-bar-h` from it, and `.app-shell:has(> .shell-phone-nav)` lifts `--safe-bottom` above it), so the stuck act
 *  bar is measured against the real rule; the doors are plain buttons. */
const PHONE_BAR = `<nav class="shell-phone-nav" aria-label="Navigation"><div class="phone-bar">${
  ['Fleet', 'Waiting', 'Inbox', 'Runs', 'Accounts', 'Docs', 'Search'].map((w) => `<button type="button" class="phone-bar-door">${w}</button>`).join('')}</div></nav>`;

/** A phone's home indicator, emulated through the DevTools protocol before the page loads, so `env(safe-area-inset-bottom)` is
 *  not 0 (headless Chrome answers 0 otherwise, and a bar stuck at the bar's height alone then passes; D-8186, review run 2491
 *  F1). A Chrome without the command rejects it, and the case goes red, never measures at zero. */
const HOME_INDICATOR = 34;
async function emulateInset(ctx: BrowserContext, page: Page): Promise<void> {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { bottom: HOME_INDICATOR } });
}

async function openBody(v: AppView, verb: 'linear-map' | 'linear-report') {
  const sheets = stylesheets(dist!);
  const phone = v.width < 900;
  const ctx = await browser!.newContext({ viewport: { width: v.width, height: phone ? 844 : 900 }, hasTouch: phone });
  const page = await ctx.newPage();
  if (phone) await emulateInset(ctx, page);
  // A page of the build's own origin, so its fonts and sheets load as the app's do; its document is then replaced.
  await page.goto(`${server!.origin}${sheets[0]}`);
  const themeAttr = v.theme === PHOSPHOR ? '' : ` data-theme="${v.theme}"`;
  await page.setContent(`<!doctype html><html lang="en" data-skin="${v.skin}"${themeAttr}><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><style>@layer properties, theme, base, components, utilities;</style>
${sheets.map((h) => `<link rel="stylesheet" href="${server!.origin}${h}">`).join('')}</head><body><div class="app-shell"><div id="root">${pageOf(verb, v.width)}</div>${phone ? PHONE_BAR : ''}</div></body></html>`,
  { waitUntil: 'load' });
  await page.evaluate(async () => { await document.fonts.ready; });
  return { ctx, page };
}

const BODY_VIEWS: { verb: 'linear-map' | 'linear-report'; v: AppView }[] = [
  ...VIEWS.map((v) => ({ verb: 'linear-map' as const, v })),
  ...WIDTHS.map((width) => ({ verb: 'linear-report' as const, v: { skin: REFINED, theme: PHOSPHOR, width } })),
];

describe('the map and report body, 200 issues, in the shared build\'s CSS', () => {
  for (const { verb, v } of BODY_VIEWS) {
    it(`${verb}: the width table, contained, the act bar in view at ${named(v)}`, async () => {
      const { ctx, page } = await openBody(v, verb);
      try {
        const at = `${verb} at ${named(v)}`;
        const m = await page.evaluate(() => {
          const q = (sel: string) => document.querySelector(sel) as HTMLElement;
          const groups = [...document.querySelectorAll<HTMLDetailsElement>('.wm-group')];
          const list = document.querySelector('.wm-list') as HTMLElement;
          const root = q('.wi');
          return {
            viewport: window.innerWidth, pageScroll: document.documentElement.scrollWidth, pageClient: document.documentElement.clientWidth,
            issues: document.querySelectorAll('.wm-issue').length, rows: document.querySelectorAll('.wm-table tbody tr').length,
            groups: groups.length, open: groups.map((g) => g.open),
            groupDisplay: getComputedStyle(groups[0]!).display, tableDisplay: getComputedStyle(q('.wm-table')).display,
            cols: getComputedStyle(list).gridTemplateColumns.split(' ').length, heads: [...document.querySelectorAll('.wm-table th')].map((h) => h.textContent),
            sticky: getComputedStyle(q('.wi-act')).position,
            ellipsis: [...root.querySelectorAll('*')].filter((e) => getComputedStyle(e).textOverflow === 'ellipsis').length,
            clipped: [...root.querySelectorAll('.wm *')].filter((e) => getComputedStyle(e).display !== 'none' && e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0)
              .map((e) => e.tagName.toLowerCase() + '.' + (e.getAttribute('class') ?? '')),
            countsFirst: !!(q('[data-migration-counts]').compareDocumentPosition(groups[0]!) & Node.DOCUMENT_POSITION_FOLLOWING),
            // D-8186: the structure section (map) or the report's lists sit between the counts and the groups.
            extraBetween: (() => {
              const extra = document.querySelector('[data-migration-structure], [data-report-list]');
              return extra === null ? null : !!(q('[data-migration-counts]').compareDocumentPosition(extra) & Node.DOCUMENT_POSITION_FOLLOWING) && !!(extra.compareDocumentPosition(groups[0]!) & Node.DOCUMENT_POSITION_FOLLOWING);
            })(),
            programmes: document.querySelectorAll('[data-structure-programme]').length, epics: document.querySelectorAll('[data-structure-epic]').length,
            reportLists: document.querySelectorAll('[data-report-list]').length,
            overflowing: [...document.querySelectorAll('[data-migration-structure] *, [data-report-list] *')].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 0.5).length,
          };
        });
        expect(m.countsFirst, `${at}: counts come before the groups`).toBe(true);
        expect(m.extraBetween, `${at}: the structure (or the report's lists) sit between the counts and the groups`).toBe(true);
        if (verb === 'linear-map') { expect(m.programmes, `${at}: every programme`).toBe(3); expect(m.epics, `${at}: every epic`).toBe(3); expect(m.reportLists).toBe(0); }
        else { expect(m.programmes).toBe(0); expect(m.reportLists, `${at}: the report's four lists`).toBe(4); }
        expect(m.overflowing, `${at}: the structure or the lists run past the viewport`).toBe(0);
        expect(m.groups, `${at}: one group per class`).toBe(MAP_CLASSES.length);
        expect(m.issues, `${at}: every issue is listed`).toBe(200);
        expect(m.rows, `${at}: every issue is a table row`).toBe(200);
        expect(m.pageScroll, `${at}: the page scrolls sideways`).toBeLessThanOrEqual(m.pageClient);
        expect(m.ellipsis, `${at}: text is cut short`).toBe(0);
        expect(m.clipped, `${at}: text is clipped`).toEqual([]);
        if (v.width < 900) {
          expect(m.open, `${at}: groups start collapsed`).toEqual(m.open.map(() => false));
          expect(m.tableDisplay).toBe('none');
          expect(m.sticky, `${at}: the act bar is sticky`).toBe('sticky');
          // Open every group so the page is long, scroll to the middle: the act bar is still whole in the viewport.
          const bar = await page.evaluate(() => {
            document.querySelectorAll<HTMLDetailsElement>('.wm-group').forEach((g) => { g.open = true; });
            window.scrollTo(0, (document.documentElement.scrollHeight - window.innerHeight) / 2);
            const r = (document.querySelector('.wi-act') as HTMLElement).getBoundingClientRect();
            const nav = (document.querySelector('.shell-phone-nav') as HTMLElement).getBoundingClientRect();
            return { navTop: nav.top, top: r.top, bottom: r.bottom, height: window.innerHeight, scrollY: window.scrollY, total: document.documentElement.scrollHeight, buttons:
              [...document.querySelectorAll('.wi-act button')].map((b) => { const x = b.getBoundingClientRect(); return { top: x.top, bottom: x.bottom }; }) };
          });
          expect(bar.total, `${at}: the page is long`).toBeGreaterThan(bar.height * 4);
          expect(bar.scrollY, `${at}: scrolled to the middle`).toBeGreaterThan(bar.height);
          expect(bar.top, `${at}: the act bar starts above the viewport`).toBeGreaterThanOrEqual(0);
          expect(bar.bottom, `${at}: the act bar is below the viewport's foot`).toBeLessThanOrEqual(bar.height + 0.5);
          expect(bar.bottom, `${at}: the act bar is under the phone bar`).toBeLessThanOrEqual(bar.navTop + 0.5);
          for (const b of bar.buttons) expect(b.bottom, `${at}: a control is under the phone bar`).toBeLessThanOrEqual(bar.navTop + 0.5);
        } else if (v.width < 1700) {
          expect(m.open, `${at}: groups start open`).toEqual(m.open.map(() => true));
          expect(m.cols, `${at}: two columns of issues`).toBe(2);
          expect(m.tableDisplay).toBe('none');
          expect(m.sticky).not.toBe('sticky');
        } else {
          expect(m.groupDisplay, `${at}: the groups are a table`).toBe('none');
          expect(m.tableDisplay).toBe('table');
          expect(m.heads).toEqual(['Issue', 'Class', 'Target']);
        }
        const shots = process.env['CCRC_SHOTS'];
        if (shots !== undefined && shots !== '') await page.screenshot({ path: path.join(shots, `body-${verb}-${v.skin}-${v.theme}-${v.width}.png`), fullPage: false });
      } finally {
        await ctx.close();
      }
    }, 60_000);
  }
});

// ---- The real shell: a map item's page on a phone, scrolled to its end, and the Waiting list's rows.

const MANY_HOW = Array.from({ length: 40 }, (_, i) => `Step ${i + 1}: read the part of the map that names ${LONG}, then go on.`);
const SHELL_ITEM = item(6, ACTIONS['linear-map']!, { how: MANY_HOW });
const ROWS_ITEMS = [item(7, ACTIONS['linear-drift']!), item(8, ACTIONS['linear-map']!), item(9, ACTIONS['linear-initiatives']!), item(10, ACTIONS['linear-owner']!)];
const withItems = (items: object[]): AppFixture => ({
  api: { ...FIXTURE.api, '/api/waiting': { ok: true, waiting: { items, cleared: [], goals: [] } } },
  fleetFrames: [{ type: 'fleet', sessions: [] }, { type: 'runs', runs: [] }, { type: 'waiting', waiting: { items, cleared: [], goals: [] } }],
});

describe('the act bar clears the phone bar in the real shell', () => {
  for (const v of VIEWS.filter((x) => x.width < 900)) {
    it(`a map item's page, scrolled to its end, at ${named(v)}`, async () => {
      const opened = await openApp(browser!, v, withItems([SHELL_ITEM]));
      try {
        await emulateInset(opened.ctx, opened.page);
        await opened.page.goto(`${server!.origin}/waiting/6`);
        await opened.page.waitForSelector('.wi .wi-act [data-linear="linear-map"]', { timeout: 20_000 });
        await opened.page.evaluate(async () => { await document.fonts.ready; });
        const m = await opened.page.evaluate(() => {
          window.scrollTo(0, document.documentElement.scrollHeight);
          const bar = (document.querySelector('.wi-act') as HTMLElement).getBoundingClientRect();
          const nav = document.querySelector('.shell-phone-nav') as HTMLElement | null;
          return { tall: document.documentElement.scrollHeight, view: window.innerHeight, top: bar.top, bottom: bar.bottom, navTop: nav === null ? null : nav.getBoundingClientRect().top };
        });
        const at = `map item page at ${named(v)}`;
        expect(m.navTop, `${at}: the real shell draws its phone bar`).not.toBeNull();
        expect(m.tall, `${at}: the page scrolls`).toBeGreaterThan(m.view * 2);
        expect(m.top, `${at}: the act bar starts above the viewport`).toBeGreaterThanOrEqual(0);
        expect(m.bottom, `${at}: the act bar is below the viewport's foot`).toBeLessThanOrEqual(m.view + 0.5);
        expect(m.bottom, `${at}: the act bar is under the phone bar`).toBeLessThanOrEqual(m.navTop! + 0.5);
        const shots = process.env['CCRC_SHOTS'];
        if (shots !== undefined && shots !== '') await opened.page.screenshot({ path: path.join(shots, `shell-map-${v.skin}-${v.theme}-${v.width}.png`), fullPage: false });
      } finally {
        await opened.ctx.close();
      }
    }, 60_000);
  }
});

describe('the Waiting list rows carry only the light acts', () => {
  for (const width of [360, 1280]) {
    it(`a drift and an initiatives row draw their controls, a map and an owner row none, at ${width}px`, async () => {
      const opened = await openApp(browser!, { skin: REFINED, theme: PHOSPHOR, width }, withItems(ROWS_ITEMS));
      try {
        await opened.page.goto(`${server!.origin}/waiting`);
        await opened.page.waitForSelector('.wl-li', { timeout: 20_000 });
        await opened.page.evaluate(async () => { await document.fonts.ready; });
        await opened.page.waitForTimeout(250);
        const m = await opened.page.evaluate(() => {
          const row = (id: number) => document.querySelector(`li:has([data-item="${id}"])`) as HTMLElement;
          const boxes = (id: number) => [...row(id).querySelectorAll('[data-linear] button')].map((b) => { const r = b.getBoundingClientRect(); return { left: r.left, right: r.right }; });
          return {
            viewport: window.innerWidth, pageScroll: document.documentElement.scrollWidth, pageClient: document.documentElement.clientWidth,
            drift: boxes(7).length, map: row(8).querySelectorAll('[data-linear]').length, init: boxes(9).length, owner: row(10).querySelectorAll('[data-linear]').length,
            driftBoxes: boxes(7), mapActs: row(8).getAttribute('data-acts'), rowRight: row(7).getBoundingClientRect().right,
          };
        });
        expect(m.drift, 'drift: Hand and Keep').toBe(2);
        expect(m.init, 'initiatives: Check again').toBe(1);
        expect(m.map, 'a map row draws no controls').toBe(0);
        expect(m.owner, 'an owner row draws no controls').toBe(0);
        expect(m.mapActs, 'a map row is not in the controls grid').toBeNull();
        expect(m.pageScroll, 'the list scrolls sideways').toBeLessThanOrEqual(m.pageClient);
        for (const b of m.driftBoxes) {
          expect(b.left, 'a row control starts left of the viewport').toBeGreaterThanOrEqual(0);
          expect(b.right, 'a row control runs past the viewport').toBeLessThanOrEqual(m.viewport + 0.5);
        }
        const shots = process.env['CCRC_SHOTS'];
        if (shots !== undefined && shots !== '') await opened.page.screenshot({ path: path.join(shots, `rows-${width}.png`), fullPage: false });
      } finally {
        await opened.ctx.close();
      }
    }, 60_000);
  }
});

// ---- The real app: a map item's route reads `GET /api/migrations/:id` and draws the body with its structure (D-8186).

const MIGRATION = { ok: true, id: 3, team: 'AAA', state: 'proposed', counts: COUNTS, entries: ENTRIES, structure: STRUCTURE, report: null };
const REPORT_MIGRATION = { ...MIGRATION, state: 'applied', structure: [], report: REPORT };
const withMigration = (m: object): AppFixture => ({ ...FIXTURE, api: { ...FIXTURE.api, '/api/migrations/3': m } });

describe('the item route draws the body from the migration read', () => {
  for (const { verb, id, mig, v } of [
    ...VIEWS.map((v) => ({ verb: 'linear-map', id: 1, mig: MIGRATION, v })),
    ...WIDTHS.map((width) => ({ verb: 'linear-report', id: 2, mig: REPORT_MIGRATION, v: { skin: REFINED, theme: PHOSPHOR, width } })),
  ]) {
    it(`${verb}: structure or report lists drawn, contained, act bar in view at ${named(v)}`, async () => {
      const opened = await openApp(browser!, v, withMigration(mig));
      try {
        await opened.page.goto(`${server!.origin}/waiting/${id}`);
        await opened.page.waitForSelector('.wi [data-migration-counts]', { timeout: 20_000 });
        await opened.page.evaluate(async () => { await document.fonts.ready; });
        await opened.page.waitForTimeout(250);
        const m = await opened.page.evaluate(() => {
          const root = document.querySelector('.wi') as HTMLElement;
          const bar = (document.querySelector('.wi-act') as HTMLElement).getBoundingClientRect();
          const extra = document.querySelector('[data-migration-structure], [data-report-list]');
          return {
            viewport: window.innerWidth, height: window.innerHeight, pageScroll: document.documentElement.scrollWidth, pageClient: document.documentElement.clientWidth,
            structure: document.querySelectorAll('[data-structure-programme]').length, lists: document.querySelectorAll('[data-report-list]').length,
            counts: !!extra && !!(document.querySelector('[data-migration-counts]')!.compareDocumentPosition(extra) & Node.DOCUMENT_POSITION_FOLLOWING),
            ellipsis: [...root.querySelectorAll('*')].filter((e) => getComputedStyle(e).textOverflow === 'ellipsis').length,
            clipped: [...root.querySelectorAll('.wm *')].filter((e) => getComputedStyle(e).display !== 'none' && e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0)
              .map((e) => e.tagName.toLowerCase() + '.' + (e.getAttribute('class') ?? '')),
            overflowing: [...document.querySelectorAll('[data-migration-structure] *, [data-report-list] *')].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 0.5).length,
            barTop: bar.top, barBottom: bar.bottom, sticky: getComputedStyle(document.querySelector('.wi-act') as Element).position,
            navTop: (document.querySelector('.shell-phone-nav') as HTMLElement | null)?.getBoundingClientRect().top ?? null,
          };
        });
        const at = `${verb} item route at ${named(v)}`;
        expect(m.counts, `${at}: the extra section follows the counts`).toBe(true);
        if (verb === 'linear-map') expect(m.structure, `${at}: every programme`).toBe(3); else expect(m.lists, `${at}: the report's lists`).toBe(4);
        expect(m.pageScroll, `${at}: the page scrolls sideways`).toBeLessThanOrEqual(m.pageClient);
        expect(m.ellipsis, `${at}: text is cut short`).toBe(0);
        expect(m.clipped, `${at}: text is clipped`).toEqual([]);
        expect(m.overflowing, `${at}: a name runs past the viewport`).toBe(0);
        if (v.width < 900) {
          expect(m.sticky, `${at}: the act bar is sticky`).toBe('sticky');
          expect(m.barBottom, `${at}: the act bar is below the viewport's foot`).toBeLessThanOrEqual(m.height + 0.5);
          if (m.navTop !== null) expect(m.barBottom, `${at}: the act bar is under the phone bar`).toBeLessThanOrEqual(m.navTop + 0.5);
        }
        const shots = process.env['CCRC_SHOTS'];
        if (shots !== undefined && shots !== '') await opened.page.screenshot({ path: path.join(shots, `route-${verb}-${v.skin}-${v.theme}-${v.width}.png`), fullPage: true });
      } finally {
        await opened.ctx.close();
      }
    }, 60_000);
  }
});

describe('the shell\'s sheets from the shared build', () => {
  const linksOf = (file: string): string[] => linkedSheets(readFileSync(path.join(dist!, file), 'utf8'));
  /** The real build's other pages, and the sheets they link that the index does not, read from the links alone (not the walk). */
  const foreignOf = (): { others: string[]; foreign: string[] } => {
    const others = readdirSync(dist!).filter((f) => f.endsWith('.html') && f !== 'index.html');
    const shell = linksOf('index.html');
    return { others, foreign: others.flatMap(linksOf).filter((h) => !shell.includes(h)) };
  };
  const page =(sheets: string[], script: string | null): string => `<!doctype html><html><head>${
    script === null ? '' : `<script type="module" crossorigin src="/assets/${script}"></script>`}${
    sheets.map((s) => `<link rel="stylesheet" crossorigin href="/assets/${s}">`).join('')}</head><body></body></html>`;
  const tree = (files: Record<string, string>): BuiltTree => ({
    read: (f) => { const t = files[f]; if (t === undefined) throw new Error(`no ${f}`); return t; },
    pages: Object.keys(files).filter((f) => !f.includes('/') && f.endsWith('.html')),
    assets: Object.keys(files).filter((f) => f.startsWith('assets/')).map((f) => f.slice('assets/'.length)),
  });

  it('leave out a sheet that only another entry page links, in the real build', () => {
    const { others, foreign } = foreignOf();
    // Not vacuous: the review page is built, and links a sheet of its own.
    expect(others).toContain('review.html');
    expect(foreign.length, `sheets only ${others.join(', ')} link`).toBeGreaterThan(0);
    expect(stylesheets(dist!).filter((h) => foreign.includes(h)), `pages ${others.join(', ')}`).toEqual([]);
  });

  it('keep every other sheet, in the real build: the index\'s links first, then the rest of the folder in its order', () => {
    const { foreign } = foreignOf();
    const shell = linksOf('index.html');
    const rest = readdirSync(path.join(dist!, 'assets')).filter((f) => f.endsWith('.css')).map((f) => `/assets/${f}`)
      .filter((h) => !shell.includes(h) && !foreign.includes(h));
    expect(rest.length, 'the shell loads sheets later, from its chunks').toBeGreaterThan(0);
    expect(stylesheets(dist!)).toEqual([...shell, ...rest]);
  });

  it('follow a chunk named only as ./x.js, in quotes or in backticks', () => {
    const t = tree({
      'index.html': page(['a.css'], 'entry.js'),
      'assets/entry.js': 'import{y}from"./dep.js";const w=()=>import(`./tpl.js`);',
      'assets/dep.js': 'export const y=["assets/c.css"];',
      'assets/tpl.js': 'export const s=new URL(`/assets/worker.js`,import.meta.url);export const z=[`assets/d.css`];',
      'assets/worker.js': '',
      'assets/a.css': '', 'assets/c.css': '', 'assets/d.css': '',
    });
    expect(shellSheets(t)).toEqual(['/assets/a.css', '/assets/c.css', '/assets/d.css']);
  });

  it('keep a lazily loaded shell sheet, and one another page links too, and drop the other page\'s own', () => {
    const t = tree({
      'index.html': page(['a.css'], 'entry.js'),
      'review.html': page(['b.css', 'd.css'], 'review.js'),
      'assets/entry.js': 'import{x}from"./shared.js";const m=()=>__vitePreload(()=>import("./lazy.js"),__vite__mapDeps([0,1]));'
        + 'function __vite__mapDeps(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/lazy.js","assets/c.css"])))',
      'assets/lazy.js': 'const n=()=>import("./later.js");export const d=["assets/d.css"];',
      'assets/later.js': 'export const z=1;',
      'assets/shared.js': 'export const x=1;',
      'assets/review.js': 'import{x}from"./shared.js";',
      'assets/a.css': '', 'assets/b.css': '', 'assets/c.css': '', 'assets/d.css': '',
    });
    expect(shellSheets(t)).toEqual(['/assets/a.css', '/assets/c.css', '/assets/d.css']);
  });

  it('answer as before with one entry page: its links first, then every other sheet in the folder\'s order', () => {
    const t = tree({
      'index.html': page(['b.css', 'a.css'], 'entry.js'),
      'assets/entry.js': 'const f=()=>import("./lazy.js");const m=["assets/lazy.js","assets/c.css"];',
      'assets/lazy.js': '',
      'assets/a.css': '', 'assets/b.css': '', 'assets/c.css': '',
    });
    expect(shellSheets(t)).toEqual(['/assets/b.css', '/assets/a.css', '/assets/c.css']);
  });

  it('throw on a sheet that no page loads, never drop it quietly', () => {
    const t = tree({ 'index.html': page(['a.css'], null), 'assets/a.css': '', 'assets/e.css': '' });
    expect(() => shellSheets(t)).toThrow(/reached\(\) follows no page to \/assets\/e\.css: each is a file under assets\/, but no page's walk/);
  });

  it('throw on a script that no page reaches, so a reference form the walk cannot read stays loud for chunks too', () => {
    const t = tree({
      'index.html': page(['a.css'], 'entry.js'),
      'assets/entry.js': 'const f=()=>import("./"+"hidden.js");',
      'assets/hidden.js': 'export const s=["assets/a.css"];',
      'assets/a.css': '',
    });
    expect(() => shellSheets(t)).toThrow(/reached\(\) follows no page to \/assets\/hidden\.js: .*The walk reads page links/);
  });
});
