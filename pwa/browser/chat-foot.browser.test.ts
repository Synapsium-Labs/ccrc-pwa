// One owner of "stay at the foot" (desktop polish wave 175, carried item 6a): the virtual list's own follow is off, and
// the chat list keeps a reader at the foot itself (`footFollow.ts`). In a real Chrome over the production build, with the
// real virtual list, at a phone's and a desk's width in both skins, what the list's follow did is still done:
//  - a reader at the foot stays there when a row is appended, when the last row grows in many small steps, when a picture
//    in the last rows finishes loading, and when a tool stretch at the foot gains a call; a reader scrolled up is moved
//    by none of them;
//  - the view shrinking by 300px (a phone keyboard's shape) and growing back keeps a reader at the foot both times, and
//    moves a reader scrolled up not at all;
//  - a window resize and a skin change at the foot, opening a session, a new backlog on the same stream, and Jump to
//    latest all end at the foot;
//  - and the defect it was turned off for: a tap that opens the newest stretch 40 to 94ms after a call arrived in it
//    leaves the tapped header in view (measured thrown in 13 of 20 taps on Instrument before).
//
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/chat-foot.browser.test.ts )`.
import { deflateSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page, type WebSocketRoute } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type AppView, type DistServer } from './app';

const VIEWS: AppView[] = [REFINED, INSTRUMENT].flatMap((skin) => [390, 1280].map((width) => ({ skin, theme: PHOSPHOR, width })));
const named = (v: AppView): string => `${v.skin}, ${v.width}px`;

// ---- the fixture: one session, neutral names ----------------------------------------------------------------------
const NOW = 1_792_362_479;
const SESSION = {
  id: 'project-a-one', wrapper: 'lane-a', home: 'lane-a', project: 'project-a', workdir: '/w/project-a/one',
  workspace: 'one', name: 'one', status: 'idle', statusUpdatedAt: null, limits: null, dialogPending: false,
  version: null, model: null, effort: null, ultracode: false, branch: 'ws/one', ctxPct: null, paneCols: null,
  tasks: null, pr: null, archivedAt: null, archivedBytes: null, held: null, hookState: null, askSummary: null,
  subagents: null, background: null, withCoordinator: null, lastEnd: null, hibernatedAt: null, bucket: 'working',
  unmeasured: [], started: true, child: { kind: 'none' },
};
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
let k = 0;
const call = (into: object[], name: string, input: object, isError = false): void => {
  k += 1;
  into.push({ kind: 'tool_use', uuid: `u${k}`, ts: TS, toolId: `t${k}`, name, input: JSON.stringify(input) });
  into.push({ kind: 'tool_result', ts: TS, toolId: `t${k}`, text: isError ? 'exit 1' : 'ok', isError });
};
/** Twenty turns of prose and a few calls, ending on a stretch of thirty-three calls: taller than any view opened. */
const EVENTS: object[] = [];
for (let i = 0; i < 20; i += 1) {
  EVENTS.push({ kind: 'user', uuid: `q${i}`, ts: TS, text: `Run step ${i}.` });
  EVENTS.push({ kind: 'assistant', uuid: `a${i}`, ts: TS, text: `Reading for step ${i}, then running it. ${'More words. '.repeat(i % 5 + 2)}` });
  call(EVENTS, 'Read', { file_path: `/w/project-a/src/a${i}.ts` });
}
EVENTS.push({ kind: 'user', uuid: 'q-last', ts: TS, text: 'Last step.' });
for (let i = 0; i < 33; i += 1) call(EVENTS, 'Read', { file_path: `/w/project-a/src/s${i}.ts` });

/** A PNG `w` by `h`, one flat colour, so a picture row has a real image to load. */
function png(w: number, h: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer): number => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0x60)]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const PICTURE = png(320, 200);

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

async function open(view: AppView, events: object[] = EVENTS) {
  const app = await openApp(browser!, view, FIXTURE);
  let ws: WebSocketRoute | null = null;
  await app.ctx.route('**/api/sessions/*/clip/**', async (route) => {
    await new Promise((r) => setTimeout(r, 400)); // the picture lands after its row is laid out
    await route.fulfill({ status: 200, contentType: 'image/png', body: PICTURE });
  });
  await app.ctx.routeWebSocket(/\/ws\/session\//, (w) => {
    ws = w;
    w.send(JSON.stringify({ type: 'backlog', uuid: 'u-1', events, offset: 1, file: '/w/t.jsonl', missing: false, searchComplete: true, fileMeasured: true }));
  });
  await app.page.goto(`${server!.origin}/s/${SESSION.id}`);
  await app.page.waitForSelector('.tool-activity-row', { timeout: 20_000 });
  await app.page.waitForTimeout(1200);
  const send = (frame: object): void => { (ws as WebSocketRoute | null)!.send(JSON.stringify(frame)); };
  return { ...app, send };
}

/** How far the reader is above the foot, px, and whether Jump to latest shows. */
const foot = (page: Page) => page.evaluate(() => {
  const s = document.querySelector<HTMLElement>('.chat-scroller')!;
  return { gap: Math.round(s.scrollHeight - s.scrollTop - s.clientHeight), pill: document.querySelector('.jump-latest') !== null };
});
async function expectAtFoot(page: Page, what: string): Promise<void> {
  const at = await foot(page);
  expect(at.gap, `${what}: the reader at the foot was left ${at.gap}px above it`).toBeLessThanOrEqual(2);
  expect(at.pill, `${what}: Jump to latest shows for a reader at the foot`).toBe(false);
}
/** Scroll to the middle as a reader does (a wheel first), and let the list settle there. */
async function toMiddle(page: Page): Promise<void> {
  await page.evaluate(() => {
    const s = document.querySelector<HTMLElement>('.chat-scroller')!;
    s.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -100 }));
    s.scrollTop = Math.round((s.scrollHeight - s.clientHeight) / 2);
  });
  await page.waitForTimeout(600);
}
/** The first row in view, by key, and where it stands. */
const inView = (page: Page) => page.evaluate(() => {
  const s = document.querySelector<HTMLElement>('.chat-scroller')!;
  const top = s.getBoundingClientRect().top;
  const r = [...s.querySelectorAll<HTMLElement>('[data-row-key]')].find((x) => x.getBoundingClientRect().top >= top)!;
  return { key: r.dataset.rowKey!, top: r.getBoundingClientRect().top - top };
});
const topOf = (page: Page, key: string) => page.evaluate((kk) => {
  const s = document.querySelector<HTMLElement>('.chat-scroller')!;
  const r = s.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(kk)}"]`);
  return r === null ? null : r.getBoundingClientRect().top - s.getBoundingClientRect().top;
}, key);

