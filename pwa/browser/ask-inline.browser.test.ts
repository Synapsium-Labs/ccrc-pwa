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
import { ASKER_PROJECT, ASKER_SESSION, HOOK_QUESTIONS, askFixture, longHookEnvelope } from '../test/askFixtures';
import type { Dialog } from '../../shared/api';

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
      if (s.rect.bottom > bar.top + 0.01) return [`sentence bottom ${s.rect.bottom} is below the input bar top ${bar.top}`];
      // The sentence keeps its 8px gap above the field (`margin: 0 0 var(--sp-2)`), so it does not touch it.
      return bar.top - s.rect.bottom >= 7.5 ? [] : [`the gap above the field is ${bar.top - s.rect.bottom}px, under 7.5`];
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
      // And the one scroller is the card's own body, whichever fixture.
      for (const sc of scrollers) if (!sc.startsWith('ask-inline-body ')) out.push(`the scroller is ${sc}, not .ask-inline-body`);
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
        // 200 percent text wraps the sentence onto at least two lines at 900px; 100 percent is one line.
        const least = zoom >= 200 ? 2 : 1;
        expect(cells.every((c) => c.lines !== null && c.lines >= least), `every wrap cell measured a sentence of at least ${least} line(s)`).toBe(true);
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

// R89 S1: a held Retry must LOOK held. R89 disables a failed bubble's Retry while the desk's inline ask card is mounted, but
// `.pending-actions .pending-retry` carried no `:disabled` look, so the held button kept the accent colour, the accent
// border and the pointer cursor of an enabled one. Through the production SessionScreen in real Chrome: a send that the
// server refuses (the page's `/prompt` route answers 500) leaves a failed bubble; the enabled Retry's look is read, fixture 7
// goes up, and the held Retry's computed `cursor` is not `pointer` and its `color` is the disabled ink, read from the page's
// own disabled Send button (a `.send-btn:disabled` while the card is up), not a token named here. After the clear the Retry
// has the look it had before. Two views, one per skin and palette.
describe('R89 S1: a held Retry looks disabled (D-6326)', () => {
  for (const view of [{ skin: REFINED, theme: PHOSPHOR, width: 1280 }, { skin: INSTRUMENT, theme: 'light', width: 1280 }] as AppView[]) {
    it(`${named(view)}: with fixture 7 up the disabled Retry is not a pointer and wears the disabled ink; enabled, it keeps its look`, async () => {
      const opened = await openR93(view);
      try {
        await opened.page.route('**/api/sessions/*/prompt', (route) => route.fulfill({
          status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'offline' }),
        }));
        const look = () => opened.page.evaluate(() => {
          const retry = document.querySelector<HTMLButtonElement>('.pending-actions .pending-retry')!;
          const send = document.querySelector<HTMLButtonElement>('.composer .send-btn')!;
          const rs = getComputedStyle(retry);
          return {
            disabled: retry.disabled, cursor: rs.cursor, color: rs.color, border: rs.borderTopColor,
            sendDisabled: send.disabled, sendColor: getComputedStyle(send).color,
          };
        });
        await opened.page.fill('.composer-input', 'resend me');
        await opened.page.click('.composer .send-btn');
        await opened.page.waitForSelector('.pending-actions .pending-retry', { timeout: 30_000 });
        await opened.page.waitForTimeout(300);
        const enabled = await look();
        expect(enabled.disabled, 'premise: Retry is enabled with no card up').toBe(false);
        expect(enabled.cursor, 'control: an enabled Retry is a pointer').toBe('pointer');

        opened.frames(R93_FRAMES(7));
        await opened.page.waitForSelector(CARD, { timeout: 30_000 });
        await opened.page.waitForTimeout(300);
        const held = await look();
        expect(held.disabled, 'premise: Retry is disabled while the card is up').toBe(true);
        expect(held.sendDisabled, 'premise: the page\'s own disabled Send is the ink reference').toBe(true);
        expect(held.cursor, 'a held Retry is not a pointer').not.toBe('pointer');
        expect(held.color, `a held Retry wears the disabled ink of the disabled Send (${held.sendColor}), not ${enabled.color}`).toBe(held.sendColor);
        expect(enabled.color, 'control: an enabled Retry is not in the disabled ink').not.toBe(held.sendColor);

        opened.frames([{ type: 'ask_cleared' }, { type: 'dialog_cleared' }]);
        await opened.page.waitForSelector(CARD, { state: 'detached', timeout: 30_000 });
        await opened.page.waitForTimeout(300);
        const after = await look();
        expect(after.disabled, 'premise: Retry is enabled again once the card has gone').toBe(false);
        expect([after.cursor, after.color, after.border], 'control: it has the look it had before').toEqual([enabled.cursor, enabled.color, enabled.border]);
        expect(opened.errors).toEqual([]);
      } finally {
        await opened.ctx.close();
      }
    }, 90_000);
  }
});

