// The chat screen loads older turns as the reader scrolls up, and the turn they are reading does not move (desktop polish
// wave 175), in a real Chrome over the production build, with the real virtual list.
//
// The session socket is routed here: its backlog offers a continuation, and each `older-page` request the page sends is
// answered from a synthetic transcript, a page at a time, the answer naming the continuation it answers (`for`). A case can
// hold an answer to act while a request is in flight. Joins are built to fall inside a tool stretch, on a picture row and
// across a time divider.
//
// Cases: repeated prepends keep the row the reader is looking at within a pixel, phone and desk, both skins, both palettes;
// live rows arriving during a page load, at the foot and scrolled up; a rotation with a request in flight, its late answer
// never applied; paging a long transcript to its start, every row once, in order; the control by keyboard alone; an older
// server (no continuation): no control and no request. Measured and printed: the anchored row's shift per prepend, the time
// from the request to painted rows, the pages to reach the start, and the store and list cost at 5,000 and 20,000 rows.
//
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/chat-history.browser.test.ts )`.
import { appendFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page, type WebSocketRoute } from 'playwright-core';
import { INSTRUMENT, OLDER_WORDS, PHOSPHOR, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type AppView, type DistServer } from './app';

const VIEWS: AppView[] = [REFINED, INSTRUMENT].flatMap((skin) => [PHOSPHOR, 'light'].flatMap((theme) =>
  [390, 1280].map((width) => ({ skin, theme, width }))));
const named = (v: AppView): string => `${v.skin}, ${v.theme}, ${v.width}px`;

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

// ---- the synthetic transcript ---------------------------------------------------------------------------------------
type Ev = Record<string, unknown> & { kind: string };
const PAGE = 30;
/** `blocks` blocks of PAGE events, oldest first, so every page boundary is a join of a known kind, by block % 3:
 *  0, a tool stretch running across the join (the older block ends in calls, this one starts with calls); 1, a picture
 *  row first; 2, a time jump first (a divider that stays). Every event 10 seconds after the one before. */
function transcript(blocks: number, prefix = 'e'): Ev[] {
  const out: Ev[] = [];
  let t = Date.parse('2026-11-20T08:00:00.000Z');
  let n = 0;
  const ts = (): string => { t += 10_000; return new Date(t).toISOString(); };
  const call = (name: string): void => {
    n += 1;
    const at = ts();
    out.push({ kind: 'tool_use', uuid: `${prefix}u${n}`, ts: at, toolId: `${prefix}t${n}`, name, input: JSON.stringify({ command: `step ${n}` }) });
    out.push({ kind: 'tool_result', ts: at, toolId: `${prefix}t${n}`, text: 'ok', isError: false });
  };
  for (let b = 0; b < blocks; b += 1) {
    const start = out.length;
    if (b % 3 === 0 && b > 0) { call('Bash'); call('Read'); }
    if (b % 3 === 1) {
      n += 1;
      out.push({ kind: 'user', uuid: `${prefix}m${n}`, ts: ts(), text: `/w/.cc-clips/lane-a-project-a/clip-${prefix}${n}.png\nThe picture ${n}.` });
    }
    if (b % 3 === 2) t += 20 * 60_000;
    while (out.length - start < PAGE - 4) {
      n += 1;
      out.push({ kind: n % 2 === 0 ? 'user' : 'assistant', uuid: `${prefix}m${n}`, ts: ts(), text: `Message ${prefix}${n}: ${'words '.repeat(6 + (n % 9) * 4)}` });
    }
    while (out.length - start < PAGE) call('Grep');
    out.length = start + PAGE; // a block is exactly a page
  }
  return out;
}

/** A routed session socket over `all`: the backlog is the newest PAGE events, and each request for `c-<k>` is answered
 *  with the PAGE events before event k. `hold()` parks the next answers until `release()`. */
interface Stream {
  readonly asked: { continuation: string; at: number }[];
  ws: WebSocketRoute | null;
  send(frame: object): void;
  hold(): void;
  release(): void;
  answered: number;
}
async function stream(ctx: BrowserContext, all: () => Ev[], o: { older?: boolean } = {}): Promise<Stream> {
  let held: (() => void)[] | null = null;
  const s: Stream = {
    asked: [], ws: null, answered: 0,
    send: (frame) => { s.ws?.send(JSON.stringify(frame)); },
    hold: () => { held ??= []; },
    release: () => { const due = held ?? []; held = null; for (const f of due) f(); },
  };
  await ctx.route('**/api/sessions/*/clip/**', async (route) => {
    await new Promise((r) => setTimeout(r, 150)); // the picture lands after its row is laid out
    await route.fulfill({ status: 200, contentType: 'image/png', body: PICTURE });
  });
  await ctx.routeWebSocket(/\/ws\/session\//, (ws) => {
    s.ws = ws;
    const events = all();
    const first = Math.max(0, events.length - PAGE);
    ws.send(JSON.stringify({
      type: 'backlog', uuid: 'u-1', events: events.slice(first), offset: 1, file: '/w/t.jsonl', missing: false,
      searchComplete: true, fileMeasured: true, ...(o.older === false || first === 0 ? {} : { older: `c-${first}` }),
    }));
    ws.onMessage((raw) => {
      if (typeof raw !== 'string') return;
      const m = JSON.parse(raw) as { type?: string; continuation?: string };
      if (m.type !== 'older-page' || typeof m.continuation !== 'string') return;
      const c = m.continuation;
      s.asked.push({ continuation: c, at: Date.now() });
      // Read from the file the stream serves when the request arrives: a held answer is that file's page.
      const k = Number(c.slice(2));
      const from = Math.max(0, k - PAGE);
      const evs = all().slice(from, k);
      const answer = (): void => {
        s.answered += 1;
        ws.send(JSON.stringify({
          type: 'older-page', events: evs, gap: false, for: c,
          ...(from === 0 ? { end: 'start' } : { end: 'more', continuation: `c-${from}` }),
        }));
      };
      if (held !== null) held.push(answer); else answer();
    });
  });
  return s;
}

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

// ---- reading the list -------------------------------------------------------------------------------------------------
/** The rows from the top of the view down, by key, and where each stands from the scroller's top. */
const rowsInView = (page: Page) => page.evaluate(() => {
  const s = document.querySelector<HTMLElement>('.chat-scroller')!;
  const top = s.getBoundingClientRect().top;
  return [...s.querySelectorAll<HTMLElement>('[data-row-key]')]
    .filter((r) => r.getBoundingClientRect().bottom > top && r.getBoundingClientRect().top < top + s.clientHeight)
    .map((r) => ({ key: r.dataset.rowKey!, top: r.getBoundingClientRect().top - top }));
});
const topOf = (page: Page, key: string) => page.evaluate((k) => {
  const s = document.querySelector<HTMLElement>('.chat-scroller')!;
  const r = s.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(k)}"]`);
  return r === null ? null : r.getBoundingClientRect().top - s.getBoundingClientRect().top;
}, key);
const scroller = (page: Page) => page.evaluate(() => {
  const s = document.querySelector<HTMLElement>('.chat-scroller')!;
  return { top: s.scrollTop, height: s.scrollHeight, client: s.clientHeight, pill: document.querySelector('.jump-latest') !== null };
});
/** Move the list as a reader does: a wheel first (ends the list's own settling), then the position. */
async function scrollList(page: Page, to: number | 'bottom'): Promise<void> {
  await page.evaluate((t) => {
    const s = document.querySelector<HTMLElement>('.chat-scroller')!;
    s.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: t === 'bottom' ? 100 : -100 }));
    s.scrollTop = t === 'bottom' ? s.scrollHeight : t;
  }, to);
  await page.waitForTimeout(400);
}
async function waitAsked(s: Stream, n: number): Promise<void> {
  const until = Date.now() + 10_000;
  while (s.asked.length < n && Date.now() < until) await new Promise((r) => setTimeout(r, 20));
  expect(s.asked.length, 'the page asked for no older page').toBeGreaterThanOrEqual(n);
}
async function open(view: AppView, all: () => Ev[], o: { older?: boolean } = {}) {
  const app = await openApp(browser!, view, FIXTURE);
  const s = await stream(app.ctx, all, o);
  await app.page.goto(`${server!.origin}/s/${SESSION.id}`);
  await app.page.waitForSelector('[data-row-key]', { timeout: 20_000 });
  await app.page.waitForTimeout(800);
  return { ...app, s };
}

