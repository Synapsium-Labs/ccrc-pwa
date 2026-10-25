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
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { buildDist, openApp, removeDist, serveDist, type AppFixture, type AppView, type DistServer } from './app';
import { sendErrorText } from '../src/lib/api';
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
  /** What bounds the card's width: the column it sits in (its parent's content width), the reading measure
   *  (`--measure-chat`) and the card's side inset (`--sp-4`), each resolved to px by Chrome from the token itself. */
  bound: { column: number; measure: number; inset: number };
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
        bound: (() => {
          const px = (token: string): number => {
            const probe = document.createElement('div');
            probe.style.cssText = `position:absolute;visibility:hidden;width:var(${token})`;
            document.body.appendChild(probe);
            const w = probe.getBoundingClientRect().width;
            probe.remove();
            return w;
          };
          return { column: el.parentElement!.clientWidth, measure: px('--measure-chat'), inset: px('--sp-4') };
        })(),
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

// At 1600 Refined draws its inspector rail and the page gains no sideways scroll. The card is bounded by
// `min(var(--measure-chat), 100%)` less its two insets (`.ask-inline`'s `max-width`), which `pageSide <= 0` alone cannot
// see: a card that was too wide by two insets still fits the page. So the width is measured against what bounds it. As
// measured here the column (880px) is WIDER than the reading measure (820px), so the measure binds and the `100%` arm,
// the card yielding to a column narrower than the measure, is not exercised at this width.
describe('the inline ask at 1600 with the inspector rail (D-6326)', () => {
  const view: AppView = { skin: REFINED, theme: PHOSPHOR, width: 1600 };
  let measured: Measure | undefined;
  let errors: string[] = [];

  beforeAll(async () => {
    ({ measured, errors } = await openAndMeasure(view));
  }, 90_000);

  it('no horizontal page scroll at 1600 with Refined\'s inspector rail', () => {
    expect(measured!.cardCount).toBe(1);
    expect(measured!.pageSide).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  });

  it('the card is no wider than the reading measure or its column less its two insets, and its edges sit on the composer\'s field', () => {
    const m = measured!;
    const { column, measure, inset } = m.bound;
    const width = m.card.right - m.card.left;
    const room = Math.min(measure, column) - 2 * inset;
    expect(inset, 'premise: the inset resolved from its token').toBeGreaterThan(0);
    expect(measure, 'premise: the reading measure resolved from its token').toBeGreaterThan(2 * inset);
    expect(width, `the card (${width}px) is no wider than min(measure ${measure}px, column ${column}px) less two ${inset}px insets`)
      .toBeLessThanOrEqual(room + 1);
    expect(Math.abs(m.card.left - m.field.left), `card left ${m.card.left}, field left ${m.field.left}`).toBeLessThanOrEqual(1);
    expect(Math.abs(m.card.right - m.field.right), `card right ${m.card.right}, field right ${m.field.right}`).toBeLessThanOrEqual(1);
  });
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

/** The live `AskUserQuestion` call the transcript's card is drawn from, so "Go to question" is offered beside the inline card. */
const CALL = {
  kind: 'tool_use', uuid: 'a2', ts: TS, toolId: 't1', name: 'AskUserQuestion',
  input: JSON.stringify({ questions: [{ question: 'Which cache should the service use?', header: 'Cache', multiSelect: false,
    options: [{ label: 'Redis' }, { label: 'In-process' }] }] }),
};
/** `frames` (fixture 1's, with the forty-line question, unless a case names another) with that call in the backlog. */
const WITH_CALL = (frames: object[] = FRAMES()): object[] =>
  frames.map((f) => ((f as { type?: string }).type === 'backlog'
    ? { ...BACKLOG, events: [...BACKLOG.events, CALL] }
    : f));

// R64 F5: the transcript's live ask card offers "Go to question" at the desk. It raises the mounted inline card (the
// existing raise path): the card scrolls into view and its first option takes focus. The transcript here holds the live
// `AskUserQuestion` call, so its card is drawn beside the inline one. Measured layout: at 1280x900 nothing scrolls the
// card out of the viewport (the page, `.chat` and `.chat-body` have no overflow to scroll), so the two viewport assertions
// below are layout pins only (they hold with or without the raise), and what this case holds of the raise is that focus,
// parked on the body before the click, is on the first option.
// (R69 F3 made the raise reveal the focused option: 'Go to question reveals the focused option' holds that geometry.)
describe('Go to question at the desk (R64 F5, D-6326)', () => {
  const view: AppView = { skin: REFINED, theme: PHOSPHOR, width: 1280 };

  it('clicking it with focus on the page body puts focus on the card\'s first option (the card stays in the viewport)', async () => {
    const opened = await openApp(browser!, view, FIXTURE);
    try {
      await opened.ctx.routeWebSocket(/\/ws\/session\//, (ws) => {
        for (const frame of WITH_CALL()) ws.send(JSON.stringify(frame));
      });
      await opened.page.goto(`${server!.origin}/s/${SESSION.id}`);
      await opened.page.waitForSelector(`${CARD} .ask-who`, { timeout: 30_000 });
      await opened.page.waitForTimeout(800);
      const button = opened.page.locator('.tool-ask .ask-state button', { hasText: 'Go to question' });
      expect(await button.count(), 'premise: the transcript card offers Go to question').toBe(1);
      expect(await opened.page.locator('.tool-ask .ask-state', { hasText: 'waiting for you, below' }).count(), 'beside the word').toBe(1);

      // Premise: nothing of the card is focused, and every scroller the layout has is at the far end from the options.
      const before = await opened.page.evaluate((card) => {
        const el = document.querySelector<HTMLElement>(card)!;
        const chat = el.closest<HTMLElement>('.chat')!;
        for (const e of [document.scrollingElement as HTMLElement, document.body, chat, chat.querySelector<HTMLElement>(':scope > .chat-body')!]) {
          e.scrollTop = e.scrollHeight;
        }
        el.querySelector<HTMLElement>('.ask-inline-body')!.scrollTop = 0;
        (document.activeElement as HTMLElement | null)?.blur();
        return el.contains(document.activeElement);
      }, CARD);
      expect(before, 'premise: focus is outside the card before the click').toBe(false);

      await button.click();
      await opened.page.waitForTimeout(300);
      const after = await opened.page.evaluate((card) => {
        const el = document.querySelector<HTMLElement>(card)!;
        const r = el.getBoundingClientRect();
        const first = el.querySelector<HTMLElement>('.opt[tabindex="0"]');
        return {
          top: r.top, bottom: r.bottom, vh: window.innerHeight,
          cards: document.querySelectorAll('[data-ask-surface]').length,
          focusIsFirst: first !== null && document.activeElement === first,
          focused: document.activeElement?.getAttribute('class') ?? document.activeElement?.tagName ?? '',
        };
      }, CARD);
      expect(after.cards, 'still one inline card').toBe(1);
      expect(after.top, 'layout pin: at 1280x900 the card cannot leave the viewport (its top)').toBeGreaterThanOrEqual(0);
      expect(after.bottom, 'layout pin: at 1280x900 the card cannot leave the viewport (its bottom)').toBeLessThanOrEqual(after.vh + 1);
      expect(after.focusIsFirst, `focus is on the card's first option (it is on ${after.focused})`).toBe(true);
      expect(opened.errors).toEqual([]);
    } finally {
      await opened.ctx.close();
    }
  }, 90_000);
});

// R69 F3: "Go to question" must leave the FOCUSED option visible, not only focused. The raise's `preventScroll` focus
// lands on the first option, which on fixture 1's forty-line question sits below the card's one scroller (`.ask-inline-body`,
// `scrollTop` 0) and below the window. Review 932 measured it in these three views (scroller 496-769 / option 997-1061 at
// Refined dark 1280, 496-769 / 976-1040 at 1600, 460-749 / 918-980 at Instrument light 1920, viewport height 900). So the
// assertion here is geometry, never identity: the option's rect lies inside the scroller's rect AND inside the window.
// The focus-identity case above stays as its own control (it holds with or without the reveal).
describe('Go to question reveals the focused option (R69 F3, D-6326)', () => {
  const GOTO_VIEWS: AppView[] = [
    { skin: REFINED, theme: PHOSPHOR, width: 1280 },
    { skin: REFINED, theme: PHOSPHOR, width: 1600 },
    { skin: INSTRUMENT, theme: 'light', width: 1920 },
  ];
  interface Geometry {
    inCard: boolean; focusIsFirst: boolean; vh: number; scrollTop: number; scrollHeight: number; clientHeight: number;
    scroller: [number, number]; option: [number, number];
    /** The focused option's own focus ring, in px: its computed `outlineWidth + outlineOffset` (base.css's `:focus-visible`),
     *  read after the click and never hard-coded here; `ringStyle` is its computed `outlineStyle`. */
    ring: number;
    ringStyle: string;
  }
  /** What must not move across the click: the composer's box and every scroller but the card's own body. */
  interface Stand { composer: { left: number; top: number; width: number }; page: number; chat: number; chatBody: number }
  const STAND = (card: string): Stand => {
    const chat = document.querySelector<HTMLElement>(card)!.closest<HTMLElement>('.chat')!;
    const r = chat.querySelector<HTMLElement>('.composer')!.getBoundingClientRect();
    return {
      composer: { left: r.left, top: r.top, width: r.width },
      page: (document.scrollingElement as HTMLElement).scrollTop,
      chat: chat.scrollTop,
      chatBody: chat.querySelector<HTMLElement>(':scope > .chat-body')!.scrollTop,
    };
  };
  const MEASURE = (card: string): Geometry => {
    const el = document.querySelector<HTMLElement>(card)!;
    const body = el.querySelector<HTMLElement>('.ask-inline-body')!;
    const a = document.activeElement as HTMLElement;
    const br = body.getBoundingClientRect();
    const ar = a.getBoundingClientRect();
    const cs = getComputedStyle(a);
    const ring = parseFloat(cs.outlineWidth) + parseFloat(cs.outlineOffset);
    return {
      ring, ringStyle: cs.outlineStyle, inCard: el.contains(a), focusIsFirst: a === el.querySelector<HTMLElement>('.opt[tabindex="0"]'), vh: window.innerHeight,
      scrollTop: body.scrollTop, scrollHeight: body.scrollHeight, clientHeight: body.clientHeight,
      scroller: [Math.round(br.top), Math.round(br.bottom)], option: [Math.round(ar.top), Math.round(ar.bottom)],
    };
  };
  /** Open `frames` at `view` with the call in the transcript, park focus on the body, click Go to question, and measure. */
  async function goTo(view: AppView, frames: object[]): Promise<{ g: Geometry; before: Stand; after: Stand; errors: string[] }> {
    const opened = await openApp(browser!, view, FIXTURE);
    try {
      await opened.ctx.routeWebSocket(/\/ws\/session\//, (ws) => {
        for (const frame of WITH_CALL(frames)) ws.send(JSON.stringify(frame));
      });
      await opened.page.goto(`${server!.origin}/s/${SESSION.id}`);
      await opened.page.waitForSelector(`${CARD} .ask-who`, { timeout: 30_000 });
      await opened.page.waitForTimeout(800);
      await opened.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      const before = await opened.page.evaluate(STAND, CARD);
      await opened.page.locator('.tool-ask .ask-state button', { hasText: 'Go to question' }).click();
      await opened.page.waitForTimeout(300);
      // A script focus that follows a mouse click is not `:focus-visible`, so no ring is drawn yet. A modifier alone does
      // nothing to the card (no digit, arrow or Escape), and makes Chrome match `:focus-visible` on the focused option, so
      // the ring is the one a keyboard user sees, and its width and offset are real computed values to measure.
      await opened.page.keyboard.press('Shift');
      await opened.page.waitForTimeout(100);
      return { g: await opened.page.evaluate(MEASURE, CARD), before, after: await opened.page.evaluate(STAND, CARD), errors: opened.errors };
    } finally {
      await opened.ctx.close();
    }
  }
  const inside = (inner: [number, number], outer: [number, number]): boolean => inner[0] >= outer[0] - 1 && inner[1] <= outer[1] + 1;

  for (const view of GOTO_VIEWS) {
    it(`${named(view)}: the focused first option lies inside the card's scroller and the window after Go to question`, async () => {
      const { g, before, after, errors } = await goTo(view, FRAMES());
      expect(g.inCard && g.focusIsFirst, 'premise: focus is on the first option (the identity control)').toBe(true);
      expect(g.scrollHeight, 'premise: the forty-line question overflows the one scroller').toBeGreaterThan(g.clientHeight);
      expect(inside(g.option, g.scroller), `the option ${JSON.stringify(g.option)} lies inside the scroller ${JSON.stringify(g.scroller)} (scrollTop ${g.scrollTop})`).toBe(true);
      expect(inside(g.option, [0, g.vh]), `the option ${JSON.stringify(g.option)} lies inside the window (0-${g.vh})`).toBe(true);
      // R69 N3 (characterization, green on arrival): nothing but the card's own body moved.
      for (const k of ['left', 'top', 'width'] as const) {
        expect(Math.abs(after.composer[k] - before.composer[k]), `the composer's ${k} moved ${before.composer[k]} -> ${after.composer[k]}`).toBeLessThanOrEqual(1);
      }
      expect(after.page, 'the page did not scroll across the click').toBe(before.page);
      expect(after.chat, '.chat did not scroll across the click').toBe(before.chat);
      expect(after.chatBody, '.chat-body did not scroll across the click').toBe(before.chatBody);
      // R69 N2: the focus ring is drawn outside the option (outline width plus offset) and the scroller clips it, so the
      // revealed option stops at least that far short of the scroller's bottom (`scroll-padding-block` on
      // `.ask-inline-body`, the app's own scroller), not flush with it. The bound is the focused option's own computed
      // ring, not the padding's token.
      expect(g.ringStyle, 'premise: the focused option draws a focus ring (an outline, so its width and offset are real)').not.toBe('none');
      expect(g.ring, 'premise: the focused option\'s outline width plus offset is read').toBeGreaterThan(0);
      expect(g.option[1], `ring room: the option's bottom ${g.option[1]} is at least ${g.ring}px (its outline width + offset) above the scroller's bottom ${g.scroller[1]}`)
        .toBeLessThanOrEqual(g.scroller[1] - g.ring + 1);
      expect(errors).toEqual([]);
    }, 90_000);
  }

  it('a card whose first option is already in view (fixture 2, the aged copy): Go to question leaves the body unscrolled', async () => {
    const short = [BACKLOG, { type: 'status', status: 'busy', statusUpdatedAt: null }, ...askFixture(2).frames];
    const { g, errors } = await goTo({ skin: REFINED, theme: PHOSPHOR, width: 1280 }, short);
    expect(g.inCard && g.focusIsFirst, 'premise: focus is on the first option').toBe(true);
    expect(g.scrollTop, 'the option was already in view, so the card body is not scrolled').toBe(0);
    expect(inside(g.option, g.scroller), `the option ${JSON.stringify(g.option)} lies inside the card's body ${JSON.stringify(g.scroller)}`).toBe(true);
    expect(errors).toEqual([]);
  }, 90_000);
});