// ---- R102, R105, R106: after a send this client initiates the keys in the card are fenced, in a real Chrome ---------------
//
// At the desk a send ends the keyboard's engagement at that moment and raises a FENCE: capture listeners that stop every key
// whose target is inside the inline card (Tab, Shift+Tab and Ctrl/Meta/Alt chords other than Enter and Space excepted; keyup
// and keypress of Enter and Space too) until the operator re-enters deliberately: a pointer press in the card or Go to
// question, made while input is eligible. jsdom cannot Tab, hold a key down, or arm a button's native activation, so the
// cases below hold what Chrome does. They use AGED fixture 2 (no envelope), whose rows are keyed by position: aged question 2
// REUSES the very row node that held focus, so focus stays on a re-enabled button with no `focusin`, which is the shape the
// fence exists for.
//
// The answer's request is a page-side `fetch` the page controls (an init script wraps `window.fetch` for the session's
// `/dialog` POST only): it records the bodies, can be held, and is answered with `{ok: true, next: aged question 2}` by
// `__reply()`. That lets a case deliver the reply in the same task as a click, on the next microtask, or after one frame,
// which a route fulfilled from the test process cannot. The page also logs every click and every `focusin` inside the card.
//
// WHAT CHROME DOES WITH A DISABLED FOCUSED BUTTON decides the shape of the "reused node" cases. While an answer is in flight the
// row is disabled, and Chrome's focus fix-up (once per frame) drops focus from it to the body, so an answer that stays in
// flight across a frame leaves nothing focused on the reused node. Only a reply that lands before that frame (a fast server:
// here the held request is off, so the page's `fetch` answers in the same task) leaves a re-enabled node still holding focus,
// which is what the cases that need that shape (`answered()`) use. The cases about a request in flight use the held one.
type Probe = {
  __posts: string[]; __pending: Array<() => void>; __hold: boolean; __next: unknown; __reply: () => boolean;
  __clicks: string[]; __focusins: string[]; __row: Element | null;
};
const AGED_Q2 = (): Dialog => {
  const q2 = HOOK_QUESTIONS[1]!;
  return {
    ...askFixture(2).dialog!, id: 'dlg-a2-q2', selectedIndex: 1,
    options: [...q2.options.map((o, i) => ({ index: i + 1, label: o.label, description: o.description })),
      { index: q2.options.length + 1, label: 'Type something.' }, { index: q2.options.length + 2, label: 'Chat about this' }],
    ask: { question: q2.question, header: q2.header, multiSelect: false, options: q2.options.map((o) => ({ ...o })) },
  };
};
const AGED_FRAMES = (): object[] => [
  { ...BACKLOG, events: [...BACKLOG.events, CALL] },
  { type: 'status', status: 'busy', statusUpdatedAt: null },
  ...askFixture(2).frames,
];
const DESK_VIEW: AppView = { skin: REFINED, theme: PHOSPHOR, width: 1280 };
const GTQ = '.tool-ask .ask-state button';
const Q2_TEXT = HOOK_QUESTIONS[1]!.question;