/** A measurement line: printed, and appended to `CCRC_MEASURE_OUT` when that names a file (a runner can swallow the
 *  output of a passing case). */
function report(line: string): void {
  console.log(`[chat-history] ${line}`);
  const out = process.env['CCRC_MEASURE_OUT'];
  if (out !== undefined && out !== '') appendFileSync(out, `${line}\n`);
}

// ---- cases ----------------------------------------------------------------------------------------------------------
const measured = { shifts: [] as number[], paint: [] as number[] };

describe('repeated prepends keep the row the reader is looking at in place (desktop polish wave 175)', () => {
  for (const view of VIEWS) {
    it(named(view), async () => {
      const all = transcript(8);
      const { ctx, page, errors, s } = await open(view, () => all);
      try {
        for (let n = 1; n <= 4; n += 1) {
          s.hold();
          await scrollList(page, 40);
          await waitAsked(s, n);
          // What the reader sees as the page is about to land: the rows from the top of the view down.
          const before = await rowsInView(page);
          expect(before.length, 'no row in view').toBeGreaterThan(0);
          // The page's newest message row: the first of its rows to be drawn, nearest the rows held.
          const k = Number(s.asked[n - 1]!.continuation.slice(2));
          const landing = all.slice(Math.max(0, k - PAGE), k).filter((e) => e.kind === 'user' || e.kind === 'assistant').at(-1)!.uuid as string;
          const t0 = Date.now();
          s.release();
          await page.waitForSelector(`.chat-scroller [data-row-key="${landing}"]`, { state: 'attached', timeout: 10_000 }).catch(async (e: unknown) => {
            const drawn = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.chat-scroller [data-row-key]')].map((r) => r.dataset.rowKey).join(' '));
            throw new Error(`prepend ${n} (asked ${s.asked.map((a) => a.continuation).join(',')}, answered ${s.answered}): ${landing} never drawn; drawn: ${drawn}; ${String(e)}`);
          });
          measured.paint.push(Date.now() - t0);
          await page.waitForTimeout(700); // pictures load, rows measure, the hold settles
          // The row the reader was looking at: the first of them that is still a row (the join can replace one).
          let shift: number | null = null;
          for (const r of before) {
            const now = await topOf(page, r.key);
            if (now !== null) { shift = now - r.top; break; }
          }
          expect(shift, 'none of the rows in view is still drawn').not.toBeNull();
          measured.shifts.push(Math.abs(shift!));
          expect(Math.abs(shift!), `prepend ${n}: the row in view moved ${shift}px`).toBeLessThanOrEqual(1);
        }
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 120_000);
  }
});

describe('live rows arriving during a page load', () => {
  const later = (n: number): Ev[] => Array.from({ length: n }, (_, i) => ({
    kind: 'assistant', uuid: `live${i}`, ts: '2026-11-21T08:00:00.000Z', text: `Live ${i}: ${'more words '.repeat(10)}`,
  }));

  for (const view of VIEWS.filter((v) => v.theme === PHOSPHOR)) {
    it(`${named(view)}: a reader at the foot stays at the foot`, async () => {
      const all = transcript(6);
      const { ctx, page, s } = await open(view, () => all);
      try {
        s.hold();
        await scrollList(page, 40);
        await waitAsked(s, 1);
        await scrollList(page, 'bottom');
        s.send({ type: 'events', uuid: 'u-1', events: later(3), offset: 2 });
        await page.waitForTimeout(300);
        s.release();
        await page.waitForTimeout(900);
        const at = await scroller(page);
        expect(at.height - at.top - at.client, 'the reader at the foot was moved off it').toBeLessThanOrEqual(2);
        expect(at.pill, 'Jump to latest shows for a reader at the foot').toBe(false);
      } finally {
        await ctx.close();
      }
    }, 90_000);

    it(`${named(view)}: a reader scrolled up keeps their row`, async () => {
      const all = transcript(6);
      const { ctx, page, s } = await open(view, () => all);
      try {
        s.hold();
        await scrollList(page, 40);
        await waitAsked(s, 1);
        const before = await rowsInView(page);
        s.send({ type: 'events', uuid: 'u-1', events: later(3), offset: 2 });
        await page.waitForTimeout(300);
        s.release();
        await page.waitForTimeout(900);
        let shift: number | null = null;
        for (const r of before) {
          const now = await topOf(page, r.key);
          if (now !== null) { shift = now - r.top; break; }
        }
        expect(Math.abs(shift ?? 99), 'the row in view moved').toBeLessThanOrEqual(1);
      } finally {
        await ctx.close();
      }
    }, 90_000);
  }
});

describe('a rotation with a request in flight', () => {
  it('voids it: the new file\'s rows only, and the late answer never applied', async () => {
    const first = transcript(4);
    const other = transcript(3, 'r');
    let serving = first;
    const { ctx, page, s } = await open(VIEWS[0]!, () => serving);
    try {
      s.hold();
      await scrollList(page, 40);
      await waitAsked(s, 1);
      serving = other;
      s.send({ type: 'rotated', uuid: 'u-2' });
      s.send({
        type: 'backlog', uuid: 'u-2', events: other.slice(-PAGE), offset: 1, file: '/w/r.jsonl', missing: false,
        searchComplete: true, fileMeasured: true, older: `c-${other.length - PAGE}`,
      });
      await page.waitForTimeout(400);
      s.release(); // the old file's page, answered after the rotation, naming the old continuation
      await page.waitForTimeout(600);
      expect(s.answered, 'the held answer was never sent').toBeGreaterThanOrEqual(1);
      const keys = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.chat-scroller [data-row-key]')].map((r) => r.dataset.rowKey!));
      expect(keys.some((k) => /^e[mut]/.test(k) || /activity-e/.test(k)), 'a row of the old file is shown').toBe(false);
    } finally {
      await ctx.close();
    }
  }, 60_000);
});

describe('paging a long transcript to its start', () => {
  for (const view of [VIEWS[0]!, VIEWS[2]!]) {
    it(`${named(view)}: every row once, in order, and the start said`, async () => {
      const all = transcript(40); // 1,200 events, 40 pages
      const { ctx, page, s } = await open(view, () => all);
      try {
        const t0 = Date.now();
        for (let guard = 0; guard < 120; guard += 1) {
          const said = await page.locator('.older-edge[data-older="start"]').count();
          if (said > 0) break;
          await scrollList(page, 0);
        }
        await expect.poll(() => page.locator('.older-edge[data-older="start"]').count(), { timeout: 10_000 }).toBe(1);
        const pages = s.answered;
        report(`${named(view)}: ${pages} pages to the start of ${all.length} events in ${Date.now() - t0} ms`);
        expect(pages).toBe(Math.ceil((all.length - PAGE) / PAGE));
        expect(await page.locator('.older-edge-say').textContent()).toBe(OLDER_WORDS.start.say);
        // Walk the list top to bottom and collect each message row's key, in the order first seen.
        const seen: string[] = [];
        const total = (await scroller(page)).height;
        for (let y = 0; y <= total; y += 300) {
          await page.evaluate((to) => { document.querySelector<HTMLElement>('.chat-scroller')!.scrollTop = to; }, y);
          await page.waitForTimeout(60);
          for (const r of await rowsInView(page)) if (/^em\d+$/.test(r.key) && !seen.includes(r.key)) seen.push(r.key);
        }
        const expected = all.filter((e) => e.kind === 'user' || e.kind === 'assistant').map((e) => e.uuid as string);
        expect(seen, 'the message rows, top to bottom').toEqual(expected);
      } finally {
        await ctx.close();
      }
    }, 240_000);
  }
});

describe('the control by keyboard alone', () => {
  it('Tab reaches Load older, Enter loads, focus stays on it, and the start takes it at the end', async () => {
    const all = transcript(2); // a short list: no scrolling, the control is how older messages come
    const { ctx, page, s } = await open(VIEWS[1]!, () => all);
    try {
      let reached = false;
      for (let i = 0; i < 80 && !reached; i += 1) {
        await page.keyboard.press('Tab');
        reached = await page.evaluate(() => document.activeElement?.classList.contains('older-edge-load') === true);
      }
      expect(reached, 'Tab never reached Load older').toBe(true);
      await page.keyboard.press('Enter');
      await waitAsked(s, 1);
      await page.waitForTimeout(600);
      const focus = await page.evaluate(() => ({
        cls: document.activeElement?.className ?? '', text: document.activeElement?.textContent ?? '',
        visible: (() => { const r = document.activeElement?.getBoundingClientRect(); return r !== undefined && r.height > 0; })(),
      }));
      expect(focus.text, 'focus went to the page when the control ended').toBe(OLDER_WORDS.start.say);
      expect(focus.cls).toContain('older-edge-say');
    } finally {
      await ctx.close();
    }
  }, 60_000);
});

describe('an older server', () => {
  it('no continuation: no control, and no request however far the reader scrolls up', async () => {
    const all = transcript(4);
    const { ctx, page, s } = await open(VIEWS[0]!, () => all, { older: false });
    try {
      await scrollList(page, 0);
      await page.waitForTimeout(400);
      expect(await page.locator('.older-edge').count()).toBe(0);
      expect(s.asked).toEqual([]);
    } finally {
      await ctx.close();
    }
  }, 60_000);
});

// ---- movement the reader's input events cannot see (fix round 1, F1 and A7) -------------------------------------------
/** Move the scroller by `dy` px over `frames` frames, one step a frame, starting in the first frame the list grows (an
 *  older page drawn), so the reader moves inside the settle whatever the timing (fix round 2, A1). With `wheel`, after a
 *  wheel, an input event the list reads (A7); without, with no input event: a fling's momentum after the finger lifted,
 *  or a scrollbar thumb dragged (its pointer moves are not listened to). Resolves with the row at the top of the view and
 *  where it stood, a frame after the last step. */
const glideOnGrow = (page: Page, dy: number, frames: number, wheel = true) => page.evaluate(([d, f, w]) => new Promise<{ key: string; top: number } | null>((done) => {
  const s = document.querySelector<HTMLElement>('.chat-scroller')!;
  const from = s.scrollHeight;
  let n = -1;
  const step = (): void => {
    if (n < 0) {
      if (s.scrollHeight === from) { requestAnimationFrame(step); return; }
      if (w) s.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: Math.sign(d) * 100 }));
      n = 0;
    }
    if (n < f) { s.scrollTop += d / f; n += 1; requestAnimationFrame(step); return; }
    requestAnimationFrame(() => {
      const top = s.getBoundingClientRect().top;
      const row = [...s.querySelectorAll<HTMLElement>('[data-row-key]')].find((r) => r.getBoundingClientRect().bottom > top + 1);
      done(row === undefined ? null : { key: row.dataset.rowKey!, top: row.getBoundingClientRect().top - top });
    });
  };
  requestAnimationFrame(step);
}), [dy, frames, wheel] as const);
const reader = (page: Page, type: string) => page.evaluate((t) => {
  document.querySelector<HTMLElement>('.chat-scroller')!.dispatchEvent(new Event(t, { bubbles: true }));
}, type);

