// Resume on any route and the switch to a long-lived token, at every width (accounts plan Task A23 Step 4, D-7871; spec
// 2026-10-18 accounts-connect §6.2, §9, §16). Sixteen cells: phone 360 and 390, laptop 1280 and wide 1920, both skins,
// dark and light, in a real Chrome over the production build, with no fleet behind it: the routes are answered by the
// fixture below. The lane is a sign-in lane whose switch to the token this session started and left at its code.
//
// Each cell reads, at every step: the skin and theme drawn are the ones the cell names, and nothing scrolls sideways.
//  - The banner on the fleet screen, on a session and on Settings: exactly one on screen, inside the viewport's width,
//    never over the tab bar, and on the session never over the composer, which stays inside the viewport.
//  - A relaunch at `/` (spec §16, its own cell): the banner is back, read from the server's answer alone.
//  - Continue: the switch sheet at its code field, with the countdown; then the code and `done`: the fresh check, the
//    sessions list with Restart, and Sign the old sign-in out as the danger confirm (a session predates the switch).
//
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts
// --maxWorkers=2 browser/auth-resume.browser.test.ts )`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { backlogFrame, longTranscript, openApp, serveDist, sharedDist, type AppFixture, type AppView, type DistServer } from './app';
import { fleetSession } from '../test/fleetFixture';

const THEMES = [PHOSPHOR, 'light'];
const SKINS = [REFINED, INSTRUMENT];
const WIDTHS = [360, 390, 1280, 1920];
const VIEWS: AppView[] = SKINS.flatMap((skin) => THEMES.flatMap((theme) => WIDTHS.map((width) => ({ skin, theme, width }))));
const named = (v: AppView): string => `${v.skin}, ${v.theme}, ${v.width}px`;

const now = Date.now();
const nowSec = Math.floor(now / 1000);
const LANE = 'lane-b';
const ATTEMPT = 'c'.repeat(32);
const EXPIRES = now + 7 * 60_000 + 30_000;
const URL = 'https://claude.com/cai/oauth/authorize?code=true&client_id=x&response_type=code&scope=user%3Ainference&state=s';
const SID = 'lane-b-project-a-quiet-basin';
const SESSION = fleetSession({
  id: SID, wrapper: LANE, home: LANE, project: 'project-a', workdir: '/w/project-a/quiet-basin',
  workspace: 'quiet-basin', name: 'quiet-basin', status: 'idle', bucket: 'idle', model: 'model-x', effort: 'high',
});
const SIGNED_IN = {
  state: { word: 'signed-in', source: 'checked just now', at: now }, ready: true, check: { verdict: 'ok', at: now - 60_000 },
  identity: 'someone@example.invalid', identitySource: 'measured',
};
const ACCOUNTS = {
  accounts: [{
    wrapper: LANE, five: 12, seven: 30, ts: nowSec - 60, fiveResetAt: null, sevenResetAt: null,
    fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false,
  }],
  projected: { wrapper: LANE, score: 12 },
  roster: [{ id: LANE, label: LANE, hue: 'violet', homeAble: true, hidden: false, pool: null, provider: 'anthropic', kind: 'sign-in' }],
  lanes: {
    [LANE]: { ...SIGNED_IN, authAttempt: { state: 'waiting-code', expiresAt: EXPIRES, mine: true, attemptId: ATTEMPT, method: 'setup-token' } },
  },
  connect: {
    accountOps: 'available', gate: 'armed', origin: 'https', caps: ['account-v2', 'account-auth-v1'], stepUpFreshUntil: now + 3_600_000,
  },
};
const FIXTURE: AppFixture = {
  api: {
    '/api/feed': { events: [] }, '/api/accounts': ACCOUNTS,
    '/api/projects': { roots: ['/w'], projects: [{ name: 'project-a', workdir: '/w/project-a' }] },
    '/api/runs': [], '/api/claims': [],
  },
  fleetFrames: [{ type: 'fleet', sessions: [SESSION] }],
  socketFrames: { [`/ws/session/${SID}`]: [backlogFrame(longTranscript(8))] },
};

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