/** An opened desk page over aged fixture 2, with the page-side request control and logs installed. */
async function openAged() {
  const opened = await openApp(browser!, DESK_VIEW, FIXTURE);
  await opened.ctx.addInitScript((next: unknown) => {
    const w = window as unknown as Probe;
    const real = window.fetch.bind(window);
    w.__posts = []; w.__pending = []; w.__hold = false; w.__next = next; w.__clicks = []; w.__focusins = []; w.__row = null;
    window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (init?.method === 'POST' && /\/api\/sessions\/[^/]+\/dialog$/.test(new URL(url, location.href).pathname)) {
        w.__posts.push(String(init.body));
        return new Promise<Response>((resolve) => {
          const done = (): void => resolve(new Response(JSON.stringify({ ok: true, next: w.__next }),
            { status: 200, headers: { 'content-type': 'application/json' } }));
          if (w.__hold) w.__pending.push(done);
          else done();
        });
      }
      return real(input, init);
    };
    w.__reply = () => {
      const done = w.__pending.shift();
      if (done === undefined) return false;
      done();
      return true;
    };
    const inCard = (e: Event): boolean => e.target instanceof Element && e.target.closest('[data-ask-surface="inline"]') !== null;
    document.addEventListener('click', (e) => { if (inCard(e)) w.__clicks.push((e.target as Element).tagName); }, true);
    document.addEventListener('focusin', (e) => { if (inCard(e)) w.__focusins.push((e.target as Element).tagName); }, true);
  }, AGED_Q2());
  let sock: { send(m: string): void; close(): void } | undefined;
  const sockets: number[] = [];
  await opened.ctx.routeWebSocket(/\/ws\/session\//, (ws) => {
    sock = ws;
    sockets.push(sockets.length);
    for (const f of AGED_FRAMES()) ws.send(JSON.stringify(f));
  });
  await opened.page.goto(`${server!.origin}/s/${SESSION.id}`);
  await opened.page.waitForSelector(`${CARD} .ask-who`, { timeout: 30_000 });
  await opened.page.waitForTimeout(800);
  const page = opened.page;
  const first = page.locator(`${CARD} button.opt`).first();
  const api = {
    ...opened, page, first, sockets,
    send: (fs: object[]): void => { for (const f of fs) sock!.send(JSON.stringify(f)); },
    drop: (): void => sock!.close(),
    /** Option 1 focused and remembered as `__row`; the next request is held when `hold`. */
    focusFirst: async (hold: boolean): Promise<void> => {
      await first.focus();
      await page.evaluate((h) => {
        const w = window as unknown as Probe;
        w.__row = document.activeElement;
        w.__hold = h;
      }, hold);
    },
    reply: async (): Promise<void> => { await page.evaluate(() => (window as unknown as Probe).__reply()); },
    /** A fast reply: option 1 answered by its digit, the reply landing in the same task, question 2 shown in the card on the
     *  reused node, which is still focused and enabled (Chrome's per-frame focus fix-up never saw it disabled). */
    answered: async (): Promise<void> => {
      await api.focusFirst(false);
      await page.keyboard.press('1');
      await expect.poll(() => api.posts(), { timeout: 10_000 }).toBe(1);
      await page.getByText(Q2_TEXT).first().waitFor({ timeout: 10_000 });
      await page.waitForTimeout(300);
      const s = await api.snap();
      expect(s.rowConnected && s.activeIsRow, 'premise: question 2 reused the row node and it holds focus').toBe(true);
      expect(s.rowDisabled, 'premise: and it is enabled again').toBe(false);
    },
    posts: (): Promise<number> => page.evaluate(() => (window as unknown as Probe).__posts.length),
    snap: () => page.evaluate((card) => {
      const w = window as unknown as Probe;
      const a = document.activeElement as HTMLElement | null;
      const c = document.querySelector<HTMLElement>(card);
      return {
        posts: w.__posts.length, clicks: w.__clicks.length, focusins: [...w.__focusins],
        activeIsRow: a !== null && a === w.__row, rowConnected: w.__row?.isConnected === true,
        rowDisabled: (w.__row as HTMLButtonElement | null)?.disabled === true,
        inCard: a !== null && c !== null && c.contains(a), activeTag: a?.tagName ?? null,
        ring: a !== null && a.matches(':focus-visible'),
      };
    }, CARD),
    mark: (): Promise<void> => page.evaluate(() => { const w = window as unknown as Probe; w.__clicks.length = 0; w.__focusins.length = 0; }),
  };
  return api;
}
type Aged = Awaited<ReturnType<typeof openAged>>;
const withAged = async (run: (a: Aged) => Promise<void>): Promise<void> => {
  const a = await openAged();
  try {
    await run(a);
    expect(a.errors).toEqual([]);
  } finally {
    await a.ctx.close();
  }
};