describe('a settle never sets back movement made after the page landed (fix round 1, F1 and A7)', () => {
  const PHONE = VIEWS.find((v) => v.width === 390 && v.theme === PHOSPHOR)!;
  const DESK = VIEWS.find((v) => v.width === 1280 && v.theme === PHOSPHOR)!;

  it(`${named(PHONE)}: a fling whose finger came down before the page landed keeps going where it went`, async () => {
    const all = transcript(6);
    const { ctx, page, errors, s } = await open(PHONE, () => all);
    try {
      s.hold();
      await scrollList(page, 40);
      await waitAsked(s, 1);
      await reader(page, 'touchstart'); // the finger, before the page
      // The fling's momentum, no input event, from the frame the page's rows are drawn: inside the settle (fix round 2, A1).
      const moving = glideOnGrow(page, 360, 14, false);
      s.release();
      const end = await moving;
      expect(end).not.toBeNull();
      await page.waitForTimeout(900);
      const now = await topOf(page, end!.key);
      report(`F1 fling, ${named(PHONE)}: the row at the fling's end moved ${now === null ? 'out of reach' : (now - end!.top).toFixed(1)} px after it`);
      expect(now, 'the row the fling ended on is no longer drawn').not.toBeNull();
      expect(Math.abs(now! - end!.top), 'the settle set the fling back').toBeLessThanOrEqual(4);
      expect(errors).toEqual([]);
    } finally {
      await ctx.close();
    }
  }, 60_000);

  it(`${named(DESK)}: a scrollbar thumb pressed before the page landed, dragged, then held still, stays put`, async () => {
    const all = transcript(6);
    const { ctx, page, errors, s } = await open(DESK, () => all);
    try {
      s.hold();
      await scrollList(page, 40);
      await waitAsked(s, 1);
      await reader(page, 'pointerdown'); // the button, before the page; its moves are not listened to
      const moving = glideOnGrow(page, 300, 10, false); // dragged from the frame the page's rows are drawn (fix round 2, A1)
      s.release();
      const end = await moving;
      expect(end).not.toBeNull();
      await page.waitForTimeout(900); // the button still held, the thumb still
      const now = await topOf(page, end!.key);
      report(`F1 drag, ${named(DESK)}: the row at the drag's end moved ${now === null ? 'out of reach' : (now - end!.top).toFixed(1)} px after it`);
      expect(now, 'the row the drag ended on is no longer drawn').not.toBeNull();
      expect(Math.abs(now! - end!.top), 'the content jumped under the thumb').toBeLessThanOrEqual(4);
      expect(errors).toEqual([]);
    } finally {
      await ctx.close();
    }
  }, 60_000);

  it(`${named(DESK)}: Jump to latest pressed while a page is out lands at the foot and stays`, async () => {
    const all = transcript(6);
    const { ctx, page, errors, s } = await open(DESK, () => all);
    try {
      s.hold();
      await scrollList(page, 40);
      await waitAsked(s, 1);
      await page.locator('.jump-latest').click();
      await page.waitForTimeout(40); // the smooth scroll under way
      s.release();
      await page.waitForTimeout(1500);
      const at = await scroller(page);
      report(`F1 jump, ${named(DESK)}: ${(at.height - at.top - at.client).toFixed(1)} px from the foot after the page settled`);
      expect(at.height - at.top - at.client, 'the settle pulled the view back from the foot').toBeLessThanOrEqual(4);
      expect(at.pill, 'Jump to latest still shows').toBe(false);
      expect(errors).toEqual([]);
    } finally {
      await ctx.close();
    }
  }, 60_000);

  it(`${named(PHONE)}: a reader at the foot when the page came, who then moves up, is not thrown back to the end (A7)`, async () => {
    const all = transcript(6);
    const { ctx, page, errors, s } = await open(PHONE, () => all);
    try {
      s.hold();
      await scrollList(page, 40);
      await waitAsked(s, 1);
      await scrollList(page, 'bottom');
      expect((await scroller(page)).pill, 'not back at the foot before the page').toBe(false);
      // At the foot the page's rows are out of reach, so the list growing says the page came: in that frame the reader
      // wheels up, inside the settle.
      const moving = glideOnGrow(page, -300, 10);
      s.release();
      const end = await moving;
      expect(end).not.toBeNull();
      await page.waitForTimeout(900);
      const at = await scroller(page);
      const now = await topOf(page, end!.key);
      report(`A7, ${named(PHONE)}: ${(at.height - at.top - at.client).toFixed(1)} px from the foot; the row moved ${now === null ? 'out of reach' : (now - end!.top).toFixed(1)} px`);
      expect(at.height - at.top - at.client, 'the reader was thrown back to the end').toBeGreaterThan(100);
      expect(now, 'the row the reader moved to is no longer drawn').not.toBeNull();
      expect(Math.abs(now! - end!.top), 'the reader was moved from where they went').toBeLessThanOrEqual(4);
      expect(errors).toEqual([]);
    } finally {
      await ctx.close();
    }
  }, 60_000);
});