const go = (page: Page, to: string): Promise<void> => page.evaluate((path) => {
  history.pushState(null, '', path);
  dispatchEvent(new PopStateEvent('popstate'));
}, to);

/** The fake box's attempt: its status (`phase`), the code, the check and the sign-out. */
async function switchRoutes(ctx: BrowserContext): Promise<void> {
  let phase: 'waiting-code' | 'exchanging' | 'done' = 'waiting-code';
  const json = (body: unknown): { status: number; contentType: string; body: string } =>
    ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  await ctx.route(`**/api/accounts/${LANE}/**`, async (route) => {
    const p = new globalThis.URL(route.request().url()).pathname;
    if (p.endsWith('/auth/code')) { phase = 'exchanging'; await route.fulfill(json({ ok: true })); return; }
    if (p.endsWith('/auth/cancel')) { await route.fulfill(json({ ok: true })); return; }
    if (p.endsWith('/auth')) {
      const st = phase;
      if (phase === 'exchanging') phase = 'done';
      await route.fulfill(json(st === 'waiting-code'
        ? { ok: true, state: st, url: URL, host: 'claude.com', updatedAt: Date.now(), expiresAt: EXPIRES }
        : { ok: true, state: st, updatedAt: Date.now(), expiresAt: EXPIRES }));
      return;
    }
    if (p.endsWith('/check')) { await route.fulfill(json({ ok: true, lane: SIGNED_IN })); return; }
    if (p.endsWith('/credential')) { await route.fulfill(json({ ok: true, signOut: 'removed', lane: SIGNED_IN })); return; }
    await route.fallback();
  });
}

interface Frame { skin: string | null; theme: string; docOverflow: number; sheetOverflow: number }
async function frame(page: Page): Promise<Frame> {
  return page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('.sheet-panel');
    return {
      skin: document.documentElement.getAttribute('data-skin'),
      theme: document.documentElement.getAttribute('data-theme') ?? 'phosphor',
      docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      sheetOverflow: panel === null ? 0 : panel.scrollWidth - panel.clientWidth,
    };
  });
}

/** The banners on screen (a CSS-hidden column's would have no box), and what each one could cover. */
async function banner(page: Page): Promise<{
  shown: number; left: number; right: number; width: number; overNav: boolean; overComposer: boolean;
  composerInView: boolean | null;
}> {
  return page.evaluate(() => {
    const shown = [...document.querySelectorAll<HTMLElement>('.auth-resume')].filter((b) => b.getClientRects().length > 0);
    const r = shown[0]?.getBoundingClientRect();
    const over = (sel: string): boolean => {
      const el = document.querySelector<HTMLElement>(sel);
      if (r === undefined || el === null || el.getClientRects().length === 0) return false;
      const o = el.getBoundingClientRect();
      return r.left < o.right && r.right > o.left && r.top < o.bottom && r.bottom > o.top;
    };
    const composer = document.querySelector<HTMLElement>('.composer');
    const c = composer?.getBoundingClientRect();
    return {
      shown: shown.length, left: r?.left ?? -1, right: r?.right ?? -1, width: innerWidth,
      overNav: over('.shell-phone-nav'), overComposer: over('.composer'),
      composerInView: c === undefined || composer!.getClientRects().length === 0 ? null : c.top >= 0 && c.bottom <= innerHeight + 1,
    };
  });
}

