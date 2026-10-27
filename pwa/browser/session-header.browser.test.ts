// The session header names the session, shows every chip whole, and its doors carry words (desktop polish T3c,
// D-6333), in a real Chrome over the production build.
//
// What jsdom cannot hold: at 360, 390, 899, 900, 1280 and 1920 in both skins and both palettes, a workspace session
// with EVERY chip (a long branch, a long model id, a coordinator) and a main checkout show no chip text ellipsized and
// no chip text running out of its pill (below 900 on Refined inside the rail's own sideways scroll, on Instrument
// wrapped); from 900 the header's three doors show their words beside the glyph, below 900 they stay glyphs at 44 px;
// and Instrument's interim header (the shared `SessionHeader`) at 1280 is no taller than it was on the base, and at
// 900 no taller than the 188 px D-7163 accepts.
//
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/session-header.browser.test.ts )`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { buildDist, openApp, removeDist, serveDist, type AppFixture, type AppView, type DistServer } from './app';
import { fleetSession } from '../test/fleetFixture';

const THEMES = [PHOSPHOR, 'light'];
const SKINS = [REFINED, INSTRUMENT];
const views = (widths: number[]): AppView[] => SKINS.flatMap((skin) => THEMES.flatMap((theme) =>
  widths.map((width) => ({ skin, theme, width }))));
const named = (v: AppView): string => `${v.skin}, ${v.theme}, ${v.width}px`;

/** Instrument's interim header (the shared `SessionHeader`) at 1280, fixture below, measured on the BASE
 *  (47b5704e2, 2026-10-27) before any T3c source edit, with `WS_DESK`: the `.chat-head` border box's height in CSS px, by palette.
 *  Never raise a number here: a taller header is fixed in the stylesheet. */
const BASE_HEAD_PX: Readonly<Record<string, number>> = { [PHOSPHOR]: 108.25, light: 108.25 };
/** The same header at exactly 900, where the detail pane is narrowest and the worded doors squeeze the chip column:
 *  measured 187.63 px in both palettes at 2ca0659b5 (139.63 on the base). D-7163 accepts that growth; this bound stops
 *  it creeping (review 1078 F2). Never raise it: a taller header is fixed in the stylesheet. */
const HEAD_900_PX = 188;

// ---- the fixture: neutral names -----------------------------------------------------------------------------------
const NOW = 1_792_362_479;
const LONG_BRANCH = 'ws/quiet-basin-a-long-branch-name-that-no-rail-holds-in-one-piece';
const LONG_MODEL = 'claude-opus-5-5-with-a-very-long-model-identifier-20261027';
const WS = fleetSession({
  id: 'project-a-quiet-basin', wrapper: 'lane-a', home: 'lane-a', project: 'project-a', workdir: '/w/project-a/quiet-basin',
  workspace: 'quiet-basin', name: 'quiet-basin', status: 'busy', bucket: 'working', model: LONG_MODEL, effort: 'high',
  branch: LONG_BRANCH, ctxPct: 40,
  withCoordinator: { kind: 'question', parentId: 'project-a-coordinator-with-a-long-name-id', since: NOW, notifyAt: NOW + 600_000 },
  pr: {
    phase: 'open', number: 123, url: null, title: null, checks: 'pass', checkNames: null, ahead: 1, reason: null,
    checkedAt: null, mergedAt: null, retryAt: null,
  },
});
/** The height case's session: every chip too, with a branch past the old 22-character cap but one a desk's row can hold
 *  (the stress session above wraps its row by design, so it cannot pin a height). */
const WS_DESK = fleetSession({
  ...WS, id: 'project-a-header-height', workspace: 'header-height', name: 'header-height',
  model: 'claude-opus-5-5-20261027', branch: 'ws/header-names-the-session',
});
const MAIN = fleetSession({
  id: 'lane-a-project-a', wrapper: 'lane-a', home: 'lane-a', project: 'project-a', workdir: '/w/project-a',
  workspace: null, name: null, status: 'idle', bucket: 'idle', model: LONG_MODEL, effort: 'high', branch: LONG_BRANCH,
});
const FIXTURE: AppFixture = {
  api: {
    '/api/accounts': { accounts: [], projected: null, roster: [{ id: 'lane-a', label: 'lane-a', hue: 'cyan', homeAble: true, hidden: false }] },
    '/api/projects': { roots: ['/w'], projects: [{ name: 'project-a', workdir: '/w/project-a' }] },
    '/api/runs': [], '/api/claims': [],
  },
  fleetFrames: [{ type: 'fleet', sessions: [WS, MAIN, WS_DESK] }],
};

let dist: string | undefined;
let server: DistServer | undefined;
let browser: Browser | undefined;

beforeAll(async () => {
  const executablePath = resolveChrome(); // throws on a box with no Chrome: red, never skipped
  dist = buildDist();
  server = await serveDist(dist);
  browser = await chromium.launch({ executablePath, headless: true });
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
  removeDist(dist);
});

async function openSession(view: AppView, id: string) {
  const opened = await openApp(browser!, view, FIXTURE);
  await opened.page.goto(`${server!.origin}/s/${id}`);
  await opened.page.waitForSelector('.chat-head .metachip, .chat-head .keycap--more', { timeout: 20_000 });
  await opened.page.waitForFunction((n) => document.querySelectorAll('.chat-head .metachip-text').length >= n, 3, { timeout: 20_000 });
  await opened.page.waitForTimeout(500); // the first paint's transitions and the fleet frame settle
  return opened;
}

describe('no chip text is ellipsized', () => {
  for (const view of views([360, 390, 899, 900, 1280, 1920])) {
    for (const session of [WS, MAIN]) {
      it(`${named(view)}, ${session.workspace === null ? 'a main checkout' : 'a workspace'}`, async () => {
        const { ctx, page, errors } = await openSession(view, session.id);
        try {
          const faults = await page.evaluate(() => {
            const out: string[] = [];
            const texts = document.querySelectorAll<HTMLElement>(
              '.chat-head .metachip-text, .chat-head .status-line, .chat-head .status-line-lead, .chat-head .status-line-name, '
              + '.chat-head .chat-meta .chip, .chat-head .chat-title, .chat-head .chat-crumb',
            );
            for (const el of texts) {
              const name = `${el.className.toString().split(' ')[0]} "${(el.textContent ?? '').slice(0, 24)}"`;
              const cs = getComputedStyle(el);
              if (el.scrollWidth > el.clientWidth + 1) out.push(`${name}: scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}`);
              if (cs.textOverflow === 'ellipsis' && cs.overflowX !== 'visible') out.push(`${name}: ellipsis with clipping`);
              // The text stays inside the pill (or the status strip) that holds it.
              const box = el.matches('.metachip-text') ? el.closest<HTMLElement>('.metachip')
                : el.matches('.status-line-name, .status-line-lead') ? el.closest<HTMLElement>('.status-line') : null;
              if (box !== null) {
                const r = el.getBoundingClientRect();
                const b = box.getBoundingClientRect();
                if (r.right > b.right + 1 || r.left < b.left - 1) out.push(`${name}: runs out of its box (${Math.round(r.right)} > ${Math.round(b.right)})`);
              }
            }
            if (texts.length < 4) out.push(`only ${texts.length} chip texts were found`);
            // A wrapped header never scrolls the page sideways; the phone rail scrolls inside itself.
            if (document.documentElement.scrollWidth > window.innerWidth + 0.5) out.push('the page scrolls sideways');
            return out;
          });
          expect(faults).toEqual([]);
          expect(errors).toEqual([]);
        } finally {
          await ctx.close();
        }
      });
    }
  }
});

describe('the doors carry words at the desk and stay glyphs on a phone', () => {
  for (const view of views([900, 1280, 1920])) {
    it(`Terminal, More and the PR door show their words (${named(view)})`, async () => {
      const { ctx, page, errors } = await openSession(view, WS.id);
      try {
        const m = await page.evaluate(() => {
          const word = (sel: string): { text: string; width: number } => {
            const w = document.querySelector<HTMLElement>(`.chat-head ${sel} .keycap-word`);
            return { text: w?.innerText ?? '', width: Math.round(w?.getBoundingClientRect().width ?? 0) };
          };
          const labels = ['.keycap--term', '.keycap--more', '.keycap--pr'].map((s) => document.querySelector(`.chat-head ${s}`)?.getAttribute('aria-label'));
          return { term: word('.keycap--term'), more: word('.keycap--more'), pr: word('.keycap--pr'), labels };
        });
        expect(m.term.text, 'Terminal').toBe('Terminal');
        expect(m.more.text, 'More').toBe('More');
        expect(m.pr.text, 'the PR door').toBe('#123');
        for (const w of [m.term, m.more, m.pr]) expect(w.width).toBeGreaterThan(0);
        // The accessible names stay what they were.
        expect(m.labels[0]).toBe('Terminal');
        expect(m.labels[1]).toBe('More');
        expect(m.labels[2]).toMatch(/^Pull request #123/);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });
  }

  for (const view of views([360, 390, 899])) {
    it(`below 900 the doors are glyphs, each at least 44 px (${named(view)})`, async () => {
      const { ctx, page, errors } = await openSession(view, WS.id);
      try {
        const m = await page.evaluate(() => {
          const caps = ['.keycap--term', '.keycap--more', '.keycap--pr'].map((s) => document.querySelector<HTMLElement>(`.chat-head ${s}`)!);
          return {
            shown: [...document.querySelectorAll<HTMLElement>('.chat-head .keycap-word')].filter((w) => w.getClientRects().length > 0).length,
            sizes: caps.map((c) => [Math.round(c.getBoundingClientRect().width), Math.round(c.getBoundingClientRect().height)]),
            titles: caps.map((c) => c.getAttribute('title')),
          };
        });
        expect(m.shown, 'no door word is drawn').toBe(0);
        for (const [w, h] of m.sizes) {
          expect(w).toBeGreaterThanOrEqual(44);
          expect(h).toBeGreaterThanOrEqual(44);
        }
        for (const t of m.titles) expect(t).toBeTruthy();
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });
  }
});

describe("Instrument's interim header at 1280 is no taller than on the base, and at 900 no taller than D-7163 accepts", () => {
  const ceilings: { width: number; px: (theme: string) => number; why: string }[] = [
    { width: 1280, px: (theme) => BASE_HEAD_PX[theme]!, why: 'base' },
    { width: 900, px: () => HEAD_900_PX, why: 'D-7163' },
  ];
  for (const { width, px, why } of ceilings) {
    for (const theme of THEMES) {
      it(`${width}px, ${theme}`, async () => {
        const { ctx, page, errors } = await openSession({ skin: INSTRUMENT, theme, width }, WS_DESK.id);
        try {
          const h = await page.evaluate(() => document.querySelector<HTMLElement>('.chat-head')!.getBoundingClientRect().height);
          expect(h, `.chat-head height at ${width} in ${theme} (${why} ${px(theme)})`).toBeLessThanOrEqual(px(theme));
          expect(errors).toEqual([]);
        } finally {
          await ctx.close();
        }
      });
    }
  }
});