// ---- a page of calls only, joining the top stretch (fix round 1, F2) ------------------------------------------------------
/** 40 older calls (pages of calls only), then the backlog: 12 calls opening it, then six long messages. With `failAt`, that
 *  older call fails, so a closed stretch that takes it gains a failure card. */
function callsAtTop(failAt?: number): Ev[] {
  const out: Ev[] = [];
  let t = Date.parse('2026-11-20T08:00:00.000Z');
  const ts = (): string => { t += 10_000; return new Date(t).toISOString(); };
  for (let n = 1; n <= 52; n += 1) {
    const at = ts();
    out.push({ kind: 'tool_use', uuid: `ju${n}`, ts: at, toolId: `jt${n}`, name: 'Bash', input: JSON.stringify({ command: `step ${n}` }) });
    out.push({ kind: 'tool_result', ts: at, toolId: `jt${n}`, text: n === failAt ? 'exit 1: no such file' : 'ok', isError: n === failAt });
  }
  for (let n = 1; n <= 6; n += 1) {
    out.push({ kind: n % 2 === 0 ? 'user' : 'assistant', uuid: `jm${n}`, ts: ts(), text: `Message ${n}: ${'words '.repeat(70)}` });
  }
  return out;
}
const topStretch = (page: Page) => page.evaluate(() => {
  const row = document.querySelector<HTMLElement>('.chat-scroller [data-row-key^="activity-"]');
  return row === null ? null : {
    key: row.dataset.rowKey!, open: row.querySelector('[aria-expanded]')?.getAttribute('aria-expanded') === 'true',
    card: row.querySelector('.tool-activity-first') !== null,
  };
});