// R69 F7: with an answer in flight every option is `disabled` (the roving tab stop, `tabindex="0"`, stays on the first row,
// which is a disabled button), and a disabled button cannot take focus. Measured in real Chrome before the fix (fixtures 1
// and 2, an answer click on option 2 whose `/dialog` request never resolves, focus parked on the body, a click on Go to
// question): `document.activeElement` was the Go to question button itself, outside the card. So the raise focused nothing in
// the card. The raise now takes an ENABLED highlighted row, else the first enabled option, else the card section (`tabindex
// -1`), and the in-flight card stays read-only: nothing is enabled and no second request is made.
describe('Go to question with an answer in flight (R69 F7, D-6326)', () => {
  it('focus lands on the card section, every option stays disabled, and no second answer is sent', async () => {
    const opened = await openApp(browser!, { skin: REFINED, theme: PHOSPHOR, width: 1280 }, FIXTURE);
    try {
      await opened.ctx.routeWebSocket(/\/ws\/session\//, (ws) => {
        for (const frame of WITH_CALL()) ws.send(JSON.stringify(frame));
      });
      const answers: string[] = [];
      // A later page route wins over `openApp`'s context route: this one never fulfils, so the answer stays in flight.
      await opened.page.route('**/api/sessions/*/dialog', (route) => { answers.push(route.request().postData() ?? ''); });
      await opened.page.goto(`${server!.origin}/s/${SESSION.id}`);
      await opened.page.waitForSelector(`${CARD} .ask-who`, { timeout: 30_000 });
      await opened.page.waitForTimeout(800);
      await opened.page.locator(`${CARD} button.opt`).nth(1).click();
      await opened.page.waitForSelector(`${CARD} .opt-wait`, { timeout: 10_000 });
      const flight = await opened.page.evaluate((card) => {
        const opts = [...document.querySelector<HTMLElement>(card)!.querySelectorAll<HTMLButtonElement>('button.opt')];
        return { count: opts.length, // the production raise's own selector (`AskSurface`), so a row disabled by aria alone is not counted either
          enabled: document.querySelector<HTMLElement>(card)!.querySelectorAll('.opt:not(:disabled):not([aria-disabled="true"])').length, stop: opts.filter((o) => o.tabIndex === 0 && o.disabled).length };
      }, CARD);
      expect(flight.count, 'premise: the card has option buttons').toBeGreaterThan(1);
      expect(flight.enabled, 'premise: every option is disabled while the answer is in flight').toBe(0);
      expect(flight.stop, 'premise: the roving tab stop is a disabled button').toBe(1);
      expect(answers.length, 'premise: one answer is in flight').toBe(1);
      await opened.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

      await opened.page.locator('.tool-ask .ask-state button', { hasText: 'Go to question' }).click();
      await opened.page.waitForTimeout(300);
      const after = await opened.page.evaluate((card) => {
        const el = document.querySelector<HTMLElement>(card)!;
        const a = document.activeElement as HTMLElement;
        return {
          isCard: a === el, inCard: el.contains(a), active: `${a.tagName}${a.className ? '.' + String(a.className).split(' ')[0] : ''}`,
          // the production raise's own selector (`AskSurface`)
          enabled: el.querySelectorAll('.opt:not(:disabled):not([aria-disabled="true"])').length,
        };
      }, CARD);
      expect(after.isCard, `focus is on the card section (it is on ${after.active})`).toBe(true);
      expect(after.enabled, 'the in-flight card stays read-only: no option was enabled').toBe(0);
      expect(answers.length, 'no second answer was sent').toBe(1);
      expect(opened.errors).toEqual([]);
    } finally {
      await opened.ctx.close();
    }
  }, 90_000);
});