describe('after a send the keys in the card are fenced in real Chrome (R102)', () => {
  it('Space held: Space down on option 1, a digit answers, the reply re-enables the reused node, Space up: one request, no click', async () => {
    await withAged(async (a) => {
      await a.focusFirst(false);
      await a.page.keyboard.down('Space');
      await a.page.keyboard.press('2'); // the digit's request is answered at once: the reply re-enables the reused node
      await expect.poll(() => a.posts(), { timeout: 10_000 }).toBe(1);
      await a.page.getByText(Q2_TEXT).first().waitFor({ timeout: 10_000 });
      await a.page.waitForTimeout(300);
      const s = await a.snap();
      expect(s.rowConnected && s.activeIsRow && !s.rowDisabled, 'premise: question 2 reused option 1\'s node, enabled, focused').toBe(true);
      await a.mark();
      await a.page.keyboard.up('Space');
      await a.page.waitForTimeout(400);
      const end = await a.snap();
      expect(end.posts, 'exactly one request: the digit\'s').toBe(1);
      expect(end.clicks, 'zero clicks on the reused node').toBe(0);
    });
  }, 90_000);

  it('Enter held: Enter down on option 1 answers it once; a digit, the reply and the auto-repeat then send nothing', async () => {
    await withAged(async (a) => {
      await a.focusFirst(false);
      await a.page.evaluate(() => {
        const w = window as unknown as { __repeats: number };
        w.__repeats = 0;
        document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.repeat) w.__repeats += 1; }, true);
      });
      await a.page.keyboard.down('Enter'); // Chrome activates a button at the keydown; the reply re-enables the reused node
      await expect.poll(() => a.posts(), { timeout: 10_000 }).toBe(1);
      await a.page.getByText(Q2_TEXT).first().waitFor({ timeout: 10_000 });
      await a.page.waitForTimeout(300);
      await a.page.keyboard.press('2'); // a digit on the fenced, reused node
      await a.page.keyboard.down('Enter'); // Playwright sends a held key's repeat
      await a.page.keyboard.down('Enter');
      await a.page.keyboard.up('Enter');
      await a.page.waitForTimeout(400);
      const end = await a.snap();
      const repeats = await a.page.evaluate(() => (window as unknown as { __repeats: number }).__repeats);
      // Not observable, never credited: input that generates no auto-repeat proves nothing about the repeat arm.
      expect(repeats, 'the harness generated auto-repeat Enter keydowns (else this arm is NOT OBSERVABLE)').toBeGreaterThan(0);
      expect(end.clicks, 'exactly one click, for option 1, at the first keydown').toBe(1);
      expect(end.posts, 'exactly one request').toBe(1);
    });
  }, 90_000);

  // The card holds ONE tab stop (the roving row), so Tab from the card section reaches the row, Tab from the row leaves the
  // card, and Shift+Tab from the row leaves it the other way. None of those is stopped by the fence, none unlocks.
  it('Tab moves focus: from the card section to its row, out of the card from the row, and Shift+Tab from the first tabbable leaves it; a digit inside sends nothing', async () => {
    await withAged(async (a) => {
      await a.answered();
      await a.page.evaluate((c) => document.querySelector<HTMLElement>(c)!.focus(), CARD);
      await a.page.keyboard.press('Tab');
      const into = await a.snap();
      expect(into.inCard && into.activeTag === 'BUTTON', `Tab moved focus from the card section to a control inside it (${into.activeTag})`).toBe(true);
      await a.page.keyboard.press('2');
      await a.page.waitForTimeout(300);
      expect((await a.snap()).posts, 'a digit inside the card sends nothing: Tab unlocked nothing').toBe(1);
      await a.page.keyboard.press('Tab');
      expect((await a.snap()).inCard, 'Tab from the card\'s last tabbable moved focus out of the card').toBe(false);
      await a.first.focus();
      await a.page.keyboard.press('Shift+Tab');
      expect((await a.snap()).inCard, 'Shift+Tab from the card\'s first tabbable moved focus OUTSIDE the card').toBe(false);
    });
  }, 90_000);

  it.each([
    'Shift+Enter', 'Control+Enter', 'Alt+Enter', 'Meta+Enter', 'Shift+Space', 'Control+Space',
  ])('the named chord %s on a fenced, reused button gives no request and no click', async (chord) => {
    await withAged(async (a) => {
      await a.answered();
      await a.mark();
      await a.page.keyboard.press(chord);
      await a.page.waitForTimeout(300);
      const s = await a.snap();
      expect(s.posts, `${chord}: no request`).toBe(1);
      expect(s.clicks, `${chord}: no click`).toBe(0);
    });
  }, 90_000);

  it('Ctrl+K pressed inside the fenced card still reaches the command layer', async () => {
    await withAged(async (a) => {
      await a.answered();
      expect(await a.page.locator('[role="dialog"]').count(), 'premise: no dialog is up').toBe(0);
      await a.page.keyboard.press('Control+k');
      await expect.poll(() => a.page.locator('[role="dialog"]').count(), { timeout: 5_000 }).toBeGreaterThan(0);
    });
  }, 90_000);
});

