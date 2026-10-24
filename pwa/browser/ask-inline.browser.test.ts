// The inline ask holds ONE vertical scroller, leaves the transcript a third of the pane, and keeps its keys to itself
// (D-6326, desktop-polish plan, T1c Step 1, with R41's F4), in a real Chrome over the production build.
//
// At the desk (>=900, `useDesk()`) an ask is not a sheet: `AskSurface` seats a `<section data-ask-surface="inline">`
// between the transcript and the strips. jsdom lays nothing out, so this file holds what Chrome computes: fixture 1 (the
// hook envelope with its three questions) with the forty-line first question, at 1280 and 1920 in both skins and both
// palettes (Phosphor & Ink, dark; Phosphor Daylight, light) —
//   - "the card has one vertical scroller": inside `[data-ask-surface]` exactly one element scrolls (computed
//     `overflow-y` of `auto` or `scroll` AND `scrollHeight > clientHeight + 1`), it is the card's body, and the card
//     itself and the page add no vertical scroll;
//   - "the transcript keeps at least a third of the pane": `.chat-body`'s height is at least a third of `.chat`'s (the
//     rule is `.chat[data-ask-inline] > .chat-body { min-height: calc(100% / 3) }`; without it the forty-line card
//     takes what it asks for and the transcript is squeezed);
//   - "the card sits inside the reading column, its edges on the composer's field": the card is as wide as the
//     composer's content box, as the transcript's cards are, not as its padded outer box;
//   - "no page error": nothing uncaught was thrown.
// One more view holds "no horizontal page scroll" at 1600 with Refined's inspector rail, where the pane is narrower
// than the reading measure and the card yields to it.
//
// R41's F4 is measured at the desk (1280, Refined, Phosphor & Ink): the card is a `<section>`, not a dialog, so its keys
// act only when the event's target is inside it. A click on the fleet column's empty space moves focus out, and `2` then
// makes no answer request; a click on the card's own text moves it back in, and `2` answers (a POST to the session's
// `/dialog` route, which this file records from the page's own requests: `app.ts` fulfils every `/api` call itself).
//
// The fixture's data is `test/askFixtures.ts`'s (`askFixture(1)` and `longHookEnvelope()`), as `ask-surface.browser.test.ts`
// reads it, so no copy is kept here.
//
// For the per-width review: `CCRC_SHOTS=<a directory>` keeps one picture per view. Run: `( cd pwa &&
// CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts
// browser/ask-inline.browser.test.ts )`.
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
  [1280, 1920].map((width) => ({ skin, theme, width }))));
const named = (v: AppView): string => `${v.skin}, ${v.theme}, ${v.width}px`;
const shotName = (v: AppView): string => `ask-inline-${v.skin}-${v.theme}-${v.width}.png`;

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
const CARD = '[data-ask-surface="inline"]';

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
  cardCount: number;
  sheetCount: number;
  scrollers: Scroller[];
  pageScroll: number;
  chatHeight: number;
  transcriptHeight: number;
  pageSide: number;
  /** The card's left and right edges, and the composer's content edges (its box less its padding). */
  card: { left: number; right: number };
  field: { left: number; right: number };
}

/** Open fixture 1 at `view`, let the card settle, and measure it as it stands. */
async function openAndMeasure(view: AppView): Promise<{ measured: Measure; errors: string[] }> {
  const opened = await openApp(browser!, view, FIXTURE);
  try {
    await opened.ctx.routeWebSocket(/\/ws\/session\//, (ws) => {
      for (const frame of FRAMES()) ws.send(JSON.stringify(frame));
    });
    await opened.page.goto(`${server!.origin}/s/${SESSION.id}`);
    await opened.page.waitForSelector(`${CARD} .ask-who`, { timeout: 30_000 });
    await opened.page.waitForTimeout(800); // the card's first layout and its fonts settle
    const shots = process.env['CCRC_SHOTS'];
    if (shots !== undefined && shots !== '') {
      mkdirSync(shots, { recursive: true });
      await opened.page.screenshot({ path: path.join(shots, shotName(view)) });
    }
    const measured = await opened.page.evaluate((card): Measure => {
      const el = document.querySelector<HTMLElement>(card)!;
      const scrolls = (e: HTMLElement): boolean => {
        const oy = getComputedStyle(e).overflowY;
        return (oy === 'auto' || oy === 'scroll') && e.scrollHeight > e.clientHeight + 1;
      };
      const scrollers = [el, ...el.querySelectorAll<HTMLElement>('*')].filter(scrolls).map((e) => ({
        cls: e.getAttribute('class') ?? e.tagName, overflowY: getComputedStyle(e).overflowY,
        scrollHeight: e.scrollHeight, clientHeight: e.clientHeight,
      }));
      const chat = el.closest<HTMLElement>('.chat')!;
      const doc = document.documentElement;
      return {
        cardCount: document.querySelectorAll('[data-ask-surface]').length,
        sheetCount: document.querySelectorAll('.sheet-panel').length,
        scrollers,
        pageScroll: Math.max(doc.scrollHeight - doc.clientHeight, document.body.scrollHeight - document.body.clientHeight),
        chatHeight: chat.getBoundingClientRect().height,
        transcriptHeight: chat.querySelector<HTMLElement>(':scope > .chat-body')!.getBoundingClientRect().height,
        pageSide: doc.scrollWidth - doc.clientWidth,
        card: { left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right },
        field: (() => {
          const composer = chat.querySelector<HTMLElement>('.composer')!;
          const r = composer.getBoundingClientRect();
          const cs = getComputedStyle(composer);
          return { left: r.left + parseFloat(cs.paddingLeft), right: r.right - parseFloat(cs.paddingRight) };
        })(),
      };
    }, CARD);
    return { measured, errors: opened.errors };
  } finally {
    await opened.ctx.close();
  }
}