// R77 F2: when the raise falls back to the card section itself (an answer in flight, R69 F7; or no enabled `.opt` row:
// the terminal door of fixtures 3 and 5, and fixture 7's Allow and Deny, which are buttons but not `.opt`), a keyboard user
// pressing Enter on "Go to question" must SEE where focus went. `.ask-inline { outline: none }` beat base.css's
// `:focus-visible` ring, so nothing was drawn. The cells below open each fallback at the desk, activate Go to question from
// the keyboard, and measure in Chrome that the section is the focused element, matches `:focus-visible`, draws an outline
// of a real style and width, and that the ring's outer box (the section's rect grown by outline width plus offset) lies
// inside the window and inside every ancestor that clips. Two controls pin the distinction: a mouse click on the same
// button focuses the section with no `:focus-visible` and no outline (a `:focus` rule would draw one), and with an
// enabled first option the keyboard raise still lands on that option and draws its own ring.
describe('Go to question draws a keyboard focus indicator on the card section (R77 F2, D-6326)', () => {
  /** Cells kept bounded: each skin at each width once, each palette once per skin. */
  const RING_VIEWS: AppView[] = [
    { skin: REFINED, theme: PHOSPHOR, width: 1280 },
    { skin: REFINED, theme: 'light', width: 1920 },
    { skin: INSTRUMENT, theme: PHOSPHOR, width: 1920 },
    { skin: INSTRUMENT, theme: 'light', width: 1280 },
  ];
  interface Ring {
    isSection: boolean; active: string; focusVisible: boolean; outlineStyle: string; outlineWidth: number; outlineOffset: number;
    /** The ring's outer box, in px. */
    box: { left: number; top: number; right: number; bottom: number };
    viewport: { width: number; height: number };
    /** Every ancestor that clips on some axis, nearest first, with the axes it clips and its padding box. */
    clips: { cls: string; x: boolean; y: boolean; left: number; top: number; right: number; bottom: number }[];
    enabled: number;
  }
  const MEASURE_RING = (card: string): Ring => {
    const el = document.querySelector<HTMLElement>(card)!;
    const a = document.activeElement as HTMLElement;
    const cs = getComputedStyle(el);
    const outlineWidth = parseFloat(cs.outlineWidth);
    const outlineOffset = parseFloat(cs.outlineOffset);
    const grow = (cs.outlineStyle === 'none' ? 0 : outlineWidth) + outlineOffset;
    const r = el.getBoundingClientRect();
    const clips: Ring['clips'] = [];
    for (let p = el.parentElement; p !== null; p = p.parentElement) {
      const pcs = getComputedStyle(p);
      const x = pcs.overflowX !== 'visible';
      const y = pcs.overflowY !== 'visible';
      if (!x && !y) continue;
      const pr = p.getBoundingClientRect();
      clips.push({
        cls: `${p.tagName.toLowerCase()}.${p.getAttribute('class') ?? ''}`, x, y,
        left: pr.left + p.clientLeft, top: pr.top + p.clientTop, right: pr.left + p.clientLeft + p.clientWidth, bottom: pr.top + p.clientTop + p.clientHeight,
      });
    }
    return {
      isSection: a === el, active: `${a.tagName.toLowerCase()}.${a.getAttribute('class') ?? ''}`.slice(0, 80),
      focusVisible: a.matches(':focus-visible'), outlineStyle: cs.outlineStyle, outlineWidth, outlineOffset,
      box: { left: r.left - grow, top: r.top - grow, right: r.right + grow, bottom: r.bottom + grow },
      viewport: { width: window.innerWidth, height: window.innerHeight }, clips,
      // the production raise's own selector (`AskSurface`)
          enabled: el.querySelectorAll('.opt:not(:disabled):not([aria-disabled="true"])').length,
    };
  };

  /** Frames of a cell: the fixture's own, with the transcript's live call so "Go to question" is offered. */
  const framesOf = (n: number): object[] => (n === 1 ? FRAMES() : [BACKLOG, { type: 'status', status: 'busy', statusUpdatedAt: null }, ...askFixture(n).frames]);

  /** Open fixture `n` at `view` (with an answer in flight when `inFlight`), focus Go to question and activate it with the
   *  keyboard (`how` 'key') or a mouse click ('mouse'); measure the section and the counters. */
  async function raise(n: number, view: AppView, o: { inFlight?: boolean; how: 'key' | 'mouse' }):
    Promise<{ ring: Ring; answers: number; errors: string[] }> {
    const opened = await openApp(browser!, view, FIXTURE);
    try {
      await opened.ctx.routeWebSocket(/\/ws\/session\//, (ws) => {
        for (const frame of WITH_CALL(framesOf(n))) ws.send(JSON.stringify(frame));
      });
      const answers: string[] = [];
      if (o.inFlight === true) {
        // A later page route wins over `openApp`'s context route: this one never fulfils, so the answer stays in flight.
        await opened.page.route('**/api/sessions/*/dialog', (route) => { answers.push(route.request().postData() ?? ''); });
      }
      await opened.page.goto(`${server!.origin}/s/${SESSION.id}`);
      await opened.page.waitForSelector(`${CARD} .ask-who`, { timeout: 30_000 });
      await opened.page.waitForTimeout(800);
      if (o.inFlight === true) {
        await opened.page.locator(`${CARD} button.opt`).nth(1).click();
        await opened.page.waitForSelector(`${CARD} .opt-wait`, { timeout: 10_000 });
      }
      await opened.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      const button = opened.page.locator('.tool-ask .ask-state button', { hasText: 'Go to question' });
      expect(await button.count(), `premise: the transcript card offers Go to question (fixture ${n})`).toBe(1);
      if (o.how === 'key') {
        await button.focus();
        await opened.page.keyboard.press('Enter');
      } else {
        await button.click();
      }
      await opened.page.waitForTimeout(300);
      const ring = await opened.page.evaluate(MEASURE_RING, CARD);
      return { ring, answers: answers.length, errors: opened.errors };
    } finally {
      await opened.ctx.close();
    }
  }

  /** The ring's outer box lies inside `[0, viewport]` and inside every clipping ancestor on the axes it clips. */
  function boxWithin(ring: Ring): string[] {
    const { box, viewport, clips } = ring;
    const out: string[] = [];
    if (box.left < -0.5 || box.top < -0.5 || box.right > viewport.width + 0.5 || box.bottom > viewport.height + 0.5) {
      out.push(`the window ${viewport.width}x${viewport.height}`);
    }
    for (const c of clips) {
      if ((c.x && (box.left < c.left - 0.5 || box.right > c.right + 0.5)) || (c.y && (box.top < c.top - 0.5 || box.bottom > c.bottom + 0.5))) {
        out.push(`the clip ${c.cls}`);
      }
    }
    return out;
  }

  const CELLS: { n: number; what: string; inFlight?: boolean }[] = [
    { n: 1, what: 'fixture 1 with an answer in flight', inFlight: true },
    { n: 3, what: 'fixture 3 (the terminal door, unreadable menu)' },
    { n: 5, what: 'fixture 5 (the terminal door, unparsed menu)' },
    { n: 7, what: 'fixture 7 (the approval: Allow and Deny are not .opt rows)' },
  ];

  for (const cell of CELLS) {
    for (const view of RING_VIEWS) {
      it(`${cell.what}, ${named(view)}: Enter on Go to question focuses the section, which draws a focus ring inside the window and its clip`, async () => {
        const { ring, answers, errors } = await raise(cell.n, view, { inFlight: cell.inFlight, how: 'key' });
        expect(ring.isSection, `premise: focus is on the card section (it is on ${ring.active})`).toBe(true);
        expect(ring.focusVisible, 'premise: the section matches :focus-visible (a keyboard raise)').toBe(true);
        if (cell.inFlight === true) {
          expect(ring.enabled, 'premise: no option is enabled while the answer is in flight').toBe(0);
          expect(answers, 'premise: only the one answer request was made').toBe(1);
        } else {
          expect(ring.enabled, 'premise: no enabled .opt row exists, so the raise fell back to the section').toBe(0);
        }
        expect(ring.outlineStyle, `the section draws a focus indicator: outline-style is ${ring.outlineStyle}`).not.toBe('none');
        expect(ring.outlineWidth, `the focus indicator has a real width (${ring.outlineWidth}px)`).toBeGreaterThanOrEqual(1);
        expect(boxWithin(ring), `the ring's outer box ${JSON.stringify(ring.box)} (width ${ring.outlineWidth}px, offset ${ring.outlineOffset}px) lies inside the window and every clipping ancestor`).toEqual([]);
        expect(errors).toEqual([]);
      }, 90_000);
    }
  }

  for (const n of [3, 7]) {
    it(`pointer control, fixture ${n}: a mouse click on Go to question focuses the section with no :focus-visible and no outline`, async () => {
      const { ring, errors } = await raise(n, { skin: REFINED, theme: PHOSPHOR, width: 1280 }, { how: 'mouse' });
      expect(ring.isSection, `premise: focus is on the card section (it is on ${ring.active})`).toBe(true);
      expect(ring.focusVisible, 'a pointer focus does not match :focus-visible').toBe(false);
      expect(ring.outlineStyle, `a pointer focus draws no outline (outline-style is ${ring.outlineStyle})`).toBe('none');
      expect(errors).toEqual([]);
    }, 90_000);
  }

  it('first-option control, fixture 1 with nothing in flight: keyboard Go to question focuses the first enabled option, and its own ring is drawn', async () => {
    const opened = await openApp(browser!, { skin: REFINED, theme: PHOSPHOR, width: 1280 }, FIXTURE);
    try {
      await opened.ctx.routeWebSocket(/\/ws\/session\//, (ws) => {
        for (const frame of WITH_CALL(FRAMES())) ws.send(JSON.stringify(frame));
      });
      await opened.page.goto(`${server!.origin}/s/${SESSION.id}`);
      await opened.page.waitForSelector(`${CARD} .ask-who`, { timeout: 30_000 });
      await opened.page.waitForTimeout(800);
      await opened.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await opened.page.locator('.tool-ask .ask-state button', { hasText: 'Go to question' }).focus();
      await opened.page.keyboard.press('Enter');
      await opened.page.waitForTimeout(300);
      const got = await opened.page.evaluate((card) => {
        const a = document.activeElement as HTMLElement;
        const cs = getComputedStyle(a);
        const first = document.querySelector<HTMLElement>(card)!.querySelector<HTMLElement>('button.opt:not([disabled])');
        return { isFirst: a === first, focusVisible: a.matches(':focus-visible'), style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) };
      }, CARD);
      expect(got.isFirst, 'focus is on the first enabled option').toBe(true);
      expect(got.focusVisible, 'the option matches :focus-visible').toBe(true);
      expect(got.style, 'the option\'s own ring is drawn').not.toBe('none');
      expect(got.width, 'with a real width').toBeGreaterThanOrEqual(1);
      expect(opened.errors).toEqual([]);
    } finally {
      await opened.ctx.close();
    }
  }, 90_000);
});