/** The four changes at the foot. */
type Change = (o: { page: Page; send: (f: object) => void }, n: number) => Promise<void>;
const CHANGES: [string, Change][] = [
  ['a row appended', async ({ send }, n) => {
    send({ type: 'events', uuid: 'u-1', events: [{ kind: 'assistant', uuid: `live${n}`, ts: TS, text: `A live row ${n}. ${'Words. '.repeat(12)}` }], offset: 2 + n });
  }],
  ['the last row growing in many small steps', async ({ page }) => {
    for (let i = 1; i <= 10; i += 1) {
      await page.evaluate((px) => {
        const rows = document.querySelectorAll<HTMLElement>('.chat-scroller .chat-item');
        rows[rows.length - 1]!.style.paddingBottom = `${px}px`;
      }, i * 12);
      await page.waitForTimeout(40);
    }
  }],
  ['a picture in the last rows finishing loading', async ({ send }, n) => {
    send({ type: 'events', uuid: 'u-1', events: [{ kind: 'user', uuid: `pic${n}`, ts: TS, text: `/w/.cc-clips/lane-a-project-a/clip-pic${n}.png\nThe picture.` }], offset: 2 + n });
  }],
  ['a tool stretch at the foot gaining a call', async ({ send }) => {
    const more: object[] = [];
    call(more, 'Grep', { pattern: 'useSkin' });
    send({ type: 'events', uuid: 'u-1', events: more, offset: 99 });
  }],
];

