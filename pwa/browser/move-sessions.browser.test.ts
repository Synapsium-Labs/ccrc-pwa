// The Move sessions sheet at every width (accounts plan Task A3 Step 4, D-7736; spec 2026-10-18 accounts-connect §4.5).
// Four sessions on lane-b, which is signed out (one idle, one busy, one hibernated, one idle with a long name), and two
// lanes to move them to. Sixteen cells: phone 360 and 390, laptop 1280 and wide 1920, both skins, light and dark.
//
// Each cell opens the sheet from lane-b's trouble card ("Move 4 sessions off") and reads: the skin and theme the cell
// names; no horizontal page scroll and nothing wider than the sheet; the session rows stacked one under another, each
// outcome word right-aligned on its row and never truncated (the long name wraps instead); on a coarse pointer every
// target in the sheet at 44px; the container the sheet decides from the width (the bottom sheet below 900, the centred
// dialog from 900). Then it moves them: the second swap is held, and the progress line reads "Moving 2 of 4" in a
// polite live region while the first row already says moved; released, the busy one is skipped and the asleep one
// refused, each in its word, and the line says what moved.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { fleetSession, hibernatedSession } from '../test/fleetFixture';
import { buildDist, openApp, removeDist, serveDist, type AppFixture, type AppView, type DistServer } from './app';

const THEMES = [PHOSPHOR, 'light'];
const SKINS = [REFINED, INSTRUMENT];
const WIDTHS = [360, 390, 1280, 1920];
const VIEWS: AppView[] = SKINS.flatMap((skin) => THEMES.flatMap((theme) => WIDTHS.map((width) => ({ skin, theme, width }))));
const named = (v: AppView): string => `${v.skin}, ${v.theme}, ${v.width}px`;

const now = Date.now();
const nowSec = Math.floor(now / 1000);
const acct = (wrapper: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  wrapper, five: 12, seven: 30, ts: nowSec - 60, fiveResetAt: null, sevenResetAt: null,
  fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false, ...over,
});
const rostered = (id: string, hue: string): Record<string, unknown> => ({
  id, label: id, hue, homeAble: true, hidden: false, pool: null, provider: 'anthropic', kind: 'sign-in',
});
const ACCOUNTS = {
  accounts: [acct('lane-a'), acct('lane-b', { authDead: true }), acct('lane-c', { five: 40, seven: 50 })],
  projected: { wrapper: 'lane-a', score: 30 },
  roster: [rostered('lane-a', 'cyan'), rostered('lane-b', 'amber'), rostered('lane-c', 'violet')],
  lanes: {
    'lane-a': { state: { word: 'signed-in', source: 'checked 4m ago', at: now - 240_000 }, ready: true },
    'lane-b': { state: { word: 'signed-out', source: 'HTTP 401 · checked 2h ago', at: now - 7_200_000 }, ready: false },
    'lane-c': { state: { word: 'signed-in', source: 'checked 6m ago', at: now - 360_000 }, ready: true },
  },
};
const on = { wrapper: 'lane-b', home: 'lane-b' };
const SESSIONS = [
  fleetSession({ ...on, id: 'lane-b-one', project: 'demo', title: 'one' }),
  fleetSession({ ...on, id: 'lane-b-two', project: 'demo', title: 'two', status: 'busy' }),
  hibernatedSession(now - 3_600_000, { ...on, id: 'lane-b-three', project: 'demo', title: 'three' }),
  fleetSession({
    ...on, id: 'lane-b-four', project: 'demo-with-a-long-project-name',
    title: 'four, a session whose title is long enough to wrap on a phone',
  }),
];
const FIXTURE: AppFixture = {
  api: { '/api/feed': { events: [] }, '/api/accounts': ACCOUNTS },
  fleetFrames: [{ type: 'fleet', sessions: SESSIONS }],
};
const swapPath = (id: string): string => `/api/sessions/${id}/swap`;

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

/** What the page measures of the open sheet, in one read. */
interface Measured {
  readonly skin: string | null;
  readonly theme: string;
  readonly docOverflow: number;
  readonly sheetOverflow: number;
  readonly rows: number;
  readonly stacked: boolean;
  readonly wordsOffRight: string[];
  readonly truncatedWords: string[];
  readonly smallTargets: string[];
  readonly animation: string;
  readonly rect: { x: number; y: number; w: number; h: number };
  readonly vw: number;
  readonly vh: number;
}