// R93: the dialog-open sentence shows ABOVE the field, inside the composer, while the desk's inline ask card is mounted, and
// the textarea and Send do not move: before the card, while it is up, and after it leaves. The composer sits at the foot of
// the pane, so a line added BELOW the field pushes the field up by the line's height (27.5 px measured: 19.5 plus the 8 px
// margin), while a line added ABOVE it grows the composer upward and leaves the field where it was. jsdom lays nothing out, so
// this is measured here in Chrome, through the production SessionScreen, one page load per grid point with the fixtures and
// drafts iterated inside it:
//   - the grid: a fine and a coarse pointer (`hasTouch`; a coarse pointer drops the key hints) x Refined and Instrument x
//     dark and light x 900, 1280, 1600 (Refined's inspector rail) and 1920;
//   - inside each point: fixtures 1 (the forty-line question, so its one card scroller is real), 3 (the terminal door) and 7
//     (the approval), each with an EMPTY draft and a 3-line draft typed (a draft auto-grows the field, so the comparison is
//     always against the same draft);
//   - a wrap view (900, both skins, the sentence's font token scaled to 100 and 200 percent: the app's sizes are px tokens,
//     so a root font-size scale moves nothing, measured) records the sentence's line count, and a
//     busy turn with a draft puts the small Stop beside Send;
//   - below 900 (360, 390 and 899, the boundary) the composer does not move and the sentence never shows: the Sheet path.
// The named assertions: GEOMETRY (the textarea's and Send's `getBoundingClientRect().top` each stay within 0.5 px across the
// three moments), PLACEMENT (the sentence's bottom is at or above the input bar's top), VISIBLE (exact text in a
// `role="status"` element, `visibility: visible`, inside the window and every clipping ancestor, and gone after the card),
// OVERLAP (zero intersection with the input bar, Send, Stop and the card), CARD AND TRANSCRIPT (the card inside the pane, the
// transcript at least a third of it, one card scroller on fixture 1, and on 3 and 7 none unless the floor binds) and IDENTITY (the same textarea,
// composer, Send and card nodes, and the draft kept).
// `CCRC_R93_OUT=<a file>` appends the sentence's line count per wrap cell.
const R93_IDLE = fleetSession({
  id: 'lane-a-project-a', wrapper: 'lane-a', home: 'lane-a', project: ASKER_PROJECT, workdir: '/w/project-a',
  workspace: ASKER_SESSION, status: 'idle', bucket: 'idle', hookState: 'waiting', started: true,
});
const R93_TEXT = sendErrorText('dialog-open');
const R93_DRAFTS: { name: string; text: string }[] = [
  { name: 'an empty draft', text: '' },
  { name: 'a 3-line draft', text: 'first line of a draft\nsecond line\nthird line' },
];
const R93_FIXTURES = [1, 3, 7] as const;
const R93_FRAMES = (n: number): object[] => askFixture(n).frames.map((f) => (n === 1 && f.type === 'ask' ? { ...f, ask: longHookEnvelope() } : f));

