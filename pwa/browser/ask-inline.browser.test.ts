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
// KNOWN (reported with R64 F5): `InlineCard` focuses with `preventScroll`, so with the forty-line question the first option
// is focused but lies below the visible part of the card's own scroller; the ruling names the existing raise, unchanged.
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
  }
  const MEASURE = (card: string): Geometry => {
    const el = document.querySelector<HTMLElement>(card)!;
    const body = el.querySelector<HTMLElement>('.ask-inline-body')!;
    const a = document.activeElement as HTMLElement;
    const br = body.getBoundingClientRect();
    const ar = a.getBoundingClientRect();
    return {
      inCard: el.contains(a), focusIsFirst: a === el.querySelector<HTMLElement>('.opt[tabindex="0"]'), vh: window.innerHeight,
      scrollTop: body.scrollTop, scrollHeight: body.scrollHeight, clientHeight: body.clientHeight,
      scroller: [Math.round(br.top), Math.round(br.bottom)], option: [Math.round(ar.top), Math.round(ar.bottom)],
    };
  };
  /** Open `frames` at `view` with the call in the transcript, park focus on the body, click Go to question, and measure. */
  async function goTo(view: AppView, frames: object[]): Promise<{ g: Geometry; errors: string[] }> {
    const opened = await openApp(browser!, view, FIXTURE);
    try {
      await opened.ctx.routeWebSocket(/\/ws\/session\//, (ws) => {
        for (const frame of WITH_CALL(frames)) ws.send(JSON.stringify(frame));
      });
      await opened.page.goto(`${server!.origin}/s/${SESSION.id}`);
      await opened.page.waitForSelector(`${CARD} .ask-who`, { timeout: 30_000 });
      await opened.page.waitForTimeout(800);
      await opened.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await opened.page.locator('.tool-ask .ask-state button', { hasText: 'Go to question' }).click();
      await opened.page.waitForTimeout(300);
      return { g: await opened.page.evaluate(MEASURE, CARD), errors: opened.errors };
    } finally {
      await opened.ctx.close();
    }
  }
  const inside = (inner: [number, number], outer: [number, number]): boolean => inner[0] >= outer[0] - 1 && inner[1] <= outer[1] + 1;

  for (const view of GOTO_VIEWS) {
    it(`${named(view)}: the focused first option lies inside the card's scroller and the window after Go to question`, async () => {
      const { g, errors } = await goTo(view, FRAMES());
      expect(g.inCard && g.focusIsFirst, 'premise: focus is on the first option (the identity control)').toBe(true);
      expect(g.scrollHeight, 'premise: the forty-line question overflows the one scroller').toBeGreaterThan(g.clientHeight);
      expect(inside(g.option, g.scroller), `the option ${JSON.stringify(g.option)} lies inside the scroller ${JSON.stringify(g.scroller)} (scrollTop ${g.scrollTop})`).toBe(true);
      expect(inside(g.option, [0, g.vh]), `the option ${JSON.stringify(g.option)} lies inside the window (0-${g.vh})`).toBe(true);
      expect(errors).toEqual([]);
    }, 90_000);
  }

  it('a short card (fixture 2, the aged copy) is already showing its first option: Go to question scrolls nothing', async () => {
    const short = [BACKLOG, { type: 'status', status: 'busy', statusUpdatedAt: null }, ...askFixture(2).frames];
    const { g, errors } = await goTo({ skin: REFINED, theme: PHOSPHOR, width: 1280 }, short);
    expect(g.inCard && g.focusIsFirst, 'premise: focus is on the first option').toBe(true);
    expect(g.scrollTop, 'the short card has nothing to scroll').toBe(0);
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
        return { count: opts.length, enabled: opts.filter((o) => !o.disabled).length, stop: opts.filter((o) => o.tabIndex === 0 && o.disabled).length };
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
          enabled: [...el.querySelectorAll<HTMLButtonElement>('button.opt')].filter((o) => !o.disabled).length,
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