// R115 in real Chrome: a DIFFERENT aged ask arrives over the socket with no clear (review 939's F3, the external path). Aged
// rows are keyed by position, so the second ask reuses the row node that holds focus, enabled, with no focus event. Native key
// phases matter here: Chrome activates a focused button at Enter's keydown and at Space's keyup, so a Space pressed on the
// first ask and released on the second would click the second ask's row unless the fence stops that keyup.
const OTHER_Q = 'Which database should the service use?';
const OTHER_AGED = (): Dialog => {
  const options = [{ label: 'Postgres', description: 'A server.' }, { label: 'SQLite', description: 'A file.' }, { label: 'Neither' }];
  return {
    ...askFixture(2).dialog!, id: 'dlg-other-ask', title: OTHER_Q, body: OTHER_Q, selectedIndex: 1,
    options: [...options.map((o, n) => ({ index: n + 1, label: o.label, description: o.description })),
      { index: options.length + 1, label: 'Type something.' }, { index: options.length + 2, label: 'Chat about this' }],
    ask: { question: OTHER_Q, header: 'Database', multiSelect: false, options: options.map((o) => ({ ...o })) },
  };
};

describe('a screen change this client did not send fences the card in real Chrome (R115)', () => {
  /** Option 1 focused, ArrowDown engages and moves focus to option 2 (remembered as `__row`); `before` runs on it; then the
   *  other aged ask arrives on the socket. The reused node still holds focus, enabled, and nothing moved focus. */
  async function otherAsk(a: Aged, before: () => Promise<void> = async () => {}): Promise<void> {
    await a.first.focus();
    await a.page.keyboard.press('ArrowDown');
    await a.page.evaluate(() => { const w = window as unknown as Probe; w.__row = document.activeElement; });
    await before();
    await a.mark();
    a.send([{ type: 'dialog', dialog: OTHER_AGED() }]);
    await a.page.getByText(OTHER_Q).first().waitFor({ timeout: 10_000 });
    await a.page.waitForTimeout(300);
    const s = await a.snap();
    expect(s.rowConnected && !s.rowDisabled, 'premise: the other ask reused the row node, enabled').toBe(true);
    expect(s.activeIsRow, 'focus is still on the reused node: nothing moved it').toBe(true);
    expect(s.focusins, 'no focusin inside the card').toEqual([]);
  }

  it('a digit, Enter and Space on the reused, focused row send nothing and click nothing; a click in the card, then a digit, answers once', async () => {
    await withAged(async (a) => {
      await otherAsk(a);
      await a.page.keyboard.press('1');
      await a.page.keyboard.press('Enter');
      await a.page.keyboard.press('Space');
      await a.page.waitForTimeout(400);
      const s = await a.snap();
      expect(s.posts, 'no request').toBe(0);
      expect(s.clicks, 'no click on the reused node').toBe(0);
      await a.page.locator(`${CARD} .ask-inline-title`).click();
      await a.page.keyboard.press('1');
      await expect.poll(() => a.posts(), { timeout: 10_000 }).toBe(1);
    });
  }, 90_000);

  it('Space held across the change: down on the first ask, up on the second gives no click and no request', async () => {
    await withAged(async (a) => {
      await otherAsk(a, async () => { await a.page.keyboard.down('Space'); });
      await a.page.keyboard.up('Space');
      await a.page.waitForTimeout(400);
      const s = await a.snap();
      expect(s.clicks, 'zero clicks: the keyup that would activate the reused node was stopped').toBe(0);
      expect(s.posts, 'no request').toBe(0);
    });
  }, 90_000);

  it('Tab moves focus without unlocking; Go to question then unlocks and a digit answers once', async () => {
    await withAged(async (a) => {
      await otherAsk(a);
      await a.page.evaluate((c) => document.querySelector<HTMLElement>(c)!.focus(), CARD);
      await a.page.keyboard.press('Tab');
      const into = await a.snap();
      expect(into.inCard && into.activeTag === 'BUTTON', `Tab moved focus to a control in the card (${into.activeTag})`).toBe(true);
      await a.page.keyboard.press('2');
      await a.page.waitForTimeout(300);
      expect((await a.snap()).posts, 'a digit after Tab sends nothing').toBe(0);
      await a.page.focus(GTQ);
      await a.page.keyboard.press('Enter');
      await a.page.waitForTimeout(300);
      await a.page.keyboard.press('2');
      await expect.poll(() => a.posts(), { timeout: 10_000 }).toBe(1);
    });
  }, 90_000);
});