interface R93Rect { left: number; top: number; right: number; bottom: number; width: number; height: number }
interface R93Snap {
  ta: number | null; send: number | null; composer: R93Rect | null; inputbar: R93Rect | null; stop: R93Rect | null; sendRect: R93Rect | null;
  sentence: null | {
    text: string; rect: R93Rect; visibility: string; display: string; inStatus: boolean; lines: number;
    outside: string[]; fontSize: number;
  };
  card: R93Rect | null; chat: R93Rect | null; chatBody: number | null; scrollers: string[];
  sameTa: boolean; sameComposer: boolean; sameSend: boolean; sameCard: boolean; value: string | null;
}
interface R93Cell {
  fixture: number; draft: string; typed: string; pointer: string;
  before: R93Snap; during: R93Snap; during2: R93Snap; after: R93Snap; lines: number | null;
}
type R93Phase = 'before' | 'tag' | 'during' | 'after';

const R93_SNAP = (arg: { card: string; phase: R93Phase }): R93Snap => {
  const q = (sel: string): HTMLElement | null => document.querySelector<HTMLElement>(sel);
  const rect = (e: Element | null): R93Rect | null => {
    if (e === null) return null;
    const r = e.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  };
  const w = window as unknown as { __r93?: { ta: Element | null; composer: Element | null; send: Element | null }; __r93card?: Element | null };
  const ta = q('.composer-input') as HTMLTextAreaElement | null;
  const composer = q('.composer');
  const send = q('.composer .send-btn');
  const stop = q('.composer .stop-slot');
  const inputbar = q('.composer .inputbar');
  const sentence = q('.composer-refusal');
  const card = q(arg.card);
  const chat = q('.chat');
  if (arg.phase === 'before') w.__r93 = { ta, composer, send };
  if (arg.phase === 'tag') w.__r93card = card;
  let sentenceInfo: R93Snap['sentence'] = null;
  if (sentence !== null) {
    const r = sentence.getBoundingClientRect();
    const cs = getComputedStyle(sentence);
    const outside: string[] = [];
    if (r.left < -0.5 || r.top < -0.5 || r.right > window.innerWidth + 0.5 || r.bottom > window.innerHeight + 0.5) outside.push('the window');
    for (let p = sentence.parentElement; p !== null; p = p.parentElement) {
      const pcs = getComputedStyle(p);
      const x = pcs.overflowX !== 'visible';
      const y = pcs.overflowY !== 'visible';
      if (!x && !y) continue;
      const pr = p.getBoundingClientRect();
      const l = pr.left + p.clientLeft;
      const t = pr.top + p.clientTop;
      if ((x && (r.left < l - 0.5 || r.right > l + p.clientWidth + 0.5)) || (y && (r.top < t - 0.5 || r.bottom > t + p.clientHeight + 0.5))) {
        outside.push(`${p.tagName.toLowerCase()}.${p.getAttribute('class') ?? ''}`);
      }
    }
    const fontSize = parseFloat(cs.fontSize);
    const lh = parseFloat(cs.lineHeight);
    sentenceInfo = {
      text: sentence.textContent ?? '', rect: rect(sentence)!, visibility: cs.visibility, display: cs.display,
      inStatus: sentence.closest('[role="status"]') !== null, outside, fontSize,
      lines: Math.round(r.height / (Number.isFinite(lh) ? lh : fontSize * 1.5)),
    };
  }
  const scrollers = card === null ? [] : [card, ...card.querySelectorAll<HTMLElement>('*')].filter((e) => {
    const oy = getComputedStyle(e).overflowY;
    return (oy === 'auto' || oy === 'scroll') && e.scrollHeight > e.clientHeight + 1;
  }).map((e) => `${e.getAttribute('class') ?? e.tagName} ${e.scrollHeight}/${e.clientHeight}`);
  return {
    ta: ta?.getBoundingClientRect().top ?? null, send: send?.getBoundingClientRect().top ?? null, composer: rect(composer),
    inputbar: rect(inputbar), stop: rect(stop), sendRect: rect(send), sentence: sentenceInfo, card: rect(card), chat: rect(chat),
    chatBody: q('.chat > .chat-body')?.getBoundingClientRect().height ?? null, scrollers,
    sameTa: w.__r93?.ta === ta && ta !== null, sameComposer: w.__r93?.composer === composer && composer !== null,
    sameSend: w.__r93?.send === send && send !== null, sameCard: card !== null && w.__r93card === card, value: ta?.value ?? null,
  };
};

