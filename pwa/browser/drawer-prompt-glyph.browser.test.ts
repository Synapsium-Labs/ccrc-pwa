// The drawer reads Claude Code's prompt glyph from its one spelling (W7 C7i, D-7187; OA-C16 (a)), in a real Chrome over
// the production build.
//
// `showsPrompt` (drawerView.ts) stays the PWA's one pane-text judgement, named legitimately different: it renders the
// PTY the drawer shows. Since C7i it reads `shared/pane-glyph.ts#PROMPT_GLYPH`, the spelling the server's dialog parser
// imports too, and nothing it draws moves. This file opens the terminal drawer at 360, 390, 1280 and 1920 in both skins
// and both palettes, writes a Claude Code screen (its `❯` input box) and then a screen with no glyph (a pager), and
// holds what the drawer draws: the wrapped view shows the prompt row's text and offers no grid while the glyph shows,
// and offers the grid once a screen has shown no glyph for two seconds; the grid view (where the window fits) never
// offers it. The page does not scroll sideways, and no page error is thrown.
//
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/drawer-prompt-glyph.browser.test.ts )`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type WebSocketRoute } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { buildDist, openApp, removeDist, serveDist, type AppFixture, type AppView, type DistServer } from './app';

const VIEWS: AppView[] = [REFINED, INSTRUMENT].flatMap((skin) => [PHOSPHOR, 'light'].flatMap((theme) =>
  [360, 390, 1280, 1920].map((width) => ({ skin, theme, width }))));
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

/** Claude Code's screen: a reply, its input box with the `❯` prompt and a no-break space, on the alternate screen. */
const CLAUDE_SCREEN = '\x1b[?1049h\x1b[2J\x1b[H● The census landed.\r\n\r\n╭────────────╮\r\n│ ❯ fix the drawer │\r\n╰────────────╯\r\n';
/** A pager's screen: no prompt glyph anywhere. */
const PAGER_SCREEN = '\x1b[2J\x1b[Hline one of the pager\r\nline two of the pager\r\n(END)';
const OFFER = 'This screen shows no Claude Code prompt, so the grid may read better. Show the grid';

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

describe('the drawer judges the prompt glyph as it did, from the one spelling (C7i, D-7187)', () => {
  for (const view of VIEWS) {
    it(named(view), async () => {
      const { ctx, page, errors } = await openApp(browser!, view, FIXTURE);
      let pty: WebSocketRoute | undefined;
      try {
        await ctx.routeWebSocket(/\/ws\/pty\//, (ws) => { pty = ws; ws.send(CLAUDE_SCREEN); });
        await page.goto(`${server!.origin}/s/${SESSION.id}`);
        await page.getByRole('button', { name: 'Terminal' }).first().click();
        await page.locator('.term-eyebrow').waitFor({ timeout: 20_000 });
        await page.locator('.term-host--off, .term-host--grid').first().waitFor({ timeout: 20_000 });
        const wrapped = (await page.locator('.term-host--off').count()) > 0;
        // The view the drawer chose, measured on the base: the wrapped view below 1920, the grid at 1920.
        expect(wrapped ? 'wrapped' : 'grid', 'the drawer\'s view').toBe(view.width < 1920 ? 'wrapped' : 'grid');
        await page.waitForTimeout(2_600);
        const withGlyph = await page.evaluate(() => ({
          wrap: document.querySelector('.term-wrap')?.textContent ?? '',
          pageSide: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        }));
        expect(await page.getByRole('button', { name: OFFER }).count(), 'no grid offer while the glyph shows').toBe(0);
        if (wrapped) expect(withGlyph.wrap, 'the wrapped view draws the prompt row').toContain('❯');
        expect(withGlyph.pageSide, 'the page has no sideways scroll').toBe(0);

        expect(pty, 'the drawer attached').toBeDefined();
        pty!.send(PAGER_SCREEN);
        await page.waitForTimeout(2_600);
        const offers = await page.getByRole('button', { name: OFFER }).count();
        expect(offers, wrapped ? 'the wrapped view offers the grid after two seconds with no glyph' : 'the grid offers nothing')
          .toBe(wrapped ? 1 : 0);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    });
  }
});