const measure = (page: import('playwright-core').Page): Promise<Measured> => page.evaluate(async () => {
  const panel = document.querySelector<HTMLElement>('.sheet-panel')!;
  await Promise.all(panel.getAnimations().map((a) => a.finished.catch(() => undefined)));
  const rect = (el: Element): DOMRect => el.getBoundingClientRect();
  const rows = [...panel.querySelectorAll<HTMLElement>('.move-row')];
  const tops = rows.map((r) => rect(r).top);
  const b = rect(panel);
  return {
    skin: document.documentElement.getAttribute('data-skin'),
    theme: document.documentElement.getAttribute('data-theme') ?? 'phosphor',
    docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    sheetOverflow: Math.max(...[...panel.querySelectorAll<HTMLElement>('*')].map((e) => rect(e).right)) - b.right,
    rows: rows.length,
    stacked: tops.every((t, i) => i === 0 || t >= rect(rows[i - 1]!).bottom - 1),
    wordsOffRight: rows.filter((r) => {
      const w = r.querySelector('.move-word');
      return w !== null && Math.abs(rect(w).right - rect(r).right) > 1;
    }).map((r) => r.textContent!),
    truncatedWords: [...panel.querySelectorAll<HTMLElement>('.move-word')]
      .filter((w) => w.scrollWidth > w.clientWidth + 1 || getComputedStyle(w).textOverflow === 'ellipsis').map((w) => w.textContent!),
    smallTargets: matchMedia('(pointer: coarse)').matches
      ? [...panel.querySelectorAll<HTMLElement>('button')].filter((t) => rect(t).height < 44).map((t) => t.textContent!)
      : [],
    animation: getComputedStyle(panel).animationName,
    rect: { x: b.x, y: b.y, w: b.width, h: b.height },
    vw: innerWidth,
    vh: innerHeight,
  };
});

describe('the Move sessions sheet at every width and skin (D-7736)', () => {
  for (const view of VIEWS) {
    it(named(view), async () => {
      const app = await openApp(browser!, view, FIXTURE);
      const { ctx, page, errors } = app;
      try {
        // The route's own refusals for the busy and the asleep session; the second one's answer waits for the test.
        let release = (): void => undefined;
        const held = new Promise<void>((done) => { release = done; });
        await ctx.route((u) => u.pathname === swapPath('lane-b-two'), async (route) => {
          await held;
          await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'session-busy' }) });
        });
        await ctx.route((u) => u.pathname === swapPath('lane-b-three'), (route) => route.fulfill({
          status: 409, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'hibernated' }),
        }));
        await page.goto(server!.origin + '/');
        await page.evaluate(() => { history.pushState(null, '', '/accounts'); dispatchEvent(new PopStateEvent('popstate')); });
        const open = page.locator('.accounts-row[data-lane="lane-b"] button', { hasText: 'Move 4 sessions off' });
        await open.waitFor({ timeout: 30_000 });
        await open.click();
        await page.locator('.sheet-panel[data-state="open"]').waitFor({ timeout: 10_000 });

        const m = await measure(page);
        expect([m.skin, m.theme], 'the cell draws the skin and theme it names').toEqual([view.skin, view.theme]);
        expect(m.rows, 'every session on the lane, the asleep one too').toBe(4);
        expect(m.docOverflow, 'no horizontal page scroll').toBeLessThanOrEqual(0);
        expect(m.sheetOverflow, 'nothing wider than the sheet').toBeLessThanOrEqual(1);
        expect(m.stacked, 'the rows stack').toBe(true);
        expect(m.smallTargets, '44px targets on a coarse pointer').toEqual([]);
        if (view.width < 900) {
          expect(m.animation, 'the bottom sheet').toBe('slideFromBottom');
          expect(Math.round(m.rect.w)).toBe(m.vw);
          expect(Math.abs(m.rect.y + m.rect.h - m.vh), 'on the foot of the screen').toBeLessThanOrEqual(1);
        } else {
          expect(m.animation, 'the centred dialog').toBe('sheet-pop-in');
          expect(Math.abs(m.rect.x + m.rect.w / 2 - m.vw / 2), 'centred across').toBeLessThanOrEqual(1);
        }

        // Move them. The first answers at once; the second is held, so the line counts one answered.
        await page.locator('.sheet-panel button', { hasText: /^Move 4 sessions$/ }).click();
        const status = page.locator('.sheet-panel [role="status"]');
        await expect.poll(() => status.textContent(), { timeout: 10_000 }).toBe('Moving 2 of 4');
        expect(await status.getAttribute('aria-live')).toBe('polite');
        const word = (title: string) => page.locator('.move-row')
          .filter({ has: page.getByText(title, { exact: true }) }).locator('.move-word').textContent();
        expect(await word('one')).toBe('moved');
        expect(await word('two')).toBe('moving…');
        expect(await word('three')).toBe('waiting');
        release();
        await expect.poll(() => status.textContent(), { timeout: 10_000 }).toBe('Done: 2 of 4 moved.');
        expect(await word('two')).toBe('skipped: busy');
        expect(await word('three')).toBe('refused: asleep');
        expect(await word('four, a session whose title is long enough to wrap on a phone')).toBe('moved');

        const after = await measure(page);
        expect(after.wordsOffRight, 'each outcome word right-aligned').toEqual([]);
        expect(after.truncatedWords, 'no outcome word truncates').toEqual([]);
        expect(after.docOverflow, 'no horizontal page scroll after the move').toBeLessThanOrEqual(0);
        expect(after.sheetOverflow, 'nothing wider than the sheet after the move').toBeLessThanOrEqual(1);
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 90_000);
  }
});
