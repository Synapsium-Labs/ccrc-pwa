// A long paste goes to the session as a saved file (desktop-polish wave 194), in a real Chrome over the production
// build, at 390 and 1440 px, in both skins and both palettes. The composer flow: a long text pasted with the keyboard is
// one chip; Send saves it through the upload route (one request, its file part carrying the text byte for byte, under
// the neutral name) and holds Send while it does; then ONE prompt request whose text is the pointer line naming the
// answered path, and the pending bubble draws that pointer as a chip in its place. A failed save sends nothing and
// shows its notice, whose words and controls read at 4.5:1 on the ground drawn behind them; Retry then sends. The chat:
// a user turn holding a pointer draws the chip in its place between the text around it, at 4.5:1, inside the bubble;
// opening it opens this session's clip in a new tab. At 390 px the page never scrolls sideways.
//
// The upload, prompt and clip routes are simulated, so this pins the browser boundary only.
//
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/long-paste-attach.browser.test.ts )`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { pastePointer } from '../../shared/pastePointer';
import { PASTED_CHIP_LINES } from '../src/session/pastedTurn';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type AppView, type DistServer } from './app';

const NOW = 1_792_362_479;
const SID = 'project-a-one';
const SESSION = {
  id: SID, wrapper: 'lane-a', home: 'lane-a', project: 'project-a', workdir: '/w/project-a/one',
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

/** 214 lines with a quote, a pipe and an emoji: the pasted text. */
const LONG = Array.from({ length: 214 }, (_, i) => `row ${String(i + 1)} "q" | p 😀`).join('\n');
const CLIP_NAME = 'clip-20261127-153012-1a2b3c4d-paste.txt';
const CLIP_PATH = `/home/user-a/.cc-clips/${SID}/${CLIP_NAME}`;
const POINTER = pastePointer(CLIP_PATH, 214);

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

const VIEWS: AppView[] = [];
for (const width of [390, 1440]) {
  for (const skin of [REFINED, INSTRUMENT]) for (const theme of [PHOSPHOR, 'light']) VIEWS.push({ skin, theme, width });
}
const named = (v: AppView): string => `${v.skin}, ${v.theme}, ${String(v.width)}px`;

/** The contrast of `el`'s text on the ground actually drawn behind it (every background up to the page composited).
 *  Runs in the page; the same measure the paste-chip leg uses. */
const contrastOf = (el: Element): number => {
  const parse = (s: string): number[] => {
    const v = (s.match(/[\d.]+/g) ?? []).map(Number);
    const rgb = s.startsWith('color(') ? v.slice(0, 3).map((n) => n * 255) : v.slice(0, 3);
    return [...rgb, v.length > 3 ? v[3]! : 1];
  };
  const layers: number[][] = [];
  for (let n: Element | null = el; n !== null; n = n.parentElement) layers.push(parse(getComputedStyle(n).backgroundColor));
  let ground = [255, 255, 255];
  for (const [r, g, b, a] of layers.reverse()) ground = [r!, g!, b!].map((c, i) => c * a! + ground[i]! * (1 - a!));
  const [r, g, b, a] = parse(getComputedStyle(el).color);
  const ink = [r!, g!, b!].map((c, i) => c * a! + ground[i]! * (1 - a!));
  const lum = (c: number[]): number => {
    const ch = (v: number): number => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * ch(c[0]!) + 0.7152 * ch(c[1]!) + 0.0722 * ch(c[2]!);
  };
  const [hi, lo] = [lum(ink), lum(ground)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

const noSidewaysScroll = (page: Page): Promise<boolean> =>
  page.evaluate(() => document.scrollingElement!.scrollWidth <= document.scrollingElement!.clientWidth);

/** The session screen with the upload and prompt routes recorded; `failFirst` refuses the first upload with 502, and
 *  `holdMs` is how long each upload takes. With `before`, run it before the paste (to stage a document first). */
const openComposer = async (view: AppView, failFirst = false, holdMs = 600, before?: (page: Page) => Promise<void>) => {
  const opened = await openApp(browser!, view, FIXTURE);
  await opened.ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: server!.origin });
  const uploads: Buffer[] = [];
  const prompts: unknown[] = [];
  await opened.page.route('**/api/sessions/*/upload', async (route) => {
    uploads.push(route.request().postDataBuffer() ?? Buffer.alloc(0));
    await new Promise((r) => setTimeout(r, holdMs)); // long enough to see Send held
    if (failFirst && uploads.length === 1) {
      await route.fulfill({ status: 502, contentType: 'application/json', body: '{"ok":false,"error":"agent-down"}' });
      return;
    }
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, clip: { path: CLIP_PATH, name: CLIP_NAME, bytes: 1 } }),
    });
  });
  await opened.page.route('**/api/sessions/*/prompt', async (route) => {
    prompts.push(JSON.parse(route.request().postData() ?? 'null'));
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });
  // An empty transcript, so the chat is drawn and the pending bubble has a list to stand in.
  await opened.ctx.routeWebSocket(/\/ws\/session\//, (ws) => {
    ws.send(JSON.stringify({
      type: 'backlog', uuid: 'u-1', events: [], offset: 1, file: '/w/t.jsonl', missing: false,
      searchComplete: true, fileMeasured: true,
    }));
  });
  await opened.page.goto(`${server!.origin}/s/${SID}`);
  const field = opened.page.getByRole('textbox', { name: 'Message' });
  await field.waitFor({ timeout: 20_000 });
  await before?.(opened.page);
  await opened.page.evaluate((text) => navigator.clipboard.writeText(text), LONG);
  await field.focus();
  await opened.page.keyboard.press('Control+V');
  await expect.poll(() => opened.page.locator('.paste-chip').count()).toBe(1);
  return { ...opened, field, uploads, prompts };
};

describe('the composer saves a long paste and sends its pointer', () => {
  for (const view of VIEWS) {
    it(named(view), async () => {
      const s = await openComposer(view);
      try {
        const send = s.page.getByRole('button', { name: 'Send' });
        await send.click();
        // Held, visibly, while the save runs.
        await expect.poll(() => send.isDisabled()).toBe(true);
        expect(await send.getAttribute('aria-busy')).toBe('true');
        await s.page.getByText('Saving pasted text…').waitFor({ timeout: 5_000 });
        await expect.poll(() => s.prompts.length, { timeout: 10_000 }).toBe(1);
        await s.page.waitForTimeout(400);
        expect(s.uploads).toHaveLength(1);
        expect(s.uploads[0]!.includes(Buffer.from(LONG, 'utf8'))).toBe(true);
        expect(s.uploads[0]!.includes(Buffer.from('filename="paste.txt"'))).toBe(true);
        expect(s.prompts).toEqual([{ text: POINTER }]);
        expect(await s.field.inputValue()).toBe('');
        // The pending bubble draws the pointer as the chip, before any echo.
        const chip = s.page.locator('.msg-user a.msg-paste');
        await chip.waitFor({ timeout: 5_000 });
        expect(await chip.textContent()).toBe('≡Pasted text · 214 lines');
        expect(await chip.evaluate(contrastOf)).toBeGreaterThanOrEqual(4.5);
        expect(await noSidewaysScroll(s.page)).toBe(true);
        expect(s.errors).toEqual([]);
      } finally {
        await s.ctx.close();
      }
    });
  }
});

describe('a failed save sends nothing, says why at 4.5:1, and Retry sends', () => {
  for (const view of VIEWS) {
    it(named(view), async () => {
      const s = await openComposer(view, true);
      try {
        await s.page.getByRole('button', { name: 'Send' }).click();
        const notice = s.page.locator('.paste-failed');
        await notice.waitFor({ timeout: 10_000 });
        expect(s.prompts).toEqual([]);
        const retry = s.page.getByRole('button', { name: 'Retry saving pasted text #1' });
        const typed = s.page.getByRole('button', { name: 'Send the message with every pasted text typed in full instead' });
        for (const [what, el] of [['words', notice.locator('.paste-notice-text')], ['retry', retry], ['typed', typed]] as const) {
          expect(await el.evaluate(contrastOf), what).toBeGreaterThanOrEqual(4.5);
        }
        if (view.width < 900) {
          for (const b of [retry, typed]) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        }
        expect(await noSidewaysScroll(s.page)).toBe(true);
        await retry.click();
        await expect.poll(() => s.prompts.length, { timeout: 10_000 }).toBe(1);
        expect(s.uploads).toHaveLength(2);
        expect(s.prompts).toEqual([{ text: POINTER }]);
        expect(s.errors).toEqual([]);
      } finally {
        await s.ctx.close();
      }
    });
  }
});

describe('while a send saves, the tray is held and a dropped file is cancelled; the draft stays (review 4119 F1, F7)', () => {
  for (const view of VIEWS) {
    it(named(view), async () => {
      const stage = async (page: Page): Promise<void> => {
        await page.locator('input.attach-input').setInputFiles({ name: 'notes.md', mimeType: 'text/markdown', buffer: Buffer.from('x') });
        await page.getByRole('button', { name: 'Remove notes.md' }).waitFor({ timeout: 10_000 });
        await expect.poll(() => page.getByRole('button', { name: 'Send' }).isEnabled(), { timeout: 10_000 }).toBe(true);
      };
      const s = await openComposer(view, false, 3_000, stage);
      try {
        const url = s.page.url();
        const remove = s.page.getByRole('button', { name: 'Remove notes.md' });
        expect(await remove.isEnabled()).toBe(true);
        await s.page.getByRole('button', { name: 'Send' }).click();
        await s.page.getByText('Saving pasted text…').waitFor({ timeout: 5_000 });
        // Held, and read so: a real click at its place does nothing.
        expect(await remove.isDisabled()).toBe(true);
        await remove.click({ force: true, timeout: 2_000 });
        expect(await remove.count()).toBe(1);
        // A file dropped meanwhile: the drag-over and the drop are both cancelled, which is what keeps Chrome from opening
        // the file in place of the page (a dispatched drop never runs that default itself, so the cancel is the pin).
        const cancelled = await s.page.locator('.composer').evaluate((el) => {
          const dt = new DataTransfer();
          dt.items.add(new File(['y'], 'late.md', { type: 'text/markdown' }));
          const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt });
          const drop = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt });
          el.dispatchEvent(over);
          el.dispatchEvent(drop);
          return [over.defaultPrevented, drop.defaultPrevented, el.getAttribute('data-drop')];
        });
        expect(cancelled).toEqual([true, true, null]);
        expect(s.page.url()).toBe(url);
        expect(await s.page.locator('.paste-chip').count()).toBe(1);
        expect(await s.page.locator('.attach-chip').count()).toBe(1);
        // The send that goes is the tap's: the attachment in front, then the pointer.
        await expect.poll(() => s.prompts.length, { timeout: 15_000 }).toBe(1);
        expect(s.prompts).toEqual([{ text: POINTER, attachments: [CLIP_PATH] }]);
        expect(s.errors).toEqual([]);
      } finally {
        await s.ctx.close();
      }
    });
  }
});

describe('the list prices a chip as it is drawn, and the turn holds still when its row renders (review 4119 F6)', () => {
  for (const view of VIEWS) {
    it(named(view), async () => {
      const opened = await openApp(browser!, view, FIXTURE);
      const { ctx, page, errors } = opened;
      try {
        const turn = (uuid: string, text: string): object => ({ kind: 'user', uuid, ts: '2026-11-27T10:00:00.000Z', text });
        await ctx.routeWebSocket(/\/ws\/session\//, (ws) => {
          ws.send(JSON.stringify({
            type: 'backlog', uuid: 'u-1', offset: 1, file: '/w/t.jsonl', missing: false, searchComplete: true, fileMeasured: true,
            events: [
              turn('e2', 'look at this\nand fix it'),
              turn('e3', 'look at this\nx\nand fix it'),
              turn('e1', `look at this\n${POINTER}\nand fix it`),
            ],
          }));
        });
        await page.goto(`${server!.origin}/s/${SID}`);
        const chip = page.locator('.msg-user a.msg-paste');
        await chip.waitFor({ timeout: 20_000 });
        const top0 = (await chip.boundingBox())!.y;
        await page.waitForTimeout(600);
        // Held still once drawn: the row did not move under the reader as the list measured it.
        expect(Math.abs((await chip.boundingBox())!.y - top0)).toBeLessThanOrEqual(1);
        const heights = await page.locator('.msg-user').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
        expect(heights).toHaveLength(3);
        const [two, three, withChip] = heights as [number, number, number];
        const line = three - two;
        const drawn = withChip - two;
        const priced = PASTED_CHIP_LINES * line;
        // Within half a line of the bubble: the price is the drawing, give or take a rounding of the chip's box.
        expect(Math.abs(drawn - priced), `drawn ${drawn.toFixed(1)}px, priced ${priced.toFixed(1)}px, line ${line.toFixed(1)}px`)
          .toBeLessThanOrEqual(line / 2);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });
  }
});

describe('the chat draws a pointer as a chip in its place and opens the file', () => {
  for (const view of VIEWS) {
    it(named(view), async () => {
      const opened = await openApp(browser!, view, FIXTURE);
      const { ctx, page, errors } = opened;
      try {
        await ctx.route(`**/api/sessions/${SID}/clip/${CLIP_NAME}`, (r) =>
          r.fulfill({ status: 200, contentType: 'text/plain', headers: { 'x-content-type-options': 'nosniff' }, body: LONG }));
        await ctx.routeWebSocket(/\/ws\/session\//, (ws) => {
          ws.send(JSON.stringify({
            type: 'backlog', uuid: 'u-1', offset: 1, file: '/w/t.jsonl', missing: false, searchComplete: true, fileMeasured: true,
            events: [{ kind: 'user', uuid: 'e1', ts: '2026-11-27T10:00:00.000Z', text: `look at this\n${POINTER}\nand fix it` }],
          }));
        });
        await page.goto(`${server!.origin}/s/${SID}`);
        const chip = page.locator('.msg-user a.msg-paste');
        await chip.waitFor({ timeout: 20_000 });
        const order = await page.locator('.msg-user').first().evaluate((b) =>
          Array.from(b.childNodes).map((n) => (n instanceof HTMLAnchorElement ? 'chip' : (n.textContent ?? '').trim())));
        expect(order).toEqual(['look at this', 'chip', 'and fix it']);
        expect(await chip.textContent()).toBe('≡Pasted text · 214 lines');
        expect(await chip.evaluate(contrastOf)).toBeGreaterThanOrEqual(4.5);
        const inside = await chip.evaluate((a) => {
          const b = a.closest('.msg-user')!.getBoundingClientRect();
          const r = a.getBoundingClientRect();
          return r.left >= b.left - 0.5 && r.right <= b.right + 0.5;
        });
        expect(inside).toBe(true);
        expect((await chip.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        expect(await noSidewaysScroll(page)).toBe(true);
        const [tab] = await Promise.all([ctx.waitForEvent('page'), chip.click()]);
        await tab.waitForLoadState();
        expect(new URL(tab.url()).pathname).toBe(`/api/sessions/${SID}/clip/${CLIP_NAME}`);
        expect(await tab.evaluate(() => document.body.innerText)).toContain('row 214');
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });
  }
});
