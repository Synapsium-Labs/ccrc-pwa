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
// - a long thread scrolls inside the part, never the page;
// - (PR B) the thread has more than one page: the newest page names an `older` cursor, so "Show older" is drawn above the oldest
//   row; the newest page holds the Overlord's recorded replies, one with its "I handled this elsewhere" control, one off the
//   record and cut, one with no response row (no control); each stays inside the part's column, and pressing "Show older" reads
//   the second page by its cursor and draws it above, with no sideways scroll, and the control gone;
// - (PR B) pressing "I handled this elsewhere" says it was handled; a reply on screen for a second posts its one `opened` receipt.
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
/** A recorded reply of the Overlord (PR B) with the response row the handled control marks (`row`), or none. */
const replyEntry = (id: number, at: number, over: Record<string, unknown> = {}, response: unknown = { kind: 'row', id: id * 10, handledAt: null }) => ({
  kind: 'reply',
  row: {
    id, at, turnAt: at, term: 1, entryUuid: `e0e0e0e0-0000-4000-8000-${String(id).padStart(12, '0')}`, text: `fixture reply ${id}`, cut: false,
    sha256: 'b'.repeat(64), inReplyTo: null, offRecord: false, ...over,
  },
  response,
});
/** The newest message id of the older page's `before` cursor: the newest page's messages are numbered from here up. */
const FIRST_NEWEST = 11;
/** The newest page: `n` messages (ids from `FIRST_NEWEST`), the last two long, the Overlord's replies among them (a long one with its
 *  handled control, one off the record and cut with no response row), one server line under the newest message, and the cursor of
 *  the older page. The generations' dividers are on the older page: the server sends a divider only where its page reaches. */
function threadOf(n: number): unknown {
  const entries: unknown[] = [];
  for (let i = 1; i <= n; i += 1) {
    const last = i === n;
    const id = FIRST_NEWEST - 1 + i;
    const at = NOW - 3_000_000 + i * 1_000;
    entries.push(message(id, at, last ? { text: LONG, offRecord: true, cut: true, state: 'queued', pickedUpAt: null, settledAt: null, settledBy: null } : i === n - 1 ? { text: LONG } : {}));
    if (i === n - 1) entries.push(replyEntry(101, at + 100, { text: `${LONG} A reply as long as the message, with its handled control under it.` }));
  }
  entries.push({ kind: 'server-line', messageId: FIRST_NEWEST - 1 + n, text: 'Recorded. The Overlord is renewing, and will read it when the new conversation starts.', word: 'renewing' });
  entries.push(replyEntry(102, NOW - 2_000, { text: 'A short reply, off the record and cut.', offRecord: true, cut: true }, { kind: 'no-row' }));
  return {
    v: 1, designation: 'designated', sessionId: SID, term: 1, entries,
    messages: { kind: 'read', value: { more: true } }, generations: { kind: 'read', value: { count: 2 } }, readiness: { kind: 'read', value: { oldest: null } },
    replies: { kind: 'read', value: { more: true } }, older: { before: FIRST_NEWEST, replyBefore: 101 },
  };
}
const OLDER_MESSAGE = 'an older message, from before the newest page';
const OLDER_REPLY = 'an older reply of the Overlord, already handled';
/** The second page, read by the cursor above: both generations' dividers, an older message and an older (handled) reply; nothing older. */
function olderPageOf(): unknown {
  const at = NOW - 7_000_000;
  return {
    v: 1, designation: 'designated', sessionId: SID, term: 1,
    entries: [
      { kind: 'divider', gen: { term: 1, n: 1 }, at: NOW - 7_200_000, current: false, newTerm: false, earlier: 'not-pageable' },
      message(1, at, { text: OLDER_MESSAGE }),
      replyEntry(80, at + 1_000, { text: OLDER_REPLY }, { kind: 'row', id: 800, handledAt: NOW - 6_000_000 }),
      { kind: 'divider', gen: { term: 1, n: 2 }, at: NOW - 3_600_000, current: true, newTerm: false, earlier: 'not-pageable' },
    ],
    messages: { kind: 'read', value: { more: false } }, generations: { kind: 'read', value: { count: 2 } }, readiness: { kind: 'read', value: { oldest: null } },
    replies: { kind: 'read', value: { more: false } }, older: null,
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
  // The second page is read by its cursor (`?before=&replyBefore=`): the fixture's `/api` is keyed by pathname alone, so the
  // cursor's reads are answered here, ahead of it (the newest handler wins). Every POST the page makes is kept, for the receipts.
  const older: string[] = [];
  const posts: { url: string; body: string }[] = [];
  await opened.ctx.route((url) => url.pathname === '/api/overlord/chat' && url.searchParams.has('before'), async (route) => {
    older.push(new URL(route.request().url()).search);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(olderPageOf()) });
  });
  await opened.ctx.route('**/api/responses/*/handled', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, id: 1010, handledAt: NOW, changed: true }),
  }));
  opened.page.on('request', (r) => { if (r.method() === 'POST') posts.push({ url: r.url(), body: r.postData() ?? '' }); });
  await opened.page.goto(server!.origin + '/overlord');
  await opened.page.waitForSelector('.oc-chat .oc-msg', { timeout: 20_000 });
  await opened.page.waitForSelector('.oc-chat .oc-pane-turn', { timeout: 20_000 });
  await opened.page.waitForSelector('.oc-chat .oc-reply', { timeout: 20_000 });
  await opened.page.evaluate(async () => { await document.fonts.ready; });
  await opened.page.waitForTimeout(250); // the first paint's transitions settle
  return { ...opened, older, posts };
}