describe('re-entry in real Chrome (R105, R106)', () => {
  it('a pointer click in the card unlocks: a digit then answers once', async () => {
    await withAged(async (a) => {
      await a.answered();
      await a.page.locator(`${CARD} .ask-inline-title`).click();
      await a.page.keyboard.press('2');
      await expect.poll(() => a.posts(), { timeout: 10_000 }).toBe(2);
    });
  }, 90_000);

  it('Go to question with nothing in flight unlocks, draws the focus ring, and a digit then answers once', async () => {
    await withAged(async (a) => {
      await a.answered();
      await a.page.focus(GTQ);
      await a.page.keyboard.press('Enter'); // the keyboard activation, so the ring is a :focus-visible one
      await a.page.waitForTimeout(300);
      const s = await a.snap();
      expect(s.inCard && s.ring, 'focus is in the card and draws the keyboard ring').toBe(true);
      await a.page.keyboard.press('2');
      await expect.poll(() => a.posts(), { timeout: 10_000 }).toBe(2);
    });
  }, 90_000);

  it('a click in the card while the request is in flight gives no later unlock; a new click after the reply does', async () => {
    await withAged(async (a) => {
      await a.focusFirst(true);
      await a.page.keyboard.press('1');
      await expect.poll(() => a.posts(), { timeout: 10_000 }).toBe(1);
      await a.page.locator(`${CARD} .ask-inline-title`).click();
      await a.reply();
      await a.page.getByText(Q2_TEXT).first().waitFor({ timeout: 10_000 });
      await a.page.waitForTimeout(300);
      await a.page.keyboard.press('2');
      await a.page.waitForTimeout(300);
      expect(await a.posts(), 'nothing sent: the click pre-authorized nothing').toBe(1);
      await a.page.locator(`${CARD} .ask-inline-title`).click();
      await a.page.keyboard.press('2');
      await expect.poll(() => a.posts(), { timeout: 10_000 }).toBe(2);
    });
  }, 90_000);

  // The reply is delivered as tightly after the click as a page can: in the same task, on the next microtask, and after one
  // frame. Each time the keys stay fenced and no focus follows the reply, and a NEW Go to question then unlocks.
  it.each(['same task', 'next microtask', 'one frame'] as const)(
    'Go to question while the answer is in flight, the reply %s: still fenced, no focus from an unlock, and a NEW Go to question unlocks', async (when) => {
      await withAged(async (a) => {
        await a.focusFirst(true);
        await a.page.keyboard.press('1');
        await expect.poll(() => a.posts(), { timeout: 10_000 }).toBe(1);
        await a.mark();
        await a.page.evaluate(async (w) => {
          const probe = window as unknown as Probe;
          const b = [...document.querySelectorAll<HTMLButtonElement>('.tool-ask .ask-state button')].find((x) => x.textContent === 'Go to question')!;
          b.click();
          if (w === 'next microtask') await Promise.resolve();
          if (w === 'one frame') await new Promise((r) => requestAnimationFrame(() => r(null)));
          probe.__reply();
        }, when);
        await a.page.getByText(Q2_TEXT).first().waitFor({ timeout: 10_000 });
        await a.page.waitForTimeout(400);
        const s = await a.snap();
        expect(s.focusins.filter((t) => t !== 'SECTION'), 'no focus but the click\'s own (the card section) followed').toEqual([]);
        await a.page.keyboard.press('2');
        await a.page.waitForTimeout(300);
        expect(await a.posts(), 'a digit sends nothing').toBe(1);
        await a.page.locator(GTQ, { hasText: 'Go to question' }).click();
        await a.page.waitForTimeout(300);
        await a.page.keyboard.press('2');
        await expect.poll(() => a.posts(), { timeout: 10_000 }).toBe(2);
      });
    }, 90_000);

  // In the gap every row that sends is disabled, so Chrome's own focus fix-up may drop focus to the body: what is held across
  // the gap is the card and row NODES and the fence, not necessarily focus. The row is focused again by script (which unlocks
  // nothing) to prove the fence stood.
  it('a reconnect gap keeps the card node and the row node and the fence: the new connection\'s frames unlock nothing', async () => {
    await withAged(async (a) => {
      await a.answered();
      await a.page.evaluate((c) => { (window as unknown as { __card: Element | null }).__card = document.querySelector(c); }, CARD);
      await a.mark();
      a.drop();
      await a.page.waitForTimeout(300);
      // Online nudges the reconnect past its backoff (the store tests' own lever).
      await a.page.evaluate(() => window.dispatchEvent(new Event('online')));
      await expect.poll(() => a.sockets.length, { timeout: 30_000 }).toBeGreaterThan(1);
      // The new connection speaks: the pane's current screen (aged question 2) and, as for an ask with no envelope, `ask_cleared`.
      a.send([{ type: 'dialog', dialog: AGED_Q2() }, { type: 'ask_cleared' }]);
      await a.page.waitForTimeout(500);
      const same = await a.page.evaluate((c) => (window as unknown as { __card: Element | null }).__card === document.querySelector(c), CARD);
      const s = await a.snap();
      expect(same, 'the card is the same node').toBe(true);
      expect(s.rowConnected, 'the reused row node is the same node').toBe(true);
      expect(s.focusins, 'no focus was assigned across the gap').toEqual([]);
      await a.first.focus();
      expect((await a.snap()).activeIsRow, 'premise: the row holds focus again').toBe(true);
      await a.page.keyboard.press('2');
      await a.page.waitForTimeout(300);
      expect(await a.posts(), 'and a digit sends nothing: the gap unlocked nothing').toBe(1);
    });
  }, 120_000);
});

