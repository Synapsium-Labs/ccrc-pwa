// Console speed, task C1 (the link and the start): six big screens load on demand, and the Session, Settings and
// Digest chunks carry stylesheets of their own, which the browser links when the chunk loads, after the entry's.
// The built app, in a real Chrome: loading a chunk changes no style the entry drew, a lazy screen draws the same
// whether it opened the page or was reached by a navigation, and the cascade-layer order declared first in
// index.html (D-7891) still comes before every built sheet once the chunks' sheets are in.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type AppView, type DistServer } from './app';

const VIEWS: AppView[] = [REFINED, INSTRUMENT].flatMap((skin) => [390, 1280].map((width) => ({ skin, theme: PHOSPHOR, width })));
const named = (v: AppView): string => `${v.skin}, ${v.width}px`;
/** The Runs screen's reads answered as an empty box answers them (`caps-dial.browser.test.ts`'s): `{}` is not a runs
 *  list, and the screen would throw into the boundary. */
/** One idle session, so the Session route has a screen and a composer to measure (review 1464 F1). Neutral names. */
const SID = 'project-a-one';
const SESSION = {
  id: SID, wrapper: 'lane-a', home: 'lane-a', project: 'project-a', workdir: '/w/project-a/one', workspace: 'one',
  name: 'one', status: 'idle', statusUpdatedAt: null, limits: null, dialogPending: false, version: null, model: null,
  effort: null, ultracode: false, branch: 'ws/one', ctxPct: null, paneCols: null, tasks: null, pr: null, archivedAt: null,
  archivedBytes: null, held: null, hookState: null, askSummary: null, subagents: null, background: null,
  withCoordinator: null, lastEnd: null, hibernatedAt: null, bucket: 'idle', unmeasured: [], started: true,
  child: { kind: 'none' }, lifecycle: 'running', presence: 'alive',
};
const FIXTURE: AppFixture = {
  api: {
    '/api/feed': { events: [] },
    '/api/accounts': { accounts: [], projected: null, roster: [] },
    '/api/projects': { roots: ['/w'], projects: [{ name: 'project-a', workdir: '/w/project-a' }] },
    '/api/runs': { runs: [] },
    '/api/claims': [],
    '/api/coord/caps': { ok: true, caps: { maxConcurrentWorkers: 4 }, usage: { running: 1 }, updatedAt: null },
  },
  fleetFrames: [{ type: 'fleet', sessions: [SESSION] }, { type: 'runs', runs: [] }, { type: 'coord', coord: { pause: 'clear' } }],
  socketFrames: {
    [`/ws/session/${SID}`]: [{ type: 'backlog', uuid: 'u1', events: [], offset: 0, file: '/t.jsonl', missing: false }],
  },
};
/** Three lazy routes: Settings (a chunk with its own sheet), Runs (a chunk without one) and a Session (whose sheets
 *  share a chunk with the entry: the order review 1464 F1 found inverted). */
const ROUTES = ['/settings', '/runs', `/s/${SID}`] as const;

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

type Styles = Record<string, Record<string, string>>;

/** The computed styles that a reordered or overriding sheet would change, for every button, heading and field under
 *  `root`, keyed by tag, text and position, so two snapshots of the same DOM compare entry by entry. A field is measured
 *  while focused, where a focus ring would show (review 1464 F1), and blurred again. */
const snapshot = async (page: Page, root: string): Promise<Styles> => {
  // A colour transition still running (a nav button leaving its active state) is not a cascade change: wait it out.
  // Only transitions: an infinite animation (a pulse, a spinner) never ends and changes no cascade.
  await page.waitForFunction(() => document.getAnimations()
    .every((a) => a.constructor.name !== 'CSSTransition' || a.playState !== 'running'), undefined, { timeout: 10_000 });
  return page.evaluate((sel) => {
  const props = ['background-color', 'color', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'font-family', 'font-size', 'font-weight', 'border-top-left-radius', 'border-top-width', 'height',
    'outline-style', 'outline-width', 'outline-color', 'outline-offset'];
  const out: Record<string, Record<string, string>> = {};
  const scope = document.querySelector(sel);
  if (scope === null) return out;
  scope.querySelectorAll('button, h1, h2, [role="tab"], textarea, input').forEach((el, i) => {
    const field = el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement;
    if (field) (el as HTMLElement).focus();
    const cs = getComputedStyle(el);
    const key = `${i} ${el.tagName.toLowerCase()} ${(el.getAttribute('aria-label') ?? el.getAttribute('placeholder') ?? el.textContent ?? '').trim().slice(0, 40)}`;
    out[key] = Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p)]));
    if (field) (el as HTMLElement).blur();
  });
  return out;
  }, root);
};

const go = (page: Page, path: string): Promise<unknown> => page.evaluate((p) => {
  history.pushState(null, '', p);
  dispatchEvent(new PopStateEvent('popstate'));
}, path);

/** The route's lazy screen has drawn: no loading line, no boundary fallback, and something to measure. */
const drawn = async (page: Page): Promise<void> => {
  try {
    await page.waitForFunction(() => {
  const pane = document.querySelector('.shell-detail');
  if (pane === null) return false;
  // The Suspense line (`app.tsx`) by its own selector: a screen may say "Loading…" of its own data.
  return pane.querySelector('p.shell-placeholder-copy[role="status"]') === null
    && !/This screen could not be (shown|loaded)\./.test(pane.textContent ?? '')
    && pane.querySelector('button, h1, h2') !== null
    // /runs: the board's own reads must have answered before the snapshot (desk-nav Task A review 1646 A1; desktop-polish
    // Task C14, D-8110). The caps dial moved to /runs/advanced (D-8074, Task 12a), so the board waits for its foot link
    // and for no "Loading…" of its own (Finished's read). Every other route waits as before.
    && (location.pathname !== '/runs'
      || (pane.querySelector('a[href="/runs/advanced"]') !== null && !/Loading…/.test(pane.textContent ?? '')));
    }, undefined, { timeout: 30_000 });
  } catch (err) {
    const pane = await page.evaluate(() => document.querySelector('.shell-detail')?.outerHTML.slice(0, 600) ?? 'no pane');
    throw new Error(`the lazy screen never drew at ${await page.evaluate(() => location.pathname)}: ${pane}`, { cause: err });
  }
};

