// The Overlord chat in a real Chrome over the production build (Overlord W1, the chat, Task 4; plan Global Constraints, "Phone
// first"). The chat is part 7 of the Overlord's place, drawn under `overlord-v1` for a bound Overlord, so every fixture names the
// word on `/health`, the designation, the ladder, the readiness word and the restore guard, then the chat's thread (two
// generations, a long message, one off the record and cut, settled ticks and a server line) and the bound session's backlog
// (an answer and a turn typed in the pane).
//
// At 360, 390, 1280 and 1920 px, in both skins and in the light and the dark palette (the dark palette's id is `PHOSPHOR`; each
// case asserts the theme the page stamped, so a name the app does not keep can never pass as dark):
// - nothing scrolls sideways, and the page throws nothing;
// - the composer and the off-the-record toggle are inside the viewport at 360 and 390;
// - the ticks and the server line stay inside their bubble's column: none ends past the part's right edge;
// - a pane turn is visibly not an operator bubble: another left edge, no bubble ground, its label drawn;
// - a refused send leaves the text in the box;
// - a long thread scrolls inside the part, never the page.
//
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/overlord-chat.browser.test.ts )`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type DistServer } from './app';
import { fleetSession } from '../test/fleetFixture';

const NOW = Date.now();
const SID = 'lane-a-overlord';
const LONG = `${'A message long enough to wrap several times on a phone, with a long word '.repeat(4)}supercalifragilisticexpialidociousandthensome.`;

const ROW = {
  bound: { sessionId: SID, generation: 'g1' }, pending: null, term: 1, designatedTerm: 1, model: 'opus',
  accountPools: { pools: ['pool-a'], untagged: false }, pastIds: [], actor: 'operator', lastAttempt: null, stopsOwed: [],
};
const message = (id: number, at: number, over: Record<string, unknown> = {}) => {
  const row = {
    id, at, term: 1, state: 'settled', text: `fixture message ${id}`, cut: false, sha256: 'a'.repeat(64),
    queuedAt: at, deliveredAt: at, pickedUpAt: at, settledAt: at, settledBy: 'acknowledge', spentAt: null, offRecord: false, ...over,
  };
  const settled = row.state === 'settled';
  return {
    kind: 'message', row,
    ticks: { lit: { recorded: true, delivery: true, 'picked-up': settled, settled }, delivery: 'delivered', settledBy: settled ? 'acknowledge' : null, unknown: false },
  };
};
/** `n` messages after the two generations' dividers, the last two long; one server line under the newest. */
function threadOf(n: number): unknown {
  const entries: unknown[] = [{ kind: 'divider', gen: { term: 1, n: 1 }, at: NOW - 7_200_000, current: false, newTerm: false, earlier: 'not-pageable' },
    { kind: 'divider', gen: { term: 1, n: 2 }, at: NOW - 3_600_000, current: true, newTerm: false, earlier: 'not-pageable' }];
  for (let i = 1; i <= n; i += 1) {
    const last = i === n;
    entries.push(message(i, NOW - 3_000_000 + i * 1_000, last ? { text: LONG, offRecord: true, cut: true, state: 'queued', pickedUpAt: null, settledAt: null, settledBy: null } : i === n - 1 ? { text: LONG } : {}));
  }
  entries.push({ kind: 'server-line', messageId: n, text: 'Recorded. The Overlord is renewing, and will read it when the new conversation starts.', word: 'renewing' });
  return {
    v: 1, designation: 'designated', sessionId: SID, term: 1, entries,
    messages: { kind: 'read', value: { more: false } }, generations: { kind: 'read', value: { count: 2 } }, readiness: { kind: 'read', value: { oldest: null } },
  };
}
const ts = (s: number): string => new Date(NOW - 3_000_000 + s * 1000).toISOString();

function fixtureFor(messages: number): AppFixture {
  return {
    fleetFrames: [{ type: 'fleet', sessions: [fleetSession({ id: SID, project: 'overlord', bucket: 'idle' })] }],
    socketFrames: {
      [`/ws/session/${SID}`]: [{
        type: 'backlog', uuid: 'conv-1', offset: 2, file: 'f', missing: false,
        events: [
          { kind: 'assistant', uuid: 'a1', ts: ts(2), text: 'An answer from the Overlord, drawn by the session view\'s own row.' },
          { kind: 'user', uuid: 'u1', ts: ts(3), text: 'typed by someone at the terminal, not from the console' },
        ],
      }],
    },
    api: {
      '/health': { ok: true, build: null, caps: ['overlord-v1'] },
      '/api/overlord/designation': { ok: true, designation: ROW },
      '/api/overlord/ladder': {
        ok: true, operatorRung: 'chat', operatorRungSource: 'set', effectiveRung: 'chat', binding: [], latches: [], conditions: [], readBy: [], lastChange: null,
        rungs: [{ rung: 'off', available: true, needs: null }, { rung: 'chat', available: true, needs: null }],
      },
      '/api/overlord/readiness': { word: 'ready', since: NOW - 1_800_000, why: null, until: null, questionsGo: 'operator', restartable: false, strandCause: null },
      '/api/overlord/restore': { ok: true, authority: { kind: 'coherent' } },
      '/api/overlord/chat': threadOf(messages),
      [`/api/sessions/${SID}/prompt`]: { ok: true, messageId: 99, cut: false, replay: false, offRecord: false },
    },
  };
}

const SKINS = [REFINED, INSTRUMENT] as const;
const WIDTHS = [360, 390, 1280, 1920] as const;
/** The light palette and the dark one, by the ids the app keeps (`@ccrc/ui`'s `THEMES`): `PHOSPHOR` is the dark palette. */
const PALETTES = ['light', PHOSPHOR] as const;

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

async function open(skin: string, theme: string, width: number, messages = 4) {
  const opened = await openApp(browser!, { skin, theme, width }, fixtureFor(messages));
  await opened.page.goto(server!.origin + '/overlord');
  await opened.page.waitForSelector('.oc-chat .oc-msg', { timeout: 20_000 });
  await opened.page.waitForSelector('.oc-chat .oc-pane-turn', { timeout: 20_000 });
  await opened.page.evaluate(async () => { await document.fonts.ready; });
  await opened.page.waitForTimeout(250); // the first paint's transitions settle
  return opened;
}

/** What the page measures, in the page. */
const measure = (phosphor: string) => {
  const box = (el: Element | null) => (el === null ? null : el.getBoundingClientRect().toJSON() as { left: number; right: number; top: number; bottom: number; width: number });
  const chat = document.querySelector('.oc-chat')!;
  const thread = document.querySelector<HTMLElement>('.oc-chat .oc-thread')!;
  const bubbles = [...chat.querySelectorAll('.oc-msg')];
  const pane = chat.querySelector('.oc-pane-turn');
  const paneBg = pane === null ? '' : getComputedStyle(pane).backgroundColor;
  return {
    theme: document.documentElement.getAttribute('data-theme') ?? phosphor,
    sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    vw: document.documentElement.clientWidth, vh: window.innerHeight,
    chat: box(chat)!,
    bubbleRights: bubbles.map((b) => box(b)!.right),
    inner: [...chat.querySelectorAll('.oc-ticks, .oc-server-line, .oc-msg-marks, .oc-msg-text')].map((e) => box(e)!.right),
    pane: box(pane), paneLabel: pane?.querySelector('figcaption')?.textContent ?? null,
    paneGroundIsClear: /rgba\(.*,\s*0\)$|transparent/.test(paneBg),
    bubbleLeft: bubbles.length === 0 ? null : box(bubbles[0]!)!.left,
    composer: box(document.querySelector('.oc-chat .composer-input')),
    toggle: box([...chat.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Off the record') ?? null),
    threadScrolls: thread.scrollHeight > thread.clientHeight + 1, threadOverflowY: getComputedStyle(thread).overflowY,
    pageScrolls: document.documentElement.scrollHeight > window.innerHeight + 1,
  };
};

async function check(page: Page, theme: string, width: number, errors: readonly unknown[]): Promise<ReturnType<typeof measure>> {
  const m = await page.evaluate(measure, PHOSPHOR);
  expect(m.theme, 'the palette the page stamped is the one asked for').toBe(theme);
  expect(m.sideways, 'sideways scroll').toBe(0);
  expect(m.chat.right, 'the part ends inside the page').toBeLessThanOrEqual(m.vw + 0.5);
  for (const r of m.inner) expect(r, 'a tick row, mark, text or server line ends inside the part').toBeLessThanOrEqual(m.chat.right + 0.5);
  for (const r of m.bubbleRights) expect(r, 'a bubble ends inside the part').toBeLessThanOrEqual(m.chat.right + 0.5);
  expect(m.pane, 'the pane turn is drawn').not.toBeNull();
  expect(m.paneLabel).toBe("Typed in the Overlord's pane, not from the console");
  expect(m.paneGroundIsClear, 'a pane turn has no bubble ground').toBe(true);
  expect(m.pane!.left, 'a pane turn is set left, an operator bubble right').toBeLessThan(m.bubbleLeft!);
  if (width < 900) {
    for (const [name, b] of [['the composer', m.composer], ['the toggle', m.toggle]] as const) {
      expect(b, `${name} is drawn`).not.toBeNull();
      expect(b!.right, `${name} ends inside the viewport`).toBeLessThanOrEqual(m.vw + 0.5);
      expect(b!.left, `${name} starts inside the viewport`).toBeGreaterThanOrEqual(0);
    }
  }
  expect(errors).toEqual([]);
  return m;
}

describe.each(SKINS)('the Overlord chat in %s', (skin) => {
  for (const theme of PALETTES) {
    for (const width of WIDTHS) {
      it(`at ${width} (${theme}): no sideways scroll, the ticks and the line inside their column, a pane turn not a bubble, the composer in reach`, async () => {
        const { ctx, page, errors } = await open(skin, theme, width);
        try {
          const shots = process.env['CCRC_SHOTS'];
          if (shots !== undefined && shots !== '') await page.screenshot({ path: `${shots}/overlord-chat-${skin}-${theme}-${width}.png`, fullPage: true });
          await check(page, theme, width, errors);
        } finally {
          await ctx.close();
        }
      }, 60_000);

      it(`at ${width} (${theme}): a refused send leaves the text in the box`, async () => {
        const { ctx, page, errors } = await open(skin, theme, width);
        try {
          await ctx.route(`**/api/sessions/${SID}/prompt`, (route) => route.fulfill({
            status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'renewing' }),
          }));
          await page.fill('.oc-chat .composer-input', 'keep these words');
          await page.click('.oc-chat [aria-label="Send"]');
          await page.waitForSelector('.oc-chat .oc-notice', { timeout: 20_000 });
          expect(await page.inputValue('.oc-chat .composer-input')).toBe('keep these words');
          await check(page, theme, width, errors);
        } finally {
          await ctx.close();
        }
      }, 60_000);
    }
  }
});

describe.each(SKINS)('a long thread in %s', (skin) => {
  for (const width of [360, 1280] as const) {
    it(`at ${width}: scrolls inside the part, never sideways`, async () => {
      const { ctx, page, errors } = await open(skin, 'light', width, 60);
      try {
        const m = await check(page, 'light', width, errors);
        expect(m.threadOverflowY, 'the thread is its own scroller').toBe('auto');
        expect(m.threadScrolls, 'sixty messages overflow the thread, which scrolls').toBe(true);
      } finally {
        await ctx.close();
      }
    }, 60_000);
  }
});
