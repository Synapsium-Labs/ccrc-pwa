// Paste chips in a real Chrome over the production build (desktop-polish wave 169; Goals modification 90, second
// half). A long text written to the clipboard and pasted with the keyboard shows as ONE token in the composer's field
// and ONE chip in the row above it, and the send makes ONE request whose `text` is the full pasted text. The browser's
// own undo and redo of the insertion keep the token's text (the paste goes in through `execCommand('insertText')`, so
// the history holds it), and Backspace against the token takes all of it. At a phone width with a touch screen the
// chip's controls reach the 44px floor, and the page does not scroll sideways, in both skins.
//
// The clipboard is Chrome's own (`navigator.clipboard.writeText` with the context granted clipboard access for the
// served origin), not the operating system's; the prompt route is simulated (`{"ok":true}`), so this pins the browser
// boundary only, as the paste-reliability note's §2 does.
//
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/paste-chips.browser.test.ts )`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type AppView, type DistServer } from './app';

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

/** 40 lines with tabs, inner blank lines and trailing spaces, about 2 KB, with no edge whitespace (so today's
 *  whole-message trim leaves it as it is) and a tail label to find. */
const LONG = Array.from({ length: 40 }, (_, i) => (i % 9 === 4 ? '' : `\tline ${String(i + 1).padStart(2, '0')}\tof the paste probe   ${'x'.repeat(20)}`))
  .join('\n') + '\nZQX-END-chip';
const TOKEN = '[Pasted text #1 +41 lines]';

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

/** Open the session screen at `view`, recording every prompt request's body. */
const open = async (view: AppView) => {
  const opened = await openApp(browser!, view, FIXTURE);
  await opened.ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: server!.origin });
  const bodies: unknown[] = [];
  await opened.page.route('**/api/sessions/*/prompt', async (route) => {
    bodies.push(JSON.parse(route.request().postData() ?? 'null'));
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });
  await opened.page.goto(`${server!.origin}/s/${SESSION.id}`);
  const field = opened.page.getByRole('textbox', { name: 'Message' });
  await field.waitFor({ timeout: 20_000 });
  return { ...opened, bodies, field };
};

const pasteLong = async (page: Page, field: ReturnType<Page['getByRole']>): Promise<void> => {
  await page.evaluate((text) => navigator.clipboard.writeText(text), LONG);
  await field.click();
  await page.keyboard.press('Control+V');
};

const chipCount = (page: Page): Promise<number> =>
  page.getByRole('list', { name: 'Pasted text' }).getByRole('listitem').count();

describe('a long paste shows one chip and sends the full text in one request', () => {
  for (const skin of [REFINED, INSTRUMENT]) {
    it(`${skin}, 1280px`, async () => {
      const s = await open({ skin, theme: PHOSPHOR, width: 1280 });
      try {
        await pasteLong(s.page, s.field);
        await expect.poll(() => s.field.inputValue()).toBe(TOKEN);
        expect(await chipCount(s.page)).toBe(1);
        await s.page.keyboard.press('Enter');
        await expect.poll(() => s.bodies.length, { timeout: 5_000 }).toBe(1);
        await s.page.waitForTimeout(300);
        expect(s.bodies).toEqual([{ text: LONG }]);
        expect(await s.field.inputValue()).toBe('');
        expect(await s.page.getByRole('list', { name: 'Pasted text' }).count()).toBe(0);
        expect(s.errors).toEqual([]);
      } finally {
        await s.ctx.close();
      }
    });
  }

  it('the browser’s undo and redo of the insertion keep the token’s text; Backspace takes the whole token', async () => {
    const s = await open({ skin: REFINED, theme: PHOSPHOR, width: 1280 });
    try {
      await pasteLong(s.page, s.field);
      await expect.poll(() => s.field.inputValue()).toBe(TOKEN);
      await s.page.keyboard.press('Control+Z');
      await expect.poll(() => s.field.inputValue()).toBe('');
      await s.page.keyboard.press('Control+Shift+Z');
      await expect.poll(() => s.field.inputValue()).toBe(TOKEN);
      expect(await chipCount(s.page)).toBe(1);
      await s.page.keyboard.press('End');
      await s.page.keyboard.press('Backspace');
      await expect.poll(() => s.field.inputValue()).toBe('');
      expect(await s.page.getByRole('list', { name: 'Pasted text' }).count()).toBe(0);
      // Undo of the Backspace brings the token back, still with its text.
      await s.page.keyboard.press('Control+Z');
      await expect.poll(() => s.field.inputValue()).toBe(TOKEN);
      await s.page.keyboard.press('Enter');
      await expect.poll(() => s.bodies.length, { timeout: 5_000 }).toBe(1);
      expect(s.bodies).toEqual([{ text: LONG }]);
      expect(s.errors).toEqual([]);
    } finally {
      await s.ctx.close();
    }
  });
});

describe('at a phone width the chip’s controls reach the floor and the page does not scroll sideways', () => {
  for (const skin of [REFINED, INSTRUMENT]) {
    for (const theme of [PHOSPHOR, 'light']) {
      it(`${skin}, ${theme}, 390px`, async () => {
        const s = await open({ skin, theme, width: 390 });
        try {
          await pasteLong(s.page, s.field);
          await expect.poll(() => s.field.inputValue()).toBe(TOKEN);
          for (const name of ['Expand pasted text #1, 41 lines, into the message', 'Remove pasted text #1']) {
            const box = await s.page.getByRole('button', { name }).boundingBox();
            expect(box, name).not.toBeNull();
            expect(box!.width, name).toBeGreaterThanOrEqual(44);
            expect(box!.height, name).toBeGreaterThanOrEqual(44);
          }
          const sideways = await s.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
          expect(sideways).toBeLessThanOrEqual(0);
          await s.page.getByRole('button', { name: 'Expand pasted text #1, 41 lines, into the message' }).click();
          await expect.poll(() => s.field.inputValue()).toBe(LONG);
          expect(s.errors).toEqual([]);
        } finally {
          await s.ctx.close();
        }
      });
    }
  }
});