/** One opened desk or phone page for R93: the session socket's handle is kept so a case can send the ask and clear it. */
async function openR93(view: AppView, o: { busy?: boolean } = {}) {
  const busy = o.busy === true;
  const opened = await openApp(browser!, view, { ...FIXTURE, fleetFrames: [{ type: 'fleet', sessions: [busy ? SESSION : R93_IDLE] }] });
  let sock: { send(m: string): void } | undefined;
  await opened.ctx.routeWebSocket(/\/ws\/session\//, (ws) => {
    sock = ws;
    for (const f of [BACKLOG, { type: 'status', status: busy ? 'busy' : 'idle', statusUpdatedAt: null }]) ws.send(JSON.stringify(f));
  });
  await opened.page.goto(`${server!.origin}/s/${SESSION.id}`);
  await opened.page.waitForSelector('.composer-input', { timeout: 30_000 });
  await opened.page.waitForTimeout(800);
  const frames = (fs: object[]): void => { for (const f of fs) sock!.send(JSON.stringify(f)); };
  return { ...opened, frames };
}

/** At one grid point: every fixture with every draft, measured before the card, twice while it is up, and after it leaves. */
async function r93Cells(view: AppView, o: { busy?: boolean; fixtures?: readonly number[]; drafts?: typeof R93_DRAFTS; zoom?: number } = {}): Promise<R93Cell[]> {
  const opened = await openR93(view, o);
  try {
    if (o.zoom !== undefined) {
      await opened.page.evaluate((z) => {
        const base = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fs-sm'));
        document.documentElement.style.setProperty('--fs-sm', `${base * z / 100}px`);
      }, o.zoom);
      await opened.page.waitForTimeout(300);
    }
    const cells: R93Cell[] = [];
    const snap = (phase: R93Phase) => opened.page.evaluate(R93_SNAP, { card: CARD, phase });
    for (const draft of o.drafts ?? R93_DRAFTS) {
      await opened.page.fill('.composer-input', draft.text);
      await opened.page.waitForTimeout(150);
      for (const n of o.fixtures ?? R93_FIXTURES) {
        const before = await snap('before');
        opened.frames(R93_FRAMES(n));
        await opened.page.waitForSelector(CARD, { timeout: 30_000 });
        await opened.page.waitForTimeout(250);
        const during = await snap('tag');
        await opened.page.waitForTimeout(150);
        const during2 = await snap('during');
        opened.frames([{ type: 'ask_cleared' }, { type: 'dialog_cleared' }]);
        await opened.page.waitForSelector(CARD, { state: 'detached', timeout: 30_000 });
        await opened.page.waitForTimeout(250);
        const after = await snap('after');
        cells.push({ fixture: n, draft: draft.name, typed: draft.text, pointer: view.touch === true ? 'coarse' : 'fine', before, during, during2, after, lines: during.sentence?.lines ?? null });
      }
    }
    return cells;
  } finally {
    await opened.ctx.close();
  }
}

