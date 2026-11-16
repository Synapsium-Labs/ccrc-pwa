// Mint and Sign in at every width (accounts plan Task A22 Step 4, D-7849; spec 2026-10-18 accounts-connect §6.1–§6.3,
// §12.1–§12.4). Sixteen cells: phone 360 and 390, laptop 1280 and wide 1920, both skins, dark and light, in a real
// Chrome over the production build, with no fleet behind it: the routes are answered by the fixture below.
//
// Each cell walks the mint (the default) and reads, at every step: the skin and theme drawn are the ones the cell names,
// and nothing scrolls sideways (the page, or the sheet).
//  - The method radio: Mint first and checked, as the provider table orders it (spec §20: the plan's matrix draws it
//    first, unlike mockup A11).
//  - The URL card: below 900, Copy link is the primary and full width, Open ↗ secondary; at ≥900, Open is a 52px
//    primary with the server's host in mono beside it on the same row, and Copy link secondary.
//  - The countdown is amber (`--status-attention-text`) while the sheet waits on the code, and the ledger's last line
//    pulses with the attention period.
//  - At 360 and 390, with the keyboard up (the viewport cut to 508px tall), the focused code field and Send are inside
//    the viewport, the field's text is at least 16px (no iOS zoom), and nothing scrolls sideways.
//  - A terminal state (Cancel): its sentence, Start again and Discard this lane, in the sheet's width.
//  - The result frame after Start again, a code and `done`: Turn it on, the stated-account field, the wrong-account act
//    and the compromise disclosure.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { INSTRUMENT, PHOSPHOR, REFINED } from '@ccrc/ui';
import { resolveChrome } from './harness';
import { openApp, serveDist, sharedDist, type AppFixture, type AppView, type DistServer } from './app';
import { PROVIDERS } from '../../shared/providers';

const THEMES = [PHOSPHOR, 'light'];
const SKINS = [REFINED, INSTRUMENT];
const WIDTHS = [360, 390, 1280, 1920];
const VIEWS: AppView[] = SKINS.flatMap((skin) => THEMES.flatMap((theme) => WIDTHS.map((width) => ({ skin, theme, width }))));
const named = (v: AppView): string => `${v.skin}, ${v.theme}, ${v.width}px`;

