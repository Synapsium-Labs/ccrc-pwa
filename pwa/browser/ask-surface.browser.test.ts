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
// Each view also asserts what the surface DOES show (the question's first line and the who line) and that the question
// "reads from its top when the sheet opens": measured as the sheet settled, with nothing scrolled by the test, the body
// is at its top and both lines lie inside the body's own rectangle. A desk view (1280, where the ask is the inline card of
// D-6326) holds that case alone, since the open-time focus differs there.
//
// The fixture's data is `test/askFixtures.ts`'s (`askFixture(1)` and `longHookEnvelope()`, the forty-line variant
// this file alone reads), so no copy is kept here; the browser config imports from `../test/` as
// `name-field.browser.test.tsx` already does.
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
import { ASKER_PROJECT, ASKER_SESSION, LONG_QUESTION, askFixture, longHookEnvelope } from '../test/askFixtures';
import type { HookAsk } from '../../shared/api';

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
const FRAMES = (twice: boolean): object[] => {
  const { frames } = askFixture(1);
  const envelope = (): HookAsk => {
    const ask = longHookEnvelope();
    if (twice && 'questions' in ask) ask.questions[0] = { ...ask.questions[0]!, question: `${LONG_QUESTION}\n${LONG_QUESTION}` };
    return ask;
  };
  return [
    BACKLOG,
    { type: 'status', status: 'busy', statusUpdatedAt: null },
    ...frames.map((f) => (f.type === 'ask' ? { ...f, ask: envelope() } : f)),
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
interface Box { top: number; bottom: number }
interface Measure {
  scrollers: Scroller[];
  titleScrolls: boolean;
  pageSide: number;
  panelText: string;
  /** Is focus inside the surface as it settled? */
  focusIn: boolean;
  /** As the sheet opened and settled, nothing scrolled by the test: the body's scroll offset, the panel's and the
   *  body's rectangles, and the question's first line and the who line as rectangles. */
  bodyScrollTop: number | null;
  panel: Box;
  body: Box | null;
  first: Box | null;
  who: Box | null;
}

/** Open fixture 1 at `view`, let the sheet settle, and measure it as it stands. `twice` doubles the question to eighty
 *  lines: at a desk the first option of the forty-line question is already on screen, so only a longer one makes the
 *  open-time focus want to scroll. */
async function openAndMeasure(view: AppView, twice = false): Promise<{ measured: Measure; errors: string[] }> {
  const opened = await openApp(browser!, view, FIXTURE);
  try {
    await opened.ctx.routeWebSocket(/\/ws\/session\//, (ws) => {
      for (const frame of FRAMES(twice)) ws.send(JSON.stringify(frame));
    });
    await opened.page.goto(`${server!.origin}/s/${SESSION.id}`);
    await opened.page.waitForSelector('.sheet-panel .ask-who, [data-ask-surface] .ask-who', { timeout: 30_000 });
    await opened.page.waitForTimeout(800); // the sheet's entrance (vaul) and its open-time focus settle
    const shots = process.env['CCRC_SHOTS'];
    if (shots !== undefined && shots !== '') {
      mkdirSync(shots, { recursive: true });
      await opened.page.screenshot({ path: path.join(shots, shotName(view)) });
    }
    const measured = await opened.page.evaluate(([FIRST_LINE_ARG, WHO_LINE_ARG]): Measure => {
      // The panel is found from the ask itself: the who line is the ask's own.
      // (At a desk the surface is T1c's inline card, `[data-ask-surface]`, whose one scroller is `.ask-inline-body`.)
      const panel = document.querySelector('.ask-who')!.closest<HTMLElement>('.sheet-panel, [data-ask-surface]')!;
      const title = panel.querySelector<HTMLElement>('.sheet-title');
      const scrolls = (el: HTMLElement): boolean => {
        const oy = getComputedStyle(el).overflowY;
        return (oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1;
      };
      const scrollers = [panel, ...panel.querySelectorAll<HTMLElement>('*')].filter(scrolls).map((el) => ({
        cls: el.getAttribute('class') ?? el.tagName, overflowY: getComputedStyle(el).overflowY,
        scrollHeight: el.scrollHeight, clientHeight: el.clientHeight,
      }));
      // The text itself, laid out where Chrome put it: a Range over the substring, because the question is one
      // element of forty lines.
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
      const body = panel.querySelector<HTMLElement>('.sheet-body, .ask-inline-body');
      const bodyRect = body?.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      return {
        scrollers,
        titleScrolls: title !== null && scrolls(title),
        pageSide: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        panelText: panel.innerText,
        focusIn: panel.contains(document.activeElement),
        bodyScrollTop: body?.scrollTop ?? null,
        panel: { top: panelRect.top, bottom: panelRect.bottom },
        body: bodyRect === undefined ? null : { top: bodyRect.top, bottom: bodyRect.bottom },
        first: boxOf(FIRST_LINE_ARG),
        who: boxOf(WHO_LINE_ARG),
      };
    }, [FIRST_LINE, WHO_LINE] as const);
    return { measured, errors: opened.errors };
  } finally {
    await opened.ctx.close();
  }
}

/** The claim of the open sheet: nothing has scrolled the question away, its first line sits inside the body's own
 *  rectangle (not merely inside the window), and the who line, which the eyebrow keeps above the body, sits inside the
 *  panel. (Two pixels of slack: a Range's rectangle is the glyphs' box, which a tight line height lets reach a pixel
 *  past the line.) */
function expectReadsFromTop(m: Measure): void {
  expect(m.body, 'the sheet has a body').not.toBeNull();
  expect(m.bodyScrollTop, 'the body opens at its top').toBeLessThanOrEqual(1);
  const inside = (what: string, box: Box | null, within: Box, name: string): void => {
    expect(box, `${what} is in the sheet`).not.toBeNull();
    expect(box!.top, `${what} starts inside the ${name}`).toBeGreaterThanOrEqual(within.top - 2);
    expect(box!.bottom, `${what} ends inside the ${name}`).toBeLessThanOrEqual(within.bottom + 2);
  };
  inside('the first line', m.first, m.body!, 'body');
  inside('the who line', m.who, m.panel, 'panel');
}

describe('an ask holds one vertical scroller (D-6325)', () => {
  for (const view of VIEWS) {
    describe(named(view), () => {
      // One page load per view, measured by the cases below (the plan's names stay greppable).
      let measured: Measure | undefined;
      let errors: string[] = [];

      beforeAll(async () => {
        ({ measured, errors } = await openAndMeasure(view));
      }, 90_000);

      it('shows the question and who asks', () => {
        expect(measured, 'the ask sheet opened').toBeDefined();
        expect(measured!.panelText).toContain(FIRST_LINE);
        expect(measured!.panelText).toContain(WHO_LINE);
      });

      it('the question reads from its top when the sheet opens', () => {
        expectReadsFromTop(measured!);
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

// At a desk the ask is T1c's inline card (D-6326), where the open-time focus (`useAskKeys`, a fine pointer's) does not
// run: the card opens at its top because nothing moves focus into it. Its own view, with an eighty-line question so that
// the first option is below the fold and focusing it would scroll the body; this case also holds that nothing did.
describe('an ask at a desk opens at its top too (D-6325, D-6326)', () => {
  const desk: AppView = { skin: REFINED, theme: PHOSPHOR, width: 1280 };
  it(named(desk), async () => {
    const { measured, errors } = await openAndMeasure(desk, true);
    expect(measured.panelText).toContain(FIRST_LINE);
    expect(measured.scrollers.map((s) => s.cls), 'the question overflows its body').toHaveLength(1);
    expect(measured.focusIn, 'the arriving ask takes no focus').toBe(false);
    expectReadsFromTop(measured);
    expect(errors).toEqual([]);
  }, 90_000);
});

// The ask holds through a reconnect (D-6325, decision `the-ask-holds-through-a-reconnect`), re-running the review's
// measurement in Chrome: fixture 1 open, the routed session socket closed by its handler ~3 s in, the page's own
// reconnect opening a second routed connection that sends `dialog` at once and `ask` two seconds later. The sheet is
// sampled in the page every 250 ms from the drop until the `ask` frame and half a second more. Before the hold the sheet
// was absent from ~2250 ms after the drop until the `ask` frame (the whole connect pipeline), replaying its entrance and
// closing a phone's keyboard; now it is present at every sample, read-only with one status line, and live again after.
describe('a reconnect keeps the open ask on screen (D-6325)', () => {
  const view: AppView = { skin: REFINED, theme: PHOSPHOR, width: 390 };
  const DROP_AFTER_MS = 3_000;
  const ASK_AFTER_MS = 2_000;
  const SAMPLE_MS = 250;
  const RECONNECTING = 'Reconnecting. Nothing can be sent until the session is back.';

  interface Sample { at: number; present: boolean; status: string | null; panelId: string | null }

  it(`${named(view)}: present at every sample from the drop to the new connection's ask frame, with the status line`, async () => {
    const opened = await openApp(browser!, view, FIXTURE);
    try {
      let dropAt = 0;
      let askAt = 0;
      let connections = 0;
      await opened.ctx.routeWebSocket(/\/ws\/session\//, (ws) => {
        connections += 1;
        if (connections === 1) {
          for (const frame of FRAMES(false)) ws.send(JSON.stringify(frame));
          setTimeout(() => { dropAt = Date.now(); void ws.close(); }, DROP_AFTER_MS);
          return;
        }
        // The new connection: its dialog at once, the envelope after the rest of the connect pipeline.
        const { frames } = askFixture(1);
        const dialog = frames.find((f) => f.type === 'dialog')!;
        const ask = FRAMES(false).find((f) => (f as { type?: string }).type === 'ask')!;
        ws.send(JSON.stringify(dialog));
        setTimeout(() => { askAt = Date.now(); ws.send(JSON.stringify(ask)); }, ASK_AFTER_MS);
      });
      await opened.page.goto(`${server!.origin}/s/${SESSION.id}`);
      await opened.page.waitForSelector('.sheet-panel .ask-who', { timeout: 30_000 });
      await opened.page.waitForTimeout(800);
      // The sampler lives in the page and stamps each sample with the clock this file reads.
      await opened.page.evaluate((ms) => {
        const w = window as unknown as { __samples: unknown[] };
        w.__samples = [];
        let seq = 0;
        const panelIds = new WeakMap<Element, string>();
        setInterval(() => {
          const who = document.querySelector('.sheet-panel .ask-who');
          const panel = who?.closest('.sheet-panel') ?? null;
          if (panel !== null && !panelIds.has(panel)) panelIds.set(panel, `panel-${seq++}`);
          w.__samples.push({
            at: Date.now(),
            present: panel !== null,
            status: panel?.querySelector('[role="status"]')?.textContent ?? null,
            panelId: panel === null ? null : panelIds.get(panel)!,
          });
        }, ms);
      }, SAMPLE_MS);

      // Wait for the drop, the reconnect, and the ask frame, then half a second more.
      await expect.poll(() => askAt, { timeout: 30_000, interval: 100 }).toBeGreaterThan(0);
      await opened.page.waitForTimeout(500 + SAMPLE_MS);
      const samples = await opened.page.evaluate(() => (window as unknown as { __samples: Sample[] }).__samples);

      expect(dropAt, 'the route handler dropped the first connection').toBeGreaterThan(0);
      expect(connections, 'the page reconnected on its own').toBe(2);
      const after = samples.filter((s) => s.at >= dropAt);
      const gap = after.filter((s) => s.at < askAt);
      // The gap is the new connection's connect pipeline, and the sampling reaches the review's 2250 ms mark.
      expect(askAt - dropAt, 'the gap is long enough to reach the review\'s measurement').toBeGreaterThanOrEqual(2_250);
      expect(gap.some((s) => s.at - dropAt >= 2_000 && s.at - dropAt <= 2_500), 'a sample near 2250 ms after the drop').toBe(true);
      expect(gap.length).toBeGreaterThanOrEqual(8);
      // Present at every sample, and always the same panel (no remount, so no new entrance).
      expect(after.filter((s) => !s.present).map((s) => s.at - dropAt), 'samples with the sheet absent').toEqual([]);
      expect(new Set(samples.filter((s) => s.present).map((s) => s.panelId)).size, 'the panel was replaced').toBe(1);
      // The status line through the gap (the first sample may precede the close event reaching the page), gone after.
      const settled = gap.filter((s) => s.at - dropAt >= SAMPLE_MS * 2);
      expect(settled.map((s) => s.status), 'the status line through the gap').toEqual(settled.map(() => RECONNECTING));
      const live = after.filter((s) => s.at >= askAt + 200);
      expect(live.length).toBeGreaterThan(0);
      expect(live.map((s) => s.status), 'the status line after the ask frame').toEqual(live.map(() => null));
      expect(opened.errors).toEqual([]);
    } finally {
      await opened.ctx.close();
    }
  }, 90_000);
});
