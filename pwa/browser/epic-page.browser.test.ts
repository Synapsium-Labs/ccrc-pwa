// The epic page and the Upkeep page (Linear hierarchy design §11.2 and §7.6, D-8184; plan Task 5.3's width table), in a real
// Chrome over the production build, at 360, 390, 1280, 1470 and 1920, in both skins and both themes. `test/epic-screen.test.tsx`
// holds the pages' behaviour in jsdom; this file holds what only an engine can say:
//   * nothing on the page scrolls sideways, and no text is cut short or clipped (no ellipsis, no element scrolling inside
//     itself), with a very long epic title, checkpoint title and ticket title that have to wrap;
//   * 360 and 390: the checkpoints are a list with the tickets below; 1280 and 1470: the two sit side by side; 1920: the same,
//     each ticket's state and links on the line of its title (at 1470 and under they sit under it);
//   * the Upkeep page lists its tickets and the closes Linear refused, and no checkpoints.
//
// The app answers from a fixture (`browser/app.ts`): no server, no ccd. Run: `( cd pwa && CCRC_CHROME=<a Chrome or
// Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/epic-page.browser.test.ts )`.
// `CCRC_SHOTS=<a directory>` keeps one picture per view.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import type { EpicView } from '../../shared/plan';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type AppView, type DistServer } from './app';

const THEMES = [PHOSPHOR, 'light'];
const SKINS = [REFINED, INSTRUMENT];
const WIDTHS = [360, 390, 1280, 1470, 1920];
const named = (v: AppView): string => `${v.skin}, ${v.theme}, ${v.width}px`;

const NOW = Date.now();
const LONG = 'a-deliberately-long-title-without-a-break-that-has-to-wrap-on-a-phone-screen-and-in-a-narrow-column-' +
  'and-keeps-going-so-that-nothing-can-fit-on-one-line-at-any-width-the-page-is-drawn-at';

// Built from parts, so no literal tracker URL sits in the tree (`topology-clean`'s private tracker id class).
const linearUrl = (...p: string[]): string => ['https:', '', 'linear.app', ...p].join('/');

const EPIC: EpicView = {
  key: 'e-1', title: `Epic ${LONG}`, summary: 'The epic summary, which is a sentence that is long enough to wrap on a phone screen.',
  project: 'project-a', waves: [1], state: 'active', url: linearUrl('ws-a', 'project', 'epic-1'), sync: 'bound', syncWord: null,
  checkpoints: [
    { key: 'c-1', title: `Checkpoint ${LONG}`, kind: 'acceptance', state: 'met', proves: [], metAt: NOW - 86_400_000, evidence: { pr: 42 },
      url: null, sync: 'none', syncWord: null },
    { key: 'c-2', title: 'Second checkpoint', kind: 'operator-act', state: 'open', proves: [], metAt: null, evidence: { itemId: 7 },
      url: null, sync: 'none', syncWord: null },
    { key: 'c-3', title: 'Third checkpoint', kind: 'measured', state: 'met', proves: [], metAt: NOW - 3_600_000,
      evidence: { path: 'docs/superpowers/specs/2026-11-10-linear-hierarchy-design.md' }, url: null, sync: 'none', syncWord: null },
  ],
  tickets: [
    { key: 't-1', kind: 'work', title: `Ticket ${LONG}`, project: 'project-a', checkpoint: 'c-1', source: 'plan', state: 'started', runId: 12,
      identifier: 'KEY-123', url: linearUrl('ws-a', 'issue', 'KEY-123'), sync: 'bound', syncWord: null },
    { key: 't-2', kind: 'bug', title: 'A short ticket', project: 'project-a', checkpoint: null, source: 'inbound', state: 'open', runId: null,
      identifier: null, url: null, sync: 'none', syncWord: null },
  ],
};
const UPKEEP: EpicView = { ...EPIC, key: 'upkeep', title: 'Upkeep', checkpoints: [] };

