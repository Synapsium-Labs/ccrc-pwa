// The ask sheet holds ONE vertical scroller and no sideways scroll at phone widths (D-6325, desktop-polish plan, T1b
// Step 1), in a real Chrome over the production build.
//
// An ask surface is a sheet whose body carries the question and its options. Before T1b the sheet also scrolled its
// title on its own (`titleScroll`'s 38vh cap) and `.dlg-body` capped a second region, so a long question gave the
// operator two nested scrollers. jsdom lays nothing out, so this file holds what Chrome computes: fixture 1 (the hook
// envelope with its parsed menu) with a forty-line first question, at 360 and 390 in both skins and both palettes
// (Phosphor & Ink, dark; Phosphor Daylight, light) —
//   - "the ask has one vertical scroller": inside the sheet panel exactly one element scrolls (computed `overflow-y`
//     of `auto` or `scroll` AND `scrollHeight > clientHeight + 1`), it is the sheet body, and the title is not it;
//   - "no horizontal page scroll": the document is no wider than the window;
//   - "no page error": nothing uncaught was thrown.
// Each view also asserts what the surface DOES show: the question's first line and the who line.
//
// The fixture's data is `test/askFixtures.ts`'s (`askFixture(1)`, `longHookEnvelope()`), the one copy every Step 1
// suite reads; the browser config imports from `../test/` as `name-field.browser.test.tsx` already does.
//
// For the per-width review: `CCRC_SHOTS=<a directory>` keeps one picture per view. Run: `( cd pwa &&
// CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts
// browser/ask-surface.browser.test.ts )`.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { buildDist, openApp, removeDist, serveDist, type AppFixture, type AppView, type DistServer } from './app';
import { fleetSession } from '../test/fleetFixture';
import { ASKER_PROJECT, ASKER_SESSION, askFixture, longHookEnvelope } from '../test/askFixtures';

const VIEWS: AppView[] = [REFINED, INSTRUMENT].flatMap((skin) => [PHOSPHOR, 'light'].flatMap((theme) =>
  [360, 390].map((width) => ({ skin, theme, width }))));
const named = (v: AppView): string => `${v.skin}, ${v.theme}, ${v.width}px`;
const shotName = (v: AppView): string => `ask-${v.skin}-${v.theme}-${v.width}.png`;

// ---- the fixture: one session asking, neutral names ----------------------------------------------------------------
const NOW = 1_792_362_479;
const SESSION = fleetSession({
  id: 'lane-a-project-a', wrapper: 'lane-a', home: 'lane-a', project: ASKER_PROJECT, workdir: '/w/project-a',
  workspace: ASKER_SESSION, status: 'busy', bucket: 'working', hookState: 'waiting', started: true,
});
const FIXTURE: AppFixture = {
  api: {
    '/api/accounts': {
      accounts: [{
        wrapper: 'lane-a', five: 40, seven: 50, ts: NOW, fiveResetAt: NOW + 7_800, sevenResetAt: NOW + 259_800,
        fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false,
      }],
      projected: null,
      roster: [{ id: 'lane-a', label: 'lane-a', hue: 'cyan', pool: null, homeAble: true, hidden: false }],
    },
    '/api/projects': { roots: ['/w'], projects: [{ name: 'project-a', workdir: '/w/project-a' }] },
    '/api/runs': [], '/api/claims': [],
  },
  fleetFrames: [{ type: 'fleet', sessions: [SESSION] }],
};

const TS = new Date((NOW - 600) * 1000).toISOString();
const BACKLOG = {
  type: 'backlog', uuid: 'u-1', offset: 1, file: '/w/t.jsonl', missing: false, searchComplete: true, fileMeasured: true,
  events: [
    { kind: 'user', uuid: 'q1', ts: TS, text: 'Set up the service.' },
    { kind: 'assistant', uuid: 'a1', ts: TS, text: 'I have a few questions first.' },
  ],
};

/** The session socket's frames, in the order the stream sends them: the transcript, the status, then fixture 1's own
 *  `dialog` and `ask` frames with the forty-line question in the envelope. */
const FRAMES = (): object[] => {
  const { frames } = askFixture(1);
  return [
    BACKLOG,
    { type: 'status', status: 'busy', statusUpdatedAt: null },
    ...frames.map((f) => (f.type === 'ask' ? { ...f, ask: longHookEnvelope() } : f)),
  ];
};

const FIRST_LINE = 'Line 1 of a question that runs on and on.';
const WHO_LINE = `${ASKER_SESSION} · ${ASKER_PROJECT}`;

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