describe('a reader at the foot stays there; a reader scrolled up is not moved (desktop polish wave 175, item 6a)', () => {
  for (const view of VIEWS) {
    it(`${named(view)}: the four changes at the foot, then scrolled up`, async () => {
      const app = await open(view);
      try {
        await expectAtFoot(app.page, 'opening the session');
        let n = 0;
        for (const [what, change] of CHANGES) {
          n += 1;
          await change(app, n);
          await app.page.waitForTimeout(900);
          await expectAtFoot(app.page, what);
        }
        await toMiddle(app.page);
        for (const [what, change] of CHANGES) {
          n += 1;
          const before = await inView(app.page);
          await change(app, n);
          await app.page.waitForTimeout(900);
          const now = await topOf(app.page, before.key);
          expect(now, `${what}: the row in view is gone`).not.toBeNull();
          expect(Math.abs(now! - before.top), `${what}: a reader scrolled up was moved`).toBeLessThanOrEqual(1);
          expect((await foot(app.page)).pill, `${what}: Jump to latest went away for a reader scrolled up`).toBe(true);
        }
        expect(app.errors).toEqual([]);
      } finally {
        await app.ctx.close();
      }
    }, 120_000);

    it(`${named(view)}: the view shrinking by 300px and growing back, at the foot and scrolled up`, async () => {
      const app = await open(view);
      try {
        const size = app.page.viewportSize()!;
        await app.page.setViewportSize({ width: size.width, height: size.height - 300 });
        await app.page.waitForTimeout(700);
        await expectAtFoot(app.page, 'the view shrank');
        await app.page.setViewportSize(size);
        await app.page.waitForTimeout(700);
        await expectAtFoot(app.page, 'the view grew back');
        await toMiddle(app.page);
        const before = await inView(app.page);
        await app.page.setViewportSize({ width: size.width, height: size.height - 300 });
        await app.page.waitForTimeout(700);
        expect(Math.abs((await topOf(app.page, before.key))! - before.top), 'the view shrank: a reader scrolled up was moved').toBeLessThanOrEqual(1);
        await app.page.setViewportSize(size);
        await app.page.waitForTimeout(700);
        expect(Math.abs((await topOf(app.page, before.key))! - before.top), 'the view grew back: a reader scrolled up was moved').toBeLessThanOrEqual(1);
      } finally {
        await app.ctx.close();
      }
    }, 90_000);

    it(`${named(view)}: a window resize, a new backlog on the same stream, and Jump to latest end at the foot`, async () => {
      const app = await open(view);
      try {
        const size = app.page.viewportSize()!;
        await app.page.setViewportSize({ width: size.width - 60, height: size.height });
        await app.page.waitForTimeout(1500);
        await expectAtFoot(app.page, 'a window resize');
        app.send({ type: 'backlog', uuid: 'u-1', events: EVENTS, offset: 3, file: '/w/t.jsonl', missing: false, searchComplete: true, fileMeasured: true });
        await app.page.waitForTimeout(1000);
        await expectAtFoot(app.page, 'a new backlog on the same stream');
        await toMiddle(app.page);
        await app.page.locator('.jump-latest').click();
        await app.page.waitForTimeout(1500);
        // As today: its own smooth scroll to the last row's start, which lands a few pixels above the very end (measured 3px
        // with virtuoso's follow on and off alike), inside the pill's band, so the pill goes and the reader is at the foot.
        const band = await app.page.evaluate(() => {
          const st = getComputedStyle(document.documentElement);
          return Number.parseFloat(st.getPropertyValue('--tap-min')) + Number.parseFloat(st.getPropertyValue('--sp-3'));
        });
        const at = await foot(app.page);
        expect(at.gap, 'Jump to latest: the reader stopped short of the foot').toBeLessThanOrEqual(band);
        expect(at.pill, 'Jump to latest: the pill is still up').toBe(false);
        // And a reader it brought there is followed: an append lands at the foot.
        app.send({ type: 'events', uuid: 'u-1', events: [{ kind: 'assistant', uuid: 'after-jump', ts: TS, text: 'After the jump.' }], offset: 50 });
        await app.page.waitForTimeout(900);
        await expectAtFoot(app.page, 'an append after Jump to latest');
      } finally {
        await app.ctx.close();
      }
    }, 90_000);
  }

  for (const view of VIEWS.filter((v) => v.width >= 900)) {
    it(`${named(view)}: a skin change at the foot`, async () => {
      const app = await open(view);
      try {
        const other = view.skin === REFINED ? 'Instrument' : 'Refined';
        await app.page.keyboard.press('Control+k');
        await app.page.keyboard.type('Switch layout');
        await app.page.keyboard.press('Enter');
        await app.page.waitForTimeout(300);
        await app.page.keyboard.type(other);
        await app.page.keyboard.press('Enter');
        await app.page.waitForTimeout(1500);
        const skin = await app.page.evaluate(() => document.documentElement.getAttribute('data-skin'));
        expect(skin, 'the palette did not switch the skin').toBe(other.toLowerCase());
        await expectAtFoot(app.page, 'a skin change');
      } finally {
        await app.ctx.close();
      }
    }, 60_000);
  }
});