describe('resume on any route, and the switch to the token, at every width and skin (D-7871)', () => {
  for (const view of VIEWS) {
    it(named(view), async () => {
      const step = async (page: Page, what: string): Promise<void> => {
        const f = await frame(page);
        expect([f.skin, f.theme], `${what}: the cell draws the skin and theme it names`).toEqual([view.skin, view.theme]);
        expect(f.docOverflow, `${what}: no horizontal page scroll`).toBeLessThanOrEqual(0);
        expect(f.sheetOverflow, `${what}: nothing scrolls sideways in the sheet`).toBeLessThanOrEqual(1);
      };
      const onScreen = async (page: Page, what: string, composer: boolean): Promise<void> => {
        await page.waitForFunction(() => [...document.querySelectorAll('.auth-resume')].some((b) => b.getClientRects().length > 0), null, { timeout: 30_000 });
        const b = await banner(page);
        expect(b.shown, `${what}: one banner on screen`).toBe(1);
        expect(b.left, `${what}: inside the viewport's width`).toBeGreaterThanOrEqual(0);
        expect(b.right, `${what}: inside the viewport's width`).toBeLessThanOrEqual(b.width + 0.5);
        expect(b.overNav, `${what}: never over the tab bar`).toBe(false);
        if (composer) {
          expect(b.overComposer, `${what}: never over the composer`).toBe(false);
          expect(b.composerInView, `${what}: the composer stays inside the viewport`).toBe(true);
        }
        await step(page, what);
      };
      const { ctx, page, errors } = await openApp(browser!, view, FIXTURE);
      try {
        await switchRoutes(ctx);
        await page.goto(server!.origin + '/');
        await onScreen(page, 'the fleet screen', false);
        const text = await page.locator('.auth-resume-text').filter({ visible: true }).first().textContent();
        expect(text).toMatch(/^A sign-in for lane-b is waiting for its code · \d+ min left$/);

        await go(page, `/s/${SID}`);
        await page.waitForSelector('.composer', { timeout: 30_000 });
        await page.waitForTimeout(300);
        await onScreen(page, 'a session', true);

        await go(page, '/settings');
        await onScreen(page, 'Settings', false);

        // A relaunch at `/` (spec §16): the banner is back, from the server's answer alone.
        await page.goto(server!.origin + '/');
        await onScreen(page, 'a relaunch at /', false);

        // Continue: the switch sheet at its code field, its countdown read from `expiresAt`.
        await page.locator('.auth-resume-continue').filter({ visible: true }).first().click();
        await page.waitForSelector('.acct-code input', { timeout: 30_000 });
        const sheet = await page.evaluate(() => ({
          title: document.querySelector('[role="dialog"]')?.textContent ?? '',
          countdown: document.querySelector('.acct-countdown')?.textContent ?? '',
        }));
        expect(sheet.title).toContain('Switch lane-b to a long-lived token');
        expect(sheet.countdown).toMatch(/^Expires at \d\d:\d\d · \d+:\d\d left$/);
        await step(page, 'the resumed code field');

        // The code and `done`: the fresh check, the session to restart, and the danger confirm.
        await page.fill('.acct-code input', 'Q'.repeat(40));
        await page.click('.acct-code-send');
        await page.waitForSelector('[data-frame="switched"]', { timeout: 30_000 });
        await page.click('[data-sign-old-out="danger"] button:text-is("Sign the old sign-in out")');
        await page.waitForSelector('.acct-wrong-confirm', { timeout: 10_000 });
        const end = await page.evaluate(() => ({
          restart: [...document.querySelectorAll('[data-frame="switched"] button')].some((b) => b.textContent === 'Restart'),
          danger: document.querySelector('.acct-wrong-confirm')?.textContent ?? '',
          anyway: [...document.querySelectorAll('.acct-wrong-confirm button')].some((b) => b.textContent === 'Sign it out anyway' && b.classList.contains('btn-danger')),
          close: document.querySelector('[data-switch-close]')?.textContent ?? '',
          code: document.documentElement.outerHTML.includes('QQQQQQQQQQ'),
        }));
        expect(end.restart).toBe(true);
        expect(end.danger).toContain('1 session on lane-b still uses the sign-in and may fail its next turn.');
        expect(end.anyway).toBe(true);
        expect(end.close).toBe("Sessions on this lane won't ask you to sign in again for about a year.");
        expect(end.code).toBe(false);
        await step(page, 'the switch, done');
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 120_000);
  }
});