/** What the page measures, in the page. */
const measure = (phosphor: string) => {
  const box = (el: Element | null) => (el === null ? null : el.getBoundingClientRect().toJSON() as { left: number; right: number; top: number; bottom: number; width: number });
  const chat = document.querySelector('.oc-chat')!;
  const thread = document.querySelector<HTMLElement>('.oc-chat .oc-thread')!;
  const bubbles = [...chat.querySelectorAll('.oc-msg')];
  const pane = chat.querySelector('.oc-pane-turn');
  const paneBg = pane === null ? '' : getComputedStyle(pane).backgroundColor;
  const replies = [...chat.querySelectorAll('.oc-reply')];
  const replyBg = replies[0] === undefined ? '' : getComputedStyle(replies[0]).backgroundColor;
  const handled = [...chat.querySelectorAll('.oc-reply button')];
  return {
    theme: document.documentElement.getAttribute('data-theme') ?? phosphor,
    sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    vw: document.documentElement.clientWidth, vh: window.innerHeight,
    chat: box(chat)!,
    bubbleRights: bubbles.map((b) => box(b)!.right),
    inner: [...chat.querySelectorAll('.oc-ticks, .oc-server-line, .oc-msg-marks, .oc-msg-text, .oc-reply-text, .oc-reply-marks, .oc-older')].map((e) => box(e)!.right),
    replyCount: replies.length,
    replyRights: replies.map((r) => box(r)!.right),
    replyLefts: replies.map((r) => box(r)!.left),
    replyGroundIsClear: /rgba\(.*,\s*0\)$|transparent/.test(replyBg),
    replyMarks: [...chat.querySelectorAll('.oc-reply .oc-mark')].map((e) => e.textContent ?? ''),
    handledButtons: handled.map((b) => ({ name: b.textContent?.trim() ?? '', box: box(b)! })),
    olderButton: box(chat.querySelector('.oc-older button')),
    pane: box(pane), paneLabel: pane?.querySelector('figcaption')?.textContent ?? null,
    paneGroundIsClear: /rgba\(.*,\s*0\)$|transparent/.test(paneBg),
    bubbleLeft: bubbles.length === 0 ? null : box(bubbles[0]!)!.left,
    composer: box(document.querySelector('.oc-chat .composer-input')),
    toggle: box([...chat.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Off the record') ?? null),
    threadScrolls: thread.scrollHeight > thread.clientHeight + 1, threadOverflowY: getComputedStyle(thread).overflowY,
    pageScrolls: document.documentElement.scrollHeight > window.innerHeight + 1,
  };
};

async function check(page: Page, theme: string, width: number, errors: readonly unknown[], olderOffered = true): Promise<ReturnType<typeof measure>> {
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
  // The Overlord's replies (PR B): drawn, inside the part's column and set left, with no bubble ground; the handled control only
  // on the reply with a response row, inside the column too; "Show older" while an older page is on record.
  expect(m.replyCount, 'the replies are drawn').toBeGreaterThan(0);
  for (const r of m.replyRights) expect(r, 'a reply ends inside the part').toBeLessThanOrEqual(m.chat.right + 0.5);
  for (const l of m.replyLefts) expect(l, 'a reply starts inside the part').toBeGreaterThanOrEqual(m.chat.left - 0.5);
  expect(m.replyGroundIsClear, 'a reply is not a bubble: no ground').toBe(true);
  expect(m.replyMarks, 'the off-the-record reply says so, and that it was cut').toEqual(expect.arrayContaining(['off the record', 'cut to fit']));
  for (const b of m.handledButtons) {
    expect(b.name, 'a button in a reply is the handled control').toBe('I handled this elsewhere');
    expect(b.box.right, 'the handled control ends inside the part').toBeLessThanOrEqual(m.chat.right + 0.5);
    expect(b.box.left, 'and starts inside it').toBeGreaterThanOrEqual(m.chat.left - 0.5);
    expect(b.box.right, 'and inside the viewport').toBeLessThanOrEqual(m.vw + 0.5);
  }
  if (olderOffered) {
    expect(m.olderButton, 'Show older is drawn while an older page is on record').not.toBeNull();
    expect(m.olderButton!.right, 'Show older ends inside the part').toBeLessThanOrEqual(m.chat.right + 0.5);
    expect(m.olderButton!.left, 'and starts inside it').toBeGreaterThanOrEqual(m.chat.left - 0.5);
  } else {
    expect(m.olderButton, 'no older page: no control').toBeNull();
  }
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

      it(`at ${width} (${theme}): Show older reads the second page by its cursor and draws it above, with no sideways scroll; the handled control says handled`, async () => {
        const { ctx, page, errors, older } = await open(skin, theme, width);
        try {
          const first = await page.evaluate(measure, PHOSPHOR);
          expect(first.handledButtons, 'one reply has a response row not yet handled: one control').toHaveLength(1);
          await page.locator('.oc-chat .oc-older button').click();
          await page.getByText(OLDER_MESSAGE).waitFor({ timeout: 20_000 });
          expect(older, 'one read by the cursor the thread named').toEqual([`?before=${FIRST_NEWEST}&replyBefore=101`]);
          const after = await check(page, theme, width, errors, false);
          expect(after.handledButtons.length, 'the older reply was handled already: no control of its own').toBe(1);
          const order = await page.evaluate((words) => {
            const text = document.querySelector('.oc-chat .oc-thread')!.textContent ?? '';
            return words.map((w) => text.indexOf(w));
          }, ['generation 1', OLDER_MESSAGE, OLDER_REPLY, 'generation 2', 'fixture message 11']);
          expect(order.every((i, k) => i >= 0 && (k === 0 || i > order[k - 1]!)), `the older page sits above the newest: ${JSON.stringify(order)}`).toBe(true);
          await page.locator('.oc-chat .oc-reply button').click();
          await page.locator('.oc-chat .oc-reply button').waitFor({ state: 'detached', timeout: 20_000 });
          await page.locator('.oc-chat .oc-reply[aria-label="Overlord reply 101"] .oc-handled').waitFor({ timeout: 20_000 });
          const done = await check(page, theme, width, errors, false);
          expect(done.handledButtons, 'handled: the control is gone').toHaveLength(0);
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

describe('a reply on screen posts its opened receipt', () => {
  it('a reply seen for a second posts one receipt for { kind: reply, id }, once, and no reply that is not on screen', async () => {
    const { ctx, page, errors, posts } = await open('refined', 'light', 1280);
    try {
      const receipts = (): string[] => posts.filter((p) => p.url.endsWith('/api/responses/receipts')).map((p) => p.body);
      // The part sits below the fold of the Overlord's place: nothing is on screen, so nothing is posted, until it is scrolled to.
      await page.waitForTimeout(1_500);
      expect(receipts(), 'a reply below the fold is not seen: nothing posted').toEqual([]);
      await page.locator('.oc-chat .oc-reply').last().scrollIntoViewIfNeeded();
      const deadline = Date.now() + 20_000;
      while (!receipts().some((b) => b.includes('"id":102')) && Date.now() < deadline) await page.waitForTimeout(250);
      expect(receipts().some((b) => b.includes('"id":102')), 'the newest reply, at the foot, was seen for a second').toBe(true);
      await page.waitForTimeout(2_500);
      const bodies = receipts();
      const refs = bodies.flatMap((b) => (JSON.parse(b) as { receipts: { ref: { kind: string; id: number }; receipt: string; from: { source: string } }[] }).receipts);
      expect(refs.every((r) => r.ref.kind === 'reply' && r.receipt === 'opened' && r.from.source === 'console'), JSON.stringify(refs)).toBe(true);
      expect(refs.filter((r) => r.ref.id === 102), 'once').toHaveLength(1);
      expect(refs.some((r) => r.ref.id === 80), 'the older page is not drawn, so none for its reply').toBe(false);
      expect(errors).toEqual([]);
    } finally {
      await ctx.close();
    }
  }, 60_000);
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