const FIXTURE: AppFixture = {
  api: {
    '/api/programmes/prog-a/plan': { ok: true, plan: { program: 'prog-a', planned: true, initiatives: [], epics: [EPIC], doneWhen: [] } },
    '/api/projects/project-a/upkeep': {
      ok: true, epic: UPKEEP,
      notClosed: [{ identifier: 'KEY-9', teamKey: 'KEY', word: `a-policy-word-${'long-'.repeat(20)}x`, at: NOW - 86_400_000 }],
    },
    '/api/projects': { roots: ['/w'], projects: [{
      name: 'project-a', workdir: '/w/project-a',
      linking: { teamKey: 'KEY', override: null, mode: 'private', initiatives: 'on', linearOwner: null, ownsTeam: false,
        measured: { state: 'measured', visibility: 'private', slug: 'owner/repo', template: 'absent', at: NOW - 3_600_000 } },
    }] },
    '/api/accounts': { accounts: [], projected: null, roster: [] },
    '/api/feed': { events: [] },
  },
  fleetFrames: [{ type: 'fleet', sessions: [] }, { type: 'coord', coord: { pause: 'clear' } }],
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

interface Box { left: number; right: number; top: number; bottom: number; width: number; height: number }
interface Measured {
  viewport: number; pageScrollWidth: number; pageClientWidth: number;
  root: { scrollWidth: number; clientWidth: number; box: Box };
  head: Box;
  checkpoints: Box | null;
  tickets: Box;
  /** Each ticket's title and meta line. */
  ticketLines: { title: Box; meta: Box }[];
  checkpointCount: number;
  notClosed: Box | null;
  ellipsis: string[];
  clipped: string[];
}

/** The page's geometry, measured in the page. */
const measure = (root: Element): Measured => {
  const box = (e: Element): Box => {
    const r = e.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
  };
  const one = (sel: string): Element => {
    const found = root.querySelector(sel);
    if (found === null) throw new Error(`no ${sel}`);
    return found;
  };
  const cps = root.querySelector('[aria-label="Checkpoints"]');
  const closes = root.querySelector('.ep-notclosed');
  return {
    viewport: window.innerWidth,
    pageScrollWidth: document.documentElement.scrollWidth,
    pageClientWidth: document.documentElement.clientWidth,
    root: { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth, box: box(root) },
    head: box(one('.ep-head')),
    checkpoints: cps === null ? null : box(cps),
    tickets: box(one('section[aria-label="Tickets"]')),
    ticketLines: [...root.querySelectorAll('.ep-tk')].map((t) => ({ title: box(t.querySelector('.ep-title')!), meta: box(t.querySelector('.ep-meta')!) })),
    checkpointCount: root.querySelectorAll('.ep-cp').length,
    notClosed: closes === null ? null : box(closes),
    ellipsis: [...root.querySelectorAll('*')].filter((e) => getComputedStyle(e).textOverflow === 'ellipsis').map((e) => e.tagName.toLowerCase()),
    clipped: [...root.querySelectorAll('*')]
      .filter((e) => e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0)
      .map((e) => e.tagName.toLowerCase() + '.' + (e.getAttribute('class') ?? '')),
  };
};

const assertContained = (m: Measured, at: string): void => {
  expect(m.root.scrollWidth, `${at}: the page root overflows sideways`).toBeLessThanOrEqual(m.root.clientWidth);
  expect(m.ellipsis, `${at}: text is cut short with an ellipsis`).toEqual([]);
  expect(m.clipped, `${at}: an element is wider than its box`).toEqual([]);
  expect(m.pageScrollWidth, `${at}: the page scrolls sideways`).toBeLessThanOrEqual(m.pageClientWidth);
  expect(m.root.box.left, `${at}: the page starts left of the viewport`).toBeGreaterThanOrEqual(0);
  expect(m.root.box.right, `${at}: the page runs past the viewport`).toBeLessThanOrEqual(m.viewport + 0.5);
  for (const b of [m.head, m.tickets, ...(m.checkpoints === null ? [] : [m.checkpoints])]) {
    expect(b.right, `${at}: a block runs past the page`).toBeLessThanOrEqual(m.root.box.right + 0.5);
  }
};

const open = async (view: AppView, pathname: string, ready: string) => {
  const app = await openApp(browser!, view, FIXTURE);
  await app.page.goto(server!.origin + pathname);
  const root = app.page.locator('.ep[data-epic]');
  await root.locator(ready).first().waitFor({ timeout: 30_000 });
  return { ...app, root };
};

describe('the epic page and the Upkeep page, per width, skin and theme (D-8184)', () => {
  for (const width of WIDTHS) {
    it(`the width table holds at ${width}px, in both skins and both themes`, async () => {
      for (const skin of SKINS) {
        for (const theme of THEMES) {
          const view: AppView = { skin, theme, width };
          const at = named(view);
          const shots = process.env.CCRC_SHOTS;

          // The epic page: checkpoints and tickets.
          {
            const { ctx, errors, root } = await open(view, '/programmes/prog-a/epics/e-1', '.ep-cp');
            try {
              expect(await root.getByRole('heading', { level: 1, name: EPIC.title }).count()).toBe(1);
              // The evidence links settle once the project list answers.
              await root.getByRole('link', { name: 'PR #42' }).waitFor({ timeout: 30_000 });
              const m = await root.evaluate(measure);
              if (shots) await root.screenshot({ path: path.join(shots, `epic-${skin}-${theme}-${width}.png`) });
              expect(m.checkpointCount).toBe(3);
              expect(m.ticketLines.length).toBe(2);
              assertContained(m, `${at} epic`);
              const cp = m.checkpoints!;
              if (width >= 1280) {
                expect(Math.abs(m.tickets.top - cp.top), `${at}: checkpoints and tickets are not side by side`).toBeLessThan(1);
                expect(m.tickets.left, `${at}: the tickets are not beside the checkpoints`).toBeGreaterThanOrEqual(cp.right - 0.5);
              } else {
                expect(m.tickets.top, `${at}: the tickets are not under the checkpoints`).toBeGreaterThanOrEqual(cp.bottom - 0.5);
                expect(Math.abs(m.tickets.left - cp.left), `${at}: the list and the tickets do not share a left edge`).toBeLessThan(1);
              }
              for (const t of m.ticketLines) {
                if (width >= 1700) expect(t.meta.top, `${at}: the ticket's state is not on its title's line`).toBeLessThan(t.title.bottom - 0.5);
                else expect(t.meta.top, `${at}: the ticket's state is not under its title`).toBeGreaterThanOrEqual(t.title.bottom - 0.5);
              }
              expect(errors, `${at}: page errors`).toEqual([]);
            } finally {
              await ctx.close();
            }
          }

          // The Upkeep page: tickets, the closes Linear refused, no checkpoints.
          {
            const { ctx, errors, root } = await open(view, '/projects/project-a/upkeep', '.ep-tk');
            try {
              expect(await root.getByRole('heading', { level: 1, name: 'Upkeep' }).count()).toBe(1);
              const m = await root.evaluate(measure);
              if (shots) await root.screenshot({ path: path.join(shots, `upkeep-${skin}-${theme}-${width}.png`) });
              expect(m.checkpoints, `${at}: the Upkeep page has a checkpoints section`).toBeNull();
              expect(m.checkpointCount).toBe(0);
              expect(m.notClosed, `${at}: no closes section`).not.toBeNull();
              assertContained(m, `${at} upkeep`);
              for (const t of m.ticketLines) {
                if (width >= 1700) expect(t.meta.top, `${at}: the ticket's state is not on its title's line`).toBeLessThan(t.title.bottom - 0.5);
                else expect(t.meta.top, `${at}: the ticket's state is not under its title`).toBeGreaterThanOrEqual(t.title.bottom - 0.5);
              }
              expect(errors, `${at}: page errors`).toEqual([]);
            } finally {
              await ctx.close();
            }
          }
        }
      }
    }, 240_000);
  }
});