describe('a page of calls only, joining the top stretch, holds the reader (fix round 1, F2)', () => {
  const PHONE = VIEWS.find((v) => v.width === 390 && v.theme === PHOSPHOR && v.skin === REFINED)!;

  it(`${named(PHONE)}: an open top stretch stays open, and what is read below it does not move`, async () => {
    const all = callsAtTop();
    const { ctx, page, errors, s } = await open(PHONE, () => all);
    try {
      s.hold();
      await scrollList(page, 0);
      const was = await topStretch(page);
      expect(was, 'no stretch at the top').not.toBeNull();
      await page.locator(`[data-row-key="${was!.key}"] [aria-expanded]`).click();
      await page.waitForTimeout(500);
      await scrollList(page, 120); // reading the open stretch and the turn under it, near the top
      await waitAsked(s, 1);
      // The open stretch draws its calls as one run ("Ran 12 commands"), so what is read is the stretch's foot and the
      // message under it.
      expect((await topStretch(page))!.open, 'the stretch did not open').toBe(true);
      const before = await topOf(page, 'jm1');
      expect(before, 'the message under the stretch is not drawn').not.toBeNull();
      s.release();
      await expect.poll(() => s.answered, { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
      await page.waitForTimeout(900);
      const now = await topStretch(page);
      const after = await topOf(page, 'jm1');
      report(`F2 open, ${named(PHONE)}: key ${was!.key} -> ${now?.key}, open ${String(now?.open)}, the message under it moved ${after === null ? 'out of reach' : (after - before!).toFixed(1)} px`);
      expect(now!.key, 'the page did not join the stretch').not.toBe(was!.key);
      expect(now!.open, 'the open stretch closed across the join').toBe(true);
      expect(after, 'the message under the stretch is no longer drawn').not.toBeNull();
      expect(Math.abs(after! - before!), 'what was read moved').toBeLessThanOrEqual(1);
      expect(errors).toEqual([]);
    } finally {
      await ctx.close();
    }
  }, 60_000);

  it(`${named(PHONE)}: a closed top stretch that gains a failure card grows above the reader without moving them`, async () => {
    const all = callsAtTop(30);
    const { ctx, page, errors, s } = await open(PHONE, () => all);
    try {
      s.hold();
      await scrollList(page, 120);
      await waitAsked(s, 1);
      const was = await topStretch(page);
      expect(was).toMatchObject({ open: false, card: false });
      const before = await topOf(page, 'jm1');
      expect(before, 'the message read is not drawn').not.toBeNull();
      s.release();
      await expect.poll(() => s.answered, { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
      await page.waitForTimeout(900);
      const now = await topStretch(page);
      const after = await topOf(page, 'jm1');
      report(`F2 closed, ${named(PHONE)}: key ${was!.key} -> ${now?.key}, card ${String(now?.card)}, the message read moved ${after === null ? 'out of reach' : (after - before!).toFixed(1)} px`);
      expect(now!.key, 'the page did not join the stretch').not.toBe(was!.key);
      expect(now!.card, 'the failure did not surface: the case did not happen').toBe(true);
      expect(now!.open).toBe(false);
      expect(after).not.toBeNull();
      expect(Math.abs(after! - before!), 'the message being read moved').toBeLessThanOrEqual(1);
      expect(errors).toEqual([]);
    } finally {
      await ctx.close();
    }
  }, 60_000);
});

// ---- paging after a context reset (fix round 2, F1) ---------------------------------------------------------------------
/** The rows in view that a page can move: every row but the reset's own (a local row and its time divider). */
const transcriptRowsInView = async (page: Page) =>
  (await rowsInView(page)).filter((r) => !r.key.startsWith('local-') && !r.key.startsWith('div-local-'));

/** How far the first of `before` that can be found moved: read where it is drawn, or, when it is out of the rows drawn,
 *  found by moving the list down half a view at a time (a measurement only: the case ends on a wrong answer). */
async function movedBy(page: Page, before: { key: string; top: number }[]): Promise<number | null> {
  for (const r of before) {
    const now = await topOf(page, r.key);
    if (now !== null) return now - r.top;
  }
  return page.evaluate(async (rows) => {
    const s = document.querySelector<HTMLElement>('.chat-scroller')!;
    const from = s.scrollTop;
    for (let i = 0; i < 400; i += 1) {
      for (const r of rows) {
        const row = s.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(r.key)}"]`);
        if (row !== null) return s.scrollTop - from + row.getBoundingClientRect().top - s.getBoundingClientRect().top - r.top;
      }
      if (s.scrollTop + s.clientHeight >= s.scrollHeight - 1) return null;
      s.scrollTop += s.clientHeight / 2;
      await new Promise((d) => requestAnimationFrame(() => requestAnimationFrame(d)));
    }
    return null;
  }, before);
}

describe('a page after a context reset holds the reader like any other (fix round 2, F1)', () => {
  for (const view of [VIEWS.find((v) => v.width === 390)!, VIEWS.find((v) => v.width === 1280)!]) {
    it(`${named(view)}: each page, put below the "Session context reset" row, keeps the row the reader is on`, async () => {
      const first = transcript(3);
      const other = transcript(8, 'r');
      let serving = first;
      const { ctx, page, errors, s } = await open(view, () => serving);
      try {
        serving = other;
        s.send({ type: 'rotated', uuid: 'u-2' });
        s.send({
          type: 'backlog', uuid: 'u-2', events: other.slice(-PAGE), offset: 1, file: '/w/r.jsonl', missing: false,
          searchComplete: true, fileMeasured: true, older: `c-${other.length - PAGE}`,
        });
        await page.waitForSelector('.chat-scroller [data-row-key^="rm"]', { state: 'attached', timeout: 10_000 });
        await page.waitForTimeout(800);
        for (let n = 1; n <= 3; n += 1) {
          s.hold();
          await scrollList(page, 40);
          await waitAsked(s, n);
          const before = await transcriptRowsInView(page);
          expect(before.length, 'no transcript row in view').toBeGreaterThan(0);
          s.release();
          const until = Date.now() + 10_000;
          while (s.answered < n && Date.now() < until) await page.waitForTimeout(20);
          await page.waitForTimeout(900);
          const shift = await movedBy(page, before);
          report(`F1 rotation, ${named(view)}, page ${n}: the row in view moved ${shift === null ? 'out of reach' : `${shift.toFixed(1)} px`}, ${s.asked.length} pages asked`);
          expect(shift, `page ${n}: none of the rows in view could be found again`).not.toBeNull();
          expect(Math.abs(shift!), `page ${n}: the row in view moved ${shift}px`).toBeLessThanOrEqual(1);
        }
        const keys = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.chat-scroller [data-row-key]')].map((r) => r.dataset.rowKey!));
        expect(keys.some((k) => /^e[mut]/.test(k) || /activity-e/.test(k)), 'a row of the old file is shown').toBe(false);
        expect(s.asked.length, 'pages chained past the reader').toBe(3);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 120_000);
  }
});

describe('measurements (printed)', () => {
  it('the anchored row\'s shift per prepend and the time from the request to painted rows', () => {
    const max = Math.max(...measured.shifts);
    const sorted = [...measured.paint].sort((a, b) => a - b);
    report(`shift per prepend over ${measured.shifts.length} prepends: max ${max.toFixed(2)} px, `
      + `mean ${(measured.shifts.reduce((a, b) => a + b, 0) / Math.max(1, measured.shifts.length)).toFixed(2)} px`);
    report(`request answered to rows painted: median ${sorted[Math.floor(sorted.length / 2)]} ms, max ${sorted.at(-1)} ms`);
    expect(measured.shifts.length).toBe(VIEWS.length * 4);
  });

  for (const rows of [5_000, 20_000]) {
    it(`the store and the list at ${rows.toLocaleString('en')} rows`, async () => {
      const blocks = Math.ceil(rows / PAGE);
      const all = transcript(blocks);
      const app = await openApp(browser!, VIEWS[1]!, FIXTURE);
      try {
        const cdp = await app.ctx.newCDPSession(app.page);
        await cdp.send('Performance.enable');
        const heap = async (): Promise<number> => {
          await cdp.send('HeapProfiler.collectGarbage');
          const m = await cdp.send('Performance.getMetrics');
          return m.metrics.find((x) => x.name === 'JSHeapUsedSize')!.value;
        };
        let ws: WebSocketRoute | null = null;
        await app.ctx.routeWebSocket(/\/ws\/session\//, (w) => {
          ws = w;
          w.send(JSON.stringify({ type: 'backlog', uuid: 'u-1', events: all.slice(-PAGE), offset: 1, file: '/w/t.jsonl', missing: false, searchComplete: true, fileMeasured: true }));
        });
        await app.page.goto(`${server!.origin}/s/${SESSION.id}`);
        await app.page.waitForSelector('[data-row-key]', { timeout: 20_000 });
        await app.page.waitForTimeout(800);
        const socket = (): WebSocketRoute => ws as WebSocketRoute | null as WebSocketRoute;
        /** One live append, and the milliseconds until its row is drawn (the merge reads every row held). */
        const append = async (uuid: string): Promise<number> => {
          const t = Date.now();
          socket().send(JSON.stringify({ type: 'events', uuid: 'u-1', events: [{ kind: 'assistant', uuid, ts: '2026-12-01T00:00:00.000Z', text: 'A live row.' }], offset: 3 }));
          await app.page.waitForSelector(`[data-row-key="${uuid}"]`, { timeout: 20_000 });
          return Date.now() - t;
        };
        const appendSmall = await append('tail-small');
        const small = await heap();
        // The same rows as pages would leave them: the whole transcript held, sent as one backlog.
        const newest = all.filter((e) => e.kind === 'assistant' || e.kind === 'user').at(-1)!.uuid as string;
        const t0 = Date.now();
        socket().send(JSON.stringify({ type: 'backlog', uuid: 'u-1', events: all, offset: 2, file: '/w/t.jsonl', missing: false, searchComplete: true, fileMeasured: true }));
        await app.page.waitForSelector(`[data-row-key="${newest}"]`, { timeout: 30_000 });
        const applyMs = Date.now() - t0;
        await app.page.waitForTimeout(1500);
        const big = await heap();
        const appendMs = await append('tail');
        report(`${all.length} events held: heap +${((big - small) / 1048576).toFixed(1)} MiB over the ${PAGE}-event view, `
          + `${applyMs} ms from the frame to its newest row drawn, one live append drawn in ${appendMs} ms (${appendSmall} ms over ${PAGE})`);
        // NO CAP (the task note's rule): at 20,000 rows the store and the list hold a few MiB, so nothing is released.
        // Pinned with room: a cost this far past the measurement means the rule must be measured again.
        expect((big - small) / 1048576, 'the held rows cost far more heap than measured').toBeLessThan(rows / 1000 * 4);
        expect(app.errors).toEqual([]);
      } finally {
        await app.ctx.close();
      }
    }, 180_000);
  }
});