describe('a tap that opens the newest stretch just after a call arrived in it stays in view (item 6a)', () => {
  for (const view of VIEWS) {
    it(`${named(view)}: ten taps, 40 to 94ms after the call`, async () => {
      const thrown: string[] = [];
      for (let n = 0; n < 10; n += 1) {
        const app = await open(view);
        try {
          const gap = 40 + Math.round((54 * n) / 9);
          const more: object[] = [];
          call(more, 'Grep', { pattern: `p${n}` });
          await app.page.evaluate((g) => {
            (window as unknown as { __arm: () => void }).__arm = () => setTimeout(() => {
              const rows = [...document.querySelectorAll<HTMLElement>('.tool-activity-row')];
              rows[rows.length - 1]!.click();
            }, g);
          }, gap);
          app.send({ type: 'events', uuid: 'u-1', events: more, offset: 2 });
          await app.page.evaluate(() => (window as unknown as { __arm: () => void }).__arm());
          await app.page.waitForTimeout(900);
          const at = await app.page.evaluate(() => {
            const s = document.querySelector<HTMLElement>('.chat-scroller')!;
            const rows = [...document.querySelectorAll<HTMLElement>('.tool-activity-row')];
            const r = rows[rows.length - 1]!;
            return { top: r.getBoundingClientRect().top - s.getBoundingClientRect().top, open: r.getAttribute('aria-expanded') };
          });
          expect(at.open, 'the tap did not open the row').toBe('true');
          if (at.top < -10) thrown.push(`${gap}ms: ${Math.round(at.top)}px`);
        } finally {
          await app.ctx.close();
        }
      }
      expect(thrown, 'the tapped header was thrown out of view').toEqual([]);
    }, 300_000);
  }
});

describe('a reader at the foot who closes the newest stretch still follows a live row (fix round 1, A1)', () => {
  // The newest stretch three calls long, so its header is in view at the foot open or closed: a reader closes what they
  // can see. (Opened at the foot, the fixture's 33-call stretch is 1,838px tall in Instrument; closing it from its foot
  // leaves the reader 1,770px above the new foot, at its header, which is leaving the foot by position.)
  const SHORT = EVENTS.slice(0, EVENTS.length - 60);
  for (const view of VIEWS) {
    it(`${named(view)}: closed at the foot, a row 150ms later is followed`, async () => {
      const app = await open(view, SHORT);
      try {
        // Open the newest stretch by its own header (an open stretch draws run rows of its own inside it), then read to its
        // foot.
        await app.page.evaluate(() => { [...document.querySelectorAll<HTMLElement>('.tool-activity-row')].filter((b) => b.closest('.tool-activity-body') === null).at(-1)!.click(); });
        await app.page.waitForTimeout(1000);
        // Its rows measure as they come into view, so the foot moves on: read down until the foot is reached.
        for (let n = 0; n < 4 && (n === 0 || (await foot(app.page)).gap > 2); n += 1) {
          await app.page.evaluate(() => {
            const s = document.querySelector<HTMLElement>('.chat-scroller')!;
            s.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 100 }));
            s.scrollTop = s.scrollHeight;
          });
          await app.page.waitForTimeout(600);
        }
        await expectAtFoot(app.page, 'read to the foot of the open stretch');
        // Close it at the foot: the list shrinks under the reader, who stays at its foot.
        await app.page.evaluate(() => { [...document.querySelectorAll<HTMLElement>('.tool-activity-row')].filter((b) => b.closest('.tool-activity-body') === null).at(-1)!.click(); });
        await app.page.waitForTimeout(150);
        app.send({ type: 'events', uuid: 'u-1', events: [{ kind: 'assistant', uuid: 'live-after-close', ts: TS, text: `A live row. ${'words '.repeat(30)}` }], offset: 2 });
        await app.page.waitForSelector('[data-row-key="live-after-close"]', { state: 'attached', timeout: 10_000 });
        await app.page.waitForTimeout(900);
        await expectAtFoot(app.page, 'a live row just after the reader closed the newest stretch');
        expect(app.errors).toEqual([]);
      } finally {
        await app.ctx.close();
      }
    }, 60_000);
  }
});