const overlaps = (a: R93Rect, b: R93Rect | null): boolean => b !== null && Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.01 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.01;
const cellName = (c: R93Cell): string => `fixture ${c.fixture}, ${c.draft}`;

/** The six named assertions over `cells()`, registered in the enclosing describe. */
function r93Tests(cells: () => R93Cell[], extra: { stop?: boolean } = {}): void {
  const each = (f: (c: R93Cell) => string[]): string[] => cells().flatMap((c) => f(c).map((m) => `${cellName(c)}: ${m}`));
  it('GEOMETRY: the textarea and Send tops stay within 0.5px before the card, while it is up, and after it leaves', () => {
    expect(cells().length, 'premise: the cells were measured').toBeGreaterThan(0);
    const fails = each((c) => {
      const out: string[] = [];
      for (const k of ['ta', 'send'] as const) {
        const v = [c.before[k], c.during[k], c.during2[k], c.after[k]];
        if (v.some((x) => x === null)) out.push(`${k} missing ${JSON.stringify(v)}`);
        else if (Math.max(...(v as number[])) - Math.min(...(v as number[])) > 0.5) out.push(`${k} top moved ${JSON.stringify(v)}`);
      }
      return out;
    });
    expect(fails, 'the textarea and Send did not move').toEqual([]);
  });

  it('PLACEMENT: the sentence is above the field (its bottom is at or above the input bar\'s top)', () => {
    const fails = each((c) => {
      const s = c.during.sentence;
      const bar = c.during.inputbar;
      if (s === null || bar === null) return ['the sentence or the input bar is missing'];
      return s.rect.bottom <= bar.top + 0.01 ? [] : [`sentence bottom ${s.rect.bottom} is below the input bar top ${bar.top}`];
    });
    expect(fails, 'the sentence sits above the field').toEqual([]);
  });

  it('VISIBLE: exact text in a status line, visible, inside the window and every clip; gone before and after the card', () => {
    const fails = each((c) => {
      const out: string[] = [];
      for (const [moment, snap] of [['while up', c.during], ['while up, later', c.during2]] as const) {
        const s = snap.sentence;
        if (s === null) { out.push(`${moment}: no sentence`); continue; }
        if (s.text !== R93_TEXT) out.push(`${moment}: text ${JSON.stringify(s.text)}`);
        if (!s.inStatus) out.push(`${moment}: not in a role="status" element`);
        if (s.visibility !== 'visible' || s.display === 'none') out.push(`${moment}: visibility ${s.visibility}, display ${s.display}`);
        if (s.rect.height < 1) out.push(`${moment}: no height`);
        if (s.outside.length > 0) out.push(`${moment}: outside ${s.outside.join(', ')}`);
      }
      if (c.before.sentence !== null) out.push('the sentence shows before the card');
      if (c.after.sentence !== null) out.push('the sentence shows after the card left');
      return out;
    });
    expect(fails, 'the sentence is fully visible while the card is up and only then').toEqual([]);
  });

  it('OVERLAP: the sentence intersects neither the input bar, Send, Stop nor the card', () => {
    const fails = each((c) => {
      const s = c.during.sentence;
      if (s === null) return ['no sentence'];
      const out: string[] = [];
      if (overlaps(s.rect, c.during.inputbar)) out.push('overlaps the input bar');
      if (overlaps(s.rect, c.during.sendRect)) out.push('overlaps Send');
      if (overlaps(s.rect, c.during.stop)) out.push('overlaps Stop');
      if (overlaps(s.rect, c.during.card)) out.push('overlaps the card');
      if (extra.stop === true && c.during.stop === null) out.push('premise: Stop is beside Send');
      return out;
    });
    expect(fails, 'the sentence overlaps nothing').toEqual([]);
  });

  it('CARD AND TRANSCRIPT: the card is inside the pane, the transcript keeps a third of it, and the card scrolls in one place: on fixture 1, and on 3 and 7 only where the floor binds', () => {
    const fails = each((c) => {
      const { card, chat, chatBody, scrollers } = c.during;
      if (card === null || chat === null || chatBody === null) return ['the card, pane or transcript is missing'];
      const out: string[] = [];
      if (card.left < chat.left - 0.5 || card.right > chat.right + 0.5 || card.top < chat.top - 0.5 || card.bottom > chat.bottom + 0.5) out.push(`the card ${JSON.stringify(card)} leaves the pane ${JSON.stringify(chat)}`);
      if (chatBody < chat.height / 3 - 1) out.push(`the transcript (${chatBody}px) is under a third of the pane (${chat.height}px)`);
      // One scroller on fixture 1 (the forty-line question). On 3 and 7 the card has none, EXCEPT where the transcript's floor
      // binds (a short window, a 3-line draft): the card yields to the floor, never the other way, and then its body is the
      // one scroller. Never two.
      const atFloor = chatBody <= chat.height / 3 + 1;
      const want = c.fixture === 1 ? [1, 1] : atFloor ? [0, 1] : [0, 0];
      if (scrollers.length < want[0]! || scrollers.length > want[1]!) out.push(`${scrollers.length} card scrollers (${scrollers.join('; ')}; scrollHeight/clientHeight), want ${want[0] === want[1] ? want[0] : `${want[0]} to ${want[1]}`}${atFloor ? ' (the floor binds)' : ''}`);
      return out;
    });
    expect(fails, 'the card and the transcript hold').toEqual([]);
  });

  it('IDENTITY: the same textarea, composer, Send and card nodes across arrival and leave, and the draft is kept', () => {
    const fails = each((c) => {
      const out: string[] = [];
      for (const [moment, snap] of [['while up', c.during2], ['after', c.after]] as const) {
        if (!snap.sameTa) out.push(`${moment}: the textarea is a different node`);
        if (!snap.sameComposer) out.push(`${moment}: the composer is a different node`);
        if (!snap.sameSend) out.push(`${moment}: Send is a different node`);
        if (snap.value !== c.typed) out.push(`${moment}: the draft is ${JSON.stringify(snap.value)}`);
      }
      if (!c.during2.sameCard) out.push('the card is a different node while it is up');
      return out;
    });
    expect(fails, 'the nodes and the draft are kept').toEqual([]);
  });
}