interface Scroller { cls: string; overflowY: string; scrollHeight: number; clientHeight: number }
interface Measure {
  scrollers: Scroller[];
  titleScrolls: boolean;
  pageSide: number;
  panelText: string;
  /** With the body scrolled to its top: the question's first line and the who line, as rectangles. */
  first: Box | null;
  who: Box | null;
  viewportHeight: number;
}
interface Box { top: number; bottom: number }

describe('an ask holds one vertical scroller (D-6325)', () => {
  for (const view of VIEWS) {
    describe(named(view), () => {
      // One page load per view, measured by the three cases below (the plan's names stay greppable).
      let measured: Measure | undefined;
      let errors: string[] = [];

      beforeAll(async () => {
        const opened = await openApp(browser!, view, FIXTURE);
        errors = opened.errors;
        try {
          await opened.ctx.routeWebSocket(/\/ws\/session\//, (ws) => {
            for (const frame of FRAMES()) ws.send(JSON.stringify(frame));
          });
          await opened.page.goto(`${server!.origin}/s/${SESSION.id}`);
          await opened.page.waitForSelector('.sheet-panel .ask-who', { timeout: 30_000 });
          await opened.page.waitForTimeout(500); // the sheet's entrance (vaul) settles
          const shots = process.env['CCRC_SHOTS'];
          if (shots !== undefined && shots !== '') {
            mkdirSync(shots, { recursive: true });
            await opened.page.screenshot({ path: path.join(shots, shotName(view)) });
          }
          measured = await opened.page.evaluate(([FIRST_LINE_ARG, WHO_LINE_ARG]): Measure => {
            const panel = document.querySelector<HTMLElement>('.sheet-panel')!;
            const title = panel.querySelector<HTMLElement>('.sheet-title');
            const scrolls = (el: HTMLElement): boolean => {
              const oy = getComputedStyle(el).overflowY;
              return (oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1;
            };
            const scrollers = [panel, ...panel.querySelectorAll<HTMLElement>('*')].filter(scrolls).map((el) => ({
              cls: el.className.toString(), overflowY: getComputedStyle(el).overflowY,
              scrollHeight: el.scrollHeight, clientHeight: el.clientHeight,
            }));
            // The text itself, laid out where Chrome put it once the body is back at its top: a Range over the
            // substring, because the question is one element of forty lines.
            const boxOf = (text: string): Box | null => {
              const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
              for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
                const at = (n.textContent ?? '').indexOf(text);
                if (at < 0) continue;
                const range = document.createRange();
                range.setStart(n, at);
                range.setEnd(n, at + text.length);
                const r = range.getBoundingClientRect();
                return { top: r.top, bottom: r.bottom };
              }
              return null;
            };
            const body = panel.querySelector<HTMLElement>('.sheet-body');
            if (body !== null) body.scrollTop = 0;
            return {
              first: boxOf(FIRST_LINE_ARG), who: boxOf(WHO_LINE_ARG), viewportHeight: window.innerHeight,
              scrollers,
              titleScrolls: title !== null && scrolls(title),
              pageSide: document.documentElement.scrollWidth - document.documentElement.clientWidth,
              panelText: panel.innerText,
            };
          }, [FIRST_LINE, WHO_LINE] as const);
        } finally {
          await opened.ctx.close();
        }
      }, 60_000);

      it('shows the question and who asks', () => {
        expect(measured, 'the ask sheet opened').toBeDefined();
        const m = measured!;
        expect(m.panelText).toContain(FIRST_LINE);
        expect(m.panelText).toContain(WHO_LINE);
        // Laid out, not only present: with the body at its top both lines sit inside the window.
        for (const [what, box] of [['the first line', m.first], ['the who line', m.who]] as const) {
          expect(box, `${what} is in the sheet`).not.toBeNull();
          expect(box!.top, `${what} starts inside the window`).toBeGreaterThanOrEqual(0);
          expect(box!.bottom, `${what} ends inside the window`).toBeLessThanOrEqual(m.viewportHeight);
        }
      });

      it('the ask has one vertical scroller', () => {
        const m = measured!;
        expect(m.titleScrolls, 'the title is not a scroller').toBe(false);
        expect(m.scrollers.map((s) => s.cls), 'one element scrolls vertically, and it is the sheet body').toHaveLength(1);
        expect(m.scrollers[0]!.cls).toContain('sheet-body');
      });

      it('no horizontal page scroll', () => {
        expect(measured!.pageSide).toBeLessThanOrEqual(0);
      });

      it('no page error', () => {
        expect(errors).toEqual([]);
      });
    });
  }
});