describe('the inline ask holds one vertical scroller and leaves the transcript its third (D-6326)', () => {
  for (const view of VIEWS) {
    describe(named(view), () => {
      // One page load per view, measured by the cases below (the plan's names stay greppable).
      let measured: Measure | undefined;
      let errors: string[] = [];

      beforeAll(async () => {
        ({ measured, errors } = await openAndMeasure(view));
      }, 90_000);

      it('is one card and no sheet', () => {
        expect(measured, 'the inline card opened').toBeDefined();
        expect(measured!.cardCount).toBe(1);
        expect(measured!.sheetCount).toBe(0);
      });

      it('the card has one vertical scroller', () => {
        const m = measured!;
        expect(m.scrollers.map((s) => s.cls), 'one element scrolls vertically, and it is the card body').toHaveLength(1);
        expect(m.scrollers[0]!.cls).toContain('ask-inline-body');
        expect(m.pageScroll, 'the card adds no vertical scroll to the page').toBeLessThanOrEqual(1);
      });

      it('the transcript keeps at least a third of the pane', () => {
        const m = measured!;
        expect(m.transcriptHeight, `the transcript (${m.transcriptHeight}px) of a pane of ${m.chatHeight}px`)
          .toBeGreaterThanOrEqual(m.chatHeight / 3 - 1);
      });

      it('the card sits inside the reading column, its edges on the composer\'s field', () => {
        const m = measured!;
        expect(Math.abs(m.card.left - m.field.left), `card left ${m.card.left}, field left ${m.field.left}`).toBeLessThanOrEqual(1);
        expect(Math.abs(m.card.right - m.field.right), `card right ${m.card.right}, field right ${m.field.right}`).toBeLessThanOrEqual(1);
      });

      it('no page error', () => {
        expect(errors).toEqual([]);
      });
    });
  }
});

// At 1600 Refined draws its inspector rail, so the session pane is narrower than the reading measure: the card yields
// to it (`max-width: min(var(--measure-chat), 100%)`) and the page gains no sideways scroll.
describe('the inline ask at 1600 with the inspector rail (D-6326)', () => {
  const view: AppView = { skin: REFINED, theme: PHOSPHOR, width: 1600 };
  it('no horizontal page scroll at 1600 with Refined\'s inspector rail', async () => {
    const { measured, errors } = await openAndMeasure(view);
    expect(measured.cardCount).toBe(1);
    expect(measured.pageSide).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  }, 90_000);
});

// R41's F4. The card is a section, not a dialog, so `useAskKeys` acts only on a key whose target is inside it.
describe('the inline ask\'s keys at the desk (R41 F4, D-6326)', () => {
  const view: AppView = { skin: REFINED, theme: PHOSPHOR, width: 1280 };
  it('a click outside the card takes its keys away; a click on the card\'s text gives them back (R41 F4)', async () => {
    const opened = await openApp(browser!, view, FIXTURE);
    try {
      const answers: string[] = [];
      opened.page.on('request', (r) => {
        if (r.method() === 'POST' && new URL(r.url()).pathname === `/api/sessions/${SESSION.id}/dialog`) answers.push(r.postData() ?? '');
      });
      await opened.ctx.routeWebSocket(/\/ws\/session\//, (ws) => {
        for (const frame of FRAMES()) ws.send(JSON.stringify(frame));
      });
      await opened.page.goto(`${server!.origin}/s/${SESSION.id}`);
      await opened.page.waitForSelector(`${CARD} .ask-who`, { timeout: 30_000 });
      await opened.page.waitForTimeout(800);

      // The fleet column's empty space: the foot of the list column, found where no row, button or link is painted.
      const empty = await opened.page.evaluate((): { x: number; y: number; hit: string } => {
        const fleet = document.querySelector<HTMLElement>('section.fleet')!;
        const r = fleet.getBoundingClientRect();
        const x = r.left + r.width / 2;
        const y = r.bottom - 24;
        const hit = document.elementFromPoint(x, y)!;
        return { x, y, hit: `${hit.tagName.toLowerCase()}.${hit.getAttribute('class') ?? ''}` + (hit.closest('button, a, [role="button"]') === null ? '' : ' (control)') };
      });
      expect(empty.hit, 'the click lands on the column\'s empty space, not on a control').not.toContain('(control)');
      await opened.page.mouse.click(empty.x, empty.y);
      const outsideFocus = await opened.page.evaluate((card) => document.querySelector(card)!.contains(document.activeElement), CARD);
      expect(outsideFocus, 'focus is not inside the card after a click outside it').toBe(false);
      await opened.page.keyboard.press('2');
      await opened.page.waitForTimeout(600);
      expect(answers, 'a digit with focus outside the card makes no answer request').toEqual([]);

      await opened.page.getByText(FIRST_LINE).first().click();
      const insideFocus = await opened.page.evaluate((card) => document.querySelector(card)!.contains(document.activeElement), CARD);
      expect(insideFocus, 'focus is inside the card after a click on its text').toBe(true);
      await opened.page.keyboard.press('2');
      await expect.poll(() => answers.length, { timeout: 10_000, interval: 100 }).toBe(1);
      expect(JSON.parse(answers[0]!), 'the key 2 answers option 2 (the rows are numbered from 1)').toMatchObject({ optionIndex: 2 });
      expect(opened.errors).toEqual([]);
    } finally {
      await opened.ctx.close();
    }
  }, 90_000);
});
