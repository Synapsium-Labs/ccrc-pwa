// The right-side inspector hides and shows, remembered per device (desktop polish T3e, D-6385), in a real Chrome over
// the production build.
//
// What jsdom cannot hold: Refined at 1600 and 1920 on a session with a plan and mail —
//   - "shown: three tracks; hidden: two tracks": the frame's grid has the sidebar, the detail and the 320 rail while the
//     rail is shown, and the sidebar and the detail alone once it is hidden (the empty aside takes no track); the
//     reading column is still 820 and centred in the detail pane, and the task and mail strips are above the composer;
//   - "hiding at the newest turn keeps the reader at the newest turn": the strips returning shrinks the transcript, and
//     the reader that was at the newest turn is still there;
//   - "no sideways page scroll either way";
//   - "under touch emulation at 1600 the toggle is at least 44 px";
//   - "at 1600 the toggle's word sits beside its glyph, shown and hidden" (C12 item 13: `chat.css`'s
//     `.chat-head .keycap--inspector,` removed stacks the word under the glyph, and this case reds).
//
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts
// --maxWorkers=2 browser/inspector-hide.browser.test.ts )`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { PHOSPHOR, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { backlogFrame, buildDist, longTranscript, openApp, removeDist, serveDist, type AppFixture, type AppView, type DistServer } from './app';
import { fleetSession } from '../test/fleetFixture';

const NOW = 1_792_362_479;
const ID = 'lane-a-project-a-quiet-basin';
const SESSION = fleetSession({
  id: ID, wrapper: 'lane-a', home: 'lane-a', project: 'project-a', workdir: '/w/project-a/quiet-basin',
  workspace: 'quiet-basin', name: 'quiet-basin', status: 'idle', bucket: 'idle', model: 'model-x', effort: 'high',
});
const EVENTS = longTranscript(60);
const LAST_TEXT = (EVENTS.at(-1) as { text: string }).text;
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
  socketFrames: {
    [`/ws/session/${ID}`]: [
      backlogFrame(EVENTS),
      { type: 'tasks', tasks: [{ id: '1', subject: 'build the rail', description: 'why', activeForm: 'building the rail', status: 'in_progress' }] },
      { type: 'mail', mail: [{
        id: 1, deliveryId: 1, at: NOW * 1000 - 30_000, fromId: 'coordinator', toId: ID, runId: 3, kind: 'question',
        subject: 'rebase before you start?', artifacts: [], state: 'delivered', attempts: 0, lastError: null,
        lastGate: null, gateCount: 0, gateSince: null, gateAt: null,
      }] },
    ],
  },
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

const WIDTHS = [1600, 1920];
const view = (width: number, touch?: boolean): AppView => ({ skin: REFINED, theme: PHOSPHOR, width, ...(touch === true ? { touch } : {}) });

async function openSession(v: AppView) {
  const opened = await openApp(browser!, v, FIXTURE);
  await opened.page.goto(`${server!.origin}/s/${ID}`);
  await opened.page.waitForSelector('[data-command="toggle-inspector"]', { timeout: 20_000 });
  await opened.page.waitForFunction((text) => document.body.textContent?.includes(text) === true, LAST_TEXT, { timeout: 20_000 });
  await opened.page.waitForTimeout(600); // the first paint's transitions, the frames and the scroll to the newest turn settle
  return opened;
}

interface Measure {
  tracks: string[];
  rail: boolean;
  column: { width: number; leftGap: number; rightGap: number };
  strips: { task: boolean; mail: boolean; aboveComposer: boolean };
  sideScroll: number;
}