// R102: inside the card the Other field takes focus only on a deliberate open. A return to a question whose Other was kept
// (here, by the pane's frame) assigns no focus at the desk, while the phone's Sheet keeps focusing it.
describe('the kept Other on a return to its question, desk and phone (R102)', () => {
  const Q2_DIALOG = (): Dialog => ({
    ...askFixture(1).dialog!, id: 'dlg-a2', selectedIndex: 1,
    options: [{ index: 1, label: 'Yes' }, { index: 2, label: 'No' }, { index: 3, label: 'Type something.' }, { index: 4, label: 'Chat about this' }],
    raw: ['╭ pane chrome ╮', '←  ☒ Cache  ☐ Tracing  ☐ Regions  ✔ Submit  →', '  1. Yes', '  2. No', '  3. Type something.', '  4. Chat about this'].join('\n'),
  });
  const run = async (view: AppView, scope: string): Promise<{ focusins: string[]; fieldFocused: boolean }> => {
    const opened = await openApp(browser!, view, FIXTURE);
    try {
      let sock: { send(m: string): void } | undefined;
      await opened.ctx.routeWebSocket(/\/ws\/session\//, (ws) => {
        sock = ws;
        for (const f of [BACKLOG, { type: 'status', status: 'busy', statusUpdatedAt: null }, ...askFixture(1).frames]) ws.send(JSON.stringify(f));
      });
      const page = opened.page;
      await page.goto(`${server!.origin}/s/${SESSION.id}`);
      await page.waitForSelector(`${scope} button.opt`, { timeout: 30_000 });
      await page.waitForTimeout(800);
      await page.locator(`${scope} button.opt`, { hasText: 'Other' }).click();
      await page.locator(`${scope} input.dlg-reply-input`).fill('Memcached');
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      sock!.send(JSON.stringify({ type: 'dialog', dialog: Q2_DIALOG() }));
      await page.getByText(HOOK_QUESTIONS[1]!.question).first().waitFor({ timeout: 10_000 });
      await page.waitForTimeout(300);
      await page.evaluate((sc) => {
        const w = window as unknown as { __fi: string[] };
        w.__fi = [];
        document.addEventListener('focusin', (e) => { if (e.target instanceof Element && e.target.closest(sc) !== null) w.__fi.push(e.target.tagName); }, true);
      }, scope);
      sock!.send(JSON.stringify({ type: 'dialog', dialog: askFixture(1).dialog! }));
      await page.getByText(HOOK_QUESTIONS[0]!.question).first().waitFor({ timeout: 10_000 });
      await page.waitForTimeout(500);
      const out = await page.evaluate((sc) => {
        const f = document.querySelector<HTMLInputElement>(`${sc} input.dlg-reply-input`);
        return { focusins: (window as unknown as { __fi: string[] }).__fi, fieldFocused: f !== null && f === document.activeElement, value: f?.value };
      }, scope);
      expect(out.value, 'premise: the kept text is in the field').toBe('Memcached');
      expect(opened.errors).toEqual([]);
      return out;
    } finally {
      await opened.ctx.close();
    }
  };

  it('desk: no focus, no focusin, the field is not focused', async () => {
    const r = await run(DESK_VIEW, CARD);
    expect(r.focusins).toEqual([]);
    expect(r.fieldFocused).toBe(false);
  }, 90_000);

  it('phone (390px, the Sheet): the same return DOES focus the field, as before', async () => {
    const r = await run({ skin: REFINED, theme: PHOSPHOR, width: 390 }, '.sheet-panel');
    expect(r.fieldFocused).toBe(true);
  }, 90_000);
});