const fleetReady = (page: Page): Promise<unknown> =>
  page.waitForFunction(() => document.querySelector('.app-shell') !== null && document.querySelector('.shell-nav') !== null,
    undefined, { timeout: 30_000 });

describe('each lazy route renders with the computed styles of the eager build', () => {
  for (const view of VIEWS) {
    for (const route of ROUTES) {
      it(`${named(view)}, ${route}`, async () => {
        const reached = await openApp(browser!, view, FIXTURE);
        const direct = await openApp(browser!, view, FIXTURE);
        try {
          // Reached by a navigation: the entry draws the fleet first, then the chunk (and its sheet) loads.
          await reached.page.goto(server!.origin + '/');
          await fleetReady(reached.page);
          const entryBefore = await snapshot(reached.page, '.app-shell');
          expect(Object.keys(entryBefore).length, 'the fleet drew something to measure').toBeGreaterThan(2);
          await go(reached.page, route);
          await drawn(reached.page);
          const viaNavigation = await snapshot(reached.page, '.shell-detail');
          await go(reached.page, '/');
          await fleetReady(reached.page);
          expect(await snapshot(reached.page, '.app-shell'), 'loading the chunk changed no style the entry drew').toEqual(entryBefore);

          // The same route as the page's first: the chunk loads at start.
          await direct.page.goto(server!.origin + route);
          await drawn(direct.page);
          const viaLoad = await snapshot(direct.page, '.shell-detail');
          expect(Object.keys(viaLoad).length).toBeGreaterThan(0);
          expect(viaNavigation, 'the screen draws the same, reached or opened').toEqual(viaLoad);
          expect(reached.errors).toEqual([]);
          expect(direct.errors).toEqual([]);
        } finally {
          await reached.ctx.close();
          await direct.ctx.close();
        }
      }, 120_000);
    }
  }
});

// Review 1464 F1: the eager build drew the composer's field with no ring (chat.css's `.composer-input` came after
// base.css's unlayered `:focus-visible`); the lazy split put chat.css's sheet first, and the ring came back. The rule
// that suppresses it must win whatever the order the sheets arrive in, opened or reached.
describe('the composer’s field draws no focus ring, as the eager build drew it', () => {
  for (const view of VIEWS) {
    it(named(view), async () => {
      const opened = await openApp(browser!, view, FIXTURE);
      try {
        const rings: string[] = [];
        for (const how of ['opened', 'reached'] as const) {
          await opened.page.goto(server!.origin + (how === 'opened' ? `/s/${SID}` : '/'));
          if (how === 'reached') {
            await fleetReady(opened.page);
            await go(opened.page, `/s/${SID}`);
          }
          await opened.page.waitForSelector('textarea.composer-input', { timeout: 30_000 });
          rings.push(await opened.page.evaluate((h) => {
            const box = document.querySelector<HTMLTextAreaElement>('textarea.composer-input')!;
            box.focus();
            return `${h}: ${getComputedStyle(box).outlineStyle}`;
          }, how));
        }
        expect(rings).toEqual(['opened: none', 'reached: none']);
        expect(opened.errors).toEqual([]);
      } finally {
        await opened.ctx.close();
      }
    }, 120_000);
  }
});

describe('the first @layer statement still precedes every built sheet', () => {
  it('after Settings, Runs and the Digest have loaded their chunks', async () => {
    const opened = await openApp(browser!, { skin: REFINED, theme: PHOSPHOR, width: 1280 }, FIXTURE);
    try {
      await opened.page.goto(server!.origin + '/');
      await fleetReady(opened.page);
      for (const route of ['/settings', '/runs', '/digest']) {
        await go(opened.page, route);
        await drawn(opened.page);
      }
      const order = await opened.page.evaluate(() => {
        const nodes = [...document.querySelectorAll('style, link[rel="stylesheet"]')];
        const first = document.styleSheets[0];
        const firstRule = first?.cssRules[0];
        return {
          firstTag: nodes[0]?.tagName ?? null,
          firstIsLayerStatement: firstRule !== undefined && firstRule.constructor.name === 'CSSLayerStatementRule',
          firstOwnerIsNode0: first?.ownerNode === nodes[0],
          links: nodes.filter((n) => n.tagName === 'LINK').map((n) => new URL((n as HTMLLinkElement).href).pathname),
          linkIndexes: nodes.map((n, i) => (n.tagName === 'LINK' ? i : -1)).filter((i) => i >= 0),
        };
      });
      expect(order.firstTag, 'the document meets a <style> first').toBe('STYLE');
      expect(order.firstIsLayerStatement, 'and its first rule is the @layer order statement').toBe(true);
      expect(order.firstOwnerIsNode0).toBe(true);
      expect(order.linkIndexes.every((i) => i > 0), 'every built sheet comes after it').toBe(true);
      expect(order.links.some((p) => /\/assets\/SettingsFrame-[\w-]+\.css$/.test(p)), 'a lazy chunk\'s own sheet is linked: the check covers one')
        .toBe(true);
      expect(opened.errors).toEqual([]);
    } finally {
      await opened.ctx.close();
    }
  }, 120_000);
});