const measure = (page: Page): Promise<Measure> => page.evaluate(() => {
  const detail = document.querySelector('main.shell-detail')!.getBoundingClientRect();
  const composer = document.querySelector('.composer')!.getBoundingClientRect();
  const task = document.querySelector('.chat-strips .task-strip');
  const mail = document.querySelector('.chat-strips .mail-strip');
  const above = (el: Element | null): boolean => el !== null && el.getBoundingClientRect().bottom <= composer.top + 1;
  return {
    tracks: getComputedStyle(document.querySelector('.app-shell')!).gridTemplateColumns.split(' '),
    rail: document.querySelector('.ref-inspector') !== null,
    column: {
      width: Math.round(composer.width),
      leftGap: Math.round(composer.left - detail.left),
      rightGap: Math.round(detail.right - composer.right),
    },
    strips: { task: task !== null, mail: mail !== null, aboveComposer: above(task) && above(mail) },
    sideScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
});

const toggle = (page: Page) => page.locator('[data-command="toggle-inspector"]');

describe('Refined at 1600 and 1920', () => {
  for (const width of WIDTHS) {
    it(`${width}px, shown: three tracks; hidden: two tracks, the reading column still 820 and centred, the strips above the composer`, async () => {
      const { ctx, page, errors } = await openSession(view(width));
      try {
        const shown = await measure(page);
        expect(shown.tracks, 'shown: sidebar, detail, rail').toHaveLength(3);
        expect(shown.tracks[0]).toBe('400px');
        expect(shown.tracks[2]).toBe('320px');
        expect(shown.rail).toBe(true);
        expect(shown.strips, 'the rail holds the plan and the mail').toEqual({ task: false, mail: false, aboveComposer: false });
        expect(shown.column.width, 'the reading column, shown (yields to the pane at 1600)').toBeLessThanOrEqual(820);
        if (width === 1920) expect(shown.column.width).toBe(820);

        await toggle(page).click();
        await page.waitForFunction(() => document.querySelector('.ref-inspector') === null);
        await page.waitForTimeout(300);
        const hidden = await measure(page);
        expect(hidden.tracks, 'hidden: sidebar and detail').toHaveLength(2);
        expect(hidden.tracks[0]).toBe('400px');
        expect(hidden.rail).toBe(false);
        expect(hidden.column.width, 'the column is the measure, not wider').toBe(820);
        expect(Math.abs(hidden.column.leftGap - hidden.column.rightGap), `centred (${hidden.column.leftGap} / ${hidden.column.rightGap})`)
          .toBeLessThanOrEqual(1);
        expect(hidden.strips, 'the plan and the mail are back, above the composer').toEqual({ task: true, mail: true, aboveComposer: true });

        // Shown again by the key: the same three tracks.
        await page.keyboard.press('i');
        await page.waitForFunction(() => document.querySelector('.ref-inspector') !== null);
        await page.waitForTimeout(300);
        const again = await measure(page);
        expect(again.tracks).toEqual(shown.tracks);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 60_000);

    it(`${width}px, no sideways page scroll either way`, async () => {
      const { ctx, page } = await openSession(view(width));
      try {
        expect((await measure(page)).sideScroll, 'shown').toBe(0);
        await toggle(page).click();
        await page.waitForFunction(() => document.querySelector('.ref-inspector') === null);
        await page.waitForTimeout(300);
        expect((await measure(page)).sideScroll, 'hidden').toBe(0);
        await page.keyboard.press('i');
        await page.waitForFunction(() => document.querySelector('.ref-inspector') !== null);
        await page.waitForTimeout(300);
        expect((await measure(page)).sideScroll, 'shown again').toBe(0);
      } finally {
        await ctx.close();
      }
    }, 60_000);

    it(`${width}px, hiding at the newest turn keeps the reader at the newest turn`, async () => {
      const { ctx, page } = await openSession(view(width));
      try {
        const reading = (): Promise<{ fromEnd: number; lastVisible: boolean; overflow: number; height: number }> => page.evaluate((text) => {
          const sc = document.querySelector<HTMLElement>('.chat-scroller')!;
          const r = sc.getBoundingClientRect();
          const last = [...document.querySelectorAll<HTMLElement>('.chat-item')].reverse()
            .find((el) => (el.textContent ?? '').includes(text));
          const box = last?.getBoundingClientRect();
          return {
            fromEnd: Math.round(sc.scrollHeight - sc.scrollTop - sc.clientHeight),
            overflow: sc.scrollHeight - sc.clientHeight,
            height: sc.clientHeight,
            lastVisible: box !== undefined && box.bottom <= r.bottom + 1 && box.top >= r.top - 1,
          };
        }, LAST_TEXT);
        const before = await reading();
        // Not vacuous: the transcript overflows its scroller, so "at the newest turn" is a position that can be lost.
        expect(before.overflow, 'the transcript overflows the scroller').toBeGreaterThan(200);
        expect(before.fromEnd, 'at the newest turn to begin with').toBeLessThanOrEqual(4);
        await toggle(page).click();
        await page.waitForFunction(() => document.querySelector('.ref-inspector') === null);
        await page.waitForTimeout(500);
        const hidden = await reading();
        expect(hidden.height, 'the strips came back, so the scroller got shorter').toBeLessThan(before.height);
        expect(hidden.fromEnd, 'still at the newest turn, hidden').toBeLessThanOrEqual(4);
        expect(hidden.lastVisible, 'the newest turn is on screen, hidden').toBe(true);
        await toggle(page).click();
        await page.waitForFunction(() => document.querySelector('.ref-inspector') !== null);
        await page.waitForTimeout(500);
        const shown = await reading();
        expect(shown.fromEnd, 'and shown again').toBeLessThanOrEqual(4);
        expect(shown.lastVisible).toBe(true);
      } finally {
        await ctx.close();
      }
    }, 60_000);
  }

  // The worded door flows in a column, as the header's other worded keycaps do (`chat.css`'s `.chat-head .keycap--inspector`,
  // T3e's departure): without that selector the word stacks under the glyph and no other case sees it (C12 item 13).
  it("at 1600 the toggle's word sits beside its glyph, shown and hidden", async () => {
    const { ctx, page } = await openSession(view(1600));
    try {
      for (const hide of [false, true]) {
        if (hide) {
          await toggle(page).click();
          await page.waitForFunction(() => document.querySelector('.ref-inspector') === null);
        }
        const parts = await page.evaluate(() => {
          const door = document.querySelector('[data-command="toggle-inspector"]')!;
          const box = (el: Element | null) => (el === null ? null : el.getBoundingClientRect().toJSON() as DOMRect);
          return { glyph: box(door.querySelector('svg')), word: box(door.querySelector('.keycap-word')) };
        });
        expect(parts.glyph, `the glyph, hidden=${hide}`).not.toBeNull();
        expect(parts.word, `the word, hidden=${hide}`).not.toBeNull();
        expect(parts.word!.width, `the word is drawn, hidden=${hide}`).toBeGreaterThan(0);
        expect(parts.word!.left, `the word starts after the glyph, hidden=${hide}`).toBeGreaterThanOrEqual(parts.glyph!.right - 0.5);
        expect(parts.word!.top, `the word is on the glyph's line, hidden=${hide}`).toBeLessThan(parts.glyph!.bottom);
      }
    } finally {
      await ctx.close();
    }
  }, 60_000);

  it('under touch emulation at 1600 the toggle is at least 44 px', async () => {
    const { ctx, page } = await openSession(view(1600, true));
    try {
      for (const hide of [false, true]) {
        if (hide) {
          await toggle(page).tap();
          await page.waitForFunction(() => document.querySelector('.ref-inspector') === null);
        }
        const box = await toggle(page).boundingBox();
        expect(box, `hidden=${hide}`).not.toBeNull();
        // A laid-out box can read a hair under its CSS size (43.99999 on a loaded runner), so the floor allows half a
        // pixel, below one device pixel, as update-indicator's does; a toggle that is really short (40) still reds.
        expect(box!.width, `width, hidden=${hide}`).toBeGreaterThanOrEqual(44 - 0.5);
        expect(box!.height, `height, hidden=${hide}`).toBeGreaterThanOrEqual(44 - 0.5);
      }
    } finally {
      await ctx.close();
    }
  }, 60_000);
});