const now = Date.now();
const nowSec = Math.floor(now / 1000);
const acct = (wrapper: string): Record<string, unknown> => ({
  wrapper, five: 12, seven: 30, ts: nowSec - 60, fiveResetAt: null, sevenResetAt: null,
  fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false,
});
const rostered = (id: string, hue: string): Record<string, unknown> => ({
  id, label: id, hue, homeAble: true, hidden: false, pool: null, provider: 'anthropic', kind: 'token',
});
const READY = { state: { word: 'signed-in', source: 'checked just now', at: now }, ready: true, check: { verdict: 'ok', at: now } };
const OFF = { state: { word: 'off', source: 'Off on the fleet host' }, ready: false, notReadyReason: 'not-checked' };
const ROSTER = [rostered('lane-a', 'cyan'), rostered('lane-b', 'violet')];
const ACCOUNTS = {
  accounts: [acct('lane-a'), acct('lane-b')],
  projected: { wrapper: 'lane-a', score: 12 },
  roster: ROSTER,
  lanes: { 'lane-a': READY, 'lane-b': READY },
  connect: {
    accountOps: 'available', gate: 'armed', origin: 'https', caps: ['account-v2', 'account-auth-v1'], stepUpFreshUntil: now + 3_600_000,
  },
};
const ID = 'lane-c';
const ATTEMPT = 'c'.repeat(32);
const URL = 'https://claude.com/cai/oauth/authorize?code=true&client_id=x&response_type=code&scope=user%3Ainference&state=s';
const FIXTURE: AppFixture = {
  api: { '/api/feed': { events: [] }, '/api/accounts': ACCOUNTS },
  fleetFrames: [{ type: 'fleet', sessions: [] }],
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

/** The fake box's sign-in: the add, the attempt, its status (`phase`), the code, the cancel and the check. */
async function signInRoutes(ctx: BrowserContext): Promise<void> {
  let phase: 'starting' | 'waiting-code' | 'exchanging' | 'done' = 'starting';
  const expiresAt = Date.now() + 7 * 60_000 + 30_000;
  const json = (body: unknown): { status: number; contentType: string; body: string } =>
    ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  await ctx.route('**/api/accounts', async (route) => {
    if (route.request().method() !== 'POST') { await route.fallback(); return; }
    await route.fulfill(json({ ok: true, roster: [...ROSTER, rostered(ID, 'blue')], lane: OFF, fleetIdentity: null }));
  });
  await ctx.route(`**/api/accounts/${ID}/**`, async (route) => {
    const p = new globalThis.URL(route.request().url()).pathname;
    if (p.endsWith('/auth/start')) { phase = 'waiting-code'; await route.fulfill(json({ ok: true, attemptId: ATTEMPT, expiresAt })); return; }
    if (p.endsWith('/auth/code')) { phase = 'exchanging'; await route.fulfill(json({ ok: true })); return; }
    if (p.endsWith('/auth/cancel')) { phase = 'starting'; await route.fulfill(json({ ok: true })); return; }
    if (p.endsWith('/auth')) {
      const st = phase;
      if (phase === 'exchanging') phase = 'done';
      await route.fulfill(json(st === 'waiting-code'
        ? { ok: true, state: st, url: URL, host: 'claude.com', updatedAt: Date.now(), expiresAt }
        : { ok: true, state: st, updatedAt: Date.now(), expiresAt }));
      return;
    }
    if (p.endsWith('/check')) { await route.fulfill(json({ ok: true, lane: READY })); return; }
    await route.fallback();
  });
}

/** What every step reads: the skin and theme drawn, and whether anything scrolls sideways. */
async function frame(page: Page): Promise<{ skin: string | null; theme: string; docOverflow: number; sheetOverflow: number }> {
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

describe('Mint and Sign in at every width and skin (D-7849)', () => {
  for (const view of VIEWS) {
    it(named(view), async () => {
      const desk = view.width >= 900;
      const step = async (page: Page, what: string): Promise<void> => {
        const f = await frame(page);
        expect([f.skin, f.theme], `${what}: the cell draws the skin and theme it names`).toEqual([view.skin, view.theme]);
        expect(f.docOverflow, `${what}: no horizontal page scroll`).toBeLessThanOrEqual(0);
        expect(f.sheetOverflow, `${what}: nothing scrolls sideways in the sheet`).toBeLessThanOrEqual(1);
      };
      const { ctx, page, errors } = await openApp(browser!, view, FIXTURE);
      try {
        await signInRoutes(ctx);
        await page.goto(server!.origin + '/');
        await go(page, '/accounts');
        await page.waitForSelector('.accounts-row[data-lane="lane-b"]', { timeout: 30_000 });

        // Provider → Name it → Method.
        await page.click('.acct-door, .acct-door-action');
        await page.waitForSelector('[data-frame="provider"]');
        await page.click('[data-frame="provider"] button.opt');
        await page.waitForSelector('[data-frame="name"]');
        await page.fill('[data-frame="name"] input.font-mono', ID);
        await page.fill('[data-frame="name"] .acct-field:nth-of-type(2) input', 'Lane C');
        await page.click('[data-frame="name"] button.btn-primary');
        await page.waitForSelector('[data-frame="method"]');
        const m = await page.evaluate(() => [...document.querySelectorAll<HTMLInputElement>('input[name="acct-method"]')]
          .map((r) => ({ value: r.value, checked: r.checked, disabled: r.disabled })));
        expect(m.map((r) => r.value), 'the radio follows the provider table').toEqual([...PROVIDERS.anthropic.connect]);
        expect(m[0], 'Mint is first and checked').toEqual({ value: 'setup-token', checked: true, disabled: false });
        expect(m.every((r) => !r.disabled), 'no method is narrowed on a fleet that advertises account-auth-v1').toBe(true);
        await step(page, 'method frame');

        // The URL card.
        await page.click('[data-frame="method"] button.btn-primary');
        await page.waitForSelector('.acct-url-card', { timeout: 30_000 });
        const card = await page.evaluate(() => {
          const c = document.querySelector<HTMLElement>('.acct-url-card')!.getBoundingClientRect();
          const copy = [...document.querySelectorAll<HTMLButtonElement>('.acct-url-card button')].find((b) => b.textContent === 'Copy link')!;
          const open = document.querySelector<HTMLAnchorElement>('.acct-url-card a[href]')!;
          const host = document.querySelector<HTMLElement>('.acct-url-acts .acct-url-host');
          const o = open.getBoundingClientRect();
          const h = host?.getBoundingClientRect();
          return {
            copyPrimary: copy.classList.contains('btn-primary'),
            openPrimary: open.classList.contains('btn-primary'),
            copyWidth: copy.getBoundingClientRect().width,
            cardWidth: c.width,
            openHeight: o.height,
            rel: open.rel,
            target: open.target,
            hostText: host?.textContent ?? null,
            hostBeside: h === undefined ? false : h.left >= o.right - 1 && h.top < o.bottom && h.bottom > o.top,
          };
        });
        expect(card.rel).toBe('noopener noreferrer');
        expect(card.target).toBe('_blank');
        if (desk) {
          expect(card.openPrimary, 'at ≥900 Open is the primary').toBe(true);
          expect(card.copyPrimary).toBe(false);
          expect(card.openHeight, 'the Open primary is 52px').toBeGreaterThanOrEqual(52);
          expect(card.hostText, "the host beside it is the server's").toBe('claude.com');
          expect(card.hostBeside, 'the mono host sits beside Open').toBe(true);
        } else {
          expect(card.copyPrimary, 'on a phone Copy link is the primary').toBe(true);
          expect(card.openPrimary).toBe(false);
          expect(card.copyWidth, 'Copy link takes the full width').toBeGreaterThanOrEqual(card.cardWidth - 1);
        }
        await step(page, 'URL card');

        // The countdown, amber while it waits on the code; the waiting line pulses.
        const amber = await page.evaluate(() => {
          const probe = document.createElement('span');
          probe.style.color = 'var(--status-attention-text)';
          document.querySelector('.sheet-panel')!.appendChild(probe);
          const want = getComputedStyle(probe).color;
          probe.remove();
          const cd = document.querySelector<HTMLElement>('.acct-countdown')!;
          const dot = document.querySelector<HTMLElement>('.acct-ledger > li[data-wait="true"] .acct-ledger-dot');
          return {
            same: getComputedStyle(cd).color === want, text: cd.textContent ?? '',
            pulse: dot === null ? '' : getComputedStyle(dot).animationName,
          };
        });
        expect(amber.same, 'the countdown is amber while it waits on the operator').toBe(true);
        expect(amber.text).toMatch(/^Expires at \d\d:\d\d · \d+:\d\d left$/);
        expect(amber.pulse, 'the waiting line pulses').not.toBe('');
        expect(amber.pulse).not.toBe('none');

        // The code field with the keyboard up (a phone's viewport, cut by the keyboard).
        if (!desk) {
          await page.setViewportSize({ width: view.width, height: 508 });
          await page.focus('.acct-code input');
          await page.evaluate(() => document.activeElement?.scrollIntoView({ block: 'nearest' }));
          const kb = await page.evaluate(() => {
            const input = document.querySelector<HTMLInputElement>('.acct-code input')!;
            const send = document.querySelector<HTMLButtonElement>('.acct-code-send')!;
            const i = input.getBoundingClientRect();
            const s = send.getBoundingClientRect();
            return {
              inView: i.top >= 0 && i.bottom <= innerHeight + 1, sendInView: s.top >= 0 && s.bottom <= innerHeight + 1,
              font: Number.parseFloat(getComputedStyle(input).fontSize), mono: getComputedStyle(input).fontFamily.toLowerCase().includes('mono'),
              width: i.width,
            };
          });
          expect(kb.inView, 'the focused code field is in the viewport with the keyboard up').toBe(true);
          expect(kb.sendInView, 'Send code is reachable with the keyboard up').toBe(true);
          expect(kb.font, 'the code field is at least 16px, so iOS does not zoom').toBeGreaterThanOrEqual(16);
          expect(kb.mono).toBe(true);
          expect(kb.width).toBeGreaterThanOrEqual(200);
          await step(page, 'code field, keyboard up');
          await page.setViewportSize({ width: view.width, height: 844 });
        }

        // A terminal state: Cancel.
        await page.click('.acct-connect button:text-is("Cancel")');
        await page.waitForSelector('.acct-connect button:text-is("Start the sign-in again")');
        const t = await page.evaluate(() => ({
          alert: document.querySelector('[data-testid="connect-alert"]')?.textContent ?? '',
          discard: [...document.querySelectorAll('.acct-connect button')].some((b) => b.textContent === 'Discard this lane'),
          link: document.querySelectorAll('.acct-connect a[href]').length,
        }));
        expect(t.alert).toBe('Sign-in cancelled. Nothing was stored. The lane is still there, off.');
        expect(t.discard).toBe(true);
        expect(t.link).toBe(0);
        await step(page, 'terminal state');

        // Start again, the code, done: the result frame.
        await page.click('.acct-connect button:text-is("Start the sign-in again")');
        await page.waitForSelector('.acct-code input', { timeout: 30_000 });
        await page.fill('.acct-code input', 'Q'.repeat(40));
        await page.click('.acct-code-send');
        await page.waitForSelector('[data-frame="result"]', { timeout: 30_000 });
        const r = await page.evaluate(() => ({
          turnOn: [...document.querySelectorAll('[data-frame="result"] button')].some((b) => b.textContent === 'Turn it on'),
          stated: document.querySelector('.acct-stated input') !== null,
          wrong: [...document.querySelectorAll('[data-frame="result"] button')].some((b) => b.textContent === 'Sign this lane out and start again'),
          compromise: document.querySelector('.acct-compromise') !== null,
          code: document.documentElement.outerHTML.includes('QQQQQQQQQQ'),
        }));
        expect(r).toEqual({ turnOn: true, stated: true, wrong: true, compromise: true, code: false });
        await step(page, 'result frame');
        expect(errors).toEqual([]);
      } finally {
        await ctx.close();
      }
    }, 90_000);
  }
});