describe('R93: the sentence above the field, and the field does not move (D-6326)', () => {
  const POINTS: { view: AppView; rail: string }[] = [];
  for (const touch of [false, true]) for (const skin of [REFINED, INSTRUMENT]) for (const theme of [PHOSPHOR, 'light']) {
    for (const width of [900, 1280, 1600, 1920]) POINTS.push({ view: { skin, theme, width, touch }, rail: width === 1600 ? ', Refined inspector rail' : '' });
  }
  for (const { view, rail } of POINTS) {
    describe(`${view.touch === true ? 'coarse' : 'fine'} pointer, ${named(view)}${rail}`, () => {
      let cells: R93Cell[] = [];
      beforeAll(async () => { cells = await r93Cells(view); }, 240_000);
      r93Tests(() => cells);
    });
  }

  // A busy turn with a draft puts the small Stop beside Send; the sentence overlaps neither.
  for (const skin of [REFINED, INSTRUMENT]) {
    describe(`a busy turn with a draft (Stop beside Send), ${skin}, 1280px`, () => {
      let cells: R93Cell[] = [];
      beforeAll(async () => { cells = await r93Cells({ skin, theme: PHOSPHOR, width: 1280 }, { busy: true, fixtures: [7, 1], drafts: [R93_DRAFTS[1]!] }); }, 240_000);
      r93Tests(() => cells, { stop: true });
    });
  }

  // The sentence's wrap. 900 is the narrowest desk pane (Instrument adds its rail from 900 up). The sentence is one line at 100
  // percent in both skins, so its font token (`--fs-sm`, px) is doubled to force it onto two lines (200 percent is text zoom's WCAG ceiling; at 300 percent the sentence takes two or three lines of 39px text and squeezes the card to a 19 to 61px body, which no placement of the sentence changes): scaling the root
  // font size moves nothing here, because the app's sizes are px tokens. The line count is recorded, and the same assertions hold.
  for (const skin of [REFINED, INSTRUMENT]) for (const zoom of [100, 200]) {
    describe(`wrap: ${skin}, 900px, sentence text at ${zoom}%`, () => {
      let cells: R93Cell[] = [];
      beforeAll(async () => {
        cells = await r93Cells({ skin, theme: PHOSPHOR, width: 900 }, { zoom, fixtures: [1, 7], drafts: [R93_DRAFTS[1]!] });
        const out = process.env['CCRC_R93_OUT'];
        if (out !== undefined && out !== '') {
          for (const c of cells) appendFileSync(out, `${skin} 900 text ${zoom}% fixture ${c.fixture}: ${c.lines} line(s), font ${c.during.sentence?.fontSize}px, sentence ${c.during.sentence?.rect.width}x${c.during.sentence?.rect.height}\n`);
        }
      }, 240_000);
      it('records a sentence of at least one line', () => {
        expect(cells.every((c) => c.lines !== null && c.lines >= 1), 'every wrap cell measured a sentence').toBe(true);
      });
      r93Tests(() => cells);
    });
  }
});

// Below 900 the ask is the Sheet's, `askInline` is never true, so the composer is the one it always was: its top, its height
// and its textarea's top are the same before the ask, while the Sheet is up and after it goes, and no sentence is drawn.
describe('R93: the phone is unchanged (360, 390 and 899px)', () => {
  for (const skin of [REFINED, INSTRUMENT]) for (const width of [360, 390, 899]) {
    describe(`${skin}, ${width}px`, () => {
      let rows: { fixture: number; before: R93Snap; during: R93Snap; after: R93Snap; sheet: boolean }[] = [];
      beforeAll(async () => {
        const opened = await openR93({ skin, theme: PHOSPHOR, width });
        try {
          const snap = (phase: R93Phase) => opened.page.evaluate(R93_SNAP, { card: CARD, phase });
          for (const n of [1, 7]) {
            const before = await snap('before');
            opened.frames(R93_FRAMES(n));
            await opened.page.waitForSelector('.sheet-panel', { timeout: 30_000 });
            await opened.page.waitForTimeout(500);
            const during = await snap('during');
            const sheet = (await opened.page.locator(CARD).count()) === 0;
            opened.frames([{ type: 'ask_cleared' }, { type: 'dialog_cleared' }]);
            await opened.page.waitForSelector('.sheet-panel', { state: 'detached', timeout: 30_000 });
            await opened.page.waitForTimeout(500);
            rows.push({ fixture: n, before, during, after: await snap('after'), sheet });
          }
        } finally {
          await opened.ctx.close();
        }
      }, 240_000);
      it('the composer\'s top, height and textarea top are unchanged by the Sheet, and no sentence is drawn', () => {
        expect(rows.length, 'premise: both fixtures were measured').toBe(2);
        const fails = rows.flatMap((r) => {
          const out: string[] = [];
          if (!r.sheet) out.push('premise: the ask is in the Sheet, with no inline card');
          for (const [k, get] of [['composer top', (x: R93Snap) => x.composer?.top], ['composer height', (x: R93Snap) => x.composer?.height], ['textarea top', (x: R93Snap) => x.ta]] as const) {
            const v = [get(r.before), get(r.during), get(r.after)];
            if (v.some((x) => x === undefined || x === null)) out.push(`${k} missing`);
            else if (Math.max(...(v as number[])) - Math.min(...(v as number[])) > 0.5) out.push(`${k} changed ${JSON.stringify(v)}`);
          }
          if (r.before.sentence !== null || r.during.sentence !== null || r.after.sentence !== null) out.push('a sentence is drawn on the phone');
          return out.map((m) => `fixture ${r.fixture}: ${m}`);
        });
        expect(fails, 'the phone composer is unchanged').toEqual([]);
      });
    });
  }
});
